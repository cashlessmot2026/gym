-- =====================================================================
-- IronYellow Gym · 05: pulseras/smartwatch, comunidad (tipo Instagram),
-- ranking histórico y retos entre miembros.
-- Ejecutar en Supabase → SQL Editor (después de schema.sql … 04_clases.sql).
-- =====================================================================

-- ---------- Actividades externas (Health Connect, FIT, TCX, GPX, BLE) ----------
create table if not exists activities (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references members(id) on delete cascade,
  source text not null check (source in ('ble','health_connect','fit','tcx','gpx')),
  sport text default 'otro',            -- correr, bici, caminar, fuerza, natación...
  title text,
  started_at timestamptz not null,
  duration_sec int default 0,
  distance_m numeric default 0,
  calories numeric default 0,
  steps int default 0,
  avg_hr int,
  max_hr int,
  hr_zones jsonb,                       -- {"z1":min,"z2":min,...,"z5":min}
  hr_series jsonb,                      -- [[segundo, lpm], ...] resumida (≤300 puntos)
  route jsonb,                          -- [[lat, lon], ...] simplificada (≤500 puntos)
  ascent_m numeric,
  device text,
  dedupe_key text not null,             -- evita contar dos veces el mismo entrenamiento
  created_at timestamptz not null default now(),
  unique (member_id, dedupe_key)
);
create index if not exists idx_act_member on activities(member_id, started_at desc);

-- Zonas de pulso y calorías por pulso en las rutinas del gimnasio (pulsera BLE en vivo)
alter table workout_sessions add column if not exists hr_zones jsonb;
alter table workout_sessions add column if not exists hr_kcal numeric;

-- Perfil público
alter table members add column if not exists bio text;
alter table members add column if not exists health_last_sync timestamptz;

-- ---------- Publicaciones (solo imágenes, alojadas en Google Drive) ----------
create table if not exists posts (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references members(id) on delete cascade,
  drive_id text not null,               -- imagen 1080 px
  thumb_id text,                        -- miniatura 320 px
  caption text,
  likes_count int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists idx_posts_created on posts(created_at desc);
create index if not exists idx_posts_member on posts(member_id, created_at desc);

create table if not exists post_likes (
  post_id uuid not null references posts(id) on delete cascade,
  member_id uuid not null references members(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, member_id)
);

-- Contador de "me gusta" siempre consistente
create or replace function post_likes_count() returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    update posts set likes_count = likes_count + 1 where id = new.post_id;
  elsif tg_op = 'DELETE' then
    update posts set likes_count = greatest(0, likes_count - 1) where id = old.post_id;
  end if;
  return null;
end $$;
drop trigger if exists trg_post_likes on post_likes;
create trigger trg_post_likes after insert or delete on post_likes
  for each row execute function post_likes_count();

-- ---------- Seguir ----------
create table if not exists follows (
  follower_id uuid not null references members(id) on delete cascade,
  following_id uuid not null references members(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (follower_id, following_id),
  check (follower_id <> following_id)
);
create index if not exists idx_follows_following on follows(following_id);

-- ---------- Ranking histórico (puntaje por objetivo, se recalcula al sincronizar) ----------
create table if not exists member_scores (
  member_id uuid primary key references members(id) on delete cascade,
  goal text,
  score numeric not null default 0,
  detail jsonb,                         -- desglose mostrado en el ranking
  updated_at timestamptz not null default now()
);
create index if not exists idx_scores_goal on member_scores(goal, score desc);

-- ---------- Retos 1 vs 1 ----------
create table if not exists challenges (
  id uuid primary key default gen_random_uuid(),
  challenger_id uuid not null references members(id) on delete cascade,
  opponent_id uuid not null references members(id) on delete cascade,
  metric text not null check (metric in ('calorias','km','sesiones','minutos','volumen')),
  title text,
  start_date date not null default current_date,
  end_date date not null,
  status text not null default 'pendiente' check (status in ('pendiente','aceptado','rechazado','terminado')),
  challenger_value numeric default 0,
  opponent_value numeric default 0,
  winner_id uuid references members(id) on delete set null,
  created_at timestamptz not null default now(),
  check (challenger_id <> opponent_id),
  check (end_date >= start_date)
);
create index if not exists idx_ch_challenger on challenges(challenger_id);
create index if not exists idx_ch_opponent on challenges(opponent_id);

-- Avisos de retos en la bandeja de notificaciones del cliente
alter table notifications drop constraint if exists notifications_category_check;
alter table notifications add constraint notifications_category_check
  check (category in ('promo','publicidad','aviso','evento','recordatorio','clase','reto'));

-- ---------- Permisos (mismo modelo temporal que el resto: anon key) ----------
do $$
declare t text;
begin
  foreach t in array array['activities','posts','post_likes','follows','member_scores','challenges'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists app_all on %I', t);
    execute format('create policy app_all on %I for all to anon, authenticated using (true) with check (true)', t);
  end loop;
end $$;

do $$ begin alter publication supabase_realtime add table posts; exception when others then null; end $$;
do $$ begin alter publication supabase_realtime add table challenges; exception when others then null; end $$;
