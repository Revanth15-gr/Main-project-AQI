import { searchIndianLocations } from "@/lib/air-quality/service";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const query = new URL(request.url).searchParams.get("q")?.trim() || "";
  if (query.length < 2 || query.length > 100) {
    return Response.json({ error: "Enter a location name or PIN code (2–100 characters)." }, { status: 400 });
  }

  try {
    const locations = await searchIndianLocations(query);
    return Response.json({ locations }, {
      headers: { "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=3600" },
    });
  } catch {
    return Response.json({ error: "Location search is temporarily unavailable." }, { status: 502 });
  }
}
