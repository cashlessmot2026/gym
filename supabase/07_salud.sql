-- IronYellow Gym · Historial diario de salud (Health Connect / pulseras)
-- Ejecutar en Supabase → SQL Editor (una sola vez). Es seguro repetirlo.
-- Cada sincronización guarda un resumen por día (pasos, distancia, calorías, pulso, sueño)
-- y la analítica del perfil suma y compara esos días con las actividades de la tabla `activities`.

create table if not exists health_daily (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references members(id) on delete cascade,
  day date not null,
  steps int default 0,
  distance_m numeric default 0,
  calories numeric default 0,       -- kcal totales del día
  avg_hr int,                       -- pulso medio del día
  max_hr int,
  min_hr int,
  resting_hr int,                   -- pulso en reposo
  sleep_min int,                    -- minutos de sueño
  source text default 'health_connect',
  updated_at timestamptz not null default now(),
  unique (member_id, day)
);
create index if not exists idx_health_daily_member on health_daily(member_id, day desc);

alter table health_daily enable row level security;
drop policy if exists app_all on health_daily;
create policy app_all on health_daily for all to anon, authenticated using (true) with check (true);
