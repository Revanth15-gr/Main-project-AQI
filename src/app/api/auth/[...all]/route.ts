import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { getUsers } from "@/lib/mongo";
import { createToken, verifyToken } from "@/lib/jwt";

export const runtime = "nodejs";
const scrypt = promisify(scryptCallback);
const cookieName = "airguard_token";
const cookieOptions = `Path=/; HttpOnly; SameSite=Lax; ${process.env.NODE_ENV === "production" ? "Secure; " : ""}Max-Age=604800`;

async function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  const derived = (await scrypt(password, salt, 64)) as Buffer;
  return `${salt}:${derived.toString("hex")}`;
}

async function passwordMatches(password: string, stored: string) {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const actual = (await scrypt(password, salt, 64)) as Buffer;
  const expected = Buffer.from(hash, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function respondError(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as { email?: string; password?: string; name?: string; action?: string };
    const email = body.email?.trim().toLowerCase();
    const password = body.password;
    const action = body.action ?? new URL(request.url).pathname.split("/").at(-1);
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !password || password.length < 8) {
      return respondError("Enter a valid email and a password of at least 8 characters.", 400);
    }
    const users = await getUsers();
    if (action === "register") {
      const exists = await users.findOne({ email });
      if (exists) return respondError("An account with this email already exists.", 409);
      const name = body.name?.trim().slice(0, 80) || email.split("@")[0];
      const result = await users.insertOne({ email, name, passwordHash: await hashPassword(password), createdAt: new Date() });
      const token = createToken({ sub: result.insertedId.toString(), email });
      return Response.json({ user: { email, name } }, { headers: { "Set-Cookie": `${cookieName}=${token}; ${cookieOptions}` } });
    }
    if (action !== "login") return respondError("Unknown authentication action.", 404);
    const user = await users.findOne({ email });
    if (!user || !(await passwordMatches(password, user.passwordHash))) return respondError("Email or password is incorrect.", 401);
    const token = createToken({ sub: user._id.toString(), email });
    return Response.json({ user: { email, name: user.name } }, { headers: { "Set-Cookie": `${cookieName}=${token}; ${cookieOptions}` } });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "";
    if (detail.includes("Set a complete MONGODB_URI")) {
      return respondError("MongoDB Atlas is not configured: replace <db_username> in MONGODB_URI with your Atlas database username, then restart the server.", 503);
    }
    if (detail.includes("JWT_SECRET")) {
      return respondError("JWT signing is not configured. Set JWT_SECRET in .env.local and restart the server.", 503);
    }
    if (detail.includes("E11000")) return respondError("An account with this email already exists.", 409);
    console.error("Authentication request failed", detail || "unknown error");
    return respondError("Could not connect to MongoDB Atlas. Check the database username, password, and Atlas Network Access settings.", 503);
  }
}

export async function GET(request: Request) {
  const cookie = request.headers.get("cookie")?.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${cookieName}=`));
  let payload = null;
  try { payload = cookie ? verifyToken(decodeURIComponent(cookie.slice(cookieName.length + 1))) : null; }
  catch { return respondError("Session service is not configured.", 503); }
  return payload ? Response.json({ user: { id: payload.sub, email: payload.email } }) : respondError("Not signed in.", 401);
}

export async function DELETE() {
  return Response.json({ ok: true }, { headers: { "Set-Cookie": `${cookieName}=; ${cookieOptions}; Max-Age=0` } });
}
