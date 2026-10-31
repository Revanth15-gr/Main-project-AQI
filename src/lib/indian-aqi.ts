type Breakpoint = { concentration: number; index: number };

// CPCB concentration breakpoints. Concentrations are µg/m³ except CO (mg/m³).
const BREAKPOINTS: Record<string, Breakpoint[]> = {
  pm2_5: [30, 60, 90, 120, 250].map((concentration, i) => ({ concentration, index: [50, 100, 200, 300, 400][i] })),
  pm10: [50, 100, 250, 350, 430].map((concentration, i) => ({ concentration, index: [50, 100, 200, 300, 400][i] })),
  nitrogen_dioxide: [40, 80, 180, 280, 400].map((concentration, i) => ({ concentration, index: [50, 100, 200, 300, 400][i] })),
  sulphur_dioxide: [40, 80, 380, 800, 1600].map((concentration, i) => ({ concentration, index: [50, 100, 200, 300, 400][i] })),
  carbon_monoxide: [1, 2, 10, 17, 34].map((concentration, i) => ({ concentration, index: [50, 100, 200, 300, 400][i] })),
  ozone: [50, 100, 168, 208, 748].map((concentration, i) => ({ concentration, index: [50, 100, 200, 300, 400][i] })),
};

export function indianAqiCategory(aqi: number | null): string {
  if (aqi === null || !Number.isFinite(aqi)) return "Unavailable";
  if (aqi <= 50) return "Good";
  if (aqi <= 100) return "Satisfactory";
  if (aqi <= 200) return "Moderate";
  if (aqi <= 300) return "Poor";
  if (aqi <= 400) return "Very Poor";
  return "Severe";
}

function subIndex(pollutant: string, concentration: number): number | null {
  const points = BREAKPOINTS[pollutant];
  if (!points || !Number.isFinite(concentration) || concentration < 0) return null;
  let lowerConcentration = 0;
  let lowerIndex = 0;
  for (const point of points) {
    if (concentration <= point.concentration) {
      return Math.round(((point.index - lowerIndex) / (point.concentration - lowerConcentration)) * (concentration - lowerConcentration) + lowerIndex);
    }
    lowerConcentration = point.concentration;
    lowerIndex = point.index;
  }
  return 500;
}

export function calculateIndianAqi(hourly: Record<string, Array<number | null> | undefined>): number | null {
  const indices: number[] = [];
  let particulatePresent = false;

  for (const pollutant of Object.keys(BREAKPOINTS)) {
    const values = (hourly[pollutant] ?? []).filter((value): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0);
    const averagingHours = pollutant === "carbon_monoxide" || pollutant === "ozone" ? 8 : 24;
    const minimumHours = pollutant === "carbon_monoxide" || pollutant === "ozone" ? 8 : 16;
    if (values.length < minimumHours) continue;
    const window = values.slice(-averagingHours);
    if (window.length < minimumHours) continue;
    const mean = window.reduce((sum, value) => sum + value, 0) / window.length;
    const normalized = pollutant === "carbon_monoxide" ? mean / 1000 : mean;
    const index = subIndex(pollutant, normalized);
    if (index === null) continue;
    indices.push(index);
    if (pollutant === "pm2_5" || pollutant === "pm10") particulatePresent = true;
  }

  // CPCB methodology needs at least three pollutants, including PM2.5 or PM10.
  return indices.length >= 3 && particulatePresent ? Math.max(...indices) : null;
}
