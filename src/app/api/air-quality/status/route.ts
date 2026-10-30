import { getStatus, startAirQualityScheduler } from "@/lib/air-quality";
export const runtime = "nodejs";
export async function GET() { startAirQualityScheduler(); return Response.json({ refreshIntervalSeconds: 300, source: "Open-Meteo Air Quality API", locations: getStatus() }, { headers: { "Cache-Control": "no-store" } }); }
