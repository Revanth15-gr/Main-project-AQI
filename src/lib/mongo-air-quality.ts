import { MongoClient, type Db } from "mongodb";
let client: MongoClient | undefined;
let connecting: Promise<Db> | undefined;
export async function getDatabase(): Promise<Db> {
  const uri = process.env.MONGODB_URI;
  if (!uri || uri.includes("<db_username>")) throw new Error("Set a complete MONGODB_URI in .env.local.");
  client ??= new MongoClient(uri);
  connecting ??= client.connect().then(() => client!.db(process.env.MONGODB_DB || "airguard")).catch((error) => { connecting = undefined; throw error; });
  return connecting;
}
