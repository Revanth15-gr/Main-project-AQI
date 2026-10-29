/* AirGuard dashboard backed by historical CPCB daily AQI bulletins. */
const ARCHIVE_CITIES = {
  Visakhapatnam: { file: "Visakhapatnam_AQIBulletins.csv", coords: [17.6868, 83.2185] },
  Hyderabad: { file: "Hyderabad_AQIBulletins.csv", coords: [17.385, 78.4867] },
  Delhi: { file: "Delhi_AQIBulletins.csv", coords: [28.6139, 77.209] },
  Bengaluru: { file: "Bengaluru_AQIBulletins.csv", coords: [12.9716, 77.5946] },
};

const byId = (id) => document.getElementById(id);
const archive = {};
let forecastChart;
let historyChart;
let map;
let mapMarkers = [];

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
    table.innerHTML = '<tr><td colspan="5">No CPCB bulletin records are included for this city.</td></tr>';
    return;
  }
  table.innerHTML = rows.map((row) => `<tr><td>${row.date}</td><td>${row.city}</td><td>${row.aqi}</td><td><span class="status-chip ${categoryClass(row.category)}">${row.category}</span></td><td>${row.stations} station${row.stations === 1 ? "" : "s"}</td></tr>`).join("");
}

function paintCity(city) {
  const rows = selectedRows(city);
  const latest = rows.at(-1);
  const noData = !latest;
  byId("aqiValue").textContent = latest ? String(latest.aqi) : "—";
  byId("gaugeValue").textContent = latest ? String(latest.aqi) : "—";
  byId("aqiSummary").textContent = latest
    ? `${latest.city} city-average AQI reported in a CPCB daily bulletin. This is historical, not current air quality.`
    : `${city} has no city series in the included CPCB bulletin archive. Choose a supported city to view historical readings.`;
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
  byId("welcomeName").textContent = city;
  byId("forecastHeadline").textContent = "Not connected";
  byId("forecastStatus").textContent = "Historical archive only";
  updateChart(city);
  updateHistoryTable(city);
  updateMap(city);
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
  byId("settingsAge").value = user?.age || "";
  byId("settingsLocation").value = user?.location || "";
  byId("settingsConditions").value = user?.diseases?.join(", ") || "";
  if (user?.location) {
    const match = Object.keys(ARCHIVE_CITIES).find((city) => user.location.toLowerCase().includes(city.toLowerCase()));
    if (match) byId("locationSelect").value = match;
  }
}

function reply(question) {
  const text = question.toLowerCase();
  if (text.includes("forecast") || text.includes("tomorrow")) return "This dashboard has no live feed or forecast yet. It shows historical CPCB daily AQI bulletins through 2023; check an official current source for today's conditions.";
  if (text.includes("aqi") || text.includes("pollut")) return "The dashboard uses reported city-average AQI values and categories from historical CPCB daily bulletins. The archive ends on 2023-12-31, so these values are not current readings. The reported prominent pollutant is shown when available.";
  if (text.includes("health") || text.includes("exposure")) return "AirGuard provides general information, not medical advice. This historical archive cannot describe today's exposure. Check current local readings and follow public-health guidance and your clinician's advice.";
  return "I can explain the historical AQI archive, reported categories, and why it is different from a live measurement. I am a rule-based demo, not a connected AI model.";
}

function addBubble(text, speaker) {
  const bubble = document.createElement("div");
  bubble.className = `chat-bubble ${speaker}`;
  bubble.textContent = text;
  byId("chatMessages").appendChild(bubble);
  byId("chatMessages").scrollTop = byId("chatMessages").scrollHeight;
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
  initProfile();
  initCharts();
  await loadArchive();
  initMap();
  paintCity(byId("locationSelect").value);

  byId("locationSelect").addEventListener("change", (event) => paintCity(event.target.value));
  byId("refreshBtn").addEventListener("click", () => showToast("This historical archive does not refresh with live readings."));
  byId("dismissNotice").addEventListener("click", () => document.querySelector(".notice-banner")?.remove());
  byId("logoutBtn").addEventListener("click", signOut);
  byId("profileSignout").addEventListener("click", signOut);
  function signOut() { localStorage.removeItem("airguardSession"); location.href = "index.html"; }
  byId("profileButton").addEventListener("click", () => byId("profilePopover").classList.toggle("hidden"));
  byId("notificationsBtn").addEventListener("click", () => showToast("AQI notifications are planned for a later phase."));
  byId("menuToggle").addEventListener("click", () => byId("sidebar").classList.toggle("open"));
  document.querySelectorAll("[data-jump]").forEach((button) => button.addEventListener("click", () => document.getElementById(button.dataset.jump)?.scrollIntoView({ behavior: "smooth" })));
  document.querySelectorAll(".side-nav a").forEach((link) => link.addEventListener("click", () => {
    document.querySelectorAll(".side-nav a").forEach((item) => item.classList.remove("active"));
    link.classList.add("active");
    byId("sidebar").classList.remove("open");
  }));
  byId("forecastRange").addEventListener("change", () => updateChart(byId("locationSelect").value));
  byId("forecastRange").value = "30";
  byId("chatForm").addEventListener("submit", (event) => {
    event.preventDefault();
    const input = byId("chatInput");
    if (!input.value.trim()) return;
    const question = input.value.trim();
    addBubble(question, "user");
    window.setTimeout(() => addBubble(reply(question), "bot"), 120);
    input.value = "";
  });
  document.querySelectorAll("[data-prompt]").forEach((button) => button.addEventListener("click", () => {
    const question = button.dataset.prompt;
    addBubble(question, "user");
    window.setTimeout(() => addBubble(reply(question), "bot"), 120);
  }));
  byId("settingsForm").addEventListener("submit", (event) => {
    event.preventDefault();
    const user = profile() || {};
    const name = byId("settingsName").value.trim();
    const email = byId("settingsEmail").value.trim();
    if (!name || !email) { byId("settingsMessage").textContent = "Name and email are required."; return; }
    user.fullName = name;
    user.email = email;
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
});
