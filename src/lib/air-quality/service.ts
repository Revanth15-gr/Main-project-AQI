import "server-only";

import { calculateIndianAqi, indianAqiCategory } from "@/lib/air-quality/aqi";
import type { AirQualityReading, LocationCandidate, Pollutants } from "@/lib/air-quality/types";
import { getDatabasePool } from "@/lib/db";

const DATA_GOV_RESOURCE_ID = process.env.DATA_GOV_IN_AQI_RESOURCE_ID || "3b01bcb8-0b14-4abf-b6f2-c1bfd384ba69";
const DATA_GOV_URL = "https://api.data.gov.in/resource";
const OPEN_METEO_AIR_URL = process.env.OPEN_METEO_BASE_URL || "https://air-quality-api.open-meteo.com/v1/air-quality";
const OPEN_METEO_GEOCODING_URL = "https://geocoding-api.open-meteo.com/v1/search";
const CAMS_ATTRIBUTION = "CAMS global atmospheric composition forecast via Open-Meteo";

type OGDRecord = {
  country?: string;
  state?: string;
  city?: string;
  station?: string;
  last_update?: string;
  latitude?: string;
  longitude?: string;
  pollutant_id?: string;
  min_value?: string;
  max_value?: string;
  avg_value?: string;
  aqi?: string;
  air_quality_index?: string;
};

type OGDPayload = {
  updated_date?: string;
  total?: number;
  count?: number;
  records?: OGDRecord[];
};

type StationRecord = {
  name: string;
  city: string;
  state: string;
  latitude: number;
  longitude: number;
  observedAt: string;
  pollutants: Pollutants;
  aqi: number | null;
};

type GeocodingResult = {
  id: number;
  name: string;
  latitude: number;
  longitude: number;
  country?: string;
  country_code?: string;
  admin1?: string;
  admin2?: string;
  admin3?: string;
  timezone?: string;
};

function parseOgDate(value: string | undefined): string | null {
  if (!value) return null;
  const match = value.match(/^(\d{2})-(\d{2})-(\d{4})\s+(\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (!match) return null;
  // CPCB timestamps in this resource are published in India Standard Time.
  const [, day, month, year, hour, minute, second = "00"] = match;
  const date = new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}+05:30`);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function numberOrNull(value: string | undefined): number | null {
  if (!value || value.toUpperCase() === "NA") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function pollutantKey(value: string | undefined): keyof Pollutants | null {
  switch ((value || "").toUpperCase().replace(/[_. -]/g, "")) {
    case "PM25": return "pm25";
    case "PM10": return "pm10";
    case "NO2": return "no2";
    case "SO2": return "so2";
    case "CO": return "co";
    case "OZONE":
    case "O3": return "o3";
    case "NH3": return "nh3";
    default: return null;
  }
}

function stationKey(record: OGDRecord): string {
  return [record.state, record.city, record.station].map((value) => (value || "").trim().toLowerCase()).join("|");
}

async function fetchCpcbStations(): Promise<{ stations: StationRecord[]; detail: string }> {
  const apiKey = process.env.DATA_GOV_IN_API_KEY;
  if (!apiKey) return { stations: [], detail: "Set DATA_GOV_IN_API_KEY to enable the government station feed." };

  const url = new URL(`${DATA_GOV_URL}/${DATA_GOV_RESOURCE_ID}`);
  url.searchParams.set("api-key", apiKey);
  url.searchParams.set("format", "json");
  url.searchParams.set("offset", "0");
  url.searchParams.set("limit", "10000");

  const response = await fetch(url, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(20_000),
    next: { revalidate: 60 * 60 },
  });
  if (!response.ok) throw new Error(`data.gov.in returned HTTP ${response.status}`);
  const payload = (await response.json()) as OGDPayload;
  const records = Array.isArray(payload.records) ? payload.records : [];
  const byStation = new Map<string, StationRecord>();

  for (const record of records) {
    const state = (record.state || "").trim();
    const city = (record.city || "").trim();
    const name = (record.station || "").trim();
    const latitude = Number(record.latitude);
    const longitude = Number(record.longitude);
    const observedAt = parseOgDate(record.last_update);
    if (!state || !city || !name || !Number.isFinite(latitude) || !Number.isFinite(longitude) || !observedAt) continue;

    const key = stationKey(record);
    let station = byStation.get(key);
    if (!station) {
      station = { name, city, state, latitude, longitude, observedAt, pollutants: {}, aqi: null };
      byStation.set(key, station);
    }
    if (observedAt > station.observedAt) station.observedAt = observedAt;

    const directAqi = numberOrNull(record.aqi || record.air_quality_index);
    if (directAqi !== null) station.aqi = directAqi;
    const pollutant = pollutantKey(record.pollutant_id);
    const average = numberOrNull(record.avg_value);
    if (pollutant && average !== null) station.pollutants[pollutant] = average;
  }

  const updateDate = payload.updated_date || "source timestamp unavailable";
  return { stations: [...byStation.values()], detail: `${records.length} pollutant records; catalogue update ${updateDate}.` };
}

export async function getCpcbSnapshot() {
  return fetchCpcbStations();
}

export async function persistCpcbSnapshot(stations: StationRecord[]) {
  if (!process.env.DATABASE_URL) return { stored: 0, skipped: "DATABASE_URL is not configured." };
  const pool = getDatabasePool();
  const client = await pool.connect();
  let stored = 0;
  try {
    await client.query("begin");
    for (const station of stations) {
      const stationResult = await client.query<{ id: string }>(
        `insert into public.monitoring_stations
          (source, station_name, city, state, latitude, longitude, is_active, last_seen_at)
         values ('CPCB/data.gov.in', $1, $2, $3, $4, $5, true, $6)
         on conflict (source, station_name, city, state) do update set
          latitude = excluded.latitude, longitude = excluded.longitude, is_active = true,
          last_seen_at = greatest(public.monitoring_stations.last_seen_at, excluded.last_seen_at),
          updated_at = now()
         returning id`,
        [station.name, station.city, station.state, station.latitude, station.longitude, station.observedAt],
      );
      const stationId = stationResult.rows[0]?.id;
      if (!stationId) continue;
      const ageMs = Date.now() - new Date(station.observedAt).getTime();
      const dataType = ageMs <= 2 * 60 * 60_000 ? "LIVE_STATION" : ageMs <= 6 * 60 * 60_000 ? "RECENT_STATION" : "HISTORICAL";
      const category = station.aqi === null ? null : indianAqiCategory(station.aqi);
      await client.query(
        `insert into public.air_quality_readings
          (station_id, aqi, aqi_scale, pollutant_values, category, source, data_type, observed_at, fetched_at, is_stale)
         values ($1, $2, 'INDIA_CPCB', $3::jsonb, $4, 'CPCB/data.gov.in', $5, $6, now(), $7)
         on conflict (station_id, source, observed_at) do update set
          aqi = excluded.aqi, pollutant_values = excluded.pollutant_values, category = excluded.category,
          data_type = excluded.data_type, fetched_at = now(), is_stale = excluded.is_stale`,
        [stationId, station.aqi, JSON.stringify(station.pollutants), category, dataType, station.observedAt, ageMs > 6 * 60 * 60_000],
      );
      stored += 1;
    }
    await client.query("commit");
    return { stored };
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

export async function persistLocation(location: LocationCandidate) {
  if (!process.env.DATABASE_URL) return null;
  const geocoderId = location.id > 0
    ? String(location.id)
    : `gps:${location.latitude.toFixed(3)}:${location.longitude.toFixed(3)}`;
  const result = await getDatabasePool().query<{ id: string }>(
    `insert into public.locations (geocoder, geocoder_id, name, state, district, latitude, longitude, location_type)
     values ('open-meteo', $1, $2, $3, $4, $5, $6, 'geocoded')
     on conflict (geocoder, geocoder_id) do update set name = excluded.name, state = excluded.state,
       district = excluded.district, latitude = excluded.latitude, longitude = excluded.longitude, updated_at = now()
     returning id`,
    [geocoderId, location.name, location.state || null, location.district || null, location.latitude, location.longitude],
  );
  return result.rows[0]?.id || null;
}

export async function searchIndianLocations(query: string): Promise<LocationCandidate[]> {
  const term = query.trim().slice(0, 100);
  if (term.length < 2) return [];
  const terms = [...new Set([term, term.split(",")[0].trim()].filter(Boolean))];
  const merged = new Map<number, GeocodingResult>();
  for (const searchTerm of terms) {
    const url = new URL(OPEN_METEO_GEOCODING_URL);
    url.searchParams.set("name", /\bindia\b/i.test(searchTerm) ? searchTerm : `${searchTerm}, India`);
    url.searchParams.set("count", "10");
    url.searchParams.set("language", "en");
    url.searchParams.set("format", "json");
    const response = await fetch(url, { signal: AbortSignal.timeout(10_000), next: { revalidate: 60 * 60 } });
    if (!response.ok) throw new Error(`Open-Meteo geocoding returned HTTP ${response.status}`);
    const payload = (await response.json()) as { results?: GeocodingResult[] };
    for (const item of payload.results || []) {
      if (item.country_code === "IN") merged.set(item.id, item);
    }
    if (merged.size) break;
  }
  const normalize = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const hints = term.split(",").map((part) => normalize(part.trim())).filter((part) => part && part !== "india");
  return [...merged.values()]
    .map((item, index) => ({ item, index, text: normalize([item.name, item.admin1, item.admin2, item.admin3].filter(Boolean).join(" ")) }))
    .sort((a, b) => {
      const score = (entry: { item: GeocodingResult; index: number; text: string }) => {
        const name = normalize(entry.item.name);
        const target = normalize(term.split(",")[0].trim());
        return hints.reduce((total, hint) => total + (entry.text.includes(hint) ? 10 : 0), 0) +
          (name === target ? 50 : name.startsWith(target) ? 20 : 0) - entry.index / 100;
      };
      return score(b) - score(a);
    })
    .map(({ item }) => ({
      id: item.id,
      name: item.name,
      country: item.country || "India",
      state: item.admin1,
      district: item.admin2,
      latitude: item.latitude,
      longitude: item.longitude,
    }));
}

function distanceKm(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const radians = (degrees: number) => (degrees * Math.PI) / 180;
  const dLat = radians(bLat - aLat);
  const dLon = radians(bLon - aLon);
  const value = Math.sin(dLat / 2) ** 2 + Math.cos(radians(aLat)) * Math.cos(radians(bLat)) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
}

function latestModelEstimate(hourly: Record<string, unknown>, times: string[], fetchedAt: string) {
  const sources: Record<string, string> = {
    pm25: "pm2_5",
    pm10: "pm10",
    no2: "nitrogen_dioxide",
    so2: "sulphur_dioxide",
    co: "carbon_monoxide",
    o3: "ozone",
  };
  const aligned: Record<string, Array<number | null>> = {};
  const pollutants: Pollutants = {};
  for (const [target, source] of Object.entries(sources)) {
    const raw = hourly[source];
    if (!Array.isArray(raw)) continue;
    const values = raw.map((value) => typeof value === "number" && Number.isFinite(value) ? value : null);
    aligned[target] = values;
    const recent = values.slice(-8).filter((value): value is number => value !== null);
    if (recent.length) pollutants[target as keyof Pollutants] = Number((recent.reduce((sum, value) => sum + value, 0) / recent.length).toFixed(1));
  }
  const aqi = calculateIndianAqi(aligned);
  return {
    aqi,
    category: indianAqiCategory(aqi),
    dataType: "MODEL_ESTIMATE" as const,
    pollutants,
    observedAt: times.at(-1)
      ? new Date(/[zZ]|[+-]\d{2}:?\d{2}$/.test(times.at(-1)!) ? times.at(-1)! : `${times.at(-1)}+05:30`).toISOString()
      : fetchedAt,
    attribution: CAMS_ATTRIBUTION,
    gridLocation: undefined as { latitude: number; longitude: number } | undefined,
  };
}

async function fetchModelEstimate(location: LocationCandidate, fetchedAt: string) {
  const url = new URL(OPEN_METEO_AIR_URL);
  url.searchParams.set("latitude", String(location.latitude));
  url.searchParams.set("longitude", String(location.longitude));
  url.searchParams.set("hourly", "pm2_5,pm10,nitrogen_dioxide,sulphur_dioxide,ozone,carbon_monoxide");
  url.searchParams.set("current", "pm2_5,pm10,nitrogen_dioxide,sulphur_dioxide,ozone,carbon_monoxide");
  url.searchParams.set("past_hours", "24");
  url.searchParams.set("forecast_hours", "1");
  url.searchParams.set("timezone", "Asia/Kolkata");
  // This endpoint runs when the user changes location or requests GPS. Do not
  // reuse a cached response; each lookup must reflect its requested coordinates.
  const response = await fetch(url, { signal: AbortSignal.timeout(15_000), cache: "no-store" });
  if (!response.ok) throw new Error(`Open-Meteo air quality returned HTTP ${response.status}`);
  const payload = (await response.json()) as {
    latitude?: number;
    longitude?: number;
    hourly?: Record<string, unknown> & { time?: string[] };
    current?: Record<string, number | string | null>;
  };
  const hourly = payload.hourly || {};
  const estimate = latestModelEstimate(hourly, hourly.time || [], fetchedAt);
  if (Number.isFinite(payload.latitude) && Number.isFinite(payload.longitude)) {
    estimate.gridLocation = { latitude: payload.latitude!, longitude: payload.longitude! };
  }
  for (const [key, source] of [["pm25", "pm2_5"], ["pm10", "pm10"], ["no2", "nitrogen_dioxide"], ["so2", "sulphur_dioxide"], ["co", "carbon_monoxide"], ["o3", "ozone"]] as const) {
    const value = payload.current?.[source];
    if (typeof value === "number" && Number.isFinite(value)) estimate.pollutants[key] = value;
  }
  return estimate;
}

export async function getAirQuality(location: LocationCandidate): Promise<AirQualityReading> {
  const fetchedAt = new Date().toISOString();
  const sources: AirQualityReading["sources"] = [];
  let station: AirQualityReading["station"] = null;
  let directAqi: number | null = null;

  const stationResult = await fetchCpcbStations().then((value) => ({ value }), (error: unknown) => ({ error }));
  if ("value" in stationResult) {
    sources.push({ name: "CPCB / data.gov.in", url: "https://www.data.gov.in/catalog/real-time-air-quality-index", status: stationResult.value.stations.length ? "available" : "not-configured", detail: stationResult.value.detail });
    const nearest = stationResult.value.stations
      .map((item) => ({ item, distance: distanceKm(location.latitude, location.longitude, item.latitude, item.longitude) }))
      .filter((entry) => entry.distance <= 50)
      .sort((a, b) => a.distance - b.distance)[0];
    if (nearest) {
      const ageMs = Date.now() - new Date(nearest.item.observedAt).getTime();
      const dataType = ageMs <= 2 * 60 * 60_000 ? "LIVE_STATION" : ageMs <= 6 * 60 * 60_000 ? "RECENT_STATION" : "HISTORICAL";
      station = {
        ...nearest.item,
        distanceKm: Number(nearest.distance.toFixed(1)),
        dataType,
      };
      directAqi = nearest.item.aqi;
    }
  } else {
    sources.push({ name: "CPCB / data.gov.in", url: "https://www.data.gov.in/catalog/real-time-air-quality-index", status: "error", detail: stationResult.error instanceof Error ? stationResult.error.message : "CPCB source request failed." });
  }

  let estimate: AirQualityReading["estimate"] = null;
  try {
    estimate = await fetchModelEstimate(location, fetchedAt);
    sources.push({ name: "Open-Meteo / CAMS", url: "https://open-meteo.com/en/docs/air-quality-api", status: "available", detail: CAMS_ATTRIBUTION });
  } catch (error) {
    sources.push({ name: "Open-Meteo / CAMS", url: "https://open-meteo.com/en/docs/air-quality-api", status: "error", detail: error instanceof Error ? error.message : "Model source request failed." });
  }

  const ageMs = station ? Date.now() - new Date(station.observedAt).getTime() : Number.POSITIVE_INFINITY;
  const stationIsRecent = Boolean(station && ageMs <= 6 * 60 * 60_000);
  const useStationAqi = stationIsRecent && directAqi !== null;
  const aqi = useStationAqi ? directAqi : estimate?.aqi ?? null;
  const dataType = useStationAqi
    ? station!.dataType
    : estimate?.aqi !== null && estimate
      ? "MODEL_ESTIMATE"
      : stationIsRecent
        ? station!.dataType
        : estimate
          ? "MODEL_ESTIMATE"
          : "UNAVAILABLE";
  const pollutants = stationIsRecent ? station!.pollutants : estimate?.pollutants || {};

  return {
    location,
    aqi,
    category: indianAqiCategory(aqi),
    aqiScale: "INDIA_CPCB",
    aqiSource: useStationAqi ? "CPCB" : estimate?.aqi !== null && estimate ? "CAMS_MODEL" : null,
    dataType,
    pollutants,
    observedAt: useStationAqi ? station!.observedAt : estimate?.observedAt || station?.observedAt || null,
    fetchedAt,
    isStale: dataType === "HISTORICAL" || dataType === "UNAVAILABLE",
    station,
    estimate,
    sources,
  };
}
