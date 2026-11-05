import { getAirQualityHistory } from "@/lib/air-quality/history";
import type { LocationCandidate } from "@/lib/air-quality/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isIndiaCoordinate(latitude: number, longitude: number) {
  return latitude >= 6 && latitude <= 38.8 && longitude >= 68 && longitude <= 97.5;
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const latitude = Number(params.get("latitude"));
  const longitude = Number(params.get("longitude"));
  const requestedDays = Number(params.get("days") || "7");
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || !isIndiaCoordinate(latitude, longitude)) {
    return Response.json({ error: "Provide coordinates for a location in India." }, { status: 400 });
  }
  if (!Number.isInteger(requestedDays) || requestedDays < 1 || requestedDays > 90) {
    return Response.json({ error: "History range must be between 1 and 90 days." }, { status: 400 });
  }
  const location: LocationCandidate = {
    id: 0,
    name: (params.get("name") || "Selected location").trim().slice(0, 100),
    country: "India",
    state: (params.get("state") || "").trim().slice(0, 100) || undefined,
    district: (params.get("district") || "").trim().slice(0, 100) || undefined,
    latitude,
    longitude,
  };
  try {
    const history = await getAirQualityHistory(location, requestedDays);
    return Response.json(history, { headers: { "Cache-Control": "no-store, no-cache, must-revalidate" } });
  } catch {
    return Response.json({ error: "Recent Open-Meteo air-quality history is temporarily unavailable." }, { status: 502 });
  }
}
