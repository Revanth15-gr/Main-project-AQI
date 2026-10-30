# AirGuard

AirGuard uses the Open-Meteo Air Quality API for live, model-estimated pollutant and provider AQI data. It does not present archived bulletins or predictions as current sensor readings.

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
- Node/Express provides `GET /api/air-quality/current`, `/history`, `/status`, and `/geocode`. Air-quality APIs require sign-in.
- Pollutants include PM2.5, PM10, NO2, SO2, CO and O3 where available. European AQI and US AQI are shown with their own standards. CPCB India AQI is not calculated from instantaneous values because required averaging windows are unavailable.
- The server caches and deduplicates by coordinates, retries failed provider calls with backoff, preserves the last successful result, stores readings in MongoDB, and refreshes tracked locations every 300 seconds. Browser dashboard polling also runs every five minutes. A persistent Node process is required for the scheduler; serverless hosting requires a platform scheduler.
- Provider model timestamp and application fetch timestamp are displayed separately. Five-minute retrieval does not imply a new provider model observation every five minutes. The feed is modelled output, not an IoT sensor feed.
- Open-Meteo is used without an API key for eligible non-commercial use. The dashboard links to Open-Meteo and CAMS attribution. Review the [Open-Meteo terms](https://open-meteo.com/en/terms) before deployment.
- Previous sample dashboard code and CPCB bulletin CSVs have been moved out of the publicly served folder into `archive/legacy-demo`; they are not loaded by the website or used as live readings.

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
