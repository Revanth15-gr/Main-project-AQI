import { getCpcbSnapshot } from "@/lib/air-quality/service";

export const runtime = "nodejs";

export async function GET() {
  try {
    const { stations, detail } = await getCpcbSnapshot();
    return Response.json({ stations, detail, fetchedAt: new Date().toISOString() }, {
      headers: { "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=3600" },
    });
  } catch {
    return Response.json({ error: "CPCB station data is temporarily unavailable." }, { status: 502 });
  }
}
