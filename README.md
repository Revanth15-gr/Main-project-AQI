# AirGuard Next.js rebuild

This is a separate Next.js App Router application. The original HTML/CSS/JavaScript prototype remains unchanged in the workspace root. A copy of its registration and dashboard files lives in `public/legacy` so the original demo functionality remains available at `/register` and `/dashboard`.

## What works now

- The new `/` login screen keeps the AirGuard mark, original copy, dark-space background, green/blue accents, password reveal, and demo navigation.
- The Earth is a Three.js client component. Its bundled NASA Blue Marble map is paired with cloud and atmosphere effects; the Earth stays inside a responsive square viewport. If WebGL or the image is unavailable, a CSS globe remains visible.
- Reduced motion is respected. The renderer, textures, geometries, observer, event listeners, and animation frame are cleaned up on unmount.
- `/register` creates an account in MongoDB, verifies the required mobile number by WhatsApp when its approved Twilio OTP template is configured (otherwise SMS fallback), and establishes a signed JWT session. The historical archive itself remains public; notification and alert APIs require a valid session.
- The demo dashboard uses the supplied light mint/blue theme from `public/legacy/dashboard-theme.css`; the login and registration pages keep their existing styling.
- The dashboard reads bundled, real historical daily city-average AQI bulletins for Visakhapatnam, Hyderabad, Delhi, and Bengaluru. The series were compiled from CPCB daily bulletins by [UrbanEmissions.Info](https://urbanemissions.info/india-air-quality/india-ncap-aqi-indian-cities-2015-2023/) and end on 31 December 2023. The UI labels them as historical and does not call them current readings. Rajam is not included in this archive, so it shows a no-data state.
- JWT sessions, verified phone numbers, and live notification settings are scoped to each MongoDB account. The dashboard's archive is historical public data; only authenticated users can manage alerts or access private notification records.

Earth surface image: NASA Visible Earth, [Blue Marble: Land Surface, Shallow Water, and Shaded Topography](https://visibleearth.nasa.gov/view.php?id=57752). NASA describes the imagery as freely available to the public. The downloaded 2048px Blue Marble JPEG is in `public/images/earth-blue-marble-2048.jpg`.

## Run locally (PowerShell)

```powershell
cd "D:\Main Project\airguard-next"
npm install
npm run dev
```

Open <http://localhost:3000>. Node.js 20.9+ is required; the current Next.js installation guide lists that minimum.

## Configure MongoDB Atlas and JWT authentication

1. In Atlas, make sure the cluster is running, the database user has read/write access, and your IP address is allowed under Network Access. Copy the Node.js SRV connection string and use the `airguard` database.
2. Set `MONGODB_URI`, `MONGODB_DB=airguard`, and `JWT_SECRET` (at least 32 bytes) in `.env.local`. Keep the URI and secret private; `.gitignore` excludes `.env.local`.
3. If needed, generate a JWT signing secret:

   ```powershell
   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
   ```

4. AirGuard stores users in MongoDB and issues signed JWTs in HttpOnly cookies. There is no Better Auth dependency or SQL migration for accounts. Registration verifies the required E.164 mobile number by SMS, and sign-in requires the registered verified number.

Accounts, notification preferences/history, and AQI alert subscriptions use MongoDB. PostgreSQL is optional and is currently used only to persist CPCB station snapshots. Do not use the legacy browser profile as an identity or notification recipient.

## Live air-quality data

The dashboard now has a live-location panel backed by server-side routes. The CPCB source is the Government of India OGD resource `3b01bcb8-0b14-4abf-b6f2-c1bfd384ba69` (“Real time Air Quality Index from various locations”). Its verified API response contains hourly station rows with `country`, `state`, `city`, `station`, `last_update`, `latitude`, `longitude`, `pollutant_id`, `min_value`, `max_value` and `avg_value`. The resource response does **not** include a numeric AQI field or pollutant units, so AirGuard does not present a calculated CPCB station AQI from a single hourly snapshot.

Set a personal `DATA_GOV_IN_API_KEY` in `.env.local`. Create an account at [data.gov.in](https://www.data.gov.in/) and generate an API key from your account. The key embedded in the public resource page is sample access and is limited to a small number of rows; it is not suitable for India-wide station coverage. Keep your personal key on the server only. `DATA_GOV_IN_AQI_RESOURCE_ID` is prefilled with the verified resource ID.

Open-Meteo’s global CAMS model is used for location search and fallback estimates. Its output is labelled as a model estimate, never a physical reading. AirGuard calculates an India CPCB scale estimate only when it has enough model hours and at least three pollutant series including PM2.5 or PM10; otherwise the AQI remains unavailable. The estimate is not an official CPCB station value. Model time, station observation time, source and fetch time are kept distinct. Air-quality lookups are not application-cached, and the dashboard shows the requested coordinates and the model grid coordinates returned by Open-Meteo. Nearby locations may still share a model grid cell, and the underlying CAMS feed follows its own update schedule.

Location search uses the Open-Meteo geocoding API and filters results to India. It supports names and postal codes and returns multiple matches, so choose the intended district for ambiguous names such as Rajam. The browser’s GPS button requests location only after the user clicks it. Coordinates are restricted to India.

The dashboard loads recent model-derived AQI history (7, 30, or 90 days) for any selected Indian location, then keeps the separate CPCB city-bulletin archive clearly marked as historical. The map adds a pin at the searched location. The assistant uses a configured OpenAI Responses endpoint or an OpenAI-compatible chat-completions endpoint and receives the selected location and current reading as context; a provider key or a running local compatible model is required.

XKDR is not used as a live feed. Its documented product is an hourly historical database with a separate publication cadence; it may be added as an attributed historical source after selecting a useful date range. No unverified State Pollution Control Board endpoint is called.

### Configure and run

1. Set a personal `DATA_GOV_IN_API_KEY` in `.env.local`. Set MongoDB Atlas and JWT values as described above. `DATABASE_URL` is optional and only needed to persist CPCB station snapshots. No secret needs to be pasted into ChatGPT.
2. To persist CPCB station snapshots, configure the optional PostgreSQL connection and apply the AQI schema:

   ```powershell
   psql "$env:DATABASE_URL" -f .\supabase\migrations\202610310001_air_quality.sql
   ```

3. Generate a long random `AIR_QUALITY_CRON_SECRET` and configure an external scheduler to POST to `/api/air-quality/refresh` once per hour with `Authorization: Bearer <secret>`. This route persists the latest CPCB station snapshot to Supabase. The refresh route returns 503 until both the API key and database are configured.
4. For signup verification, set `TWILIO_ENABLED=true`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, and either `TWILIO_WHATSAPP_NUMBER` plus `TWILIO_WHATSAPP_OTP_CONTENT_SID` (approved template with `{{1}}` for the OTP) or `TWILIO_PHONE_NUMBER` for SMS fallback. Indian 10-digit numbers are normalized to `+91` in the account forms.
5. Set `TWILIO_ENABLED=true` after adding the Twilio credentials. The authenticated dashboard lets each user verify/update their own number and opt into SMS and/or WhatsApp; the server selects the destination from that user's verified MongoDB profile. Consent and enabled channels are checked before every send. `/api/notifications/history` only returns the current user's history, with phone numbers masked. Schedule `/api/alerts/dispatch` with `AIR_QUALITY_CRON_SECRET`; it sends on threshold crossings, records provider message IDs, deduplicates retries, and accepts signed delivery status callbacks at `/api/webhooks/twilio/status`.
6. WhatsApp alerts additionally need a public HTTPS status callback URL and both approved WhatsApp Content Template SIDs. The generic template uses variable `1` for message text; the AQI template uses variables `1`–`4` for location, AQI, category and source. Configure the exact Twilio WhatsApp sender and account.
7. For AI, set `AI_API_KEY`, `AI_MODEL`, and `AI_BASE_URL` in `.env.local`; the default endpoint uses OpenAI's Responses API. A local OpenAI-compatible model may run without a key when `AI_BASE_URL` points to localhost.
8. Start the app with `npm run dev`. Useful endpoints include `/api/health`, `/api/assistant`, `/api/air-quality/history?latitude=18.45&longitude=83.66&name=Rajam&days=7`, `/api/locations/search?q=Rajam%2C%20Srikakulam%2C%20Andhra%20Pradesh`, `/api/air-quality/stations`, and `/api/air-quality?latitude=18.45&longitude=83.66&name=Rajam&state=Andhra%20Pradesh`.

`MONGODB_URI` and `MONGODB_DB` configure MongoDB-backed users and notification data. `JWT_SECRET` signs authentication tokens. `DATABASE_URL` is optional and only used for AQI snapshot persistence. `AIR_QUALITY_CRON_SECRET` protects scheduled ingestion and alert dispatch. Twilio credentials stay server-side. `.env.local` is ignored by Git. Never set database or Twilio credentials in `NEXT_PUBLIC_*` variables.

The old historical bulletin dashboard remains available below the live panel and continues to be labelled as an archive through 2023. It is not used as a live fallback.

## Validation

```powershell
npm run typecheck
npm run lint
npm run build
```

The original prototype uses external chart/map libraries and is retained as-is; those legacy CDN features need internet access.
