import { getHistory, type AirLocation } from "@/lib/air-quality";
export const runtime = "nodejs";
export async function GET(request: Request) {
  const url = new URL(request.url); const latitude = Number(url.searchParams.get("latitude")); const longitude = Number(url.searchParams.get("longitude"));
  if (!Number.isFinite(latitude) || Math.abs(latitude) > 90 || !Number.isFinite(longitude) || Math.abs(longitude) > 180) return Response.json({ error: "Valid latitude and longitude are required." }, { status: 400 });
  const location: AirLocation = { name: (url.searchParams.get("location") || "Selected location").slice(0, 100), latitude, longitude };
  try { return Response.json(await getHistory(location, Number(url.searchParams.get("limit")) || 24)); }
  catch { return Response.json({ error: "Air-quality history is not available." }, { status: 503 }); }
}
