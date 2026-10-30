import { getCurrent, refreshLocation, startAirQualityScheduler, type AirLocation } from "@/lib/air-quality";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const cities: Record<string, AirLocation> = {
  Visakhapatnam: { name: "Visakhapatnam, India", latitude: 17.6868, longitude: 83.2185 }, Hyderabad: { name: "Hyderabad, India", latitude: 17.385, longitude: 78.4867 },
  Delhi: { name: "Delhi, India", latitude: 28.6139, longitude: 77.209 }, Bengaluru: { name: "Bengaluru, India", latitude: 12.9716, longitude: 77.5946 },
  Rajam: { name: "Rajam, India", latitude: 18.449, longitude: 83.659 },
};
function numberParam(url: URL, name: string) { const raw = url.searchParams.get(name); if (raw === null || raw.trim() === "") return null; const value = Number(raw); return Number.isFinite(value) ? value : null; }
export async function GET(request: Request) {
  const url = new URL(request.url); const city = url.searchParams.get("city") || "Visakhapatnam";
  let location = cities[city];
  const latitude = numberParam(url, "latitude"); const longitude = numberParam(url, "longitude");
  if (url.searchParams.has("latitude") || url.searchParams.has("longitude")) {
    if (latitude === null || longitude === null || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return Response.json({ error: "Latitude must be between -90 and 90 and longitude between -180 and 180." }, { status: 400 });
  }
  if (latitude !== null && longitude !== null && Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180) location = { name: (url.searchParams.get("location") || "Selected location").slice(0, 100), latitude, longitude };
  if (!location) return Response.json({ error: "Choose a supported city or provide valid latitude and longitude." }, { status: 400 });
  startAirQualityScheduler();
  try { return Response.json(url.searchParams.get("refresh") === "1" ? await refreshLocation(location) : await getCurrent(location), { headers: { "Cache-Control": "no-store" } }); }
  catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Air-quality data is unavailable." }, { status: 502 }); }
}
