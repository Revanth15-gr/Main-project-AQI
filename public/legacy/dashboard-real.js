/* AirGuard dashboard backed by historical CPCB daily AQI bulletins. */
const ARCHIVE_CITIES = {
  Visakhapatnam: { file: "Visakhapatnam_AQIBulletins.csv", coords: [17.6868, 83.2185] },
  Hyderabad: { file: "Hyderabad_AQIBulletins.csv", coords: [17.385, 78.4867] },
  Delhi: { file: "Delhi_AQIBulletins.csv", coords: [28.6139, 77.209] },
  Bengaluru: { file: "Bengaluru_AQIBulletins.csv", coords: [12.9716, 77.5946] },
};
const CUSTOM_ARCHIVE_LOCATION = "__selected_location__";

const byId = (id) => document.getElementById(id);
const archive = {};
let forecastChart;
let historyChart;
let map;
let mapMarkers = [];
let liveStationMarker;
let locationSearchSequence = 0;
let liveLocationSequence = 0;
let selectedLiveLocation = null;
let latestLiveReading = null;
let liveHistoryChart;
let liveHistorySequence = 0;
let selectedMapMarker;

const LIVE_POLLUTANTS = [
  ["pm25", "PM2.5"], ["pm10", "PM10"], ["no2", "NO₂"],
  ["so2", "SO₂"], ["co", "CO"], ["o3", "Ozone"], ["nh3", "NH₃"],
];

function initLiveAirQuality() {
  const section = document.createElement("section");
  section.id = "liveAirQuality";
  section.className = "section-block panel live-panel";
  section.innerHTML = `
    <div class="section-heading compact live-heading">
      <div><span class="eyebrow">CURRENT AIR QUALITY</span><h2>Search an Indian location</h2>
        <p class="muted">Search for a place to view its current station observation or clearly labelled model estimate.</p></div>
      <span class="status-chip neutral" id="liveDataType">Loading</span>
    </div>
    <form id="liveLocationForm" class="live-search-form">
      <label class="sr-only" for="liveLocationQuery">Search an Indian location</label>
      <input id="liveLocationQuery" type="search" placeholder="Search city, district or town in India" autocomplete="off" required minlength="2">
      <button class="btn btn-primary" type="submit">Search</button>
      <button class="btn btn-outline" id="liveUseLocation" type="button">Use my location</button>
    </form>
    <div id="liveLocationResults" class="live-location-results" role="listbox" aria-label="Location suggestions"></div>
    <p id="liveMessage" class="tiny-note" role="status">Search for an Indian location to load current air-quality data.</p>
    <div class="live-reading-grid">
      <article class="live-aqi-card"><small>INDIA CPCB AQI SCALE</small><strong id="liveAqiValue">—</strong><b id="liveAqiCategory">Data unavailable</b>
        <span id="liveAqiSource">No AQI source selected.</span></article>
      <article class="live-source-card"><b id="liveLocationName">—</b><span id="liveLocationAdmin">—</span>
        <div id="liveStationInfo">Nearest CPCB station: unavailable</div><small id="liveTimestamps">Observation time: —</small>
        <small id="liveFetchedAt">Fetched at: —</small></article>
    </div>
    <div id="livePollutants" class="live-pollutant-grid"></div>
    <form id="whatsappAlertForm" class="live-search-form" style="margin-top:1rem">
      <label>AQI alert threshold <input id="whatsappAlertThreshold" type="number" min="0" max="500" value="100" required></label>
      <button class="btn btn-primary" type="submit">Enable AQI alert for this location</button>
    </form>
    <section class="panel" style="margin-top:1rem;padding:1rem" aria-labelledby="notificationSettingsTitle">
      <h3 id="notificationSettingsTitle">Verified mobile and notification settings</h3>
      <p id="registeredMobile" class="tiny-note">Loading your account mobile number…</p>
      <form id="notificationPreferencesForm" class="live-search-form">
        <label class="check-label"><input id="smsNotificationsEnabled" type="checkbox"> SMS alerts</label>
        <label class="check-label"><input id="whatsappNotificationsEnabled" type="checkbox"> WhatsApp alerts</label>
        <label class="check-label"><input id="notificationConsent" type="checkbox"> I consent to AQI notifications on the selected channels.</label>
        <button class="btn btn-outline" type="submit">Save notification preferences</button>
      </form>
      <form id="phoneUpdateForm" class="live-search-form">
        <label>Change mobile number (include country code) <input id="newMobileNumber" type="tel" inputmode="tel" autocomplete="tel" placeholder="+919876543210" pattern="\\+[1-9][0-9]{7,14}" required></label>
        <button class="btn btn-outline" type="submit">Send verification code</button>
      </form>
      <form id="phoneUpdateVerifyForm" class="live-search-form" hidden>
        <label>Verification code <input id="phoneUpdateCode" type="text" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{4,8}" required></label>
        <button class="btn btn-primary" type="submit">Verify and update mobile</button>
      </form>
      <p id="notificationSettingsMessage" class="tiny-note" role="status"></p>
      <h3>Recent notifications</h3>
      <div id="notificationHistoryList" class="tiny-note">Sign in to view notification history.</div>
    </section>
    <p class="tiny-note" id="liveAttribution">CPCB source API does not publish pollutant units. Modelled values are estimates, not station measurements.</p>`;
  const content = document.querySelector(".content-wrap");
  if (content) content.prepend(section);
  const liveStatusTitle = document.querySelector("#forecast .insight-panel h2");
  if (liveStatusTitle) liveStatusTitle.textContent = "Live source status";
  const liveStatusText = document.querySelector("#forecast .insight-callout p");
  if (liveStatusText) liveStatusText.textContent = "CPCB station data appears when the government API key is configured. Model estimates are separately labelled and are not sensor readings.";
  const mapDescription = document.querySelector("#map-section .section-heading p");
  if (mapDescription) mapDescription.textContent = "Search an Indian place above to center the map on its location pin; archived city AQI markers remain available for comparison.";
  const mapStatus = document.querySelector("#map-section .section-heading .status-chip");
  if (mapStatus) mapStatus.textContent = "Selected location pin";
  const mapLegend = document.querySelector("#map-section .map-legend");
  if (mapLegend?.children[0]) mapLegend.children[0].textContent = "CPCB station snapshot / archived city AQI";
  if (mapLegend?.children[1]) mapLegend.children[1].textContent = "Station markers are neutral when no official AQI is supplied";

  const archiveHeading = document.querySelector("#overview .eyebrow");
  if (archiveHeading) archiveHeading.textContent = "LIVE INDIA AIR QUALITY";
  const latestMetric = document.querySelector(".aqi-feature .metric-label");
  if (latestMetric) latestMetric.textContent = "CURRENT INDIA AQI";
  const metricDescription = document.querySelector(".aqi-feature .aqi-main .muted");
  if (metricDescription) metricDescription.textContent = "Live source reading or clearly labelled model estimate";
  const bulletinTitle = document.querySelector("#pollutants h2");
  if (bulletinTitle) bulletinTitle.textContent = "What the current reading reports";
  const bulletinDescription = document.querySelector("#pollutants .section-heading .muted");
  if (bulletinDescription) bulletinDescription.textContent = "This section follows the selected India location and current provider response. CPCB station readings and model estimates are identified separately.";
  const bulletinCards = document.querySelectorAll("#pollutants .pollutant-card");
  if (bulletinCards[0]) bulletinCards[0].querySelector("p").textContent = "Current India AQI category";
  const pollutantMetricLabel = byId("prominentPollutant")?.closest(".metric-card")?.querySelector(".metric-label");
  if (pollutantMetricLabel) pollutantMetricLabel.textContent = "CURRENT POLLUTANT VALUE";
  if (bulletinCards[1]) bulletinCards[1].querySelector("p").textContent = "Largest reported pollutant concentration";
  if (bulletinCards[1]) bulletinCards[1].querySelector("small").textContent = "Provider pollutant values, when available";
  if (bulletinCards[2]) bulletinCards[2].querySelector("p").textContent = "Nearest reporting station";
  if (bulletinCards[2]) bulletinCards[2].querySelector("small").textContent = "Unavailable when no station is nearby";
  if (bulletinCards[3]) { bulletinCards[3].querySelector("p").textContent = "Latest observation / model time"; bulletinCards[3].querySelector("small").textContent = "Fetched time is shown above"; }
  const observationLabel = byId("updatedAt")?.parentElement;
  if (observationLabel) observationLabel.firstChild.textContent = "Observation time ";
  const pollutantFooter = byId("prominentPollutant")?.closest(".metric-card")?.querySelector(".metric-footer");
  if (pollutantFooter?.children[0]) pollutantFooter.children[0].textContent = "Provider concentration";
  if (pollutantFooter?.children[1]) pollutantFooter.children[1].textContent = "Current";
  const prominentDescription = byId("prominentPollutant")?.closest(".metric-card")?.querySelector(".muted");
  if (prominentDescription) prominentDescription.textContent = "Largest concentration returned for the current location; model values are labelled.";
  const stationsDescription = byId("stationsCount")?.closest(".metric-card")?.querySelector(".muted");
  if (stationsDescription) stationsDescription.textContent = "Nearest CPCB station, when available for this location.";
  const overviewPill = document.querySelector(".top-actions .data-pill");
  if (overviewPill) overviewPill.lastChild.textContent = " Live + archive";
  const changePhone = byId("newMobileNumber");
  const changePhoneLabel = changePhone?.closest("label");
  if (changePhoneLabel) changePhoneLabel.firstChild.textContent = "Change mobile number (+91 added for 10-digit Indian numbers) ";
  if (changePhone) changePhone.pattern = "(?:\\+[1-9][0-9]{7,14}|[6-9][0-9]{9}|91[6-9][0-9]{9})";
  changePhone?.addEventListener("blur", () => {
    const digits = changePhone.value.trim().replace(/[\s()-]/g, "");
    if (/^[6-9]\d{9}$/.test(digits)) changePhone.value = `+91${digits}`;
    else if (/^91[6-9]\d{9}$/.test(digits)) changePhone.value = `+${digits}`;
  });

}

function formatLocalDate(value) {
  if (!value) return "Unavailable";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Unavailable" : new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" }).format(date) + " IST";
}

function renderLiveReading(reading) {
  const { location, station, estimate, aqi, category, dataType, aqiSource, pollutants, observedAt, fetchedAt, sources } = reading;
  latestLiveReading = reading;
  const typeLabels = { LIVE_STATION: "Live station reading", RECENT_STATION: "Recent station reading", HISTORICAL: "Historical station reading", MODEL_ESTIMATE: "Model-based estimate", UNAVAILABLE: "Data unavailable" };
  const sourceLabel = aqiSource === "CPCB" ? "CPCB official AQI" : aqiSource === "CAMS_MODEL" ? "India CPCB AQI calculated from CAMS model estimates" : "No validated Indian AQI value available";
  byId("liveDataType").textContent = typeLabels[dataType] || "Data unavailable";
  byId("liveAqiValue").textContent = Number.isFinite(aqi) ? String(aqi) : "—";
  byId("liveAqiCategory").textContent = category || "Unavailable";
  byId("liveAqiSource").textContent = sourceLabel;
  byId("liveLocationName").textContent = location.name;
  byId("liveLocationAdmin").textContent = [location.district, location.state, location.country,
    `${Number(location.latitude).toFixed(4)}, ${Number(location.longitude).toFixed(4)}`].filter(Boolean).join(" · ");
  byId("liveStationInfo").textContent = station
    ? `${station.dataType === "HISTORICAL" ? "Nearest historical station" : "Nearest CPCB station"}: ${station.name}, ${station.city} (${station.distanceKm} km away)`
    : "Nearest CPCB station: unavailable. Model estimate, when present, is not a station reading.";
  byId("liveTimestamps").textContent = station
    ? `Station observation: ${formatLocalDate(station.observedAt)}${estimate ? ` · Model time: ${formatLocalDate(estimate.observedAt)}` : ""}`
    : `Model time: ${formatLocalDate(observedAt)}${estimate?.gridLocation ? ` · CAMS grid: ${estimate.gridLocation.latitude.toFixed(3)}, ${estimate.gridLocation.longitude.toFixed(3)}` : ""}`;
  byId("liveFetchedAt").textContent = `Fetched: ${formatLocalDate(fetchedAt)}`;
  const data = station?.dataType !== "HISTORICAL" && station ? station.pollutants : (estimate?.pollutants || pollutants || {});
  const grid = byId("livePollutants");
  grid.replaceChildren();
  LIVE_POLLUTANTS.forEach(([key, label]) => {
    const card = document.createElement("article");
    card.className = "live-pollutant-card";
    const value = typeof data[key] === "number" ? data[key] : null;
    const valueNode = document.createElement("b");
    const isModelValue = !(station?.dataType !== "HISTORICAL" && station);
    valueNode.textContent = value === null ? "—" : isModelValue ? `${value} µg/m³` : String(value);
    const labelNode = document.createElement("span");
    labelNode.textContent = label;
    const kindNode = document.createElement("small");
    kindNode.textContent = station?.dataType !== "HISTORICAL" && station ? "CPCB station · unit not supplied" : estimate ? "CAMS model estimate · µg/m³" : "Unavailable";
    card.append(labelNode, valueNode, kindNode);
    grid.append(card);
  });
  const source = sources?.find((item) => item.name === "CPCB / data.gov.in");
  byId("liveMessage").textContent = source?.status === "not-configured"
    ? "Model fallback is active. Add a personal data.gov.in API key in .env.local to enable CPCB monitoring stations."
    : source?.status === "error"
      ? `CPCB source issue: ${source.detail || "unavailable"}. Displayed model readings remain separately labelled.`
      : source?.detail || (estimate ? "CPCB station data and model estimates are separately identified." : "No source returned a usable reading.");
  byId("liveAttribution").textContent = estimate
    ? `Estimate attribution: ${estimate.attribution}. It is a model output, not a physical monitoring-station measurement. CPCB API pollutant units are not included in its response.`
    : "CPCB source attribution: Government of India OGD / Central Pollution Control Board. The data API response does not include pollutant units.";

  const leadingPollutant = Object.entries(pollutants || {}).filter(([, value]) => typeof value === "number").sort((a, b) => b[1] - a[1])[0];
  byId("aqiValue").textContent = Number.isFinite(aqi) ? String(aqi) : "—";
  byId("gaugeValue").textContent = Number.isFinite(aqi) ? String(aqi) : "—";
  byId("aqiSummary").textContent = `${location.name} · ${category || "AQI unavailable"} · ${aqiSource === "CPCB" ? "CPCB station observation" : aqiSource === "CAMS_MODEL" ? "Open-Meteo/CAMS model estimate" : "Source unavailable"}. This is the current reading, not the bundled archive.`;
  byId("updatedAt").textContent = formatLocalDate(observedAt);
  byId("prominentPollutant").textContent = leadingPollutant ? LIVE_POLLUTANTS.find(([key]) => key === leadingPollutant[0])?.[1] || leadingPollutant[0].toUpperCase() : "—";
  byId("detailCategory").textContent = category || "Unavailable";
  byId("detailPollutant").textContent = leadingPollutant ? `${leadingPollutant[1]} µg/m³ · ${LIVE_POLLUTANTS.find(([key]) => key === leadingPollutant[0])?.[1] || leadingPollutant[0].toUpperCase()}` : "Unavailable";
  byId("stationsCount").textContent = station ? "1 nearby" : "No nearby CPCB station";
  byId("detailStations").textContent = station ? `${station.name} · ${station.distanceKm} km` : "Not reported";
  byId("archiveDate").textContent = formatLocalDate(observedAt);
  byId("forecastHeadline").textContent = dataType === "MODEL_ESTIMATE" ? "CAMS model" : dataType.replaceAll("_", " ");
  byId("forecastStatus").textContent = `${aqiSource || "Source unavailable"} · ${formatLocalDate(observedAt)}`;
  byId("aqiMarker").style.left = Number.isFinite(aqi) ? `${Math.min(98, Math.max(1, aqi / 5))}%` : "0%";
  const liveColor = ({ Good: "#17a977", Satisfactory: "#8bcf71", Moderate: "#e3bd3b", Poor: "#e98a47", "Very Poor": "#e77c5d", Severe: "#8a4c75" })[category] || "#82979e";
  byId("aqiGauge").style.background = Number.isFinite(aqi) ? `conic-gradient(${liveColor} 0 ${Math.min(100, aqi / 5)}%, #e5f5ec ${Math.min(100, aqi / 5)}% 100%)` : "#edf4f2";
  setChip(byId("aqiStatusChip"), category || "Unavailable", category);
  const notice = document.querySelector(".notice-banner");
  if (notice) {
    notice.querySelector("b").textContent = "Live reading and historical archive are shown separately";
    const noticeCopy = notice.querySelector("p");
    if (noticeCopy) noticeCopy.textContent = "The live location reading appears above; the CPCB daily-bulletin archive below covers selected cities through 2023.";
  }

  if (map && station && window.L) {
    if (liveStationMarker) map.removeLayer(liveStationMarker);
    const popup = document.createElement("div");
    const title = document.createElement("b");
    title.textContent = station.name;
    const details = document.createElement("div");
    details.textContent = `${station.city}, ${station.state}`;
    const timestamp = document.createElement("div");
    timestamp.textContent = `Observation: ${formatLocalDate(station.observedAt)}`;
    const distance = document.createElement("div");
    distance.textContent = `${station.distanceKm} km from selected location`;
    popup.append(title, details, timestamp, distance);
    liveStationMarker = L.circleMarker([station.latitude, station.longitude], { radius: 10, color: "#fff", weight: 2, fillColor: "#168d74", fillOpacity: .95 })
      .addTo(map)
      .bindPopup(popup);
  }
}

function updateSelectedLocationMarker(location) {
  if (!map || !window.L || !Number.isFinite(Number(location.latitude)) || !Number.isFinite(Number(location.longitude))) return;
  if (selectedMapMarker) map.removeLayer(selectedMapMarker);
  const pin = L.divIcon({
    className: "airguard-location-pin",
    html: '<span aria-hidden="true">📍</span>',
    iconSize: [32, 38],
    iconAnchor: [16, 34],
  });
  const popup = document.createElement("div");
  const label = document.createElement("b");
  label.textContent = [location.name, location.district, location.state].filter(Boolean).join(", ");
  const coordinates = document.createElement("div");
  coordinates.textContent = `${Number(location.latitude).toFixed(4)}, ${Number(location.longitude).toFixed(4)}`;
  popup.append(label, coordinates);
  selectedMapMarker = L.marker([location.latitude, location.longitude], { icon: pin, zIndexOffset: 1000 }).addTo(map).bindPopup(popup).openPopup();
  map.setView([location.latitude, location.longitude], 11, { animate: true });
}

function initLiveHistoryPanel() {
  if (byId("liveHistoryPanel")) return;
  const section = document.createElement("section");
  section.id = "liveHistoryPanel";
  section.className = "section-block panel chart-panel live-history-panel";
  section.innerHTML = `<div class="section-heading compact"><div><span class="eyebrow">RECENT LIVE MODEL SERIES</span><h2>Recent AQI trend</h2><p class="muted" id="liveHistoryDescription">Choose an Indian location to load recent hourly CAMS estimates.</p></div><label class="live-history-range">Range <select id="liveHistoryRange" class="small-select" aria-label="Recent AQI history range"><option value="7">7 days</option><option value="30">30 days</option><option value="90">90 days</option></select></label></div><div class="chart-wrap"><canvas id="liveHistoryCanvas" aria-label="Recent modeled AQI trend"></canvas></div><p class="tiny-note">Model-derived India AQI estimate from Open-Meteo/CAMS; not a CPCB station measurement. The separate historical CPCB bulletin archive remains available below.</p>`;
  document.querySelector("#forecast")?.before(section);
  section.querySelector("#liveHistoryRange").addEventListener("change", () => {
    if (selectedLiveLocation) void loadLiveHistory(selectedLiveLocation, Number(byId("liveHistoryRange").value));
  });
  liveHistoryChart = new Chart(byId("liveHistoryCanvas"), {
    type: "line",
    data: { labels: [], datasets: [{ label: "Estimated India AQI", data: [], borderColor: "#0b9d70", backgroundColor: "#0b9d7020", fill: true, tension: 0.25, spanGaps: true, pointRadius: 1 }] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: true } }, scales: { y: { beginAtZero: true, suggestedMax: 200 }, x: { ticks: { maxTicksLimit: 10 } } } },
  });
}

async function loadLiveHistory(location, days) {
  if (!location || !liveHistoryChart) return;
  const sequence = ++liveHistorySequence;
  const description = byId("liveHistoryDescription");
  description.textContent = `Loading up to ${days} days of recent CAMS estimates for ${location.name}…`;
  const params = new URLSearchParams({ latitude: String(location.latitude), longitude: String(location.longitude), name: location.name, state: location.state || "", district: location.district || "", days: String(days) });
  try {
    const response = await fetch(`/api/air-quality/history?${params}`, { cache: "no-store", headers: { accept: "application/json" } });
    const payload = await response.json();
    if (sequence !== liveHistorySequence) return;
    if (!response.ok) throw new Error(payload.error || "Recent live trend is unavailable.");
    liveHistoryChart.data.labels = payload.points.map((point) => point.date);
    liveHistoryChart.data.datasets[0].data = payload.points.map((point) => point.aqi);
    liveHistoryChart.update();
    description.textContent = `${location.name} · ${payload.points.length} recent daily values · model output updated ${formatLocalDate(payload.fetchedAt)}.`;
  } catch (error) {
    if (sequence !== liveHistorySequence) return;
    description.textContent = error instanceof Error ? error.message : "Recent live trend is temporarily unavailable.";
  }
}

async function searchLiveLocations(query) {
  const results = byId("liveLocationResults");
  if (!results) return;
  const sequence = ++locationSearchSequence;
  results.replaceChildren();
  if (query.trim().length < 2) return;
  byId("liveMessage").textContent = "Searching Indian locations…";
  try {
    const response = await fetch(`/api/locations/search?q=${encodeURIComponent(query.trim())}`, { headers: { accept: "application/json" } });
    const payload = await response.json();
    if (sequence !== locationSearchSequence) return;
    if (!response.ok) throw new Error(payload.error || "Location search is temporarily unavailable.");
    const locations = payload.locations || payload.results || [];
    results.replaceChildren(...locations.map((location) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "live-location-option";
      button.textContent = [location.name, location.district, location.state].filter(Boolean).join(", ");
      button.addEventListener("click", () => loadLiveLocation(location));
      return button;
    }));
    byId("liveMessage").textContent = locations.length ? "Choose a matching location." : "No matching Indian locations were found.";
  } catch (error) {
    if (sequence !== locationSearchSequence) return;
    byId("liveMessage").textContent = error instanceof Error ? error.message : "Location search is temporarily unavailable.";
  }
}

async function loadLiveLocation(location) {
  const sequence = ++liveLocationSequence;
  selectedLiveLocation = location;
  syncHistoricalLocation(location);
  byId("liveLocationResults")?.replaceChildren();
  updateSelectedLocationMarker(location);
  void loadLiveHistory(location, Number(byId("liveHistoryRange")?.value || 7));
  if (byId("liveLocationQuery")) byId("liveLocationQuery").value = [location.name, location.district, location.state].filter(Boolean).join(", ");
  byId("liveMessage").textContent = `Loading air-quality data for ${location.name}…`;
  const params = new URLSearchParams({ latitude: String(location.latitude), longitude: String(location.longitude), name: location.name, state: location.state || "", district: location.district || "" });
  try {
    const response = await fetch(`/api/air-quality?${params}`, { cache: "no-store", headers: { accept: "application/json" } });
    const payload = await response.json();
    if (sequence !== liveLocationSequence) return;
    if (!response.ok) throw new Error(payload.error || "Air-quality lookup failed.");
    renderLiveReading(payload);
  } catch (error) {
    if (sequence !== liveLocationSequence) return;
    byId("liveMessage").textContent = error instanceof Error ? error.message : "Air-quality providers are temporarily unavailable.";
  }
}

function requestCurrentLocation() {
  if (!navigator.geolocation) {
    byId("liveMessage").textContent = "Location access is not available in this browser.";
    return;
  }
  byId("liveMessage").textContent = "Finding your current location…";
  navigator.geolocation.getCurrentPosition(({ coords }) => {
    loadLiveLocation({ name: "Your location", latitude: coords.latitude, longitude: coords.longitude, country: "India" });
  }, () => {
    byId("liveMessage").textContent = "Could not access your location. Search for a city instead.";
  }, { enableHighAccuracy: true, timeout: 15_000, maximumAge: 0 });
}

function parseCsvLine(line) {
  const cells = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"' && line[index + 1] === '"' && quoted) {
      cell += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      cells.push(cell);
      cell = "";
    } else {
      cell += char;
    }
  }
  cells.push(cell);
  return cells;
}

function parseBulletinCsv(text) {
  const lines = text.trim().split(/\r?\n/);
  const headers = parseCsvLine(lines.shift() || "");
  return lines.map((line) => {
    const values = parseCsvLine(line);
    const row = Object.fromEntries(headers.map((header, index) => [header.trim(), values[index]?.trim() ?? ""]));
    return {
      date: row.date,
      city: row.City,
      stations: Number(row["No. Stations"]),
      category: row["Air Quality"],
      aqi: Number(row["Index Value"]),
      pollutant: row["Prominent Pollutant"] || "Not reported",
    };
  }).filter((row) => row.date && Number.isFinite(row.aqi))
    .sort((left, right) => left.date.localeCompare(right.date));
}

async function loadArchive() {
  const results = await Promise.all(Object.entries(ARCHIVE_CITIES).map(async ([city, config]) => {
    try {
      const response = await fetch(`/legacy/data/${config.file}`, { cache: "force-cache" });
      if (!response.ok) throw new Error(`Could not load ${city} bulletin data`);
      archive[city] = parseBulletinCsv(await response.text());
    } catch (error) {
      console.error(error);
      archive[city] = [];
    }
  }));
  return results;
}

function profile() {
  try { return JSON.parse(localStorage.getItem("airguardUser") || "null"); }
  catch { return null; }
}

function showToast(text) {
  const toast = byId("toast");
  if (!toast) return;
  toast.textContent = text;
  toast.classList.add("show");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove("show"), 3000);
}

function categoryClass(category) {
  return ({
    Good: "good",
    Satisfactory: "satisfactory",
    Moderate: "moderate",
    Poor: "poor",
    "Very Poor": "very-poor",
    Severe: "severe",
  })[category] || "neutral";
}

function setChip(element, label, category) {
  element.textContent = label;
  element.className = `status-chip ${category ? categoryClass(category) : "neutral"}`;
}

function selectedRows(city) {
  return archive[city] || [];
}

function updateChart(city) {
  const rows = selectedRows(city);
  const range = byId("forecastRange")?.value || "30";
  const filtered = range === "all" ? rows : rows.slice(-Number(range));
  if (forecastChart) {
    forecastChart.data.labels = filtered.map((row) => row.date);
    forecastChart.data.datasets[0].data = filtered.map((row) => row.aqi);
    forecastChart.update();
  }
  const recent = rows.slice(-7);
  if (historyChart) {
    historyChart.data.labels = recent.map((row) => row.date.slice(5));
    historyChart.data.datasets[0].data = recent.map((row) => row.aqi);
    historyChart.update();
  }
  const recentValues = rows.slice(-7).map((row) => row.aqi);
  const recentMean = recentValues.length ? Math.round(recentValues.reduce((sum, value) => sum + value, 0) / recentValues.length) : null;
  const peak = rows.length ? Math.max(...rows.map((row) => row.aqi)) : null;
  byId("weeklyAverage").textContent = recentMean === null ? "—" : `${recentMean} AQI`;
  byId("latestYearMax").textContent = peak === null ? "—" : `${peak} AQI`;
  byId("dataRecords").textContent = String(rows.length);
}

function updateHistoryTable(city) {
  const rows = selectedRows(city).slice(-7).reverse();
  const table = byId("historyRows");
  if (!table) return;
  if (!rows.length) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = 5;
    cell.textContent = `No CPCB historical bulletin records are available for ${city}. The bundled archive covers Visakhapatnam, Hyderabad, Delhi and Bengaluru through 2023.`;
    row.append(cell);
    table.replaceChildren(row);
    return;
  }
  table.innerHTML = rows.map((row) => `<tr><td>${row.date}</td><td>${row.city}</td><td>${row.aqi}</td><td><span class="status-chip ${categoryClass(row.category)}">${row.category}</span></td><td>${row.stations} station${row.stations === 1 ? "" : "s"}</td></tr>`).join("");
}

function paintCity(city, displayName) {
  const archiveCity = Object.hasOwn(ARCHIVE_CITIES, city) ? city : null;
  const label = displayName || city;
  const rows = archiveCity ? selectedRows(archiveCity) : [];
  const latest = rows.at(-1);
  const noData = !latest;
  byId("aqiValue").textContent = latest ? String(latest.aqi) : "—";
  byId("gaugeValue").textContent = latest ? String(latest.aqi) : "—";
  byId("aqiSummary").textContent = latest
    ? `${latest.city} city-average AQI reported in a CPCB daily bulletin. This is historical, not current air quality.`
    : `${label} has no city series in the included CPCB bulletin archive. The available historical cities are Visakhapatnam, Hyderabad, Delhi and Bengaluru.`;
  byId("updatedAt").textContent = latest ? latest.date : "No archive record";
  byId("prominentPollutant").textContent = latest ? latest.pollutant : "—";
  byId("detailCategory").textContent = latest ? latest.category : "—";
  byId("detailPollutant").textContent = latest ? latest.pollutant : "—";
  byId("stationsCount").textContent = latest ? String(latest.stations) : "—";
  byId("detailStations").textContent = latest ? String(latest.stations) : "—";
  byId("archiveDate").textContent = latest ? latest.date : "—";
  byId("aqiMarker").style.left = latest ? `${Math.min(98, Math.max(1, latest.aqi / 5))}%` : "0%";
  const color = latest ? ({ Good: "#17a977", Satisfactory: "#8bcf71", Moderate: "#e3bd3b", Poor: "#e98a47", "Very Poor": "#e77c5d", Severe: "#8a4c75" })[latest.category] || "#82979e" : "#82979e";
  byId("aqiGauge").style.background = latest
    ? `conic-gradient(${color} 0 ${Math.min(100, latest.aqi / 5)}%, #e5f5ec ${Math.min(100, latest.aqi / 5)}% 100%)`
    : "#edf4f2";
  setChip(byId("aqiStatusChip"), latest?.category || "No archive", latest?.category);
  byId("welcomeName").textContent = label;
  const trendTitle = document.querySelector("#forecast .chart-panel h2");
  if (trendTitle) trendTitle.textContent = `Historical AQI trend · ${label}`;
  const historyTitle = document.querySelector("#history h2");
  if (historyTitle) historyTitle.textContent = `History & trends · ${label}`;
  byId("forecastHeadline").textContent = "Not connected";
  byId("forecastStatus").textContent = "Historical archive only";
  updateChart(archiveCity || city);
  updateHistoryTable(archiveCity || label);
  updateMap(archiveCity || city);
  const downloadButton = byId("downloadCsv");
  if (downloadButton) downloadButton.disabled = rows.length === 0;
}

function normalizeLocationName(value) {
  return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function archiveCityForLocation(location) {
  const names = [location?.name, location?.district].map(normalizeLocationName).filter(Boolean);
  const aliases = {
    Visakhapatnam: ["visakhapatnam", "vizag"],
    Hyderabad: ["hyderabad"],
    Delhi: ["delhi", "new delhi"],
    Bengaluru: ["bengaluru", "bangalore"],
  };
  for (const [city, cityAliases] of Object.entries(aliases)) {
    if (names.some((name) => cityAliases.some((alias) => name === alias || name.startsWith(`${alias} `)))) return city;
  }
  const latitude = Number(location?.latitude);
  const longitude = Number(location?.longitude);
  if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
    const distanceKm = (aLat, aLon, bLat, bLon) => {
      const radians = (degrees) => degrees * Math.PI / 180;
      const dLat = radians(bLat - aLat);
      const dLon = radians(bLon - aLon);
      const term = Math.sin(dLat / 2) ** 2 + Math.cos(radians(aLat)) * Math.cos(radians(bLat)) * Math.sin(dLon / 2) ** 2;
      return 6371 * 2 * Math.atan2(Math.sqrt(term), Math.sqrt(1 - term));
    };
    const nearest = Object.entries(ARCHIVE_CITIES)
      .map(([city, config]) => ({ city, distance: distanceKm(latitude, longitude, config.coords[0], config.coords[1]) }))
      .sort((left, right) => left.distance - right.distance)[0];
    if (nearest && nearest.distance <= 25) return nearest.city;
  }
  return null;
}

function syncHistoricalLocation(location, paint = true) {
  const select = byId("locationSelect");
  const archiveCity = archiveCityForLocation(location);
  const label = [...new Set([location?.name, location?.district, location?.state].filter(Boolean))].join(", ") || "Selected location";
  let customOption = select.querySelector(`option[value="${CUSTOM_ARCHIVE_LOCATION}"]`);
  if (archiveCity) {
    customOption?.remove();
    select.value = archiveCity;
    if (paint) paintCity(archiveCity);
    return;
  }
  if (!customOption) {
    customOption = document.createElement("option");
    customOption.value = CUSTOM_ARCHIVE_LOCATION;
    select.append(customOption);
  }
  customOption.textContent = `${label} (no archive series)`;
  customOption.dataset.archiveLocationName = label;
  select.value = CUSTOM_ARCHIVE_LOCATION;
  if (paint) paintCity(CUSTOM_ARCHIVE_LOCATION, label);
}

async function notificationApi(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { accept: "application/json", ...(options.headers || {}) },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || payload.message || `Request failed (${response.status}).`);
  return payload;
}

async function loadNotificationSettings() {
  try {
    const settings = await notificationApi("/api/notifications/preferences");
    byId("registeredMobile").textContent = settings.phone
      ? `Registered mobile: ${settings.phone} · ${settings.phoneVerified ? "verified" : "not verified"}`
      : "No registered mobile number is saved on this account.";
    byId("smsNotificationsEnabled").checked = settings.smsEnabled;
    byId("whatsappNotificationsEnabled").checked = settings.whatsappEnabled;
    byId("notificationConsent").checked = Boolean(settings.consentedAt);
    byId("notificationSettingsMessage").textContent = "Preferences apply to your verified profile number. This browser never chooses the recipient.";
  } catch (error) {
    byId("registeredMobile").textContent = "Sign in to view your verified mobile number and manage notification preferences.";
    byId("notificationSettingsMessage").textContent = error instanceof Error ? error.message : "Account settings are unavailable.";
  }

  try {
    const result = await notificationApi("/api/notifications/history");
    const container = byId("notificationHistoryList");
    const rows = result.notifications || [];
    if (!rows.length) { container.textContent = "No notifications have been sent."; return; }
    container.replaceChildren(...rows.map((entry) => {
      const item = document.createElement("p");
      item.textContent = `${new Date(entry.created_at).toLocaleString()} · ${entry.channel} · ${entry.delivery_status} · ${entry.recipient_phone || "number unavailable"} · ${entry.message}`;
      return item;
    }));
  } catch (error) {
    byId("notificationHistoryList").textContent = error instanceof Error ? error.message : "Notification history is unavailable.";
  }
}

function makeChart(canvas, type, labels, data, label) {
  if (!window.Chart || !canvas) return null;
  return new Chart(canvas, {
    type,
    data: { labels, datasets: [{ label, data, borderColor: "#0b9d70", backgroundColor: type === "bar" ? "#a9e6ca" : "rgba(11,157,112,.12)", fill: type === "line", tension: .25, borderWidth: 2, pointRadius: type === "line" ? 0 : 2 }] },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { mode: "index", intersect: false } },
      scales: {
        x: { grid: { display: false }, ticks: { color: "#8aa0a6", font: { size: 9 }, maxRotation: 0, maxTicksLimit: 12 } },
        y: { beginAtZero: true, suggestedMax: 500, grid: { color: "#edf3f1" }, ticks: { color: "#8aa0a6", font: { size: 9 } } },
      },
    },
  });
}

function initCharts() {
  forecastChart = makeChart(byId("forecastChart"), "line", [], [], "Reported city AQI");
  historyChart = makeChart(byId("historyChart"), "bar", [], [], "Reported city AQI");
}

function initMap() {
  const container = byId("airMap");
  if (!window.L || !container) {
    if (container) container.innerHTML = '<p style="padding:20px">Map tiles are unavailable. Historical AQI tables remain available.</p>';
    return;
  }
  map = L.map(container).setView([20.5, 78.9], 4.5);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 18, attribution: "&copy; OpenStreetMap contributors" }).addTo(map);
  updateMap(byId("locationSelect").value);
  setTimeout(() => map.invalidateSize(), 200);
}

function updateMap(selected) {
  if (!map) return;
  mapMarkers.forEach((marker) => map.removeLayer(marker));
  mapMarkers = [];
  Object.entries(ARCHIVE_CITIES).forEach(([city, config]) => {
    const latest = selectedRows(city).at(-1);
    if (!latest) return;
    const color = ({ Good: "#21ae7d", Satisfactory: "#8bcf71", Moderate: "#e1b83d", Poor: "#e98a47", "Very Poor": "#e47b60", Severe: "#8a4c75" })[latest.category] || "#607b85";
    const marker = L.circleMarker(config.coords, { radius: city === selected ? 10 : 7, color: "#fff", weight: 2, fillColor: color, fillOpacity: .95 })
      .addTo(map)
      .bindPopup(`<b>${city}</b><br>Archived AQI: ${latest.aqi} (${latest.category})<br>Bulletin date: ${latest.date}<br>${latest.stations} reporting station(s)<br><small>Approximate city pin; historical city-average bulletin</small>`);
    mapMarkers.push(marker);
  });
}

function initProfile() {
  const user = profile();
  const name = user?.fullName || "Demo explorer";
  byId("topProfileName").textContent = name.split(" ")[0];
  byId("profileName").textContent = name;
  byId("profileEmail").textContent = user?.email || "demo@airguard.local";
  byId("avatarInitial").textContent = name[0]?.toUpperCase() || "U";
  byId("healthProfileName").textContent = user?.fullName || "Your profile";
  byId("healthProfileMeta").textContent = user ? `${user.age || "Age not set"} years · ${user.location || "Location not set"}` : "Add profile details to personalise this view.";
  byId("healthConditions").textContent = user?.diseases?.length ? user.diseases.join(" · ") : "No health conditions selected";
  byId("settingsName").value = user?.fullName || "";
  byId("settingsEmail").value = user?.email || "";
  byId("settingsPhone").value = user?.phone || localStorage.getItem("airguardMobile") || "";
  byId("settingsAge").value = user?.age || "";
  byId("settingsLocation").value = user?.location || "";
  byId("settingsConditions").value = user?.diseases?.join(", ") || "";
  const settingsPhone = byId("settingsPhone");
  settingsPhone.pattern = "(?:\\+[1-9][0-9]{7,14}|[6-9][0-9]{9}|91[6-9][0-9]{9})";
  settingsPhone.addEventListener("blur", () => {
    const digits = settingsPhone.value.trim().replace(/[\s()-]/g, "");
    if (/^[6-9]\d{9}$/.test(digits)) settingsPhone.value = `+91${digits}`;
    else if (/^91[6-9]\d{9}$/.test(digits)) settingsPhone.value = `+${digits}`;
  });
  if (user?.location) {
    syncHistoricalLocation({ name: user.location }, false);
  }
}

function addBubble(text, speaker) {
  const bubble = document.createElement("div");
  bubble.className = `chat-bubble ${speaker}`;
  bubble.textContent = text;
  byId("chatMessages").appendChild(bubble);
  byId("chatMessages").scrollTop = byId("chatMessages").scrollHeight;
  return bubble;
}

async function askAssistant(question) {
  const previous = [...byId("chatMessages").children].slice(-8).map((bubble) => ({
    role: bubble.classList.contains("user") ? "user" : bubble.classList.contains("bot") ? "assistant" : null,
    content: bubble.textContent || "",
  })).filter((item) => item.role && item.content && item.content !== "Checking the live context…");
  addBubble(question, "user");
  const answer = addBubble("Checking the live context…", "bot");
  try {
    const response = await fetch("/api/assistant", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({
        message: question,
        history: previous,
        location: selectedLiveLocation ? [selectedLiveLocation.name, selectedLiveLocation.district, selectedLiveLocation.state].filter(Boolean).join(", ") : "not selected",
        aqi: latestLiveReading?.aqi,
        category: latestLiveReading?.category,
        source: latestLiveReading?.aqiSource,
        observedAt: latestLiveReading?.observedAt,
      }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || "AI assistant is temporarily unavailable.");
    answer.textContent = result.answer;
  } catch (error) {
    answer.textContent = error instanceof Error ? error.message : "AI assistant is temporarily unavailable.";
  }
}

function downloadCityCsv(city) {
  const rows = selectedRows(city);
  if (!rows.length) { showToast("No archived CPCB AQI rows are available for this city."); return; }
  const header = ["date", "city", "aqi", "category", "stations", "prominent_pollutant"];
  const csv = [header, ...rows.map((row) => [row.date, row.city, row.aqi, row.category, row.stations, row.pollutant])]
    .map((row) => row.map((value) => `"${String(value).replace(/"/g, '""')}"`).join(","))
    .join("\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `airguard-cpcb-aqi-${city.toLowerCase()}-archive.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

document.addEventListener("DOMContentLoaded", async () => {
  const assistantHint = document.querySelector("#assistant .assistant-header .muted");
  if (assistantHint) assistantHint.textContent = "AI-powered answers grounded in your selected location and current reading.";
  const assistantBadge = document.querySelector("#assistant .assistant-header .status-chip");
  if (assistantBadge) assistantBadge.textContent = "AI";
  const assistantNote = document.querySelector("#assistant .assistant-panel > .tiny-note");
  if (assistantNote) assistantNote.textContent = "AI-generated general information can be incomplete. Follow official public-health guidance; the assistant does not provide medical diagnosis or emergency care.";
  const assistantWelcome = byId("chatMessages")?.querySelector(".chat-bubble.bot");
  if (assistantWelcome) assistantWelcome.textContent = "Hi! Ask me about your current AQI, pollutants, recent trends, forecasts, or ways to understand air-quality data.";
  initProfile();
  initLiveAirQuality();
  initCharts();
  initLiveHistoryPanel();
  await loadArchive();
  initMap();
  const archiveSelection = byId("locationSelect").selectedOptions[0];
  paintCity(byId("locationSelect").value, archiveSelection?.dataset.archiveLocationName);
  const initialCity = byId("locationSelect").value;
  const initialCoords = ARCHIVE_CITIES[initialCity]?.coords;
  if (initialCoords) {
    void loadLiveLocation({ id: 0, name: initialCity, country: "India", state: archiveSelection?.textContent.split(",").at(-1)?.trim(), latitude: initialCoords[0], longitude: initialCoords[1] });
  }
  void loadNotificationSettings();

  byId("liveLocationForm").addEventListener("submit", (event) => {
    event.preventDefault();
    void searchLiveLocations(byId("liveLocationQuery").value);
  });
  byId("whatsappAlertForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!selectedLiveLocation) { byId("liveMessage").textContent = "Choose a location or use your current location before enabling alerts."; return; }
    byId("liveMessage").textContent = "Saving your AQI alert threshold…";
    try {
      await notificationApi("/api/alerts", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({
          location: selectedLiveLocation,
          threshold: Number(byId("whatsappAlertThreshold").value),
        }),
      });
      byId("liveMessage").textContent = "AQI alert threshold saved for your verified number and selected channels.";
    } catch (error) {
      byId("liveMessage").textContent = error instanceof Error ? error.message : "WhatsApp alert setup is temporarily unavailable.";
    }
  });
  byId("notificationPreferencesForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const message = byId("notificationSettingsMessage");
    message.textContent = "Saving notification preferences…";
    try {
      await notificationApi("/api/notifications/preferences", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          smsEnabled: byId("smsNotificationsEnabled").checked,
          whatsappEnabled: byId("whatsappNotificationsEnabled").checked,
          consent: byId("notificationConsent").checked,
        }),
      });
      message.textContent = "Notification preferences saved.";
      await loadNotificationSettings();
    } catch (error) {
      message.textContent = error instanceof Error ? error.message : "Could not save notification preferences.";
    }
  });
  byId("phoneUpdateForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const rawPhone = byId("newMobileNumber").value.trim().replace(/[\s()-]/g, "");
    const phoneNumber = /^[6-9]\d{9}$/.test(rawPhone) ? `+91${rawPhone}` : /^91[6-9]\d{9}$/.test(rawPhone) ? `+${rawPhone}` : rawPhone;
    byId("newMobileNumber").value = phoneNumber;
    const message = byId("notificationSettingsMessage");
    if (!/^\+[1-9]\d{7,14}$/.test(phoneNumber)) { message.textContent = "Enter a valid Indian 10-digit mobile number; +91 is added automatically."; return; }
    message.textContent = "Sending a verification code…";
    try {
      await notificationApi("/api/auth/phone/send-otp", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ phoneNumber }),
      });
      byId("phoneUpdateCode").value = "";
      byId("phoneUpdateVerifyForm").hidden = false;
      message.textContent = "Code sent. Enter it below to verify the new number.";
    } catch (error) { message.textContent = error instanceof Error ? error.message : "Could not send a verification code."; }
  });
  byId("phoneUpdateVerifyForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const phoneNumber = byId("newMobileNumber").value.trim();
    const code = byId("phoneUpdateCode").value.trim();
    const message = byId("notificationSettingsMessage");
    try {
      await notificationApi("/api/auth/phone/verify", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ phoneNumber, code, updatePhoneNumber: true }),
      });
      localStorage.setItem("airguardMobile", phoneNumber);
      message.textContent = "Mobile number verified and updated.";
      byId("phoneUpdateVerifyForm").hidden = true;
      byId("newMobileNumber").value = "";
      await loadNotificationSettings();
    } catch (error) { message.textContent = error instanceof Error ? error.message : "Could not verify this number."; }
  });
  byId("liveUseLocation").addEventListener("click", requestCurrentLocation);
  let searchTimer;
  byId("liveLocationQuery").addEventListener("input", () => {
    clearTimeout(searchTimer);
    const query = byId("liveLocationQuery").value;
    if (query.trim().length >= 2) searchTimer = setTimeout(() => void searchLiveLocations(query), 250);
  });

  byId("dismissNotice").addEventListener("click", () => document.querySelector(".notice-banner")?.remove());
  byId("logoutBtn").addEventListener("click", signOut);
  byId("profileSignout").addEventListener("click", signOut);
  async function signOut() {
    try { await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" }); } catch { /* Redirect still clears this browser's view. */ }
    localStorage.removeItem("airguardSession");
    location.href = "/";
  }
  byId("profileButton").addEventListener("click", () => byId("profilePopover").classList.toggle("hidden"));
  byId("notificationsBtn").addEventListener("click", () => {
    const preferences = byId("notificationPreferencesForm");
    preferences?.scrollIntoView({ behavior: "smooth", block: "center" });
    byId("notificationConsent")?.focus({ preventScroll: true });
  });
  byId("menuToggle").addEventListener("click", () => byId("sidebar").classList.toggle("open"));
  document.querySelectorAll("[data-jump]").forEach((button) => button.addEventListener("click", () => document.getElementById(button.dataset.jump)?.scrollIntoView({ behavior: "smooth" })));
  document.querySelectorAll(".side-nav a").forEach((link) => link.addEventListener("click", () => {
    document.querySelectorAll(".side-nav a").forEach((item) => item.classList.remove("active"));
    link.classList.add("active");
    byId("sidebar").classList.remove("open");
  }));
  byId("forecastRange").addEventListener("change", () => updateChart(byId("locationSelect").value));
  byId("locationSelect").addEventListener("change", () => {
    const city = byId("locationSelect").value;
    const coords = ARCHIVE_CITIES[city]?.coords;
    if (coords) void loadLiveLocation({ id: 0, name: city, country: "India", latitude: coords[0], longitude: coords[1] });
  });
  byId("forecastRange").value = "30";
  byId("chatForm").addEventListener("submit", (event) => {
    event.preventDefault();
    const input = byId("chatInput");
    if (!input.value.trim()) return;
    void askAssistant(input.value.trim());
    input.value = "";
  });
  document.querySelectorAll("[data-prompt]").forEach((button) => button.addEventListener("click", () => {
    const question = button.dataset.prompt;
    void askAssistant(question);
  }));
  byId("settingsForm").addEventListener("submit", (event) => {
    event.preventDefault();
    const user = profile() || {};
    const name = byId("settingsName").value.trim();
    const email = byId("settingsEmail").value.trim();
    const rawPhone = byId("settingsPhone").value.trim().replace(/[\s()-]/g, "");
    const phone = /^[6-9]\d{9}$/.test(rawPhone) ? `+91${rawPhone}` : /^91[6-9]\d{9}$/.test(rawPhone) ? `+${rawPhone}` : rawPhone;
    byId("settingsPhone").value = phone;
    if (!name || !email || !/^\+[1-9]\d{7,14}$/.test(phone)) { byId("settingsMessage").textContent = "Name, email and a valid international mobile number are required."; return; }
    user.fullName = name;
    user.email = email;
    user.phone = phone;
    localStorage.setItem("airguardMobile", phone);
    user.age = byId("settingsAge").value;
    user.location = byId("settingsLocation").value.trim();
    user.diseases = byId("settingsConditions").value.split(",").map((value) => value.trim()).filter(Boolean);
    localStorage.setItem("airguardUser", JSON.stringify(user));
    initProfile();
    byId("settingsMessage").textContent = "Profile saved in this browser.";
    showToast("Local profile saved.");
  });
  byId("clearProfile").addEventListener("click", () => {
    if (confirm("Clear the saved demo profile from this browser?")) {
      localStorage.removeItem("airguardUser");
      initProfile();
      showToast("Local profile cleared.");
    }
  });
  byId("downloadCsv").addEventListener("click", () => downloadCityCsv(byId("locationSelect").value));
  byId("locationSelect").addEventListener("change", (event) => {
    const selectedOption = event.target.selectedOptions[0];
    if (event.target.value === CUSTOM_ARCHIVE_LOCATION) {
      paintCity(CUSTOM_ARCHIVE_LOCATION, selectedOption?.dataset.archiveLocationName);
      return;
    }
    event.target.querySelector(`option[value="${CUSTOM_ARCHIVE_LOCATION}"]`)?.remove();
    paintCity(event.target.value);
  });
  byId("refreshBtn").addEventListener("click", () => showToast("This historical archive does not refresh with live readings."));
});
