export const runtime = "nodejs";
export async function GET(request: Request) {
  const query = new URL(request.url).searchParams.get("q")?.trim();
  if (!query || query.length < 2 || query.length > 100) return Response.json({ error: "Enter at least two characters to search." }, { status: 400 });
  try {
    const url = new URL("https://geocoding-api.open-meteo.com/v1/search"); url.search = new URLSearchParams({ name: query, count: "10", language: "en", format: "json", countryCode: "IN" }).toString();
    const response = await fetch(url, { signal: AbortSignal.timeout(8000) }); if (!response.ok) throw new Error("Geocoding service unavailable");
    const data = await response.json();
    return Response.json((data.results || []).filter((item: { country_code?: string }) => item.country_code === "IN").map((item: { name: string; admin1?: string; country?: string; latitude: number; longitude: number }) => ({ name: [item.name, item.admin1, "India"].filter(Boolean).join(", "), latitude: item.latitude, longitude: item.longitude })));
  } catch { return Response.json({ error: "Location search is temporarily unavailable." }, { status: 502 }); }
}
