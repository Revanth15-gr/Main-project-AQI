import { createHmac, timingSafeEqual } from "node:crypto";
import { ensureNotificationIndexes, notificationHistoryCollection } from "@/lib/notifications/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type TwilioParams = Record<string, string | string[]>;

function validTwilioSignature(signature: string, params: TwilioParams) {
  const token = process.env.TWILIO_AUTH_TOKEN;
  const callbackUrl = process.env.TWILIO_STATUS_CALLBACK_URL;
  if (!signature || !token || !callbackUrl) return false;
  const canonical = Object.keys(params).sort().reduce((value, key) => {
    const entries = Array.isArray(params[key]) ? [...params[key] as string[]].sort() : [params[key] as string];
    return value + entries.map((entry) => `${key}${entry}`).join("");
  }, callbackUrl);
  const expected = Buffer.from(createHmac("sha1", token).update(canonical).digest("base64"));
  const supplied = Buffer.from(signature);
  return expected.length === supplied.length && timingSafeEqual(expected, supplied);
}

const allowedStatuses = new Set(["accepted", "scheduled", "queued", "sending", "sent", "delivered", "read", "failed", "undelivered", "canceled"]);

export async function POST(request: Request) {
  const form = await request.formData().catch(() => null);
  if (!form) return Response.json({ error: "Expected form-encoded Twilio callback." }, { status: 400 });
  const params: TwilioParams = {};
  for (const [key, raw] of form.entries()) {
    const value = String(raw);
    const previous = params[key];
    params[key] = previous === undefined ? value : Array.isArray(previous) ? [...previous, value] : [previous, value];
  }
  if (!validTwilioSignature(request.headers.get("x-twilio-signature") || "", params)) {
    return Response.json({ error: "Invalid Twilio signature." }, { status: 403 });
  }
  const sid = typeof params.MessageSid === "string" ? params.MessageSid : "";
  const status = typeof params.MessageStatus === "string" ? params.MessageStatus : "";
  const errorCode = typeof params.ErrorCode === "string" ? params.ErrorCode : null;
  if (!/^(SM|MM)[0-9a-fA-F]{32}$/.test(sid) || !allowedStatuses.has(status)) {
    return new Response(null, { status: 204 });
  }

  try {
    await ensureNotificationIndexes();
    const terminalStatuses = ["delivered", "read", "failed", "undelivered", "canceled"];
    const fields: Record<string, unknown> = { deliveryStatus: status };
    if (errorCode) {
      fields.errorCode = errorCode;
      fields.errorDetail = `Twilio delivery error ${errorCode}`;
    }
    if (status === "delivered" || status === "read") fields.deliveredAt = new Date();
    await notificationHistoryCollection().updateOne(
      { providerMessageId: sid, deliveryStatus: { $nin: terminalStatuses } },
      { $set: fields },
    );
  } catch {
    return Response.json({ error: "Could not record Twilio delivery status." }, { status: 503 });
  }
  return new Response(null, { status: 204 });
}
