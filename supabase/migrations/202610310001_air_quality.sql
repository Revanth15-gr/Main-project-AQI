create extension if not exists pgcrypto;

create table if not exists public.locations (
  id uuid primary key default gen_random_uuid(),
  geocoder text not null default 'open-meteo',
  geocoder_id text not null,
  name text not null,
  state text,
  district text,
  latitude double precision not null,
  longitude double precision not null,
  location_type text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (geocoder, geocoder_id)
);

create table if not exists public.monitoring_stations (
  id uuid primary key default gen_random_uuid(),
  source text not null,
  station_name text not null,
  city text not null,
  state text not null,
  latitude double precision not null,
  longitude double precision not null,
  is_active boolean not null default true,
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source, station_name, city, state)
);

create table if not exists public.air_quality_readings (
  id uuid primary key default gen_random_uuid(),
  station_id uuid not null references public.monitoring_stations(id) on delete cascade,
  aqi integer,
  aqi_scale text not null default 'INDIA_CPCB',
  pollutant_values jsonb not null default '{}'::jsonb,
  category text,
  source text not null,
  data_type text not null,
  observed_at timestamptz not null,
  fetched_at timestamptz not null default now(),
  is_stale boolean not null default false,
  unique (station_id, source, observed_at)
);

create index if not exists air_quality_readings_observed_idx
  on public.air_quality_readings (observed_at desc);
create index if not exists air_quality_readings_station_idx
  on public.air_quality_readings (station_id, observed_at desc);
create index if not exists monitoring_stations_state_city_idx
  on public.monitoring_stations (state, city);
create index if not exists locations_state_district_idx
  on public.locations (state, district);

create table if not exists public.favourite_locations (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  location_id uuid not null references public.locations(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (user_id, location_id)
);

create table if not exists public.alert_preferences (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  location_id uuid not null references public.locations(id) on delete cascade,
  phone_number text not null,
  threshold integer not null check (threshold between 0 and 500),
  enabled boolean not null default true,
  consented_at timestamptz not null,
  last_alerted_at timestamptz,
  last_alerted_aqi integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, location_id)
);

create table if not exists public.notification_history (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  location_id uuid not null references public.locations(id) on delete cascade,
  alert_preference_id uuid references public.alert_preferences(id) on delete set null,
  message text not null,
  provider_message_id text,
  dispatch_key text unique,
  sent_at timestamptz,
  delivery_status text not null,
  created_at timestamptz not null default now()
);

create index if not exists alert_preferences_enabled_idx
  on public.alert_preferences (enabled, threshold);
create index if not exists notification_history_user_idx
  on public.notification_history (user_id, created_at desc);
