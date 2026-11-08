import "server-only";

import { randomUUID } from "node:crypto";
import { getMongoDatabase } from "@/lib/mongo";
import {
  ensureNotificationIndexes,
  notificationHistoryCollection,
  notificationPreferencesCollection,
  type NotificationHistory,
} from "@/lib/notifications/store";
import { isValidE164Phone } from "@/lib/twilio/phone";

type Channel = "sms" | "whatsapp";
type TwilioCredentials = { accountSid: string; authUsername: string; authPassword: string };
type DeliveryInput = {
  userId: string;
  channel: Channel;
  message: string;
  messageType: string;
  idempotencyKey: string;
  locationId?: string;
  alertPreferenceId?: string;
  contentSid?: string;
  contentVariables?: Record<string, string>;
};

function readTwilioCredentials(): TwilioCredentials {
  if (process.env.TWILIO_ENABLED !== "true") throw new Error("Twilio delivery is disabled. Set TWILIO_ENABLED=true after completing setup.");
  const accountSid = process.env.TWILIO_ACCOUNT_SID?.trim();
  const authToken = process.env.TWILIO_AUTH_TOKEN?.trim();
  const apiKeySid = process.env.TWILIO_API_KEY_SID?.trim();
  const apiKeySecret = process.env.TWILIO_API_KEY_SECRET?.trim();
  if (!accountSid || accountSid.startsWith("SK")) throw new Error("Set TWILIO_ACCOUNT_SID to the Account SID beginning with AC. API Key SIDs beginning with SK belong in TWILIO_API_KEY_SID.");
  if (apiKeySid && apiKeySecret) return { accountSid, authUsername: apiKeySid, authPassword: apiKeySecret };
  if (authToken) return { accountSid, authUsername: accountSid, authPassword: authToken };
  throw new Error("Twilio credentials require TWILIO_AUTH_TOKEN or both TWILIO_API_KEY_SID and TWILIO_API_KEY_SECRET.");
}

function authorizationHeader(credentials: TwilioCredentials) {
  return `Basic ${Buffer.from(`${credentials.authUsername}:${credentials.authPassword}`).toString("base64")}`;
}

function readNotificationConfig(channel: Channel, contentSid?: string) {
  const credentials = readTwilioCredentials();
  const callbackUrl = process.env.TWILIO_STATUS_CALLBACK_URL?.trim();
  if (!callbackUrl) throw new Error("TWILIO_STATUS_CALLBACK_URL is required for delivery receipts.");
  let callback: URL;
  try { callback = new URL(callbackUrl); }
  catch { throw new Error("TWILIO_STATUS_CALLBACK_URL must be an absolute HTTPS URL."); }
  if (callback.protocol !== "https:") throw new Error("TWILIO_STATUS_CALLBACK_URL must use HTTPS.");

  if (channel === "sms") {
    const smsFrom = process.env.TWILIO_PHONE_NUMBER?.trim();
    if (!smsFrom) throw new Error("Set TWILIO_PHONE_NUMBER to send SMS alerts.");
    return { ...credentials, from: smsFrom, callbackUrl };
  }
  const rawWhatsappFrom = process.env.TWILIO_WHATSAPP_NUMBER?.trim();
  if (!rawWhatsappFrom) throw new Error("Set TWILIO_WHATSAPP_NUMBER to send WhatsApp alerts.");
  if (!contentSid) throw new Error("An approved WhatsApp Content Template SID is required.");
  return {
    ...credentials,
    from: rawWhatsappFrom.startsWith("whatsapp:") ? rawWhatsappFrom : `whatsapp:${rawWhatsappFrom}`,
    callbackUrl,
  };
}

export function validateTwilioConfiguration() {
  readTwilioCredentials();
}

export async function sendPhoneVerificationCode(phoneNumber: string, code: string): Promise<{ channel: "sms" | "whatsapp" }> {
  if (!isValidE164Phone(phoneNumber)) throw new Error("Enter a valid phone number in international E.164 format.");
  const credentials = readTwilioCredentials();
  const otpContentSid = process.env.TWILIO_WHATSAPP_OTP_CONTENT_SID?.trim();
  const whatsappFrom = process.env.TWILIO_WHATSAPP_NUMBER?.trim();
  if (otpContentSid && whatsappFrom) {
    const from = whatsappFrom.startsWith("whatsapp:") ? whatsappFrom : `whatsapp:${whatsappFrom}`;
    const body = new URLSearchParams({
      From: from,
      To: `whatsapp:${phoneNumber}`,
      ContentSid: otpContentSid,
      ContentVariables: JSON.stringify({ "1": code }),
    });
    const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${credentials.accountSid}/Messages.json`, {
      method: "POST",
      headers: {
        authorization: authorizationHeader(credentials),
        "content-type": "application/x-www-form-urlencoded",
      },
      body,
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error("Twilio could not send the WhatsApp verification code.");
    return { channel: "whatsapp" };
  }
  const smsFrom = process.env.TWILIO_PHONE_NUMBER?.trim();
  if (!smsFrom) throw new Error("Twilio SMS verification needs TWILIO_PHONE_NUMBER.");
  const body = new URLSearchParams({
    From: smsFrom,
    To: phoneNumber,
    Body: `Your AirGuard verification code is ${code}. It expires shortly. Do not share this code.`,
  });
  const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${credentials.accountSid}/Messages.json`, {
    method: "POST",
    headers: {
      authorization: authorizationHeader(credentials),
      "content-type": "application/x-www-form-urlencoded",
    },
    body,
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error("Twilio could not send the verification code.");
  return { channel: "sms" };
}

function isDuplicateKey(error: unknown) {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === 11000);
}

async function sendUserNotification(input: DeliveryInput) {
  if (!input.userId) throw new Error("An authenticated user is required.");
  if (!input.message.trim() || input.message.length > 1_500) throw new Error("Notification text is empty or too long.");
  if (!input.idempotencyKey || input.idempotencyKey.length > 240) throw new Error("A valid idempotency key is required.");

  await ensureNotificationIndexes();
  const [user, preference] = await Promise.all([
    getMongoDatabase().collection<{ _id: string; phoneNumber?: string; phoneNumberVerified?: boolean }>("user").findOne({ _id: input.userId }),
    notificationPreferencesCollection().findOne({ userId: input.userId }),
  ]);
  if (!user) throw new Error("User profile was not found.");
  if (!user.phoneNumberVerified || !user.phoneNumber || !isValidE164Phone(user.phoneNumber)) {
    throw new Error("A verified mobile number is required before sending notifications.");
  }
  if (!preference?.consentedAt) throw new Error("Notification consent is required.");
  if (input.channel === "sms" && !preference.smsEnabled) throw new Error("SMS notifications are disabled for this user.");
  if (input.channel === "whatsapp" && !preference.whatsappEnabled) throw new Error("WhatsApp notifications are disabled for this user.");

  const config = readNotificationConfig(input.channel, input.contentSid);
  const history = notificationHistoryCollection();
  const newRow: NotificationHistory = {
    _id: randomUUID(), userId: input.userId, locationId: input.locationId || null,
    alertPreferenceId: input.alertPreferenceId || null, recipientPhone: user.phoneNumber,
    message: input.message, messageType: input.messageType, channel: input.channel,
    dispatchKey: input.idempotencyKey, providerMessageId: null, sentAt: null,
    deliveryStatus: "pending", errorCode: null, errorDetail: null,
    createdAt: new Date(), deliveredAt: null,
  };
  try {
    await history.insertOne(newRow);
  } catch (error) {
    if (!isDuplicateKey(error)) throw error;
    const retry = await history.updateOne(
      { dispatchKey: input.idempotencyKey, deliveryStatus: { $in: ["failed", "undelivered", "rejected"] } },
      { $set: { deliveryStatus: "pending", errorCode: null, errorDetail: null, createdAt: new Date() } },
    );
    if (!retry.matchedCount) return { duplicate: true as const, status: "already-recorded" };
  }

  const body = new URLSearchParams({
    From: config.from,
    To: input.channel === "sms" ? user.phoneNumber : `whatsapp:${user.phoneNumber}`,
    StatusCallback: config.callbackUrl,
  });
  if (input.contentSid) {
    body.set("ContentSid", input.contentSid);
    body.set("ContentVariables", JSON.stringify(input.contentVariables || {}));
  } else {
    body.set("Body", input.message);
  }

  try {
    const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${config.accountSid}/Messages.json`, {
      method: "POST",
      headers: {
        authorization: authorizationHeader(config),
        "content-type": "application/x-www-form-urlencoded",
      },
      body,
      signal: AbortSignal.timeout(15_000),
    });
    const result = await response.json().catch(() => ({})) as { sid?: string; status?: string; code?: number; message?: string };
    if (!response.ok || !result.sid) {
      const detail = (result.message || `Twilio returned HTTP ${response.status}.`).slice(0, 500);
      await history.updateOne({ dispatchKey: input.idempotencyKey }, {
        $set: { deliveryStatus: "failed", errorCode: result.code ? String(result.code) : String(response.status), errorDetail: detail },
      });
      throw new Error("Twilio rejected the notification.");
    }
    await history.updateOne({ dispatchKey: input.idempotencyKey }, {
      $set: { providerMessageId: result.sid, deliveryStatus: result.status || "queued", sentAt: new Date() },
    });
    return { duplicate: false as const, sid: result.sid, status: result.status || "queued" };
  } catch (error) {
    if (error instanceof Error && error.message === "Twilio rejected the notification.") throw error;
    const detail = error instanceof Error ? error.message.slice(0, 500) : "Unknown provider error.";
    await history.updateOne({ dispatchKey: input.idempotencyKey }, { $set: { deliveryStatus: "submission_unknown", errorDetail: detail } });
    throw new Error("Twilio submission status is unknown; check notification history before retrying.");
  }
}

export function sendSMS(userId: string, message: string, idempotencyKey = randomUUID()) {
  return sendUserNotification({ userId, channel: "sms", message, messageType: "transactional", idempotencyKey });
}

export function sendWhatsApp(userId: string, message: string, idempotencyKey = randomUUID()) {
  return sendUserNotification({
    userId, channel: "whatsapp", message, messageType: "transactional", idempotencyKey,
    contentSid: process.env.TWILIO_WHATSAPP_GENERIC_CONTENT_SID,
    contentVariables: { "1": message.replace(/[\r\n]+/g, " ").slice(0, 1_000) },
  });
}

export function sendAqiAlert(
  userId: string,
  values: { message: string; locationId: string; alertPreferenceId: string; idempotencyKey: string; location: string; aqi: number; category: string; source: string },
  channels: { sms: boolean; whatsapp: boolean },
) {
  const safeLocation = values.location.replace(/[\r\n]+/g, " ").slice(0, 80);
  const variables = {
    "1": safeLocation,
    "2": String(values.aqi),
    "3": values.category.replace(/[\r\n]+/g, " ").slice(0, 40),
    "4": values.source.replace(/[\r\n]+/g, " ").slice(0, 60),
  };
  const deliveries: Promise<unknown>[] = [];
  if (channels.sms) deliveries.push(sendUserNotification({
    userId, channel: "sms", message: values.message, messageType: "aqi_alert",
    idempotencyKey: `${values.idempotencyKey}:sms`, locationId: values.locationId,
    alertPreferenceId: values.alertPreferenceId,
  }));
  if (channels.whatsapp) deliveries.push(sendUserNotification({
    userId, channel: "whatsapp", message: values.message, messageType: "aqi_alert",
    idempotencyKey: `${values.idempotencyKey}:whatsapp`, locationId: values.locationId,
    alertPreferenceId: values.alertPreferenceId,
    contentSid: process.env.TWILIO_WHATSAPP_CONTENT_SID,
    contentVariables: variables,
  }));
  return Promise.allSettled(deliveries);
}
