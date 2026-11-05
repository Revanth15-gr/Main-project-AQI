import "server-only";

import { createHash } from "node:crypto";
import { getMongoDatabase } from "@/lib/mongo";

let indexes: Promise<void> | undefined;

export async function ensureAuthIndexes() {
  indexes ??= (async () => {
    await Promise.all([
      getMongoDatabase().collection("user").createIndex({ email: 1 }, { unique: true }),
      getMongoDatabase().collection("user").createIndex(
        { phoneNumber: 1 },
        { unique: true, partialFilterExpression: { phoneNumber: { $type: "string" } } },
      ),
      getMongoDatabase().collection("auth_rate_limits").createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
    ]).then(() => undefined);
  })().catch((error) => {
    indexes = undefined;
    throw error;
  });
  await indexes;
}

export async function consumeRateLimit(scope: string, identity: string, limit: number, windowSeconds: number) {
  await ensureAuthIndexes();
  const windowMs = windowSeconds * 1000;
  const now = Date.now();
  const bucket = Math.floor(now / windowMs);
  const digest = createHash("sha256").update(identity.toLowerCase()).digest("hex").slice(0, 24);
  const id = `${scope}:${digest}:${bucket}`;
  const collection = getMongoDatabase().collection<{ _id: string; count: number; expiresAt: Date }>("auth_rate_limits");
  const result = await collection.findOneAndUpdate(
    { _id: id },
    { $inc: { count: 1 }, $setOnInsert: { expiresAt: new Date((bucket + 2) * windowMs) } },
    { upsert: true, returnDocument: "after" },
  );
  const record = result;
  return Boolean(record && record.count <= limit);
}
