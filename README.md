# AirGuard Next.js rebuild

This is a separate Next.js App Router application. The original HTML/CSS/JavaScript prototype remains unchanged in the workspace root. A copy of its registration and dashboard files lives in `public/legacy` so the original demo functionality remains available at `/register` and `/dashboard`.

## What works now

- The new `/` login screen keeps the AirGuard mark, original copy, dark-space background, green/blue accents, password reveal, and demo navigation.
- The Earth is a Three.js client component. Its bundled NASA Blue Marble map is paired with cloud and atmosphere effects; the Earth stays inside a responsive square viewport. If WebGL or the image is unavailable, a CSS globe remains visible.
- Reduced motion is respected. The renderer, textures, geometries, observer, event listeners, and animation frame are cleaned up on unmount.
- `/register` keeps the prototype registration flow. `/dashboard` opens the public historical AQI dashboard at `/legacy/dashboard.html`.
- The demo dashboard uses the supplied light mint/blue theme from `public/legacy/dashboard-theme.css`; the login and registration pages keep their existing styling.
- The dashboard reads bundled, real historical daily city-average AQI bulletins for Visakhapatnam, Hyderabad, Delhi, and Bengaluru. The series were compiled from CPCB daily bulletins by [UrbanEmissions.Info](https://urbanemissions.info/india-air-quality/india-ncap-aqi-indian-cities-2015-2023/) and end on 31 December 2023. The UI labels them as historical and does not call them current readings. Rajam is not included in this archive, so it shows a no-data state.
- A Better Auth App Router endpoint and server-only PostgreSQL connection foundation are included. Sign-in and protected dashboard access are not enabled until a real Supabase database is configured and migrated. The demo dashboard is intentionally a public prototype and is not an authenticated route.

Earth surface image: NASA Visible Earth, [Blue Marble: Land Surface, Shallow Water, and Shaded Topography](https://visibleearth.nasa.gov/view.php?id=57752). NASA describes the imagery as freely available to the public. The downloaded 2048px Blue Marble JPEG is in `public/images/earth-blue-marble-2048.jpg`.

## Run locally (PowerShell)

```powershell
cd "D:\Main Project\airguard-next"
npm install
npm run dev
```

Open <http://localhost:3000>. Node.js 20.9+ is required; the current Next.js installation guide lists that minimum.

## Configure Supabase PostgreSQL and Better Auth

1. Create a Supabase project and obtain its PostgreSQL connection string. Prefer the direct/server connection or session pooler supported for your deployment; do not put the database URI in a `NEXT_PUBLIC_` variable.
2. Copy the example and generate a secret:

   ```powershell
   Copy-Item .env.example .env.local
   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
   ```

3. Set `DATABASE_URL`, `BETTER_AUTH_SECRET` (at least 32 characters), and `BETTER_AUTH_URL` in `.env.local`. Keep `.env.local` private; `.gitignore` excludes it.
4. Apply Better Auth's PostgreSQL schema with the official CLI after setting the environment:

   ```powershell
   npx auth@latest migrate
   ```

5. The server endpoint is `/api/auth/[...all]`. Before enabling the login form, implement and verify its Better Auth client sign-in flow, then protect the production dashboard with server-side session validation. Do not treat `/legacy/dashboard.html` as private; it shows historical archive data and its demo profile still uses local browser storage.

No credentials are included, no authentication is claimed as working, and no passwords are saved by the new login form.

## AQI data phases

- Current implementation: historical CPCB city-average AQI, category, prominent pollutant, station count, and bulletin date. Individual pollutant concentrations are not present in these city-bulletin CSVs, so the dashboard does not invent PM2.5/PM10 readings.
- Later live phase: connect an official live provider through a server-side route, retain source/station/timestamp/freshness, and distinguish current observations from archive history.
- Later notification phase: add opt-in AQI thresholds and WhatsApp delivery through an approved provider after consent and provider credentials are configured.
- Later LLM/RAG phase: retrieve from reviewed air-quality/public-health references, show sources, keep guidance informational, and require user opt-in before any message is sent.

## Validation

```powershell
npm run typecheck
npm run lint
npm run build
```

The original prototype uses external chart/map libraries and is retained as-is; those legacy CDN features need internet access.
