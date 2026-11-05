import { getAirQuality, persistLocation, searchIndianLocations } from "@/lib/air-quality/service";
import type { LocationCandidate } from "@/lib/air-quality/types";

export const runtime = "nodejs";

function validIndiaCoordinates(latitude: number, longitude: number) {
  return latitude >= 6 && latitude <= 38.8 && longitude >= 68 && longitude <= 97.5;
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const latitude = Number(params.get("latitude"));
  const longitude = Number(params.get("longitude"));
  const name = (params.get("name") || "Selected location").trim().slice(0, 100);
  const state = (params.get("state") || "").trim().slice(0, 100) || undefined;
  const district = (params.get("district") || "").trim().slice(0, 100) || undefined;

  let location: LocationCandidate;
  if (Number.isFinite(latitude) && Number.isFinite(longitude) && validIndiaCoordinates(latitude, longitude)) {
    location = { id: 0, name, country: "India", state, district, latitude, longitude };
  } else {
    const query = params.get("q")?.trim() || "";
    if (query.length < 2 || query.length > 100) {
      return Response.json({ error: "Provide an Indian location or valid India coordinates." }, { status: 400 });
    }
    try {
      const locations = await searchIndianLocations(query);
      location = locations[0];
      if (!location) return Response.json({ error: "No matching Indian location was found." }, { status: 404 });
    } catch {
      return Response.json({ error: "Location lookup is temporarily unavailable." }, { status: 502 });
    }
  }

  try {
    await persistLocation(location).catch(() => null);
    const reading = await getAirQuality(location);
    return Response.json(reading, {
      headers: { "Cache-Control": "no-store, no-cache, must-revalidate" },
    });
  } catch {
    return Response.json({ error: "Air-quality providers are temporarily unavailable." }, { status: 502 });
  }
}
