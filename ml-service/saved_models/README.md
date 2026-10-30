# Random Forest model artifact

No validated pretrained model is present in this repository. Do not use an arbitrary model or train on current Open-Meteo readings and present its outputs as measured AQI.

To enable predictions, install a project-trained scikit-learn `Pipeline` at `random_forest_model.joblib` and a same-directory `random_forest_model.json` with a `features` array naming the exact input columns, a `target`, and `aqi_standard` only when the target truly follows that standard; include an optional `model` name. CPCB categories are returned only when `aqi_standard` is exactly `CPCB India AQI`. Keep its training-data source, date range, target definition, preprocessing, and validation metrics documented alongside the artifact. The inference API returns 503 until both files exist and then validates all required provider features.
