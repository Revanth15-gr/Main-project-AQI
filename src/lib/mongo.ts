import "server-only";
import { MongoClient } from "mongodb";

let client: MongoClient | undefined;

export async function getUsers() {
  const uri = process.env.MONGODB_URI;
  if (!uri || uri.includes("<db_username>")) throw new Error("Set a complete MONGODB_URI in .env.local, including the Atlas database username.");
  client ??= new MongoClient(uri);
  const database = client.db(process.env.MONGODB_DB || "airguard");
  await client.connect();
  const users = database.collection<{ email: string; name: string; passwordHash: string; createdAt: Date }>("users");
  await users.createIndex({ email: 1 }, { unique: true });
  return users;
}
