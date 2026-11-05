import "server-only";

import type { Collection } from "mongodb";
import { getMongoDatabase } from "@/lib/mongo";
import type { LocationCandidate } from "@/lib/air-quality/types";

export type NotificationPreference = {
  userId: string;
  smsEnabled: boolean;
  whatsappEnabled: boolean;
  consentedAt: Date | null;
  updatedAt: Date;
};

export type AlertPreference = {
  _id: string;
  userId: string;
  locationKey: string;
  location: LocationCandidate;
  threshold: number;
  enabled: boolean;
  consentedAt?: Date;
  lastAlertedAt: Date | null;
  lastAlertedAqi: number | null;
  dispatchingAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type NotificationHistory = {
  _id: string;
  userId: string;
  locationId: string | null;
  alertPreferenceId: string | null;
  recipientPhone: string | null;
  message: string;
  messageType: string;
  channel: "sms" | "whatsapp";
  dispatchKey: string;
  providerMessageId: string | null;
  sentAt: Date | null;
  deliveryStatus: string;
  errorCode: string | null;
  errorDetail: string | null;
  createdAt: Date;
  deliveredAt: Date | null;
};

let indexes: Promise<void> | undefined;

export function notificationPreferencesCollection(): Collection<NotificationPreference> {
  return getMongoDatabase().collection<NotificationPreference>("notification_preferences");
}

export function alertPreferencesCollection(): Collection<AlertPreference> {
  return getMongoDatabase().collection<AlertPreference>("alert_preferences");
}

export function notificationHistoryCollection(): Collection<NotificationHistory> {
  return getMongoDatabase().collection<NotificationHistory>("notification_history");
}

export async function ensureNotificationIndexes() {
  indexes ??= (async () => {
    await Promise.all([
      notificationPreferencesCollection().createIndex({ userId: 1 }, { unique: true }),
      alertPreferencesCollection().createIndex({ userId: 1, locationKey: 1 }, { unique: true }),
      alertPreferencesCollection().createIndex({ enabled: 1, updatedAt: 1 }),
      notificationHistoryCollection().createIndex({ userId: 1, createdAt: -1 }),
      notificationHistoryCollection().createIndex({ dispatchKey: 1 }, { unique: true }),
      notificationHistoryCollection().createIndex(
        { providerMessageId: 1 },
        { unique: true, partialFilterExpression: { providerMessageId: { $type: "string" } } },
      ),
    ]).then(() => undefined);
  })().catch((error) => {
    indexes = undefined;
    throw error;
  });
  await indexes;
}
