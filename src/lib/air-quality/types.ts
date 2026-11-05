export type DataType = "LIVE_STATION" | "RECENT_STATION" | "HISTORICAL" | "MODEL_ESTIMATE" | "UNAVAILABLE";

export type Pollutants = {
  pm25?: number;
  pm10?: number;
  no2?: number;
  so2?: number;
  co?: number;
  o3?: number;
  nh3?: number;
};

export type LocationCandidate = {
  id: number;
  name: string;
  country: string;
  state?: string;
  district?: string;
  latitude: number;
  longitude: number;
};

export type AirQualityReading = {
  location: LocationCandidate;
  aqi: number | null;
  category: string;
  aqiScale: "INDIA_CPCB";
  aqiSource: "CPCB" | "CAMS_MODEL" | null;
  dataType: DataType;
  pollutants: Pollutants;
  observedAt: string | null;
  fetchedAt: string;
  isStale: boolean;
  station: null | {
    name: string;
    city: string;
    state: string;
    latitude: number;
    longitude: number;
    distanceKm: number;
    observedAt: string;
    dataType: "LIVE_STATION" | "RECENT_STATION" | "HISTORICAL";
    pollutants: Pollutants;
  };
  estimate: null | {
    aqi: number | null;
    category: string;
    dataType: "MODEL_ESTIMATE";
    pollutants: Pollutants;
    observedAt: string | null;
    attribution: string;
    gridLocation?: { latitude: number; longitude: number };
  };
  sources: Array<{ name: string; url: string; status: string; detail?: string }>;
};
