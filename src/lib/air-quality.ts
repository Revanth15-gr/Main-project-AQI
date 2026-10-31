import { getDatabase } from "./mongo-air-quality";
import { calculateIndianAqi, indianAqiCategory } from "./indian-aqi";

export type AirLocation = { name: string; latitude: number; longitude: number };
export type CpcbStation = {
  name: string; city: string; state: string; latitude: number; longitude: number;
  observedAt: string; pollutants: Partial<AirQualityReading["pollutants"]>;
  aqi: number | null; dataType: "LIVE_STATION" | "RECENT_STATION" | "HISTORICAL";
  distanceKm?: number;
};
type CpcbSnapshot = { stations: CpcbStation[]; fetchedAt: string; detail: string };
export type AirQualityReading = {
  location: AirLocation;
  pollutants: { pm2_5: number | null; pm10: number | null; nitrogen_dioxide: number | null; sulphur_dioxide: number | null; carbon_monoxide: number | null; ozone: number | null };
  providerIndices: { europeanAqi: number | null; usAqi: number | null; standard: "European AQI and US AQI" };
  indianCpcbAqi: number | null;
  indianAqi: { value: number | null; category: string; source: "CPCB" | "CAMS_MODEL" | null; dataType: "LIVE_STATION" | "RECENT_STATION" | "MODEL_ESTIMATE" | "UNAVAILABLE" };
  cpcbStation: CpcbStation | null;
  cpcbStatus: { configured: boolean; fetchedAt: string | null; detail: string; error?: string };
  providerTimestamp: string | null;
  providerGridCoordinates: { latitude: number; longitude: number } | null;
  fetchedAt: string;
  source: "Open-Meteo Air Quality API";
  modelPrediction: { predictedAqi: number; category?: string; model: string; predictedAt: string } | null;
  modelStatus: string;
  stale?: boolean;
  error?: string;
};
type CacheEntry = { reading: AirQualityReading; nextRefreshAt: number; lastError?: string };
type ServiceState = { cache: Map<string, CacheEntry>; inFlight: Map<string, Promise<AirQualityReading>>; locations: Map<string, AirLocation>; failureUntil: Map<string, number>; failureCount: Map<string, number>; timer?: ReturnType<typeof setInterval>; cpcbSnapshot: CpcbSnapshot | null; cpcbInFlight?: Promise<CpcbSnapshot | null>; cpcbNextRefreshAt: number; cpcbLastError?: string; cpcbLastAttemptAt: string | null };
declare global { var __airGuardAirQuality: ServiceState | undefined; }
const state: ServiceState = globalThis.__airGuardAirQuality ??= { cache: new Map(), inFlight: new Map(), locations: new Map(), failureUntil: new Map(), failureCount: new Map(), cpcbSnapshot: null, cpcbNextRefreshAt: 0, cpcbLastAttemptAt: null };
const CACHE_MS = 5 * 60 * 1000;
const CPCB_RESOURCE_ID = process.env.DATA_GOV_IN_AQI_RESOURCE_ID || "3b01bcb8-0b14-4abf-b6f2-c1bfd384ba69";

export function locationKey(location: AirLocation) { return `${location.latitude.toFixed(4)},${location.longitude.toFixed(4)}`; }

type OGDRecord = { country?: string; state?: string; city?: string; station?: string; last_update?: string; latitude?: string; longitude?: string; pollutant_id?: string; avg_value?: string; aqi?: string; air_quality_index?: string };
type OGDPayload = { updated_date?: string; total?: number; count?: number; records?: OGDRecord[] };
const POLLUTANT_FIELDS: Record<string, keyof AirQualityReading["pollutants"]> = {
  PM25: "pm2_5", PM2_5: "pm2_5", PM10: "pm10", NO2: "nitrogen_dioxide", SO2: "sulphur_dioxide",
  CO: "carbon_monoxide", O3: "ozone", OZONE: "ozone",
};

function parseCpcbTimestamp(value: string | undefined): string | null {
  if (!value) return null;
  const match = value.match(/^(\d{2})-(\d{2})-(\d{4})\s+(\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (!match) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  const [, day, month, year, hour, minute, second = "00"] = match;
  const parts = [Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second)];
  const local = new Date(Date.UTC(parts[0], parts[1], parts[2], parts[3], parts[4], parts[5]));
  if (local.getUTCFullYear() !== parts[0] || local.getUTCMonth() !== parts[1] || local.getUTCDate() !== parts[2] || local.getUTCHours() !== parts[3] || local.getUTCMinutes() !== parts[4]) return null;
  return new Date(local.getTime() - 330 * 60_000).toISOString();
}

function numberOrNull(value: string | undefined) {
  if (!value || value.toUpperCase() === "NA") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function stationIdentity(station: Pick<CpcbStation, "name" | "city" | "state">) {
  return [station.state, station.city, station.name].map((part) => part.trim().toLowerCase()).join("|");
}

async function fetchCpcbSnapshot(): Promise<CpcbSnapshot> {
  const apiKey = process.env.DATA_GOV_IN_API_KEY;
  if (!apiKey) throw new Error("DATA_GOV_IN_API_KEY is not configured.");
  const allRecords: OGDRecord[] = [];
  let total = Number.POSITIVE_INFINITY;
  let sourceUpdatedAt = "source update timestamp unavailable";
  const pageSize = 10000;
  for (let offset = 0; offset < total && offset < 50000; offset += pageSize) {
    const url = new URL(`https://api.data.gov.in/resource/${encodeURIComponent(CPCB_RESOURCE_ID)}`);
    url.search = new URLSearchParams({ "api-key": apiKey, format: "json", offset: String(offset), limit: String(pageSize) }).toString();
    const response = await fetch(url, { signal: AbortSignal.timeout(20000), cache: "no-store", headers: { Accept: "application/json" } });
    if (!response.ok) {
      const retryAfter = response.headers.get("retry-after");
      throw new Error(`data.gov.in returned HTTP ${response.status}${retryAfter ? ` (retry after ${retryAfter})` : ""}.`);
    }
    const payload = await response.json() as OGDPayload;
    if (payload.updated_date) sourceUpdatedAt = payload.updated_date;
    const records = Array.isArray(payload.records) ? payload.records : [];
    allRecords.push(...records);
    total = Number.isFinite(payload.total) ? Number(payload.total) : offset + records.length;
    if (!records.length || records.length < pageSize) break;
  }

  const byStation = new Map<string, CpcbStation>();
  for (const record of allRecords) {
    const name = (record.station || "").trim(); const city = (record.city || "").trim(); const stateName = (record.state || "").trim();
    const latitude = Number(record.latitude); const longitude = Number(record.longitude); const observedAt = parseCpcbTimestamp(record.last_update);
    if (!name || !city || !stateName || !Number.isFinite(latitude) || !Number.isFinite(longitude) || !observedAt) continue;
    const key = stationIdentity({ name, city, state: stateName });
    let station = byStation.get(key);
    if (!station) {
      station = { name, city, state: stateName, latitude, longitude, observedAt, pollutants: {}, aqi: null, dataType: "HISTORICAL" };
      byStation.set(key, station);
    }
    if (observedAt > station.observedAt) station.observedAt = observedAt;
    const pollutantId = (record.pollutant_id || "").toUpperCase().replace(/[ .-]/g, "");
    const field = POLLUTANT_FIELDS[pollutantId]; const value = numberOrNull(record.avg_value);
    if (field && value !== null) station.pollutants[field] = value;
    const directAqi = numberOrNull(record.aqi || record.air_quality_index);
    if (directAqi !== null) station.aqi = directAqi;
  }
  const now = Date.now();
  const stations = [...byStation.values()].map((station) => {
    const ageMs = now - new Date(station.observedAt).getTime();
    return { ...station, dataType: ageMs >= 0 && ageMs <= 2 * 60 * 60_000 ? "LIVE_STATION" as const : ageMs >= 0 && ageMs <= 6 * 60 * 60_000 ? "RECENT_STATION" as const : "HISTORICAL" as const };
  });
  return { stations, fetchedAt: new Date().toISOString(), detail: `${allRecords.length} pollutant rows returned; source catalogue updated ${sourceUpdatedAt}.` };
}

async function persistCpcbSnapshot(snapshot: CpcbSnapshot) {
  try {
    const db = await getDatabase();
    const stations = db.collection<CpcbStation & { stationKey: string; source: string; lastFetchedAt: string }>("cpcb_monitoring_stations");
    const readings = db.collection<CpcbStation & { stationKey: string; source: string; fetchedAt: string }>("cpcb_station_readings");
    await stations.createIndex({ stationKey: 1 }, { unique: true });
    await readings.createIndex({ stationKey: 1, observedAt: 1 }, { unique: true });
    if (!snapshot.stations.length) return;
    const stationOps = snapshot.stations.map((station) => {
      const stationKey = stationIdentity(station);
      return { updateOne: { filter: { stationKey }, update: { $set: { ...station, stationKey, source: "CPCB / data.gov.in", lastFetchedAt: snapshot.fetchedAt } }, upsert: true } };
    });
    const readingOps = snapshot.stations.map((station) => {
      const stationKey = stationIdentity(station);
      return { updateOne: { filter: { stationKey, observedAt: station.observedAt }, update: { $set: { ...station, stationKey, source: "CPCB / data.gov.in", fetchedAt: snapshot.fetchedAt } }, upsert: true } };
    });
    await Promise.all([stations.bulkWrite(stationOps, { ordered: false }), readings.bulkWrite(readingOps, { ordered: false })]);
  } catch (error) {
    console.error("CPCB station snapshot persistence failed", error instanceof Error ? error.name : "unknown error");
  }
}

async function refreshCpcbSnapshot(force = false): Promise<CpcbSnapshot | null> {
  if (!process.env.DATA_GOV_IN_API_KEY) {
    state.cpcbLastError = "DATA_GOV_IN_API_KEY is not configured.";
    return state.cpcbSnapshot;
  }
  if (!force && state.cpcbSnapshot && state.cpcbNextRefreshAt > Date.now()) return state.cpcbSnapshot;
  if (state.cpcbInFlight) return state.cpcbInFlight;
  state.cpcbLastAttemptAt = new Date().toISOString();
  const task = (async () => {
    try {
      const snapshot = await fetchCpcbSnapshot();
      if (!snapshot.stations.length && state.cpcbSnapshot?.stations.length) {
        state.cpcbLastError = "CPCB returned no station records; retaining the last successful snapshot.";
        state.cpcbNextRefreshAt = Date.now() + CACHE_MS;
        return state.cpcbSnapshot;
      }
      state.cpcbSnapshot = snapshot;
      state.cpcbNextRefreshAt = Date.now() + CACHE_MS;
      state.cpcbLastError = undefined;
      await persistCpcbSnapshot(snapshot);
      return snapshot;
    } catch (error) {
      state.cpcbLastError = error instanceof Error ? error.message : "CPCB refresh failed.";
      state.cpcbNextRefreshAt = Date.now() + Math.min(CACHE_MS, 60_000);
      return state.cpcbSnapshot;
    } finally { state.cpcbInFlight = undefined; }
  })();
  state.cpcbInFlight = task;
  return task;
}

function distanceKm(aLat: number, aLon: number, bLat: number, bLon: number) {
  const radians = (degrees: number) => degrees * Math.PI / 180;
  const dLat = radians(bLat - aLat); const dLon = radians(bLon - aLon);
  const value = Math.sin(dLat / 2) ** 2 + Math.cos(radians(aLat)) * Math.cos(radians(bLat)) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
}

function nearestCpcbStation(location: AirLocation, stations: CpcbStation[]) {
  return stations.map((station) => ({ ...station, distanceKm: Number(distanceKm(location.latitude, location.longitude, station.latitude, station.longitude).toFixed(1)) }))
    .sort((a, b) => a.distanceKm - b.distanceKm)[0] || null;
}

export function getCpcbStations() { return state.cpcbSnapshot?.stations || []; }

export function getCpcbStatus() {
  return { configured: Boolean(process.env.DATA_GOV_IN_API_KEY), resourceId: CPCB_RESOURCE_ID, lastAttemptAt: state.cpcbLastAttemptAt, lastSuccessfulFetchAt: state.cpcbSnapshot?.fetchedAt || null, stationCount: state.cpcbSnapshot?.stations.length || 0, error: state.cpcbLastError || null, detail: state.cpcbSnapshot?.detail || (process.env.DATA_GOV_IN_API_KEY ? "Waiting for first successful CPCB fetch." : "Live CPCB station data is not configured; add DATA_GOV_IN_API_KEY on the server.") };
}

export function startAirQualityScheduler() {
  if (state.timer) return;
  const poll = () => {
    void refreshCpcbSnapshot(true);
    for (const location of [...state.locations.values()]) void refresh(location, true).catch(() => undefined);
  };
  void refreshCpcbSnapshot(true);
  state.timer = setInterval(poll, CACHE_MS);
  state.timer.unref?.();
}

async function fetchJson(url: string, timeoutMs: number) {
  const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs), headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`Provider returned HTTP ${response.status}`);
  return response.json();
}

async function getProviderReading(location: AirLocation) {
  const url = new URL("https://air-quality-api.open-meteo.com/v1/air-quality");
  url.search = new URLSearchParams({
    latitude: String(location.latitude), longitude: String(location.longitude),
    current: "pm2_5,pm10,nitrogen_dioxide,sulphur_dioxide,carbon_monoxide,ozone,european_aqi,us_aqi",
    hourly: "pm2_5,pm10,nitrogen_dioxide,sulphur_dioxide,carbon_monoxide,ozone",
    past_hours: "24",
    forecast_hours: "1",
    timezone: "auto",
  }).toString();
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try { return await fetchJson(url.toString(), 10000); }
    catch (error) {
      lastError = error;
      if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** attempt));
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Open-Meteo request failed.");
}

function finiteOrNull(value: unknown): number | null { return typeof value === "number" && Number.isFinite(value) ? value : null; }

async function getModelPrediction(pollutants: AirQualityReading["pollutants"]) {
  const base = process.env.ML_SERVICE_URL?.trim();
  if (!base) return { value: null, status: "Model service is not configured." } as const;
  try {
    const endpoint = new URL("/predict", base);
    const result = await fetchJsonPost(endpoint.toString(), { ...pollutants, PM2_5: pollutants.pm2_5, PM10: pollutants.pm10, NO2: pollutants.nitrogen_dioxide, SO2: pollutants.sulphur_dioxide, CO: pollutants.carbon_monoxide, O3: pollutants.ozone }, 5000);
    const predictedAqi = finiteOrNull(result.predicted_aqi ?? result.predictedAqi);
    if (predictedAqi === null) return { value: null, status: "Model service returned no valid prediction." } as const;
    return { value: { predictedAqi, category: result.aqi_category ?? result.category, aqiStandard: result.aqi_standard ?? result.aqiStandard, model: result.model || "Random Forest", predictedAt: result.predicted_at ?? result.predictedAt ?? new Date().toISOString() }, status: "Available" } as const;
  } catch { return { value: null, status: "Model service is unavailable; provider measurements are still shown." } as const; }
}

async function fetchJsonPost(url: string, body: unknown, timeoutMs: number) {
  const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) throw new Error(`Model service returned HTTP ${response.status}`);
  return response.json();
}

async function persist(reading: AirQualityReading) {
  try {
    const collection = (await getDatabase()).collection<AirQualityReading & { locationKey: string }>("air_quality_readings");
    await collection.createIndex({ locationKey: 1, providerTimestamp: 1 }, { unique: true, sparse: true });
    const key = locationKey(reading.location);
    await collection.updateOne({ locationKey: key, providerTimestamp: reading.providerTimestamp }, { $set: { ...reading, locationKey: key } }, { upsert: true });
  } catch (error) { console.error("Air quality persistence failed", error instanceof Error ? error.name : "unknown error"); }
}

async function getLastPersisted(location: AirLocation) {
  try {
    const collection = (await getDatabase()).collection<AirQualityReading & { locationKey: string }>("air_quality_readings");
    return await collection.findOne({ locationKey: locationKey(location) }, { sort: { fetchedAt: -1 } });
  } catch { return null; }
}

function hourlyPollutants(value: unknown): Record<string, Array<number | null> | undefined> {
  const hourly = (value as { hourly?: Record<string, unknown> } | null)?.hourly || {};
  const names = ["pm2_5", "pm10", "nitrogen_dioxide", "sulphur_dioxide", "carbon_monoxide", "ozone"];
  return Object.fromEntries(names.map((name) => [name, Array.isArray(hourly[name])
    ? (hourly[name] as unknown[]).map((item) => finiteOrNull(item))
    : undefined]));
}

async function refresh(location: AirLocation, force: boolean): Promise<AirQualityReading> {
  const key = locationKey(location);
  if (!state.locations.has(key) && state.locations.size >= 100) {
    const oldestKey = state.locations.keys().next().value;
    if (oldestKey) { state.locations.delete(oldestKey); state.cache.delete(oldestKey); state.failureUntil.delete(oldestKey); state.failureCount.delete(oldestKey); }
  }
  state.locations.delete(key);
  state.locations.set(key, location);
  const cached = state.cache.get(key);
  if (!force && cached && cached.nextRefreshAt > Date.now()) return cached.reading;
  if (state.inFlight.has(key)) return state.inFlight.get(key)!;
  const blockedUntil = state.failureUntil.get(key) || 0;
  if (blockedUntil > Date.now()) {
    if (cached) return { ...cached.reading, stale: true, error: cached.lastError || "Retry is delayed after a recent provider failure." };
    throw new Error("A retry is delayed after a recent provider failure.");
  }
  const task = (async () => {
    try {
      const cpcbSnapshot = await refreshCpcbSnapshot(false);
      const nearest = cpcbSnapshot ? nearestCpcbStation(location, cpcbSnapshot.stations) : null;
      const response = await getProviderReading(location);
      const current = response.current || {};
      const pollutants: AirQualityReading["pollutants"] = {
        pm2_5: finiteOrNull(current.pm2_5), pm10: finiteOrNull(current.pm10), nitrogen_dioxide: finiteOrNull(current.nitrogen_dioxide),
        sulphur_dioxide: finiteOrNull(current.sulphur_dioxide), carbon_monoxide: finiteOrNull(current.carbon_monoxide), ozone: finiteOrNull(current.ozone),
      };
      const model = await getModelPrediction(pollutants);
      const modelIndianAqi = calculateIndianAqi(hourlyPollutants(response));
      const officialStationAqi = nearest && nearest.dataType !== "HISTORICAL" ? nearest.aqi : null;
      const indianAqi = officialStationAqi !== null
        ? { value: officialStationAqi, category: indianAqiCategory(officialStationAqi), source: "CPCB" as const, dataType: nearest!.dataType as "LIVE_STATION" | "RECENT_STATION" }
        : modelIndianAqi !== null
          ? { value: modelIndianAqi, category: indianAqiCategory(modelIndianAqi), source: "CAMS_MODEL" as const, dataType: "MODEL_ESTIMATE" as const }
          : { value: null, category: "Unavailable", source: null, dataType: "UNAVAILABLE" as const };
      const reading: AirQualityReading = {
        location,
        pollutants,
        providerIndices: { europeanAqi: finiteOrNull(current.european_aqi), usAqi: finiteOrNull(current.us_aqi), standard: "European AQI and US AQI" },
        indianCpcbAqi: officialStationAqi,
        indianAqi,
        cpcbStation: nearest,
        cpcbStatus: { configured: Boolean(process.env.DATA_GOV_IN_API_KEY), fetchedAt: cpcbSnapshot?.fetchedAt || null, detail: cpcbSnapshot?.detail || getCpcbStatus().detail, ...(state.cpcbLastError ? { error: state.cpcbLastError } : {}) },
        providerTimestamp: typeof current.time === "string" ? current.time : null,
        providerGridCoordinates: { latitude: finiteOrNull(response.latitude) ?? location.latitude, longitude: finiteOrNull(response.longitude) ?? location.longitude },
        fetchedAt: new Date().toISOString(), source: "Open-Meteo Air Quality API", modelPrediction: model.value, modelStatus: model.status,
      };
      state.cache.set(key, { reading, nextRefreshAt: Date.now() + CACHE_MS });
      state.failureUntil.delete(key);
      state.failureCount.delete(key);
      await persist(reading);
      return reading;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Air-quality provider request failed.";
      const failures = (state.failureCount.get(key) || 0) + 1;
      state.failureCount.set(key, failures);
      const backoff = Math.min(5 * 60 * 1000, 30000 * 2 ** Math.min(failures - 1, 4));
      state.failureUntil.set(key, Date.now() + backoff);
      if (cached) {
        cached.lastError = message;
        cached.nextRefreshAt = Date.now() + backoff;
        return { ...cached.reading, stale: true, error: "Refresh failed; showing the last successful reading." };
      }
      const persisted = await getLastPersisted(location);
      if (persisted) {
        const reading: AirQualityReading = { ...persisted, stale: true, error: "Refresh failed; showing the last saved reading." };
        state.cache.set(key, { reading, nextRefreshAt: Date.now() + backoff, lastError: message });
        return reading;
      }
      throw new Error(message);
    } finally { state.inFlight.delete(key); }
  })();
  state.inFlight.set(key, task);
  return task;
}

export async function getCurrent(location: AirLocation) { return refresh(location, false); }
export async function refreshLocation(location: AirLocation) { return refresh(location, true); }

export async function getHistory(location: AirLocation, limit = 24) {
  const collection = (await getDatabase()).collection<AirQualityReading & { locationKey: string }>("air_quality_readings");
  return collection.find({ locationKey: locationKey(location) }).sort({ fetchedAt: -1 }).limit(Math.min(100, Math.max(1, limit))).toArray();
}

export function getStatus() {
  const now = Date.now();
  return [...state.locations.entries()].map(([key, location]) => {
    const entry = state.cache.get(key);
    return { location, source: "Open-Meteo Air Quality API", lastFetchedAt: entry?.reading.fetchedAt ?? null, providerTimestamp: entry?.reading.providerTimestamp ?? null, nextRefreshAt: entry ? new Date(entry.nextRefreshAt).toISOString() : null, stale: Boolean(entry && entry.nextRefreshAt < now), lastError: entry?.lastError ?? null, refreshing: state.inFlight.has(key) };
  });
}
