export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ChatCompletionResponse = {
  choices?: Array<{ message?: { content?: string | Array<{ type?: string; text?: string }> } }>;
  error?: { message?: string };
};
type ResponsesApiResponse = {
  output_text?: string;
  output?: Array<{ content?: Array<{ type?: string; text?: string }> }>;
};

export async function POST(request: Request) {
  let body: unknown;
  try { body = await request.json(); }
  catch { return Response.json({ error: "Send a valid JSON request." }, { status: 400 }); }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return Response.json({ error: "Send a valid chat request." }, { status: 400 });
  }
  const input = body as Record<string, unknown>;
  const message = typeof input.message === "string" ? input.message.trim().slice(0, 1200) : "";
  if (!message) return Response.json({ error: "Enter a question for the AirGuard assistant." }, { status: 400 });

  const apiKey = process.env.AI_API_KEY?.trim();
  const location = typeof input.location === "string" ? input.location.slice(0, 120) : "not selected";
  const aqi = typeof input.aqi === "number" && Number.isFinite(input.aqi) ? String(input.aqi) : "unavailable";
  const category = typeof input.category === "string" ? input.category.slice(0, 40) : "unavailable";
  const source = typeof input.source === "string" ? input.source.slice(0, 80) : "unavailable";
  const observedAt = typeof input.observedAt === "string" ? input.observedAt.slice(0, 40) : "unavailable";
  const history = Array.isArray(input.history) ? input.history.slice(-8).flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const entry = item as Record<string, unknown>;
    const role = entry.role === "assistant" ? "assistant" : entry.role === "user" ? "user" : null;
    const content = typeof entry.content === "string" ? entry.content.trim().slice(0, 1200) : "";
    return role && content ? [{ role, content }] : [];
  }) : [];
  const endpoint = process.env.AI_BASE_URL?.trim() || "https://api.openai.com/v1/responses";
  const model = process.env.AI_MODEL?.trim() || "gpt-4.1-mini";

  let url: URL;
  try {
    url = new URL(endpoint);
    if (url.protocol !== "https:" && !["localhost", "127.0.0.1"].includes(url.hostname)) throw new Error("HTTPS required");
  } catch {
    return Response.json({ error: "AI_BASE_URL must be a valid HTTPS URL (or a local model endpoint)." }, { status: 500 });
  }
  const localModel = ["localhost", "127.0.0.1"].includes(url.hostname);
  if (!apiKey && !localModel) {
    return Response.json({ error: "AI assistant is not configured yet. Set AI_API_KEY, AI_MODEL and AI_BASE_URL in .env.local, or run a local OpenAI-compatible model." }, { status: 503 });
  }

  try {
    const systemPrompt = "You are AirGuard's helpful air-quality assistant. Answer naturally using the live context supplied, and clearly distinguish CPCB monitoring-station observations from Open-Meteo/CAMS model estimates. Never invent measurements, locations, or medical facts. Give general exposure-reduction information only; do not diagnose, prescribe, or replace official advisories or clinicians. If data is unavailable or stale, say so plainly. Keep answers practical and concise.";
    const userPrompt = `Current app context (data may be unavailable): location=${location}; India AQI=${aqi}; category=${category}; source=${source}; observed at=${observedAt}. User question: ${message}`;
    const conversation = [...history, { role: "user", content: userPrompt }];
    const chatCompletions = /\/chat\/completions\/?$/i.test(url.pathname);
    const providerRequest = chatCompletions
      ? {
          model, temperature: 0.3, max_tokens: 500,
          messages: [{ role: "system", content: systemPrompt }, ...conversation],
        }
      : {
          model, temperature: 0.3, max_output_tokens: 500, store: false,
          input: [
            { role: "system", content: [{ type: "input_text", text: systemPrompt }] },
            ...conversation.map((entry) => ({ role: entry.role, content: [{ type: "input_text", text: entry.content }] })),
          ],
        };
    const response = await fetch(url, {
      method: "POST",
      headers: { ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}), "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(providerRequest),
      signal: AbortSignal.timeout(25_000),
      cache: "no-store",
    });
    const result = await response.json().catch(() => ({})) as ChatCompletionResponse & ResponsesApiResponse;
    if (!response.ok) return Response.json({ error: "AI provider could not answer right now." }, { status: 502 });
    const chatContent = result.choices?.[0]?.message?.content;
    const responseContent = result.output?.flatMap((item) => item.content || []).filter((part) => part.type === "output_text").map((part) => part.text || "").join("\n");
    const answer = typeof chatContent === "string"
      ? chatContent.trim()
      : Array.isArray(chatContent) ? chatContent.map((part) => part.text || "").join("\n").trim()
        : (result.output_text || responseContent || "").trim();
    if (!answer) return Response.json({ error: "AI provider returned an empty answer. Try again." }, { status: 502 });
    return Response.json({ answer, model }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ error: "AI provider is not reachable right now." }, { status: 502 });
  }
}
