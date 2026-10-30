import express, { type Request, type Response, type NextFunction } from "express";
import next from "next";
import { createHmac, timingSafeEqual } from "node:crypto";
import { getCurrent, getHistory, getStatus, refreshLocation, startAirQualityScheduler, type AirLocation } from "../src/lib/air-quality";

const dev = process.argv.includes("--dev");
const port = Number(process.env.PORT || 3000);
const nextApp = next({ dev, hostname: "0.0.0.0", port });
const handle = nextApp.getRequestHandler();
const app = express();
app.disable("x-powered-by");

function authenticated(req: Request, res: Response, nextMiddleware: NextFunction) {
  const token = req.cookies?.airguard_token || req.headers.cookie?.match(/(?:^|;\s*)airguard_token=([^;]+)/)?.[1];
  const secret = process.env.JWT_SECRET;
  try {
    if (!token || !secret || secret.length < 32) throw new Error("Invalid session");
    const [head, body, signature, extra] = decodeURIComponent(token).split(".");
    if (!head || !body || !signature || extra) throw new Error("Invalid session");
    const expected = createHmac("sha256", secret).update(`${head}.${body}`).digest("base64url");
    const actualBuffer = Buffer.from(signature);
    const expectedBuffer = Buffer.from(expected);
    if (actualBuffer.length !== expectedBuffer.length || !timingSafeEqual(actualBuffer, expectedBuffer)) throw new Error("Invalid session");
    const payload = JSON.parse(Buffer.from(body, "base64url").toString()) as { exp?: number };
    if (!payload.exp || payload.exp <= Math.floor(Date.now() / 1000)) throw new Error("Expired session");
    nextMiddleware();
  } catch {
    res.status(401).json({ error: "Sign in to access your AirGuard data." });
  }
}
app.use(express.json({ limit: "32kb" }));
app.use("/api/air-quality", authenticated);

function selectedLocation(req: Request): AirLocation | null {
  const latitude = Number(req.query.latitude);
  const longitude = Number(req.query.longitude);
  if (!Number.isFinite(latitude) || Math.abs(latitude) > 90 || !Number.isFinite(longitude) || Math.abs(longitude) > 180) return null;
  return { name: String(req.query.location || "Selected location").slice(0, 100), latitude, longitude };
}

app.get("/api/air-quality/current", async (req, res) => {
  const location = selectedLocation(req);
  if (!location) return res.status(400).json({ error: "Valid latitude and longitude are required." });
  startAirQualityScheduler();
  try {
    const reading = req.query.refresh === "1" ? await refreshLocation(location) : await getCurrent(location);
    return res.set("Cache-Control", "no-store").json(reading);
  } catch (error) {
    return res.status(502).json({ error: error instanceof Error ? error.message : "Air-quality data is unavailable." });
  }
});

app.get("/api/air-quality/history", async (req, res) => {
  const location = selectedLocation(req);
  if (!location) return res.status(400).json({ error: "Valid latitude and longitude are required." });
  try { return res.json(await getHistory(location, Number(req.query.limit) || 24)); }
  catch { return res.status(503).json({ error: "Air-quality history is not available." }); }
});

app.get("/api/air-quality/status", (_req, res) => {
  startAirQualityScheduler();
  return res.set("Cache-Control", "no-store").json({ refreshIntervalSeconds: 300, source: "Open-Meteo Air Quality API", locations: getStatus() });
});

app.get("/api/air-quality/geocode", async (req, res) => {
  const query = String(req.query.q || "").trim();
  if (query.length < 2 || query.length > 100) return res.status(400).json({ error: "Enter at least two characters to search." });
  try {
    const url = new URL("https://geocoding-api.open-meteo.com/v1/search");
    url.search = new URLSearchParams({ name: query, count: "10", language: "en", format: "json", countryCode: "IN" }).toString();
    const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!response.ok) throw new Error("Geocoding service unavailable");
    const data = await response.json() as { results?: Array<{ name: string; admin1?: string; country?: string; country_code?: string; latitude: number; longitude: number }> };
    return res.json((data.results || []).filter((item) => item.country_code === "IN").map((item) => ({ name: [item.name, item.admin1, "India"].filter(Boolean).join(", "), latitude: item.latitude, longitude: item.longitude })));
  } catch { return res.status(502).json({ error: "Location search is temporarily unavailable." }); }
});

app.use((req, res) => { void handle(req, res); });

nextApp.prepare().then(() => {
  startAirQualityScheduler();
  const server = app.listen(port, "0.0.0.0", () => console.info(`AirGuard ${dev ? "development" : "production"} server listening on port ${port}`));
  server.ref();
}).catch((error) => { console.error("Failed to start AirGuard", error); process.exit(1); });
