import "server-only";

import { calculateIndianAqi, indianAqiCategory } from "@/lib/air-quality/aqi";
import type { LocationCandidate } from "@/lib/air-quality/types";

const OPEN_METEO_AIR_URL = process.env.OPEN_METEO_BASE_URL || "https://air-quality-api.open-meteo.com/v1/air-quality";
const SERIES: Record<string, string> = {
  pm25: "pm2_5",
  pm10: "pm10",
  no2: "nitrogen_dioxide",
  so2: "sulphur_dioxide",
  co: "carbon_monoxide",
  o3: "ozone",
};

type OpenMeteoHistory = {
  hourly?: Record<string, Array<number | string | null> | string[] | undefined> & { time?: string[] };
};

export async function getAirQualityHistory(location: LocationCandidate, days: number) {
  const url = new URL(OPEN_METEO_AIR_URL);
  url.searchParams.set("latitude", String(location.latitude));
  url.searchParams.set("longitude", String(location.longitude));
  url.searchParams.set("hourly", Object.values(SERIES).join(","));
  // Past-hour windows include the current partial day; past_days ends at
  // yesterday's midnight and made the latest trend point look stale.
  url.searchParams.set("past_hours", String(days * 24));
  url.searchParams.set("forecast_hours", "0");
  url.searchParams.set("timezone", "Asia/Kolkata");
  const response = await fetch(url, { signal: AbortSignal.timeout(20_000), cache: "no-store" });
  if (!response.ok) throw new Error(`Open-Meteo history returned HTTP ${response.status}`);
  const payload = await response.json() as OpenMeteoHistory;
  const hourly = payload.hourly || {};
  const times = Array.isArray(hourly.time) ? hourly.time : [];
  const values: Record<string, Array<number | null>> = {};
  for (const [key, source] of Object.entries(SERIES)) {
    const array = hourly[source];
    values[key] = Array.isArray(array) ? array.map((value) => {
      const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
      return Number.isFinite(parsed) ? parsed : null;
    }) : [];
  }

  const lastIndexByDate = new Map<string, number>();
  times.forEach((time, index) => {
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(time)) lastIndexByDate.set(time.slice(0, 10), index);
  });
  const points = [...lastIndexByDate.entries()].map(([date, index]) => {
    const start = Math.max(0, index - 23);
    const window = Object.fromEntries(Object.entries(values).map(([key, list]) => [key, list.slice(start, index + 1)]));
    const aqi = calculateIndianAqi(window);
    return { date, aqi, category: indianAqiCategory(aqi), observedAt: times[index] || null };
  }).slice(-days);

  return {
    location,
    days,
    dataType: "MODEL_ESTIMATE" as const,
    attribution: "CAMS global atmospheric composition via Open-Meteo; daily values are model-derived India AQI estimates, not CPCB station bulletins.",
    fetchedAt: new Date().toISOString(),
    points,
  };
}
