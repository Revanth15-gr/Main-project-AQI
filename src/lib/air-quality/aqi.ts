type Breakpoint = { concentration: number; index: number };

// CPCB IND-AQI concentration breakpoints. Units are µg/m³ except CO (mg/m³).
const BREAKPOINTS: Record<string, Breakpoint[]> = {
  pm25: [30, 60, 90, 120, 250].map((concentration, i) => ({ concentration, index: [50, 100, 200, 300, 400][i] })),
  pm10: [50, 100, 250, 350, 430].map((concentration, i) => ({ concentration, index: [50, 100, 200, 300, 400][i] })),
  no2: [40, 80, 180, 280, 400].map((concentration, i) => ({ concentration, index: [50, 100, 200, 300, 400][i] })),
  so2: [40, 80, 380, 800, 1600].map((concentration, i) => ({ concentration, index: [50, 100, 200, 300, 400][i] })),
  co: [1, 2, 10, 17, 34].map((concentration, i) => ({ concentration, index: [50, 100, 200, 300, 400][i] })),
  o3: [50, 100, 168, 208, 748].map((concentration, i) => ({ concentration, index: [50, 100, 200, 300, 400][i] })),
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
      return Math.round(
        ((point.index - lowerIndex) / (point.concentration - lowerConcentration)) *
          (concentration - lowerConcentration) +
          lowerIndex,
      );
    }
    lowerConcentration = point.concentration;
    lowerIndex = point.index;
  }
  return 500;
}

export function calculateIndianAqi(hourly: Record<string, Array<number | null> | undefined>): number | null {
  const subIndices: number[] = [];
  let particulatePresent = false;

  for (const pollutant of Object.keys(BREAKPOINTS)) {
    const values = (hourly[pollutant] ?? []).filter((value): value is number =>
      typeof value === "number" && Number.isFinite(value) && value >= 0,
    );
    if (values.length < 16) continue;
    const window = pollutant === "co" || pollutant === "o3" ? values.slice(-8) : values.slice(-24);
    if (window.length < (pollutant === "co" || pollutant === "o3" ? 8 : 16)) continue;
    const average = window.reduce((sum, value) => sum + value, 0) / window.length;
    const normalized = pollutant === "co" ? average / 1000 : average;
    const index = subIndex(pollutant, normalized);
    if (index !== null) {
      subIndices.push(index);
      if (pollutant === "pm25" || pollutant === "pm10") particulatePresent = true;
    }
  }

  // CPCB requires at least three pollutants, including PM2.5 or PM10,
  // and at least 16 hours of data for each sub-index.
  if (subIndices.length < 3 || !particulatePresent) return null;
  return Math.max(...subIndices);
}
