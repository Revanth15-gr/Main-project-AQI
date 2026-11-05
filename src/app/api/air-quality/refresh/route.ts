import { timingSafeEqual } from "node:crypto";
import { getCpcbSnapshot, persistCpcbSnapshot } from "@/lib/air-quality/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function authorized(request: Request) {
  const secret = process.env.AIR_QUALITY_CRON_SECRET;
  const supplied = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || "";
  if (!secret || !supplied) return false;
  const left = Buffer.from(secret);
  const right = Buffer.from(supplied);
  return left.length === right.length && timingSafeEqual(left, right);
}

export async function POST(request: Request) {
  if (!authorized(request)) return Response.json({ error: "Unauthorized." }, { status: 401 });
  if (!process.env.DATA_GOV_IN_API_KEY) {
    return Response.json({ error: "DATA_GOV_IN_API_KEY is not configured." }, { status: 503 });
  }
  try {
    const snapshot = await getCpcbSnapshot();
    const persisted = await persistCpcbSnapshot(snapshot.stations);
    return Response.json({
      fetchedAt: new Date().toISOString(),
      stationCount: snapshot.stations.length,
      detail: snapshot.detail,
      persisted,
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "CPCB refresh failed." }, { status: 502 });
  }
}
