# AirGuard

AirGuard uses the Government of India OGD CPCB monitoring feed when configured and Open-Meteo/CAMS for separately labelled model estimates. It does not present model estimates as station readings.

## Run locally

Requires Node.js 20.9 or newer.

```powershell
npm install
npm run dev
```

Open <http://localhost:3000>. The Express server runs in front of Next.js and serves the existing site and API on one port. For production, run `npm run build` and then `npm start` on a persistent Node.js host.

## Configure sign-in and data storage

Copy `.env.example` to `.env.local`, then set `MONGODB_URI`, `MONGODB_DB`, and a `JWT_SECRET` of at least 32 characters. Keep the Atlas URI and JWT secret private. The application uses its existing signed JWT cookie authentication. Protected dashboard and air-quality routes require a valid signed-in session.

## Live India-wide air quality

- The dashboard supports Indian city search through Open-Meteo geocoding with `countryCode=IN`, common city shortcuts, and browser location only after the user opts in.
- Node/Express provides `GET /api/air-quality/current`, `/history`, `/status`, `/stations`, and `/geocode`. Air-quality APIs require sign-in.
- CPCB resource `3b01bcb8-0b14-4abf-b6f2-c1bfd384ba69` is queried from `https://api.data.gov.in/resource/{resource-id}` with a personal `DATA_GOV_IN_API_KEY`, `format=json`, `offset`, and `limit`. Its verified response contains hourly pollutant rows and `last_update` station timestamps, but no AQI field or pollutant units. A single hourly CPCB snapshot is not enough to calculate official CPCB AQI, so AirGuard uses an official station AQI only if the source actually supplies one. It does not infer an AQI from incomplete station data.
- Open-Meteo is the model fallback. AirGuard calculates a clearly labelled estimate on the Indian CPCB scale only when the available hourly model data meets the minimum pollutant and averaging-window requirements. European and US indices remain separate secondary fields and are never presented as India's AQI.
- The Node server polls the nationwide CPCB feed every five minutes, with one in-flight refresh at a time. It deduplicates station readings by station and original `last_update`, so polling does not alter observation timestamps. Successful snapshots are upserted into MongoDB; a failed poll retains the last valid in-memory snapshot and Mongo records. The existing location cache and Open-Meteo refresh also run every 300 seconds. A persistent Node process is required; serverless hosting needs a platform scheduler.
- Rajam and other Indian locations are geocoded dynamically. If CPCB has no local station record, the dashboard identifies the nearest available station and its distance and observation time, while keeping the selected location's CAMS estimate separate.
- Provider model timestamp and application fetch timestamp are displayed separately. Five-minute retrieval does not imply a new provider model observation every five minutes. The feed is modelled output, not an IoT sensor feed.
- Open-Meteo is used without an API key for eligible non-commercial use. The dashboard links to Open-Meteo and CAMS attribution. Review the [Open-Meteo terms](https://open-meteo.com/en/terms) before deployment.
- The running project uses MongoDB Atlas via `MONGODB_URI`; `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, and `SUPABASE_SECRET_KEY` are not consumed by this repository. The Supabase placeholders in `.env.example` document that they are not configured integrations; the app's existing database architecture is preserved.
- Previous sample dashboard code and CPCB bulletin CSVs remain under `archive/legacy-demo`; they are not used as live readings.

Create a data.gov.in account and generate a personal API key for `DATA_GOV_IN_API_KEY`. The resource ID is prefilled. The publicly displayed sample key is limited and should not be used for India-wide polling. Never put the key in a `NEXT_PUBLIC_` variable. Without it, `/api/air-quality/status` reports CPCB as unconfigured and the UI labels its fallback estimate.

## Optional Random Forest service

`ml-service` contains a FastAPI inference service. Start it with:

```powershell
cd ml-service
python -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r requirements.txt
uvicorn main:app --host 0.0.0.0 --port 8000
```

Set `ML_SERVICE_URL=http://localhost:8000` in the root `.env.local` and restart Node. **This repository contains no validated pretrained Random Forest artifact or Kaggle training data.** The service reports its model unavailable and returns HTTP 503 until a compatible trained scikit-learn Pipeline and feature metadata are supplied in `ml-service/saved_models`. It will not make up a prediction. Document the actual dataset, target, feature preprocessing and validation metrics with any future artifact. Provider measurements and model predictions are returned separately.

## Advisory status

The dashboard currently offers clearly labeled, general rule-based guidance based on the selected provider index and the user's locally stored profile. No LLM advisory implementation, provider configuration, or credentials are present in this repository, so it does not claim to generate LLM advice or transmit health-profile information to a model provider.

## Checks

```powershell
npm run typecheck
npm run lint
npm run build
```
