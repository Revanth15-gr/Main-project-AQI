const CITIES = {
  Visakhapatnam: { name: "Visakhapatnam, India", latitude: 17.6868, longitude: 83.2185 },
  Hyderabad: { name: "Hyderabad, India", latitude: 17.385, longitude: 78.4867 },
  Delhi: { name: "Delhi, India", latitude: 28.6139, longitude: 77.209 },
  Bengaluru: { name: "Bengaluru, India", latitude: 12.9716, longitude: 77.5946 },
  Rajam: { name: "Rajam, India", latitude: 18.449, longitude: 83.659 },
};
const byId = (id) => document.getElementById(id);
const localRead = (key) => { try { return localStorage.getItem(key); } catch { return null; } };
const localWrite = (key, value) => { try { localStorage.setItem(key, value); } catch { /* Optional browser cache. */ } };
let locationChoice;
let inFlight;
let nextRefreshAt = 0;
let lastReading;
let chart;
let map;
let marker;
let historyRows = [];

function userProfile() { try { return JSON.parse(localRead("airguardUser") || "null"); } catch { return null; } }
function safeText(value) { return String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]); }
function category(value, standard = "US EPA") {
  if (standard === "EEA") return value <= 20 ? ["Good", "good"] : value <= 40 ? ["Fair", "moderate"] : value <= 60 ? ["Moderate", "moderate"] : value <= 80 ? ["Poor", "poor"] : value <= 100 ? ["Very poor", "very-poor"] : ["Extremely poor", "severe"];
  return value <= 50 ? ["Good", "good"] : value <= 100 ? ["Moderate", "moderate"] : value <= 150 ? ["Unhealthy for sensitive groups", "moderate"] : value <= 200 ? ["Unhealthy", "poor"] : value <= 300 ? ["Very unhealthy", "very-poor"] : ["Hazardous", "severe"];
}
function setStatus(text, isError = false) { const el = byId("liveDataStatus"); if (el) { el.textContent = text; el.classList.toggle("error", isError); } }
function display(value) { return typeof value === "number" && Number.isFinite(value) ? `${Number(value.toFixed(1))} µg/m³` : "Unavailable"; }
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
  const us = reading.providerIndices?.usAqi;
  const color = typeof us !== "number" ? "#3388ff" : us <= 50 ? "#21ae7d" : us <= 100 ? "#e1b83d" : us <= 150 ? "#ee8b42" : "#e47b60";
  marker = L.circleMarker([latitude, longitude], { radius: 12, color: "#fff", weight: 3, fillColor: color, fillOpacity: 1 }).addTo(map)
    .bindPopup(`<b>${safeText(name)}</b><br>Open-Meteo model estimate<br>US AQI: ${us ?? "unavailable"}<br>European AQI: ${reading.providerIndices?.europeanAqi ?? "unavailable"}<br>Provider timestamp: ${safeText(reading.providerTimestamp || "unavailable")}`);
}
function updateAdvisory(reading) {
  const basis = byId("liveHealthBasis"); const advice = byId("liveHealthAdvice");
  if (!basis || !advice) return;
  const usAqi = reading.providerIndices?.usAqi; const p = userProfile() || {};
  if (typeof usAqi !== "number") { basis.textContent = "No provider AQI is available; no category-based guidance was generated."; advice.textContent = "Check local public-health information."; return; }
  const sensitive = (Number(p.age) < 18 || Number(p.age) >= 65) || (p.diseases || []).some((x) => /asthma|copd|heart|allerg/i.test(x));
  basis.textContent = `Based on Open-Meteo US AQI ${usAqi} (${category(usAqi)[0]}) and your saved profile. This is general rule-based guidance, not LLM advice or a diagnosis.`;
  advice.textContent = usAqi <= 50 ? "Air quality is in the US AQI Good range. Follow ordinary precautions and your usual care plan." : usAqi <= 100 ? (sensitive ? "People who are unusually sensitive may consider reducing prolonged, strenuous outdoor activity if symptoms occur." : "Most people can continue usual activities; unusually sensitive people may consider reducing prolonged, strenuous outdoor activity if symptoms occur.") : usAqi <= 150 ? "People with asthma, heart or lung conditions, children, and older adults may consider reducing prolonged or strenuous outdoor activity." : usAqi <= 200 ? "Consider reducing prolonged or strenuous outdoor activity; sensitive groups should take extra care and follow local public-health guidance." : "Avoid strenuous outdoor activity where practical and follow local public-health guidance.";
}
function renderReading(reading) {
  lastReading = reading;
  const pollutants = reading.pollutants || {};
  const pollutantIds = { livePm25: "pm2_5", livePm10: "pm10", liveNo2: "nitrogen_dioxide", liveSo2: "sulphur_dioxide", liveCo: "carbon_monoxide", liveO3: "ozone" };
  Object.entries(pollutantIds).forEach(([id, key]) => { if (byId(id)) byId(id).textContent = display(pollutants[key]); });
  const eu = reading.providerIndices?.europeanAqi; const us = reading.providerIndices?.usAqi;
  byId("liveEuropeanAqi").textContent = eu == null ? "Unavailable" : `${eu} · ${category(eu, "EEA")[0]}`;
  byId("liveUsAqi").textContent = us == null ? "Unavailable" : `${us} · ${category(us)[0]}`;
  byId("liveCpcbAqi").textContent = "Not calculated";
  const chosen = typeof us === "number" ? { value: us, name: "US AQI", standard: "US EPA" } : typeof eu === "number" ? { value: eu, name: "European AQI", standard: "EEA" } : null;
  const selectedCategory = chosen ? category(chosen.value, chosen.standard) : ["Unavailable", "neutral"];
  byId("aqiValue").textContent = chosen ? String(chosen.value) : "—";
  byId("gaugeValue").textContent = chosen ? String(chosen.value) : "—";
  byId("detailCategory").textContent = chosen ? `${selectedCategory[0]} · ${chosen.standard}` : "Unavailable";
  byId("detailPollutant").textContent = "See live pollutant concentrations";
  byId("detailStations").textContent = "Not a station reading";
  byId("archiveDate").textContent = reading.providerTimestamp || "Unavailable";
  byId("updatedAt").textContent = reading.providerTimestamp || "Unavailable";
  byId("prominentPollutant").textContent = "Modelled values";
  byId("stationsCount").textContent = reading.source;
  byId("aqiSummary").textContent = chosen ? `${chosen.name} ${chosen.value} (${selectedCategory[0]}). This index uses the ${chosen.standard} standard; India CPCB AQI is not calculated from these values.` : "No provider AQI index is available for this reading.";
  byId("aqiStatusChip").textContent = chosen ? selectedCategory[0] : "Unavailable";
  byId("aqiStatusChip").className = `status-chip ${selectedCategory[1]}`;
  const scaleMax = chosen?.standard === "EEA" ? 100 : 500;
  const scaleLabels = chosen?.standard === "EEA" ? ["Good", "Fair", "Moderate", "Poor", "Very poor", "Extremely poor"] : ["Good", "Moderate", "Unhealthy · sensitive groups", "Unhealthy", "Very unhealthy", "Hazardous"];
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
  const oldProvider = !providerDate || Date.now() - providerDate.getTime() > 24 * 60 * 60 * 1000;
  const oldFetch = Date.now() - fetched.getTime() > 10 * 60 * 1000;
  const stale = Boolean(reading.stale || oldProvider || oldFetch);
  const status = stale ? `STALE DATA — last successful fetch ${fetched.toLocaleString()}. Provider timestamp: ${providerDate ? providerDate.toLocaleString() : "unavailable"}.` : `LIVE API DATA – OPEN-METEO · Retrieved ${fetched.toLocaleString()}.`;
  setStatus(status + (reading.error ? ` ${reading.error}` : ""), stale);
  const meta = byId("liveDataMeta");
  meta.innerHTML = `Location: ${safeText(reading.location?.name || locationChoice.name)} · Source: <a href="https://open-meteo.com/en/docs/air-quality-api" target="_blank" rel="noreferrer">Open-Meteo Air Quality API</a> · Model data: <a href="https://ads.atmosphere.copernicus.eu/" target="_blank" rel="noreferrer">CAMS</a> · Provider model timestamp: ${safeText(providerDate ? providerDate.toLocaleString() : "unavailable")} · Last API fetch: ${safeText(fetched.toLocaleString())} · AQI standard: ${chosen?.standard || "provider index unavailable"}.`;
  if (byId("welcomeDataSource")) byId("welcomeDataSource").textContent = `LIVE API DATA – OPEN-METEO · ${reading.source}`;
  nextRefreshAt = Date.now() + 5 * 60 * 1000;
  localWrite(`airguardLastLive:${locationChoice.latitude.toFixed(4)},${locationChoice.longitude.toFixed(4)}`, JSON.stringify(reading));
  profileUI(); updateAdvisory(reading); updateMap(reading);
}
async function fetchCurrent(force = false) {
  if (inFlight) return inFlight;
  const query = new URLSearchParams({ latitude: locationChoice.latitude, longitude: locationChoice.longitude, location: locationChoice.name });
  if (force) query.set("refresh", "1");
  setStatus("Loading live Open-Meteo data…");
  inFlight = (async () => {
    try {
      const response = await fetch(`/api/air-quality/current?${query}`, { cache: "no-store", credentials: "same-origin" });
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
    const response = await fetch(`/api/air-quality/history?${query}`, { cache: "no-store", credentials: "same-origin" });
    const data = await response.json(); if (!response.ok) throw new Error("History unavailable");
    historyRows = data; renderHistory();
  } catch { byId("historyRows").innerHTML = '<tr><td colspan="5">Live API history is temporarily unavailable.</td></tr>'; }
}
function renderHistory() {
  const tbody = byId("historyRows");
  if (!historyRows.length) tbody.innerHTML = '<tr><td colspan="5">No successful live API readings have been saved for this location yet.</td></tr>';
  else tbody.innerHTML = historyRows.map((r) => `<tr><td>${safeText(new Date(r.fetchedAt).toLocaleString())}</td><td>${safeText(r.location.name)}</td><td>${r.providerIndices?.europeanAqi ?? "—"}</td><td>${r.providerIndices?.usAqi ?? "—"}</td><td>${safeText(r.providerTimestamp || "—")}</td></tr>`).join("");
  const compact = byId("liveHistoryRows");
  if (compact) compact.innerHTML = !historyRows.length ? '<tr><td colspan="4">No live API history is saved for this location.</td></tr>' : historyRows.slice(0, 6).map((r) => `<tr><td>${safeText(new Date(r.fetchedAt).toLocaleString())}</td><td>${r.providerIndices?.europeanAqi ?? "—"}</td><td>${r.providerIndices?.usAqi ?? "—"}</td><td>${safeText(r.providerTimestamp || "—")}</td></tr>`).join("");
  byId("dataRecords").textContent = String(historyRows.length);
  byId("latestYearMax").textContent = historyRows[0]?.providerIndices?.usAqi == null ? "—" : `${historyRows[0].providerIndices.usAqi} US AQI`;
  byId("weeklyAverage").textContent = historyRows[0]?.fetchedAt ? new Date(historyRows[0].fetchedAt).toLocaleString() : "—";
  if (chart) {
    const rows = [...historyRows].reverse(); chart.data.labels = rows.map((r) => r.providerTimestamp || r.fetchedAt);
    chart.data.datasets[0].data = rows.map((r) => r.providerIndices?.usAqi ?? null); chart.update();
  }
}
async function searchLocations() {
  const q = byId("locationSearch").value.trim(); const results = byId("locationResults"); results.replaceChildren();
  if (q.length < 2) { setStatus("Enter at least two characters to search Indian locations.", true); return; }
  try {
    const response = await fetch(`/api/air-quality/geocode?q=${encodeURIComponent(q)}`, { credentials: "same-origin" }); const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Location search failed.");
    for (const item of data) { const b = document.createElement("button"); b.type = "button"; b.textContent = item.name; b.addEventListener("click", () => { locationChoice = item; syncLocationSelect(); results.hidden = true; localWrite("airguardSelectedLocation", JSON.stringify(item)); profileUI(); void fetchCurrent(); }); results.appendChild(b); }
    results.hidden = !data.length; if (!data.length) setStatus("No Indian location matched that search.", true);
  } catch (error) { setStatus(error.message || "Location search failed.", true); }
}
function updateCountdown() {
  if (Date.now() >= nextRefreshAt && !inFlight) { void fetchCurrent(); return; }

  const seconds = Math.max(0, Math.ceil((nextRefreshAt - Date.now()) / 1000));
  const status = byId("liveDataStatus");
  if (status && seconds > 0 && !status.classList.contains("error") && !inFlight) status.textContent = `LIVE API DATA – OPEN-METEO · Next refresh in ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}. Provider model updates may occur less often.`;
}
function initMap() {
  const el = byId("airMap"); if (!el || !window.L) return;
  map = L.map(el).setView([locationChoice.latitude, locationChoice.longitude], 8);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 18, attribution: "&copy; OpenStreetMap contributors" }).addTo(map);
  if (lastReading) updateMap(lastReading); setTimeout(() => map.invalidateSize(), 100);
}
function initChart() {
  if (!window.Chart || !byId("forecastChart")) return;
  chart = new Chart(byId("forecastChart"), { type: "line", data: { labels: [], datasets: [{ label: "Open-Meteo US AQI", data: [], borderColor: "#0b9d70", backgroundColor: "rgba(11,157,112,.12)", fill: true, tension: .3, spanGaps: true }] }, options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: true } }, scales: { y: { beginAtZero: true } } } });
}
function addBubble(text, who) { const bubble = document.createElement("div"); bubble.className = `chat-bubble ${who}`; bubble.textContent = text; byId("chatMessages").appendChild(bubble); byId("chatMessages").scrollTop = byId("chatMessages").scrollHeight; }
function answer(question) {
  if (!lastReading) return "No successful live reading is loaded yet. Check the connection status and try refreshing.";
  const r = lastReading; const p = r.pollutants; const standard = r.providerIndices?.usAqi != null ? `US AQI ${r.providerIndices.usAqi} (${category(r.providerIndices.usAqi, "US EPA")[0]})` : `European AQI ${r.providerIndices?.europeanAqi == null ? "unavailable" : `${r.providerIndices.europeanAqi} (${category(r.providerIndices.europeanAqi, "EEA")[0]})`}`;
  if (/pm|pollut/i.test(question)) return `${r.location.name}: PM2.5 ${p.pm2_5 ?? "unavailable"}, PM10 ${p.pm10 ?? "unavailable"}, NO2 ${p.nitrogen_dioxide ?? "unavailable"}, SO2 ${p.sulphur_dioxide ?? "unavailable"}, CO ${p.carbon_monoxide ?? "unavailable"}, O3 ${p.ozone ?? "unavailable"} µg/m³. Provider timestamp ${r.providerTimestamp || "unavailable"}. Model estimates, not station measurements.`;
  if (/health|advice|exposure/i.test(question)) return `The health panel uses ${standard} for rule-based general guidance. It is not an LLM response or medical diagnosis. India CPCB AQI is not calculated from these inputs.`;
  return `${r.location.name}: ${standard}. European AQI ${r.providerIndices?.europeanAqi ?? "unavailable"}. Provider timestamp ${r.providerTimestamp || "unavailable"}; last fetched ${new Date(r.fetchedAt).toLocaleString()}. These use their stated provider standards, not India CPCB AQI.`;
}
async function signOut() { await fetch("/api/auth/logout", { method: "DELETE", credentials: "same-origin" }).catch(() => undefined); window.location.assign("/"); }

document.addEventListener("DOMContentLoaded", async () => {
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
  byId("downloadCsv").addEventListener("click", () => { if (!historyRows.length) { byId("settingsMessage").textContent = "No live API history is available to export."; return; } const rows = [["Fetched at", "Location", "European AQI", "US AQI", "Provider timestamp"], ...historyRows.map((r) => [r.fetchedAt, r.location.name, r.providerIndices?.europeanAqi ?? "", r.providerIndices?.usAqi ?? "", r.providerTimestamp || ""])]; const csv = rows.map((row) => row.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n"); const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" })); a.download = "airguard-live-api-history.csv"; a.click(); URL.revokeObjectURL(a.href); });
  await fetchCurrent();
  window.setInterval(updateCountdown, 1000);
});
