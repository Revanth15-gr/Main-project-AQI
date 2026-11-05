import { authenticateRequest } from "@/lib/auth";
import { ensureNotificationIndexes, notificationHistoryCollection } from "@/lib/notifications/store";
import { maskPhoneNumber } from "@/lib/twilio/phone";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const user = await authenticateRequest(request).catch(() => null);
  if (!user) return Response.json({ error: "Sign in to view notification history." }, { status: 401 });
  try {
    await ensureNotificationIndexes();
    const notifications = await notificationHistoryCollection()
      .find({ userId: user._id })
      .sort({ createdAt: -1 })
      .limit(50)
      .toArray();
    return Response.json({ notifications: notifications.map((row) => ({
      id: row._id,
      recipient_phone: row.recipientPhone ? maskPhoneNumber(row.recipientPhone) : null,
      message: row.message,
      message_type: row.messageType,
      channel: row.channel,
      delivery_status: row.deliveryStatus,
      error_code: row.errorCode,
      created_at: row.createdAt,
      delivered_at: row.deliveredAt,
    })) }, { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return Response.json({ error: "Could not load MongoDB notification history." }, { status: 503 });
  }
}
