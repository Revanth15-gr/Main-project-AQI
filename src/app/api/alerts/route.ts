import { randomUUID } from "node:crypto";
import { authenticateRequest } from "@/lib/auth";
import { getMongoDatabase } from "@/lib/mongo";
import {
  alertPreferencesCollection,
  ensureNotificationIndexes,
  notificationPreferencesCollection,
} from "@/lib/notifications/store";
import type { LocationCandidate } from "@/lib/air-quality/types";
import { isValidE164Phone } from "@/lib/twilio/phone";

export const runtime = "nodejs";

async function authenticatedUser(request: Request) {
  return authenticateRequest(request).catch(() => null);
}

export async function GET(request: Request) {
  const user = await authenticatedUser(request);
  if (!user) return Response.json({ error: "Sign in to manage AQI alerts." }, { status: 401 });
  try {
    await ensureNotificationIndexes();
    const alerts = await alertPreferencesCollection().find({ userId: user._id }).sort({ createdAt: -1 }).toArray();
    return Response.json({ alerts }, { headers: { "Cache-Control": "private, no-store" } });
  } catch { return Response.json({ error: "Could not load saved AQI alerts." }, { status: 503 }); }
}

export async function POST(request: Request) {
  const user = await authenticatedUser(request);
  if (!user) return Response.json({ error: "Sign in to subscribe to AQI alerts." }, { status: 401 });
  let body: { location?: LocationCandidate; threshold?: number };
  try { body = await request.json(); }
  catch { return Response.json({ error: "Expected a JSON request body." }, { status: 400 }); }
  if (!body || typeof body !== "object" || Array.isArray(body)) return Response.json({ error: "Expected a JSON request body." }, { status: 400 });

  const location = body.location;
  const threshold = Number(body.threshold);
  if (!location || location.country !== "India" || !Number.isFinite(location.latitude) || !Number.isFinite(location.longitude) ||
      location.latitude < 6 || location.latitude > 38.8 || location.longitude < 68 || location.longitude > 97.5) {
    return Response.json({ error: "Choose a valid Indian location." }, { status: 400 });
  }
  if (!Number.isInteger(threshold) || threshold < 0 || threshold > 500) return Response.json({ error: "Threshold must be an integer from 0 to 500." }, { status: 400 });

  try {
    const profile = await getMongoDatabase().collection<{ _id: string; phoneNumber?: string; phoneNumberVerified?: boolean }>("user")
      .findOne({ _id: user._id }, { projection: { phoneNumber: 1, phoneNumberVerified: 1 } });
    if (!profile?.phoneNumberVerified || !profile.phoneNumber || !isValidE164Phone(profile.phoneNumber)) {
      return Response.json({ error: "Verify your registered mobile number before enabling AQI alerts." }, { status: 409 });
    }
    const preference = await notificationPreferencesCollection().findOne({ userId: user._id });
    if (!preference?.consentedAt || (!preference.smsEnabled && !preference.whatsappEnabled)) {
      return Response.json({ error: "Opt in to SMS or WhatsApp alerts and record consent before saving an AQI threshold." }, { status: 409 });
    }

    await ensureNotificationIndexes();
    const locationKey = `${location.id}:${location.latitude.toFixed(4)}:${location.longitude.toFixed(4)}`;
    const now = new Date();
    const id = randomUUID();
    const update = await alertPreferencesCollection().updateOne(
      { userId: user._id, locationKey },
      {
        $set: { location, threshold, enabled: true, consentedAt: now, lastAlertedAt: null, lastAlertedAqi: null, dispatchingAt: null, updatedAt: now },
        $setOnInsert: { _id: id, userId: user._id, locationKey, createdAt: now },
      },
      { upsert: true },
    );
    return Response.json({ subscribed: true, id: update.upsertedId || id }, { status: 201 });
  } catch { return Response.json({ error: "Could not save AQI alert preferences." }, { status: 503 }); }
}

export async function DELETE(request: Request) {
  const user = await authenticatedUser(request);
  if (!user) return Response.json({ error: "Sign in to manage AQI alerts." }, { status: 401 });
  const id = new URL(request.url).searchParams.get("id") || "";
  try {
    const result = await alertPreferencesCollection().updateOne(
      { _id: id, userId: user._id }, { $set: { enabled: false, updatedAt: new Date() } },
    );
    return Response.json({ disabled: result.modifiedCount === 1 });
  } catch { return Response.json({ error: "Could not update this AQI alert." }, { status: 503 }); }
}
