import { verifyMongoConnection } from "@/lib/mongo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  let mongo: { ok: boolean; database?: string } = { ok: false };
  try { mongo = await verifyMongoConnection(); }
  catch { /* Do not return connection strings or provider errors to the browser. */ }
  const twilioReady = process.env.TWILIO_ENABLED === "true" &&
    Boolean(process.env.TWILIO_ACCOUNT_SID?.trim() &&
      (process.env.TWILIO_AUTH_TOKEN?.trim() || (process.env.TWILIO_API_KEY_SID?.trim() && process.env.TWILIO_API_KEY_SECRET?.trim())) &&
      process.env.TWILIO_WHATSAPP_NUMBER?.trim() &&
      process.env.TWILIO_WHATSAPP_GENERIC_CONTENT_SID?.trim() && process.env.TWILIO_WHATSAPP_CONTENT_SID?.trim());
  let localAiReady = false;
  try { localAiReady = ["localhost", "127.0.0.1"].includes(new URL(process.env.AI_BASE_URL || "https://api.openai.com/v1/chat/completions").hostname); }
  catch { /* Invalid endpoint is not ready. */ }
  const aiReady = Boolean(process.env.AI_API_KEY?.trim()) || localAiReady;
  return Response.json({
    status: mongo.ok ? "ok" : "degraded",
    mongo: mongo.ok
      ? { connected: true, database: mongo.database }
      : { connected: false, action: "Confirm the Atlas cluster is running and add this app server's public IP to the project's Network Access list." },
    auth: { jwtConfigured: Boolean(process.env.JWT_SECRET && Buffer.byteLength(process.env.JWT_SECRET) >= 32), databaseConnected: mongo.ok },
    whatsapp: { configured: twilioReady },
    ai: { configured: aiReady },
  }, { status: mongo.ok ? 200 : 503, headers: { "Cache-Control": "no-store" } });
}
