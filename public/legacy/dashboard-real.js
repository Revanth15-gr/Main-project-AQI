const CITIES = {
  Visakhapatnam: { name: "Visakhapatnam, India", latitude: 17.6868, longitude: 83.2185 },
  Hyderabad: { name: "Hyderabad, India", latitude: 17.385, longitude: 78.4867 },
  Delhi: { name: "Delhi, India", latitude: 28.6139, longitude: 77.209 },
  Bengaluru: { name: "Bengaluru, India", latitude: 12.9716, longitude: 77.5946 },
  Rajam: { name: "Rajam, India", latitude: 18.449, longitude: 83.659 },
};
const byId = (id) => document.getElementById(id);
const DEMO_MODE = new URLSearchParams(window.location.search).get("demo") === "1";
function apiUrl(path) {
  const url = new URL(path, window.location.origin);
  if (DEMO_MODE) url.searchParams.set("demo", "1");
  return `${url.pathname}${url.search}`;
}
const localRead = (key) => { try { return localStorage.getItem(key); } catch { return null; } };
const localWrite = (key, value) => { try { localStorage.setItem(key, value); } catch { /* Optional browser cache. */ } };
let locationChoice;
let inFlight;
let nextRefreshAt = 0;
let lastReading;
let chart;
let map;
let marker;
let stationMarkers = [];
let historyRows = [];

function userProfile() { if (DEMO_MODE) return null; try { return JSON.parse(localRead("airguardUser") || "null"); } catch { return null; } }
function safeText(value) { return String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]); }
function category(value, standard = "US EPA") {
  if (standard === "EEA") return value <= 20 ? ["Good", "good"] : value <= 40 ? ["Fair", "moderate"] : value <= 60 ? ["Moderate", "moderate"] : value <= 80 ? ["Poor", "poor"] : value <= 100 ? ["Very poor", "very-poor"] : ["Extremely poor", "severe"];
  return value <= 50 ? ["Good", "good"] : value <= 100 ? ["Moderate", "moderate"] : value <= 150 ? ["Unhealthy for sensitive groups", "moderate"] : value <= 200 ? ["Unhealthy", "poor"] : value <= 300 ? ["Very unhealthy", "very-poor"] : ["Hazardous", "severe"];
}
function indianCategory(value) {
  if (!Number.isFinite(value)) return ["Unavailable", "neutral"];
  return value <= 50 ? ["Good", "good"] : value <= 100 ? ["Satisfactory", "moderate"] : value <= 200 ? ["Moderate", "moderate"] : value <= 300 ? ["Poor", "poor"] : value <= 400 ? ["Very Poor", "very-poor"] : ["Severe", "severe"];
}
function setStatus(text, isError = false) { const el = byId("liveDataStatus"); if (el) { el.textContent = text; el.classList.toggle("error", isError); } }
function display(value, includeUnits = true) { return typeof value === "number" && Number.isFinite(value) ? `${Number(value.toFixed(1))}${includeUnits ? " µg/m³" : ""}` : "Unavailable"; }
function profileUI() {
  const p = userProfile() || {}; const name = p.fullName || "AirGuard member";
  if (byId("topProfileName")) byId("topProfileName").textContent = name.split(" ")[0];
  if (byId("profileName")) byId("profileName").textContent = name;
  if (byId("profileEmail")) byId("profileEmail").textContent = p.email || "";
  if (byId("avatarInitial")) byId("avatarInitial").textContent = name[0]?.toUpperCase() || "U";
  if (byId("settingsName")) byId("settingsName").value = p.fullName || "";
  if (byId("settingsEmail")) byId("settingsEmail").value = p.email || "";
  if (byId("settingsAge")) byId("settingsAge").value = p.age || "";
  if (byId("settingsLocation")) byId("settingsLocation").value = locationChoice?.name || p.location || "";
  if (byId("settingsConditions")) byId("settingsConditions").value = (p.diseases || []).join(", ");
  if (byId("healthProfileName")) byId("healthProfileName").textContent = name;
  if (byId("healthProfileMeta")) byId("healthProfileMeta").textContent = `${p.age ? `${p.age} years` : "Age not set"} · ${locationChoice?.name || p.location || "Choose a location"}`;
  if (byId("healthConditions")) byId("healthConditions").textContent = (p.diseases || []).length ? p.diseases.join(", ") : "No health conditions selected";
}
function syncLocationSelect() {
  const select = byId("locationSelect"); if (!select) return;
  const known = Object.entries(CITIES).find(([, city]) => Math.abs(city.latitude - locationChoice.latitude) < .02 && Math.abs(city.longitude - locationChoice.longitude) < .02);
  let option = select.querySelector('option[value="__custom__"]');
  if (!known) {
    if (!option) { option = document.createElement("option"); option.value = "__custom__"; select.appendChild(option); }
    option.textContent = locationChoice.name; select.value = "__custom__";
  } else select.value = known[0];
}
function updateMap(reading) {
  if (!map || !reading?.location) return;
  if (marker) map.removeLayer(marker);
  const { latitude, longitude, name } = reading.location;
  map.setView([latitude, longitude], 8);
  const india = reading.indianAqi?.value;
  const color = typeof india !== "number" ? "#3388ff" : india <= 50 ? "#21ae7d" : india <= 100 ? "#e1b83d" : india <= 200 ? "#ee8b42" : india <= 300 ? "#e47b60" : "#8a4c75";
  marker = L.circleMarker([latitude, longitude], { radius: 12, color: "#fff", weight: 3, fillColor: color, fillOpacity: 1 }).addTo(map)
    .bindPopup(`<b>${safeText(name)}</b><br>${safeText(reading.indianAqi?.source === "CPCB" ? "CPCB station AQI" : reading.indianAqi?.source === "CAMS_MODEL" ? "India CPCB scale · CAMS model estimate" : "India AQI unavailable")}<br>India AQI: ${india ?? "unavailable"}<br>Nearest station: ${safeText(reading.cpcbStation?.name || "unavailable")}<br>Provider model timestamp: ${safeText(reading.providerTimestamp || "unavailable")}`);
}
function updateAdvisory(reading) {
  const basis = byId("liveHealthBasis"); const advice = byId("liveHealthAdvice");
  if (!basis || !advice) return;
  const indiaAqi = reading.indianAqi?.value; const p = userProfile() || {};
  if (typeof indiaAqi !== "number") { basis.textContent = "No validated India-scale AQI is available; no category-based guidance was generated."; advice.textContent = "Check local public-health information."; return; }
  const sensitive = (Number(p.age) < 18 || Number(p.age) >= 65) || (p.diseases || []).some((x) => /asthma|copd|heart|allerg/i.test(x));
  basis.textContent = `Based on India-scale AQI ${indiaAqi} (${indianCategory(indiaAqi)[0]}) from ${reading.indianAqi.source === "CPCB" ? "a CPCB station" : "CAMS model estimates"}. This is general rule-based guidance, not a diagnosis.`;
  advice.textContent = indiaAqi <= 50 ? "Air quality is in the CPCB Good range. Follow ordinary precautions and your usual care plan." : indiaAqi <= 100 ? (sensitive ? "People who are unusually sensitive may consider reducing prolonged, strenuous outdoor activity if symptoms occur." : "Most people can continue usual activities; unusually sensitive people may consider reducing prolonged, strenuous outdoor activity if symptoms occur.") : indiaAqi <= 200 ? "People with asthma, heart or lung conditions, children, and older adults may consider reducing prolonged or strenuous outdoor activity." : indiaAqi <= 300 ? "Consider reducing prolonged or strenuous outdoor activity; sensitive groups should take extra care and follow local public-health guidance." : "Avoid strenuous outdoor activity where practical and follow local public-health guidance.";
}
function renderReading(reading) {
  lastReading = reading;
  const pollutants = reading.pollutants || {};
  const pollutantIds = { livePm25: "pm2_5", livePm10: "pm10", liveNo2: "nitrogen_dioxide", liveSo2: "sulphur_dioxide", liveCo: "carbon_monoxide", liveO3: "ozone" };
  let stationPollutantsShown = 0;
  Object.entries(pollutantIds).forEach(([id, key]) => {
    const valueNode = byId(id); if (!valueNode) return;
    const station = reading.cpcbStation;
    const stationValue = station && station.dataType !== "HISTORICAL" ? station.pollutants?.[key] : null;
    const hasStationValue = typeof stationValue === "number" && Number.isFinite(stationValue);
    if (hasStationValue) stationPollutantsShown += 1;
    valueNode.textContent = display(hasStationValue ? stationValue : pollutants[key], !hasStationValue);
    const label = valueNode.closest(".live-reading")?.querySelector("span");
    if (label) label.textContent = `${label.textContent.split(" · ")[0]} · ${hasStationValue ? "CPCB station" : "CAMS model"}`;
  });
  const pollutantNote = [...document.querySelectorAll(".section-heading p.muted")].find((node) => node.textContent.includes("Pollutants and provider AQI indices"));
  if (pollutantNote) pollutantNote.textContent = stationPollutantsShown
    ? `CPCB values are shown where available; source units are not included. Other pollutant values are CAMS model estimates and are labelled separately.`
    : `Pollutant concentrations are CAMS model estimates in µg/m³. CPCB station data appears separately when configured; the government feed does not include pollutant units.`;
  const eu = reading.providerIndices?.europeanAqi; const us = reading.providerIndices?.usAqi;
  byId("liveEuropeanAqi").textContent = eu == null ? "Unavailable" : `${eu} · ${category(eu, "EEA")[0]}`;
  byId("liveUsAqi").textContent = us == null ? "Unavailable" : `${us} · ${category(us)[0]}`;
  const india = reading.indianAqi || { value: null, category: "Unavailable", source: null, dataType: "UNAVAILABLE" };
  const chosen = typeof india.value === "number" ? { value: india.value, name: "India CPCB AQI", standard: india.source === "CPCB" ? "CPCB station" : "CPCB scale estimate" } : null;
  const selectedCategory = chosen ? indianCategory(chosen.value) : ["Unavailable", "neutral"];
  byId("liveCpcbAqi").textContent = chosen ? `${chosen.value} · ${selectedCategory[0]}${india.source === "CPCB" ? " · station" : " · estimate"}` : "Unavailable · no complete India-scale AQI";
  byId("aqiValue").textContent = chosen ? String(chosen.value) : "—";
  byId("gaugeValue").textContent = chosen ? String(chosen.value) : "—";
  byId("detailCategory").textContent = chosen ? `${selectedCategory[0]} · India CPCB scale · ${chosen.standard}` : "Unavailable";
  byId("detailPollutant").textContent = "See live pollutant concentrations";
  byId("detailStations").textContent = reading.cpcbStation ? `${reading.cpcbStation.distanceKm} km to nearest station` : "No station record available";
  byId("archiveDate").textContent = reading.cpcbStation?.observedAt || reading.providerTimestamp || "Unavailable";
  byId("updatedAt").textContent = reading.cpcbStation?.observedAt || reading.providerTimestamp || "Unavailable";
  byId("prominentPollutant").textContent = india.source === "CPCB" ? "CPCB station AQI" : india.source === "CAMS_MODEL" ? "CAMS model estimate" : "No validated India AQI";
  byId("stationsCount").textContent = reading.cpcbStation ? `${reading.cpcbStation.name}, ${reading.cpcbStation.city}` : "CPCB station unavailable";
  byId("aqiSummary").textContent = chosen ? `${chosen.name} ${chosen.value} (${selectedCategory[0]}). ${india.source === "CPCB" ? "Official station AQI." : "Calculated from CAMS model concentrations and labelled as an estimate; it is not a station reading."}` : "India-scale AQI unavailable: the CPCB feed does not include an AQI value and the model lacks enough hourly pollutant data to calculate one.";
  byId("aqiStatusChip").textContent = chosen ? selectedCategory[0] : "Unavailable";
  byId("aqiStatusChip").className = `status-chip ${selectedCategory[1]}`;
  const scaleMax = 500;
  const scaleLabels = ["Good", "Satisfactory", "Moderate", "Poor", "Very Poor", "Severe"];
  const scale = document.querySelector(".aqi-scale");
  if (scale) scale.innerHTML = scaleLabels.map((label) => `<span>${safeText(label)}</span>`).join("");
  const scalePosition = chosen ? Math.min(100, chosen.value / scaleMax * 100) : 0;
  byId("aqiMarker").style.left = `${Math.min(98, Math.max(1, scalePosition))}%`;
  const color = chosen ? ({ good: "#17a977", moderate: "#e3bd3b", poor: "#e98a47", "very-poor": "#e77c5d", severe: "#8a4c75" })[selectedCategory[1]] || "#82979e" : "#82979e";
  byId("aqiGauge").style.background = chosen ? `conic-gradient(${color} 0 ${scalePosition}%, #e5f5ec ${scalePosition}% 100%)` : "#edf4f2";
  byId("welcomeName").textContent = reading.location?.name || locationChoice.name;
  byId("forecastHeadline").textContent = "Live API data";
  byId("forecastStatus").textContent = reading.source;
  const prediction = reading.modelPrediction;
  byId("liveModelPrediction").textContent = prediction ? `Random Forest prediction: ${prediction.predictedAqi} (${prediction.category || "category unavailable"}; ${prediction.aqiStandard || "model AQI standard not declared"}), model output at ${new Date(prediction.predictedAt).toLocaleString()}. Prediction only; not a provider reading.` : `Random Forest unavailable: ${reading.modelStatus || "No trained model service configured."}`;
  const fetched = new Date(reading.fetchedAt);
  const providerDate = reading.providerTimestamp ? new Date(reading.providerTimestamp) : null;
  const stationDate = reading.cpcbStation?.observedAt ? new Date(reading.cpcbStation.observedAt) : null;
  const effectiveDate = india.source === "CPCB" ? stationDate : providerDate;
  const oldProvider = !effectiveDate || Date.now() - effectiveDate.getTime() > (india.source === "CPCB" ? 6 : 24) * 60 * 60 * 1000;
  const oldFetch = Date.now() - fetched.getTime() > 10 * 60 * 1000;
  const stale = Boolean(reading.stale || oldProvider || oldFetch || india.dataType === "UNAVAILABLE");
  const sourceLabel = india.source === "CPCB" ? `${india.dataType === "RECENT_STATION" ? "RECENT STATION READING" : "LIVE STATION READING"} · CPCB` : india.source === "CAMS_MODEL" ? "MODEL-BASED ESTIMATE · CAMS / OPEN-METEO" : "DATA UNAVAILABLE";
  const status = `${sourceLabel} · Last fetch ${fetched.toLocaleString()} · Observation ${effectiveDate ? effectiveDate.toLocaleString() : "unavailable"}.`;
  setStatus(status + (reading.error ? ` ${reading.error}` : ""), stale);
  const meta = byId("liveDataMeta");
  const station = reading.cpcbStation;
  const stationValues = station ? Object.entries(station.pollutants || {}).filter(([, value]) => typeof value === "number").map(([key, value]) => `${key} ${value}`).join(", ") : "";
  meta.innerHTML = `Location: ${safeText(reading.location?.name || locationChoice.name)} · AQI source: ${safeText(india.source === "CPCB" ? "Official CPCB station" : india.source === "CAMS_MODEL" ? "CAMS model estimate on India CPCB scale" : "Unavailable")} · <a href="https://www.data.gov.in/catalog/real-time-air-quality-index" target="_blank" rel="noreferrer">CPCB / data.gov.in</a> · <a href="https://open-meteo.com/en/docs/air-quality-api" target="_blank" rel="noreferrer">Open-Meteo</a> · Model timestamp: ${safeText(providerDate ? providerDate.toLocaleString() : "unavailable")} · Last fetch: ${safeText(fetched.toLocaleString())} · CPCB last fetch: ${safeText(reading.cpcbStatus?.fetchedAt ? new Date(reading.cpcbStatus.fetchedAt).toLocaleString() : "unavailable")} · CPCB feed: ${safeText(reading.cpcbStatus?.detail || "unavailable")}.`;
  let stationInfo = byId("cpcbStationDetails");
  if (!stationInfo) { stationInfo = document.createElement("p"); stationInfo.id = "cpcbStationDetails"; stationInfo.className = "tiny-note"; meta.parentElement?.appendChild(stationInfo); }
  stationInfo.textContent = station ? `Nearest CPCB station: ${station.name}, ${station.city}, ${station.state} (${station.distanceKm} km away). Original observation: ${new Date(station.observedAt).toLocaleString()}. Station pollutant values: ${stationValues || "none"}. The source does not publish pollutant units or an AQI field.` : reading.cpcbStatus?.detail || "No verified CPCB station record is available. The location marker is a model estimate.";
  if (byId("welcomeDataSource")) byId("welcomeDataSource").textContent = `${sourceLabel} · ${reading.source}`;
  nextRefreshAt = Date.now() + 5 * 60 * 1000;
  localWrite(`airguardLastLive:${locationChoice.latitude.toFixed(4)},${locationChoice.longitude.toFixed(4)}`, JSON.stringify(reading));
  profileUI(); updateAdvisory(reading); updateMap(reading); if (map) void loadCpcbStations();
}
async function fetchCurrent(force = false) {
  if (inFlight) return inFlight;
  const query = new URLSearchParams({ latitude: locationChoice.latitude, longitude: locationChoice.longitude, location: locationChoice.name });
  if (force) query.set("refresh", "1");
  setStatus("Loading current Indian air-quality data…");
  inFlight = (async () => {
    try {
      const response = await fetch(apiUrl(`/api/air-quality/current?${query}`), { cache: "no-store", credentials: "same-origin" });
      const result = await response.json(); if (!response.ok) throw new Error(result.error || `Live API returned HTTP ${response.status}.`);
      renderReading(result); await loadHistory();
    } catch (error) {
      nextRefreshAt = Date.now() + 60 * 1000;
      const key = `airguardLastLive:${locationChoice.latitude.toFixed(4)},${locationChoice.longitude.toFixed(4)}`;
      try { const cached = JSON.parse(localRead(key) || "null"); if (cached) renderReading({ ...cached, stale: true }); } catch { /* Ignore invalid local cache. */ }
      setStatus(`${error.message || "Live data could not be fetched."} ${lastReading ? "Showing the last successful reading; it is marked stale." : "No live reading is available."}`, true);
    } finally { inFlight = null; }
  })();
  return inFlight;
}
async function loadHistory() {
  const query = new URLSearchParams({ latitude: locationChoice.latitude, longitude: locationChoice.longitude, location: locationChoice.name, limit: "50" });
  try {
    const response = await fetch(apiUrl(`/api/air-quality/history?${query}`), { cache: "no-store", credentials: "same-origin" });
    const data = await response.json(); if (!response.ok) throw new Error("History unavailable");
    historyRows = data; renderHistory();
  } catch { byId("historyRows").innerHTML = '<tr><td colspan="5">Live API history is temporarily unavailable.</td></tr>'; }
}
function renderHistory() {
  const tbody = byId("historyRows");
  const header = tbody.closest("table")?.querySelector("thead");
  if (header) header.innerHTML = "<tr><th>Last successful fetch</th><th>Location</th><th>India CPCB scale AQI</th><th>Source / reading type</th><th>Observation timestamp</th></tr>";
  if (!historyRows.length) tbody.innerHTML = '<tr><td colspan="5">No current-data history is saved for this location yet.</td></tr>';
  else tbody.innerHTML = historyRows.map((r) => `<tr><td>${safeText(new Date(r.fetchedAt).toLocaleString())}</td><td>${safeText(r.location.name)}</td><td>${r.indianAqi?.value ?? "—"} · ${safeText(r.indianAqi?.category || "Unavailable")}</td><td>${safeText(r.indianAqi?.source === "CPCB" ? "CPCB station reading" : r.indianAqi?.source === "CAMS_MODEL" ? "Model estimate" : "Unavailable")}</td><td>${safeText(r.cpcbStation?.observedAt || r.providerTimestamp || "—")}</td></tr>`).join("");
  const compact = byId("liveHistoryRows");
  if (compact) compact.innerHTML = !historyRows.length ? '<tr><td colspan="4">No current-data history is saved for this location.</td></tr>' : historyRows.slice(0, 6).map((r) => `<tr><td>${safeText(new Date(r.fetchedAt).toLocaleString())}</td><td>${r.indianAqi?.value ?? "—"}</td><td>${safeText(r.indianAqi?.source || "unavailable")}</td><td>${safeText(r.cpcbStation?.observedAt || r.providerTimestamp || "—")}</td></tr>`).join("");
  byId("dataRecords").textContent = String(historyRows.length);
  byId("latestYearMax").textContent = historyRows[0]?.indianAqi?.value == null ? "—" : `${historyRows[0].indianAqi.value} India AQI`;
  byId("weeklyAverage").textContent = historyRows[0]?.fetchedAt ? new Date(historyRows[0].fetchedAt).toLocaleString() : "—";
  if (chart) {
    const rows = [...historyRows].reverse(); chart.data.labels = rows.map((r) => r.providerTimestamp || r.fetchedAt);
    chart.data.datasets[0].data = rows.map((r) => r.indianAqi?.source === "CPCB" ? r.indianAqi.value : null);
    chart.data.datasets[1].data = rows.map((r) => r.indianAqi?.source === "CAMS_MODEL" ? r.indianAqi.value : null); chart.update();
  }
}
async function searchLocations() {
  const q = byId("locationSearch").value.trim(); const results = byId("locationResults"); results.replaceChildren();
  if (q.length < 2) { setStatus("Enter at least two characters to search Indian locations.", true); return; }
  try {
    const response = await fetch(apiUrl(`/api/air-quality/geocode?q=${encodeURIComponent(q)}`), { credentials: "same-origin" }); const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Location search failed.");
    for (const item of data) { const b = document.createElement("button"); b.type = "button"; b.textContent = item.name; b.addEventListener("click", () => { locationChoice = item; syncLocationSelect(); results.hidden = true; localWrite("airguardSelectedLocation", JSON.stringify(item)); profileUI(); void fetchCurrent(); }); results.appendChild(b); }
    results.hidden = !data.length; if (!data.length) setStatus("No Indian location matched that search.", true);
  } catch (error) { setStatus(error.message || "Location search failed.", true); }
}
function updateCountdown() {
  if (Date.now() >= nextRefreshAt && !inFlight) { void fetchCurrent(); return; }

  const seconds = Math.max(0, Math.ceil((nextRefreshAt - Date.now()) / 1000));
  const status = byId("liveDataStatus");
  if (status && seconds > 0 && !status.classList.contains("error") && !inFlight) {
    const source = lastReading?.indianAqi?.source === "CPCB" ? "CPCB station reading" : lastReading?.indianAqi?.source === "CAMS_MODEL" ? "Model-based estimate on the India CPCB scale" : "Data unavailable";
    status.textContent = `${source} · Next check in ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}. New provider observations may arrive less often.`;
  }
}
function initMap() {
  const el = byId("airMap"); if (!el || !window.L) return;
  map = L.map(el).setView([locationChoice.latitude, locationChoice.longitude], 8);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 18, attribution: "&copy; OpenStreetMap contributors" }).addTo(map);
  if (lastReading) updateMap(lastReading); setTimeout(() => map.invalidateSize(), 100);
  void loadCpcbStations();
}
async function loadCpcbStations() {
  if (!map || !window.L) return;
  try {
    const response = await fetch(apiUrl("/api/air-quality/stations"), { cache: "no-store", credentials: "same-origin" });
    const result = await response.json(); if (!response.ok) return;
    stationMarkers.forEach((item) => map.removeLayer(item)); stationMarkers = [];
    (result.stations || []).forEach((station) => {
      const color = typeof station.aqi === "number" ? station.aqi <= 50 ? "#21ae7d" : station.aqi <= 100 ? "#e1b83d" : station.aqi <= 200 ? "#ee8b42" : station.aqi <= 300 ? "#e47b60" : "#8a4c75" : "#728995";
      const point = L.circleMarker([station.latitude, station.longitude], { radius: 5, color: "#fff", weight: 1, fillColor: color, fillOpacity: .9 }).addTo(map);
      const pollutantText = Object.entries(station.pollutants || {}).filter(([, value]) => typeof value === "number").map(([key, value]) => `${key}: ${value}`).join(", ");
      point.bindPopup(`<b>${safeText(station.name)}</b><br>${safeText(station.city)}, ${safeText(station.state)}<br>${safeText(station.dataType.replaceAll("_", " "))}<br>Observed: ${safeText(new Date(station.observedAt).toLocaleString())}<br>${station.aqi == null ? "No CPCB AQI field in source" : `CPCB AQI: ${station.aqi}`}<br>Pollutants (source units not supplied): ${safeText(pollutantText || "unavailable")}`);
      stationMarkers.push(point);
    });
  } catch { /* Keep the selected-location map usable if the station source is unavailable. */ }
}
function initChart() {
  if (!window.Chart || !byId("forecastChart")) return;
  chart = new Chart(byId("forecastChart"), { type: "line", data: { labels: [], datasets: [
    { label: "CPCB station AQI", data: [], borderColor: "#0b9d70", backgroundColor: "rgba(11,157,112,.12)", fill: false, tension: .3, spanGaps: true },
    { label: "CAMS model estimate on India CPCB scale", data: [], borderColor: "#557db5", backgroundColor: "rgba(85,125,181,.12)", fill: false, tension: .3, spanGaps: true },
  ] }, options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: true } }, scales: { y: { beginAtZero: true, max: 500 } } } });
}
function addBubble(text, who) { const bubble = document.createElement("div"); bubble.className = `chat-bubble ${who}`; bubble.textContent = text; byId("chatMessages").appendChild(bubble); byId("chatMessages").scrollTop = byId("chatMessages").scrollHeight; }
function answer(question) {
  if (!lastReading) return "No successful live reading is loaded yet. Check the connection status and try refreshing.";
  const r = lastReading; const p = r.pollutants; const india = r.indianAqi || {};
  if (/pm|pollut/i.test(question)) {
    const keys = { "PM2.5": "pm2_5", PM10: "pm10", NO2: "nitrogen_dioxide", SO2: "sulphur_dioxide", CO: "carbon_monoxide", O3: "ozone" };
    const values = Object.entries(keys).map(([label, key]) => {
      const stationValue = r.cpcbStation?.dataType !== "HISTORICAL" ? r.cpcbStation?.pollutants?.[key] : null;
      return `${label} ${stationValue ?? p[key] ?? "unavailable"}${typeof stationValue === "number" ? " (CPCB station; units unavailable)" : " µg/m³ (CAMS model estimate)"}`;
    }).join(", ");
    return `${r.location.name}: ${values}. ${r.cpcbStation ? `Nearest CPCB station: ${r.cpcbStation.name}, ${r.cpcbStation.city}, ${r.cpcbStation.state}, ${r.cpcbStation.distanceKm} km away; observed ${r.cpcbStation.observedAt}.` : "No CPCB station record is available."}`;
  }
  if (/health|advice|exposure/i.test(question)) return `The health panel uses India CPCB scale AQI ${india.value ?? "unavailable"} (${india.category || "Unavailable"}), from ${india.source === "CPCB" ? "an official station value" : india.source === "CAMS_MODEL" ? "a clearly labelled model estimate" : "no validated Indian AQI source"}. This is general guidance, not an LLM response or medical diagnosis.`;
  return `${r.location.name}: India CPCB scale AQI ${india.value ?? "unavailable"} (${india.category || "Unavailable"}), ${india.source === "CPCB" ? "official station reading" : india.source === "CAMS_MODEL" ? "model-based estimate, not a station reading" : "unavailable"}. Separate provider indices are European AQI ${r.providerIndices?.europeanAqi ?? "unavailable"} and US AQI ${r.providerIndices?.usAqi ?? "unavailable"}; they are not substitutes for Indian AQI. Last fetched ${new Date(r.fetchedAt).toLocaleString()}.`;
}
async function signOut() { await fetch("/api/auth/logout", { method: "DELETE", credentials: "same-origin" }).catch(() => undefined); window.location.assign("/"); }

document.addEventListener("DOMContentLoaded", async () => {
  if (DEMO_MODE) {
    const settings = byId("settings"); if (settings) settings.hidden = true;
    const profileButton = byId("profileButton"); if (profileButton) profileButton.hidden = true;
    const brandLink = document.querySelector(".side-brand"); if (brandLink) brandLink.href = "dashboard.html?demo=1";
    if (byId("healthProfileName")) byId("healthProfileName").textContent = "Demo view";
    if (byId("healthProfileMeta")) byId("healthProfileMeta").textContent = "Profile details are not loaded in demo mode.";
    if (byId("healthConditions")) byId("healthConditions").textContent = "No personal health profile is used.";
  }
  const selected = (() => { try { return JSON.parse(localRead("airguardSelectedLocation") || "null"); } catch { return null; } })();
  locationChoice = selected && Number.isFinite(selected.latitude) && Number.isFinite(selected.longitude) ? selected : CITIES[byId("locationSelect")?.value] || CITIES.Visakhapatnam;
  syncLocationSelect(); profileUI(); initChart(); initMap();
  byId("locationSelect").addEventListener("change", (event) => { if (event.target.value === "__custom__") return; locationChoice = CITIES[event.target.value] || CITIES.Visakhapatnam; localWrite("airguardSelectedLocation", JSON.stringify(locationChoice)); profileUI(); void fetchCurrent(); });
  byId("locationSearchButton").addEventListener("click", () => void searchLocations());
  byId("locationSearch").addEventListener("keydown", (event) => { if (event.key === "Enter") { event.preventDefault(); void searchLocations(); } });
  byId("useLocationButton").addEventListener("click", () => {
    if (!navigator.geolocation) { setStatus("Location is unavailable in this browser.", true); return; }
    setStatus("Waiting for browser location permission…");
    navigator.geolocation.getCurrentPosition((pos) => { locationChoice = { name: "Your current location", latitude: pos.coords.latitude, longitude: pos.coords.longitude }; syncLocationSelect(); localWrite("airguardSelectedLocation", JSON.stringify(locationChoice)); profileUI(); void fetchCurrent(); }, () => setStatus("Location permission was not granted. Search for an Indian location instead.", true), { timeout: 10000, maximumAge: 300000 });
  });
  byId("refreshLiveButton").addEventListener("click", () => { void fetchCurrent(true); });
  byId("refreshBtn").addEventListener("click", () => { void fetchCurrent(true); });
  byId("logoutBtn").addEventListener("click", signOut); byId("profileSignout").addEventListener("click", signOut);
  byId("profileButton").addEventListener("click", () => byId("profilePopover").classList.toggle("hidden"));
  byId("menuToggle").addEventListener("click", () => byId("sidebar").classList.toggle("open"));
  byId("dismissNotice").addEventListener("click", () => byId("dismissNotice").closest(".notice-banner")?.remove());
  document.querySelectorAll("[data-jump]").forEach((button) => button.addEventListener("click", () => document.getElementById(button.dataset.jump)?.scrollIntoView({ behavior: "smooth" })));
  document.querySelectorAll(".side-nav a").forEach((a) => a.addEventListener("click", () => { document.querySelectorAll(".side-nav a").forEach((x) => x.classList.remove("active")); a.classList.add("active"); byId("sidebar").classList.remove("open"); }));
  byId("chatForm").addEventListener("submit", (event) => { event.preventDefault(); const input = byId("chatInput"); if (!input.value.trim()) return; const q = input.value.trim(); addBubble(q, "user"); addBubble(answer(q), "bot"); input.value = ""; });
  document.querySelectorAll("[data-prompt]").forEach((button) => button.addEventListener("click", () => { addBubble(button.dataset.prompt, "user"); addBubble(answer(button.dataset.prompt), "bot"); }));
  byId("settingsForm").addEventListener("submit", (event) => { event.preventDefault(); const p = userProfile() || {}; p.fullName = byId("settingsName").value.trim(); p.email = byId("settingsEmail").value.trim(); p.age = byId("settingsAge").value; p.location = locationChoice.name; p.diseases = byId("settingsConditions").value.split(",").map((x) => x.trim()).filter(Boolean); localWrite("airguardUser", JSON.stringify(p)); profileUI(); if (lastReading) updateAdvisory(lastReading); byId("settingsMessage").textContent = "Profile saved in this browser."; });
  byId("clearProfile").addEventListener("click", () => { if (confirm("Clear the saved profile from this browser?")) { localStorage.removeItem("airguardUser"); profileUI(); } });
  byId("downloadCsv").addEventListener("click", () => { if (!historyRows.length) { byId("settingsMessage").textContent = "No live API history is available to export."; return; } const rows = [["Fetched at", "Location", "India CPCB scale AQI", "Category", "Source", "Observation timestamp", "CPCB station", "CPCB station AQI", "CAMS PM2.5 µg/m³", "CAMS PM10 µg/m³", "Provider timestamp"]]; for (const r of historyRows) rows.push([r.fetchedAt, r.location.name, r.indianAqi?.value ?? "", r.indianAqi?.category ?? "", r.indianAqi?.source ?? "Unavailable", r.cpcbStation?.observedAt || r.providerTimestamp || "", r.cpcbStation?.name ?? "", r.cpcbStation?.aqi ?? "", r.pollutants?.pm2_5 ?? "", r.pollutants?.pm10 ?? "", r.providerTimestamp || ""]); const csv = rows.map((row) => row.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n"); const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" })); a.download = "airguard-live-api-history.csv"; a.click(); URL.revokeObjectURL(a.href); });
  await fetchCurrent();
  window.setInterval(updateCountdown, 1000);
});
