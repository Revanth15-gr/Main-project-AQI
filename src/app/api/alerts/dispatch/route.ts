import { timingSafeEqual } from "node:crypto";
import { getAirQuality } from "@/lib/air-quality/service";
import { getMongoDatabase } from "@/lib/mongo";
import {
  alertPreferencesCollection,
  ensureNotificationIndexes,
  notificationPreferencesCollection,
} from "@/lib/notifications/store";
import { sendAqiAlert, validateTwilioConfiguration } from "@/lib/twilio/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function authorized(request: Request) {
  const secret = process.env.AIR_QUALITY_CRON_SECRET;
  const supplied = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || "";
  if (!secret || !supplied) return false;
  const expected = Buffer.from(secret);
  const actual = Buffer.from(supplied);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export async function POST(request: Request) {
  if (!authorized(request)) return Response.json({ error: "Unauthorized." }, { status: 401 });
  try { validateTwilioConfiguration(); }
  catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Twilio is not configured." }, { status: 503 }); }

  try {
    await ensureNotificationIndexes();
    const preferences = await alertPreferencesCollection().find({ enabled: true }).sort({ createdAt: 1 }).toArray();
    let accepted = 0;
    let skipped = 0;
    const staleClaim = new Date(Date.now() - 10 * 60_000);

    for (const preference of preferences) {
      const [profile, channels] = await Promise.all([
        getMongoDatabase().collection<{ _id: string; phoneNumber?: string; phoneNumberVerified?: boolean }>("user")
          .findOne({ _id: preference.userId }, { projection: { phoneNumber: 1, phoneNumberVerified: 1 } }),
        notificationPreferencesCollection().findOne({ userId: preference.userId }),
      ]);
      if (!profile?.phoneNumberVerified || !profile.phoneNumber || !channels?.consentedAt || (!channels.smsEnabled && !channels.whatsappEnabled)) {
        skipped += 1;
        continue;
      }

      let reading;
      try { reading = await getAirQuality(preference.location); }
      catch { skipped += 1; continue; }
      if (reading.aqi === null || !reading.observedAt) { skipped += 1; continue; }
      if (reading.aqi < preference.threshold) {
        await alertPreferencesCollection().updateOne({ _id: preference._id, userId: preference.userId }, {
          $set: { lastAlertedAqi: null, lastAlertedAt: null, dispatchingAt: null, updatedAt: new Date() },
        });
        skipped += 1;
        continue;
      }
      if (preference.lastAlertedAqi !== null) { skipped += 1; continue; }

      const claimed = await alertPreferencesCollection().updateOne(
        {
          _id: preference._id,
          userId: preference.userId,
          enabled: true,
          lastAlertedAqi: null,
          $or: [{ dispatchingAt: null }, { dispatchingAt: { $lt: staleClaim } }, { dispatchingAt: { $exists: false } }],
        },
        { $set: { dispatchingAt: new Date(), updatedAt: new Date() } },
      );
      if (claimed.modifiedCount !== 1) { skipped += 1; continue; }

      const idempotencyKey = `${preference._id}:${reading.observedAt}:${reading.aqi}`;
      const channelsToSend = { sms: channels.smsEnabled, whatsapp: channels.whatsappEnabled };
      const enabledChannels = Number(channelsToSend.sms) + Number(channelsToSend.whatsapp);
      const deliveries = await sendAqiAlert(preference.userId, {
        message: `${preference.location.name}: India AQI ${reading.aqi} (${reading.category}); ${reading.dataType}.`,
        locationId: preference.locationKey,
        alertPreferenceId: preference._id,
        idempotencyKey,
        location: preference.location.name,
        aqi: reading.aqi,
        category: reading.category,
        source: reading.dataType === "MODEL_ESTIMATE" ? "Model-based estimate" : "CPCB station reading",
      }, channelsToSend);
      const successful = deliveries.filter((delivery) => delivery.status === "fulfilled").length;
      if (successful < enabledChannels) {
        await alertPreferencesCollection().updateOne({ _id: preference._id, userId: preference.userId }, {
          $set: { dispatchingAt: null, updatedAt: new Date() },
        });
        skipped += 1;
        continue;
      }
      await alertPreferencesCollection().updateOne({ _id: preference._id, userId: preference.userId }, {
        $set: { lastAlertedAqi: reading.aqi, lastAlertedAt: new Date(), dispatchingAt: null, updatedAt: new Date() },
      });
      accepted += successful;
    }
    return Response.json({ accepted, skipped, evaluated: preferences.length });
  } catch {
    return Response.json({ error: "Alert dispatch failed." }, { status: 502 });
  }
}
