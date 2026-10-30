import { getDatabase } from "./mongo-air-quality";

export type AirLocation = { name: string; latitude: number; longitude: number };
export type AirQualityReading = {
  location: AirLocation;
  pollutants: { pm2_5: number | null; pm10: number | null; nitrogen_dioxide: number | null; sulphur_dioxide: number | null; carbon_monoxide: number | null; ozone: number | null };
  providerIndices: { europeanAqi: number | null; usAqi: number | null; standard: "European AQI and US AQI" };
  indianCpcbAqi: null;
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
type ServiceState = { cache: Map<string, CacheEntry>; inFlight: Map<string, Promise<AirQualityReading>>; locations: Map<string, AirLocation>; failureUntil: Map<string, number>; failureCount: Map<string, number>; timer?: ReturnType<typeof setInterval> };
declare global { var __airGuardAirQuality: ServiceState | undefined; }
const state: ServiceState = globalThis.__airGuardAirQuality ??= { cache: new Map(), inFlight: new Map(), locations: new Map(), failureUntil: new Map(), failureCount: new Map() };
const CACHE_MS = 5 * 60 * 1000;

export function locationKey(location: AirLocation) { return `${location.latitude.toFixed(4)},${location.longitude.toFixed(4)}`; }

export function startAirQualityScheduler() {
  if (state.timer) return;
  state.timer = setInterval(() => {
    for (const location of state.locations.values()) void refresh(location, true).catch(() => undefined);
  }, CACHE_MS);
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
      const response = await getProviderReading(location);
      const current = response.current || {};
      const pollutants: AirQualityReading["pollutants"] = {
        pm2_5: finiteOrNull(current.pm2_5), pm10: finiteOrNull(current.pm10), nitrogen_dioxide: finiteOrNull(current.nitrogen_dioxide),
        sulphur_dioxide: finiteOrNull(current.sulphur_dioxide), carbon_monoxide: finiteOrNull(current.carbon_monoxide), ozone: finiteOrNull(current.ozone),
      };
      const model = await getModelPrediction(pollutants);
      const reading: AirQualityReading = {
        location,
        pollutants,
        providerIndices: { europeanAqi: finiteOrNull(current.european_aqi), usAqi: finiteOrNull(current.us_aqi), standard: "European AQI and US AQI" },
        indianCpcbAqi: null,
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
