import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

type JwtPayload = { sub: string; email: string; exp: number };
const b64 = (input: string | Buffer) => Buffer.from(input).toString("base64url");

function sign(data: string) {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 32) throw new Error("JWT_SECRET must contain at least 32 characters.");
  return createHmac("sha256", secret).update(data).digest("base64url");
}

export function createToken(payload: Omit<JwtPayload, "exp">) {
  const head = b64(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = b64(JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 7 }));
  const data = `${head}.${body}`;
  return `${data}.${sign(data)}`;
}

export function verifyToken(token: string): JwtPayload | null {
  const [head, body, signature, extra] = token.split(".");
  if (!head || !body || !signature || extra) return null;
  const data = `${head}.${body}`;
  const expected = Buffer.from(sign(data));
  const actual = Buffer.from(signature);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString()) as JwtPayload;
    return payload.exp > Math.floor(Date.now() / 1000) ? payload : null;
  } catch { return null; }
}
