import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { authenticateRequest, clearSessionCookie, createSessionToken, hashOtp, hashPassword, makeOtp, publicUser, sessionCookie, verifyPassword, type AppUser } from "@/lib/auth";
import { consumeRateLimit, ensureAuthIndexes } from "@/lib/auth-storage";
import { getMongoDatabase } from "@/lib/mongo";
import { ensureNotificationIndexes, notificationPreferencesCollection } from "@/lib/notifications/store";
import { isValidE164Phone } from "@/lib/twilio/phone";
import { sendPhoneVerificationCode } from "@/lib/twilio/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const OTP_TTL_MS = 10 * 60_000;
const users = () => getMongoDatabase().collection<AppUser>("user");

function jsonError(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

async function readJson(request: Request) {
  try {
    const value: unknown = await request.json();
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
  } catch { return null; }
}

function setSessionCookie(user: AppUser, body: Record<string, unknown> = {}, status = 200) {
  return Response.json({ ...body, user: publicUser(user) }, { status, headers: { "Set-Cookie": sessionCookie(createSessionToken(user)) } });
}

function requestIdentity(request: Request, value: string) {
  void request;
  return value;
}

async function register(request: Request) {
  const body = await readJson(request);
  if (!body) return jsonError("Expected a JSON request body.", 400);
  const name = typeof body.fullName === "string" ? body.fullName.trim().slice(0, 80) : "";
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const phoneNumber = typeof body.phoneNumber === "string" ? body.phoneNumber.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";
  const age = Number(body.age);
  if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) return jsonError("Enter a valid name and email address.", 400);
  if (!isValidE164Phone(phoneNumber)) return jsonError("Enter a valid international mobile number in E.164 format.", 400);
  if (password.length < 8 || password.length > 256) return jsonError("Password must be between 8 and 256 characters.", 400);
  if (!Number.isInteger(age) || age < 1 || age > 120) return jsonError("Enter a valid age.", 400);
  if (body.termsAccepted !== true) return jsonError("Accept the informational-use terms to create an account.", 400);
  if (!await consumeRateLimit("register", requestIdentity(request, email), 5, 15 * 60)) return jsonError("Too many account attempts. Try again in 15 minutes.", 429);

  try {
    await ensureAuthIndexes();
    const existing = await users().findOne({ $or: [{ email }, { phoneNumber }] }, { projection: { email: 1 } });
    if (existing) return jsonError("An account already uses this email or mobile number. Sign in or recover your account.", 409);
    const { salt, hash } = hashPassword(password);
    const user: AppUser = {
      _id: randomUUID(), email, name, phoneNumber, phoneNumberVerified: false,
      passwordHash: hash, passwordSalt: salt,
      age, gender: typeof body.gender === "string" ? body.gender.slice(0, 40) : undefined,
      location: typeof body.location === "string" ? body.location.trim().slice(0, 100) : undefined,
      diseases: Array.isArray(body.diseases) ? body.diseases.filter((item): item is string => typeof item === "string").slice(0, 20) : [],
      healthInformation: typeof body.healthInformation === "string" ? body.healthInformation.slice(0, 300) : "",
      createdAt: new Date(), updatedAt: new Date(),
    };
    await users().insertOne(user);
    return setSessionCookie(user, { created: true }, 201);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === 11000) return jsonError("An account already uses this email or mobile number.", 409);
    return jsonError("Could not create the account. Check MongoDB and Twilio configuration.", 503);
  }
}

async function login(request: Request) {
  const body = await readJson(request);
  if (!body) return jsonError("Expected a JSON request body.", 400);
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const phoneNumber = typeof body.phoneNumber === "string" ? body.phoneNumber.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";
  if (!email || !password || !isValidE164Phone(phoneNumber)) return jsonError("Email, password, and a valid mobile number are required.", 400);
  if (!await consumeRateLimit("login", requestIdentity(request, email), 10, 15 * 60)) return jsonError("Too many sign-in attempts. Try again in 15 minutes.", 429);
  try {
    const user = await users().findOne({ email });
    if (!user?.passwordHash || !user.passwordSalt || !verifyPassword(password, user.passwordSalt, user.passwordHash)) return jsonError("Email or password is incorrect.", 401);
    if (user.phoneNumber !== phoneNumber) return jsonError("Enter the mobile number registered to this account.", 403);
    return setSessionCookie(user, { signedIn: true });
  } catch { return jsonError("Sign-in is temporarily unavailable. Check MongoDB connectivity.", 503); }
}

async function sendPhoneUpdateCode(request: Request) {
  const user = await authenticateRequest(request).catch(() => null);
  if (!user) return jsonError("Sign in to update your mobile number.", 401);
  const body = await readJson(request);
  const phoneNumber = typeof body?.phoneNumber === "string" ? body.phoneNumber.trim() : "";
  if (!isValidE164Phone(phoneNumber)) return jsonError("Enter a valid mobile number in E.164 format.", 400);
  if (!await consumeRateLimit("phone-update-otp", requestIdentity(request, user._id), 3, 60)) return jsonError("Wait a minute before requesting another code.", 429);
  try {
    const duplicate = await users().findOne({ phoneNumber, _id: { $ne: user._id } }, { projection: { _id: 1 } });
    if (duplicate) return jsonError("Another account already uses that mobile number.", 409);
    const otp = makeOtp();
    const otpSalt = randomBytes(16).toString("hex");
    await users().updateOne({ _id: user._id }, { $set: {
      pendingPhoneNumber: phoneNumber, pendingPhoneOtpHash: hashOtp(otp, otpSalt), pendingPhoneOtpSalt: otpSalt,
      pendingPhoneOtpExpiresAt: new Date(Date.now() + OTP_TTL_MS), pendingPhoneOtpAttemptCount: 0, updatedAt: new Date(),
    } });
    await sendPhoneVerificationCode(phoneNumber, otp);
    return Response.json({ sent: true });
  } catch { return jsonError("Could not send the verification code. Check Twilio configuration.", 503); }
}

async function verifyPhoneUpdate(request: Request) {
  const user = await authenticateRequest(request).catch(() => null);
  if (!user) return jsonError("Sign in to update your mobile number.", 401);
  const body = await readJson(request);
  const code = typeof body?.code === "string" ? body.code.trim() : "";
  if (!/^\d{6}$/.test(code) || !user.pendingPhoneNumber || !user.pendingPhoneOtpHash || !user.pendingPhoneOtpSalt ||
      !user.pendingPhoneOtpExpiresAt || user.pendingPhoneOtpExpiresAt <= new Date()) return jsonError("Enter a valid, unexpired verification code.", 400);
  const expected = Buffer.from(user.pendingPhoneOtpHash, "hex");
  const actual = Buffer.from(hashOtp(code, user.pendingPhoneOtpSalt), "hex");
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    await users().updateOne({ _id: user._id }, { $inc: { pendingPhoneOtpAttemptCount: 1 } });
    return jsonError("The verification code is incorrect.", 400);
  }
  try {
    const update = await users().updateOne(
      { _id: user._id, pendingPhoneNumber: user.pendingPhoneNumber, pendingPhoneOtpHash: user.pendingPhoneOtpHash, pendingPhoneOtpExpiresAt: { $gt: new Date() } },
      { $set: { phoneNumber: user.pendingPhoneNumber, phoneNumberVerified: true, updatedAt: new Date() },
        $unset: { pendingPhoneNumber: "", pendingPhoneOtpHash: "", pendingPhoneOtpSalt: "", pendingPhoneOtpExpiresAt: "", pendingPhoneOtpAttemptCount: "" } },
    );
    if (!update.modifiedCount) return jsonError("This verification code has expired or already been used.", 409);
    await ensureNotificationIndexes();
    await notificationPreferencesCollection().updateOne({ userId: user._id }, {
      $set: { smsEnabled: false, whatsappEnabled: false, consentedAt: null, updatedAt: new Date() },
    });
    const refreshed = await users().findOne({ _id: user._id });
    return refreshed ? setSessionCookie(refreshed, { updated: true }) : jsonError("Could not reload the account.", 503);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === 11000) return jsonError("Another account already uses that mobile number.", 409);
    return jsonError("Could not update the verified mobile number.", 503);
  }
}

export async function GET(request: Request) {
  if (new URL(request.url).pathname !== "/api/auth/session") return jsonError("Not found.", 404);
  try {
    const user = await authenticateRequest(request);
    return Response.json({ user: user ? publicUser(user) : null }, { headers: { "Cache-Control": "private, no-store" } });
  } catch { return jsonError("Could not validate the session.", 503); }
}

export async function POST(request: Request) {
  const path = new URL(request.url).pathname;
  try {
    if (path === "/api/auth/logout") return Response.json({ signedOut: true }, { headers: { "Set-Cookie": clearSessionCookie() } });
    if (path === "/api/auth/register") return await register(request);
    if (path === "/api/auth/login") return await login(request);
    if (path === "/api/auth/phone/send-otp") return await sendPhoneUpdateCode(request);
    if (path === "/api/auth/phone/verify") return await verifyPhoneUpdate(request);
    return jsonError("Not found.", 404);
  } catch {
    // A database/network failure (for example, an unreachable Atlas cluster)
    // should be an actionable service response, never an unhandled 500.
    return jsonError("AirGuard cannot reach the MongoDB Atlas cluster. Confirm the cluster is running and this app server's public IP is allowed in Atlas Network Access, then retry.", 503);
  }
}
