import "server-only";

import { MongoClient, type Db } from "mongodb";

const globalMongo = globalThis as typeof globalThis & {
  airguardMongoClient?: MongoClient;
};

export function getMongoClient() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("MONGODB_URI is missing. Configure MongoDB Atlas in .env.local.");
  globalMongo.airguardMongoClient ??= new MongoClient(uri, {
    appName: "AirGuard",
    serverSelectionTimeoutMS: 10_000,
  });
  return globalMongo.airguardMongoClient;
}

export function getMongoDatabase(): Db {
  const databaseName = process.env.MONGODB_DB?.trim() || "airguard";
  return getMongoClient().db(databaseName);
}

export async function verifyMongoConnection() {
  await getMongoClient().connect();
  await getMongoDatabase().command({ ping: 1 });
  return { database: process.env.MONGODB_DB?.trim() || "airguard", ok: true };
}
