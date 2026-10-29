import "server-only";
import { betterAuth } from "better-auth";
import { getDatabasePool } from "@/lib/db";

function createAuth() {
  const secret = process.env.BETTER_AUTH_SECRET;
  const baseURL = process.env.BETTER_AUTH_URL;
  if (!secret || secret.length < 32 || !baseURL) {
    throw new Error("Better Auth is not configured. Set BETTER_AUTH_SECRET (32+ characters) and BETTER_AUTH_URL in .env.local.");
  }

  return betterAuth({
    database: getDatabasePool(),
    baseURL,
    secret,
    emailAndPassword: { enabled: true },
  });
}

let authInstance: ReturnType<typeof createAuth> | undefined;

export function getAuth() {
  authInstance ??= createAuth();
  return authInstance;
}
