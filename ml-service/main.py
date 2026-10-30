"""Optional Random Forest inference API for AirGuard.

Place a project-trained sklearn Pipeline at saved_models/random_forest_model.joblib
and a JSON file next to it containing {"features": [...], "target": "AQI"}.
The API intentionally reports unavailable until a real, compatible model is supplied.
"""
from datetime import datetime, timezone
from pathlib import Path
import json

import joblib
import pandas as pd
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

ROOT = Path(__file__).parent
MODEL_PATH = ROOT / "saved_models" / "random_forest_model.joblib"
METADATA_PATH = ROOT / "saved_models" / "random_forest_model.json"
app = FastAPI(title="AirGuard Random Forest API", version="1.0.0")


class Pollutants(BaseModel):
    pm2_5: float | None = Field(default=None, ge=0)
    pm10: float | None = Field(default=None, ge=0)
    nitrogen_dioxide: float | None = Field(default=None, ge=0)
    sulphur_dioxide: float | None = Field(default=None, ge=0)
    carbon_monoxide: float | None = Field(default=None, ge=0)
    ozone: float | None = Field(default=None, ge=0)
    PM2_5: float | None = Field(default=None, ge=0)
    PM10: float | None = Field(default=None, ge=0)
    NO2: float | None = Field(default=None, ge=0)
    SO2: float | None = Field(default=None, ge=0)
    CO: float | None = Field(default=None, ge=0)
    O3: float | None = Field(default=None, ge=0)


def load_model():
    if not MODEL_PATH.is_file() or not METADATA_PATH.is_file():
        return None, None
    try:
        metadata = json.loads(METADATA_PATH.read_text(encoding="utf-8"))
        features = metadata.get("features")
        if not isinstance(features, list) or not features or not all(isinstance(x, str) for x in features):
            return None, None
        return joblib.load(MODEL_PATH), metadata
    except Exception:
        return None, None


@app.get("/health")
def health():
    model, metadata = load_model()
    return {"service": "ok", "model_available": model is not None,
            "model": (metadata or {}).get("model", "Random Forest"),
            "detail": "Ready" if model is not None else "No trained compatible Random Forest artifact is installed."}


@app.get("/model-info")
def model_info():
    _, metadata = load_model()
    return {"available": metadata is not None, "metadata": metadata,
            "artifact": MODEL_PATH.name if metadata else None}


@app.post("/predict")
def predict(values: Pollutants):
    model, metadata = load_model()
    if model is None:
        raise HTTPException(status_code=503, detail="Random Forest model is not installed. Train and provide a validated model artifact and feature metadata.")
    raw = values.model_dump()
    aliases = {"PM2.5": ("PM2_5", "pm2_5"), "PM2_5": ("PM2_5", "pm2_5"),
               "PM10": ("PM10", "pm10"), "NO2": ("NO2", "nitrogen_dioxide"),
               "SO2": ("SO2", "sulphur_dioxide"), "CO": ("CO", "carbon_monoxide"),
               "O3": ("O3", "ozone")}
    row = {}
    for feature in metadata["features"]:
        candidates = aliases.get(feature, (feature,))
        found = next((raw.get(name) for name in candidates if raw.get(name) is not None), None)
        if found is None:
            raise HTTPException(status_code=422, detail=f"Required model feature '{feature}' is unavailable from the provider response.")
        row[feature] = found
    try:
        estimate = float(model.predict(pd.DataFrame([row]))[0])
    except Exception as exc:
        raise HTTPException(status_code=500, detail="The installed model could not process these features.") from exc
    if not pd.notna(estimate):
        raise HTTPException(status_code=500, detail="The model returned a non-finite AQI prediction.")
    standard = metadata.get("aqi_standard")
    if standard == "CPCB India AQI":
        category = "Good" if estimate <= 50 else "Satisfactory" if estimate <= 100 else "Moderate" if estimate <= 200 else "Poor" if estimate <= 300 else "Very Poor" if estimate <= 400 else "Severe"
    else:
        category = "Unavailable: model AQI standard not declared"
    return {"predicted_aqi": round(estimate, 2), "aqi_category": category,
            "aqi_standard": standard,
            "model": metadata.get("model", "Random Forest"),
            "predicted_at": datetime.now(timezone.utc).isoformat(),
            "input_source": "Open-Meteo model estimates; prediction is not a measurement"}
