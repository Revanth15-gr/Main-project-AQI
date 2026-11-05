import { authenticateRequest } from "@/lib/auth";
import { getMongoDatabase } from "@/lib/mongo";
import { ensureNotificationIndexes, notificationPreferencesCollection } from "@/lib/notifications/store";
import { maskPhoneNumber } from "@/lib/twilio/phone";

export const runtime = "nodejs";

async function authenticatedUser(request: Request) {
  return authenticateRequest(request).catch(() => null);
}

export async function GET(request: Request) {
  const sessionUser = await authenticatedUser(request);
  if (!sessionUser) return Response.json({ error: "Sign in to manage notification preferences." }, { status: 401 });
  try {
    const user = await getMongoDatabase().collection<{ _id: string; phoneNumber?: string; phoneNumberVerified?: boolean }>("user")
      .findOne({ _id: sessionUser._id }, { projection: { phoneNumber: 1, phoneNumberVerified: 1 } });
    if (!user) return Response.json({ error: "User profile was not found." }, { status: 404 });
    await ensureNotificationIndexes();
    const preference = await notificationPreferencesCollection().findOne({ userId: sessionUser._id });
    return Response.json({
      phone: user.phoneNumber ? maskPhoneNumber(user.phoneNumber) : null,
      phoneVerified: user.phoneNumberVerified === true,
      smsEnabled: preference?.smsEnabled || false,
      whatsappEnabled: preference?.whatsappEnabled || false,
      consentedAt: preference?.consentedAt || null,
    }, { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return Response.json({ error: "Could not load MongoDB notification preferences." }, { status: 503 });
  }
}

export async function PATCH(request: Request) {
  const sessionUser = await authenticatedUser(request);
  if (!sessionUser) return Response.json({ error: "Sign in to manage notification preferences." }, { status: 401 });
  let body: { smsEnabled?: boolean; whatsappEnabled?: boolean; consent?: boolean };
  try { body = await request.json(); }
  catch { return Response.json({ error: "Expected a JSON request body." }, { status: 400 }); }
  if (!body || typeof body !== "object" || Array.isArray(body)) return Response.json({ error: "Expected a JSON request body." }, { status: 400 });
  if (typeof body.smsEnabled !== "boolean" || typeof body.whatsappEnabled !== "boolean") {
    return Response.json({ error: "Choose SMS and WhatsApp preferences." }, { status: 400 });
  }
  const enabled = body.smsEnabled || body.whatsappEnabled;
  if (enabled && body.consent !== true) return Response.json({ error: "Explicit notification consent is required." }, { status: 400 });

  try {
    const profile = await getMongoDatabase().collection<{ _id: string; phoneNumber?: string; phoneNumberVerified?: boolean }>("user")
      .findOne({ _id: sessionUser._id }, { projection: { phoneNumber: 1, phoneNumberVerified: 1 } });
    if (!profile) return Response.json({ error: "User profile was not found." }, { status: 404 });
    if (enabled && (!profile.phoneNumberVerified || !profile.phoneNumber)) {
      return Response.json({ error: "Verify your mobile number before enabling notifications." }, { status: 409 });
    }
    await ensureNotificationIndexes();
    const consentedAt = body.consent === true ? new Date() : null;
    await notificationPreferencesCollection().updateOne(
      { userId: sessionUser._id },
      { $set: { smsEnabled: body.smsEnabled, whatsappEnabled: body.whatsappEnabled, consentedAt, updatedAt: new Date() } },
      { upsert: true },
    );
    return Response.json({ saved: true, smsEnabled: body.smsEnabled, whatsappEnabled: body.whatsappEnabled });
  } catch {
    return Response.json({ error: "Could not save MongoDB notification preferences." }, { status: 503 });
  }
}
