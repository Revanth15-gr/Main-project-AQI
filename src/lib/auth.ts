import "server-only";

import { createHmac, randomBytes, randomInt, scryptSync, timingSafeEqual } from "node:crypto";
import { getMongoDatabase } from "@/lib/mongo";

export const SESSION_COOKIE = "airguard_session";
const SESSION_SECONDS = 7 * 24 * 60 * 60;

export type AppUser = {
  _id: string;
  email: string;
  name: string;
  phoneNumber: string;
  phoneNumberVerified: boolean;
  age?: number;
  gender?: string;
  location?: string;
  diseases?: string[];
  healthInformation?: string;
  passwordHash?: string;
  passwordSalt?: string;
  otpHash?: string;
  otpSalt?: string;
  otpExpiresAt?: Date;
  otpAttemptCount?: number;
  pendingPhoneNumber?: string;
  pendingPhoneOtpHash?: string;
  pendingPhoneOtpSalt?: string;
  pendingPhoneOtpExpiresAt?: Date;
  pendingPhoneOtpAttemptCount?: number;
  createdAt?: Date;
  updatedAt?: Date;
};

export type PublicUser = Pick<AppUser, "_id" | "email" | "name" | "phoneNumber" | "phoneNumberVerified">;

function jwtSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret || Buffer.byteLength(secret) < 32) throw new Error("JWT_SECRET must be at least 32 bytes. Configure it in .env.local.");
  return Buffer.from(secret);
}

function base64url(value: string | Buffer) {
  return Buffer.from(value).toString("base64url");
}

export function hashPassword(password: string, salt = randomBytes(16).toString("hex")) {
  return { salt, hash: scryptSync(password, salt, 64).toString("hex") };
}

export function verifyPassword(password: string, salt: string, hash: string) {
  const expected = Buffer.from(hash, "hex");
  const actual = scryptSync(password, salt, expected.length);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function hashOtp(code: string, salt: string) {
  return createHmac("sha256", salt).update(code).digest("hex");
}

export function makeOtp() {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

export function createSessionToken(user: Pick<AppUser, "_id" | "email">) {
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = base64url(JSON.stringify({ sub: user._id, email: user.email, iat: now, exp: now + SESSION_SECONDS, iss: "airguard" }));
  const signingInput = `${header}.${payload}`;
  const signature = createHmac("sha256", jwtSecret()).update(signingInput).digest("base64url");
  return `${signingInput}.${signature}`;
}

export function verifySessionToken(token: string) {
  try {
    const [header, payload, signature, extra] = token.split(".");
    if (!header || !payload || !signature || extra) return null;
    const parsedHeader = JSON.parse(Buffer.from(header, "base64url").toString("utf8")) as { alg?: string; typ?: string };
    if (parsedHeader.alg !== "HS256" || parsedHeader.typ !== "JWT") return null;
    const signingInput = `${header}.${payload}`;
    const expected = createHmac("sha256", jwtSecret()).update(signingInput).digest();
    const actual = Buffer.from(signature, "base64url");
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { sub?: string; exp?: number; iss?: string };
    if (!claims.sub || !claims.exp || claims.exp <= Math.floor(Date.now() / 1000) || claims.iss !== "airguard") return null;
    return { userId: claims.sub };
  } catch {
    return null;
  }
}

export function tokenFromCookieHeader(cookieHeader: string | null) {
  for (const part of (cookieHeader || "").split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0 || part.slice(0, separator).trim() !== SESSION_COOKIE) continue;
    try { return decodeURIComponent(part.slice(separator + 1).trim()); }
    catch { return null; }
  }
  return null;
}

export function sessionCookie(token: string) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_SECONDS}${secure}`;
}

export function clearSessionCookie() {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`;
}

export function publicUser(user: AppUser): PublicUser {
  return { _id: user._id, email: user.email, name: user.name, phoneNumber: user.phoneNumber, phoneNumberVerified: user.phoneNumberVerified };
}

export async function authenticateRequest(request: Request): Promise<AppUser | null> {
  const token = tokenFromCookieHeader(request.headers.get("cookie"));
  if (!token) return null;
  const claims = verifySessionToken(token);
  if (!claims) return null;
  const user = await getMongoDatabase().collection<AppUser>("user").findOne({ _id: claims.userId });
  return user?.phoneNumberVerified ? user : null;
}

export async function authenticateToken(token: string | undefined): Promise<AppUser | null> {
  if (!token) return null;
  const claims = verifySessionToken(token);
  if (!claims) return null;
  const user = await getMongoDatabase().collection<AppUser>("user").findOne({ _id: claims.userId });
  return user?.phoneNumberVerified ? user : null;
}
