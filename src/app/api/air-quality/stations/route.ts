import { getCpcbStatus, getCpcbStations, startAirQualityScheduler } from "@/lib/air-quality";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  startAirQualityScheduler();
  return Response.json({ ...getCpcbStatus(), stations: getCpcbStations() }, {
    headers: { "Cache-Control": "no-store" },
  });
}
