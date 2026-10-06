-- =====================================================================
-- IronYellow Gym · Esquema Supabase
-- Ejecutar completo en: Supabase Dashboard > SQL Editor > New query > Run
-- Autenticación propia (validación en base de datos con bcrypt/pgcrypto).
-- Las contraseñas viven en la tabla "credentials", inaccesible para el
-- cliente: sólo se leen/escriben mediante funciones SECURITY DEFINER.
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------- Personal (admin / coach / recepción) ----------
create table if not exists staff (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  email text unique not null,
  username text unique not null,
  role text not null check (role in ('admin','coach','reception')),
  phone text,
  specialty text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- ---------- Tipos de entrenamiento (editables) ----------
create table if not exists training_types (
  id uuid primary key default gen_random_uuid(),
  name text unique not null,
  description text,
  emoji text default '🏋️',
  wger_categories int[] default '{}',
  met numeric default 5,
  created_at timestamptz not null default now()
);

-- ---------- Planes de membresía ----------
create table if not exists plans (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  days int not null,
  price numeric not null default 0,
  active boolean not null default true
);

-- ---------- Clientes ----------
create table if not exists members (
  id uuid primary key default gen_random_uuid(),
  cedula text unique not null,
  full_name text not null,
  email text unique,
  phone text,
  birthdate date,
  sex text check (sex in ('M','F')),
  address text,
  emergency_name text,
  emergency_phone text,
  medical_notes text,
  photo text,                          -- data URL (jpeg) comprimida
  face_descriptors jsonb,              -- [[128 floats], ...] varias muestras
  qr_code text unique not null default ('IY-' || upper(substr(replace(gen_random_uuid()::text,'-',''),1,10))),
  nfc_uid text unique,
  goal text,                           -- objetivo (perder grasa, hipertrofia...)
  training_modes text[] default '{}',  -- modos elegidos
  level text default 'principiante',
  activity_level numeric default 1.55,
  onboarded boolean not null default false,
  coach_id uuid references staff(id) on delete set null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- ---------- Credenciales (bcrypt) ----------
create table if not exists credentials (
  owner_type text not null check (owner_type in ('staff','member')),
  owner_id uuid not null,
  password_hash text not null,
  updated_at timestamptz not null default now(),
  primary key (owner_type, owner_id)
);

-- ---------- Membresías (cada renovación = nueva fila) ----------
create table if not exists memberships (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references members(id) on delete cascade,
  plan_id uuid references plans(id) on delete set null,
  plan_name text,
  start_date date not null default current_date,
  end_date date not null,
  price numeric default 0,
  paid boolean default true,
  payment_method text default 'efectivo',
  notes text,
  created_at timestamptz not null default now()
);

-- ---------- Ejercicios ----------
create table if not exists exercises (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  muscle_group text not null,
  training_type text,
  description text,
  image_url text,
  video_url text,
  default_sets int default 4,
  default_reps int default 12,
  default_work_sec int default 45,
  default_rest_sec int default 60,
  created_by uuid references staff(id) on delete set null,
  created_at timestamptz not null default now()
);

-- ---------- Rutinas (grupos de ejercicios) ----------
create table if not exists routines (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  training_type text,
  items jsonb not null default '[]', -- [{exercise_id, sets, reps, work_sec, rest_sec, weight}]
  coach_id uuid references staff(id) on delete set null,
  created_at timestamptz not null default now()
);

-- ---------- Grupos de clientes ----------
create table if not exists client_groups (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  coach_id uuid references staff(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists group_members (
  group_id uuid references client_groups(id) on delete cascade,
  member_id uuid references members(id) on delete cascade,
  primary key (group_id, member_id)
);

-- ---------- Asignaciones (por cliente o por grupo, por día de semana) ----------
-- weekday: 0=Domingo ... 6=Sábado
create table if not exists assignments (
  id uuid primary key default gen_random_uuid(),
  member_id uuid references members(id) on delete cascade,
  group_id uuid references client_groups(id) on delete cascade,
  routine_id uuid references routines(id) on delete set null,
  exercise_id uuid not null references exercises(id) on delete cascade,
  weekday int not null check (weekday between 0 and 6),
  sets int not null default 4,
  reps int not null default 12,
  work_sec int not null default 45,
  rest_sec int not null default 60,
  weight numeric,
  notes text,
  sort int default 0,
  created_by uuid references staff(id) on delete set null,
  created_at timestamptz not null default now(),
  check (member_id is not null or group_id is not null)
);

-- ---------- Sesiones y registros de entrenamiento ----------
create table if not exists workout_sessions (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references members(id) on delete cascade,
  date date not null default current_date,
  started_at timestamptz default now(),
  ended_at timestamptz,
  total_sec int default 0,
  active_sec int default 0,
  exercises_done int default 0,
  sets_done int default 0,
  volume_kg numeric default 0,
  calories numeric default 0,
  avg_hr int,
  max_hr int,
  created_at timestamptz not null default now()
);

create table if not exists workout_logs (
  id uuid primary key default gen_random_uuid(),
  session_id uuid references workout_sessions(id) on delete cascade,
  member_id uuid not null references members(id) on delete cascade,
  assignment_id uuid references assignments(id) on delete set null,
  exercise_id uuid references exercises(id) on delete set null,
  exercise_name text,
  muscle_group text,
  date date not null default current_date,
  sets_target int,
  reps_target int,
  sets_done int,
  reps_done int,
  weight numeric,
  work_sec int,
  rest_sec int,
  set_times jsonb default '[]',  -- [{set, work, rest, reps}]
  completed boolean default false,
  created_at timestamptz not null default now()
);

-- ---------- Medidas corporales ----------
create table if not exists body_metrics (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references members(id) on delete cascade,
  date date not null default current_date,
  weight numeric, height numeric, age int, sex text,
  neck numeric, chest numeric, waist numeric, hip numeric,
  arm numeric, thigh numeric, calf numeric,
  resting_hr int, systolic int, diastolic int,
  activity_level numeric,
  water_l numeric, sleep_h numeric,
  bmi numeric, body_fat numeric, lean_mass numeric, whr numeric, whtr numeric,
  bmr numeric, tdee numeric, target_kcal numeric,
  protein_g numeric, carbs_g numeric, fat_g numeric,
  notes text,
  created_at timestamptz not null default now()
);

-- ---------- Asistencia ----------
create table if not exists attendance (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references members(id) on delete cascade,
  method text not null check (method in ('cedula','qr','nfc','face','manual')),
  allowed boolean not null default true,
  created_at timestamptz not null default now()
);

-- ---------- Índices ----------
create index if not exists idx_memberships_member on memberships(member_id, end_date desc);
create index if not exists idx_assign_member on assignments(member_id, weekday);
create index if not exists idx_assign_group on assignments(group_id, weekday);
create index if not exists idx_logs_member on workout_logs(member_id, date);
create index if not exists idx_sessions_member on workout_sessions(member_id, date);
create index if not exists idx_metrics_member on body_metrics(member_id, date);
create index if not exists idx_att_member on attendance(member_id, created_at);

-- ---------- Vista: estado de membresía por cliente ----------
create or replace view member_status as
select m.id as member_id,
       m.full_name, m.cedula, m.email, m.phone, m.qr_code, m.nfc_uid, m.photo, m.coach_id, m.active,
       ms.plan_name, ms.start_date, ms.end_date,
       greatest(0, (ms.end_date - current_date))::int as days_left,
       case when ms.end_date is null then 'sin_plan'
            when ms.end_date < current_date then 'vencida'
            when ms.end_date - current_date <= 5 then 'por_vencer'
            else 'activa' end as status
from members m
left join lateral (
  select * from memberships x where x.member_id = m.id order by x.end_date desc limit 1
) ms on true;

-- =====================================================================
-- FUNCIONES DE AUTENTICACIÓN (SECURITY DEFINER)
-- =====================================================================

create or replace function staff_login(p_user text, p_pass text)
returns setof staff language sql security definer set search_path = public, extensions as $$
  select s.* from staff s
  join credentials c on c.owner_type = 'staff' and c.owner_id = s.id
  where (lower(s.username) = lower(trim(p_user)) or lower(s.email) = lower(trim(p_user)))
    and s.active
    and c.password_hash = crypt(p_pass, c.password_hash);
$$;

create or replace function member_login(p_user text, p_pass text)
returns setof members language sql security definer set search_path = public, extensions as $$
  select m.* from members m
  join credentials c on c.owner_type = 'member' and c.owner_id = m.id
  where (lower(m.email) = lower(trim(p_user)) or m.cedula = trim(p_user))
    and m.active
    and c.password_hash = crypt(p_pass, c.password_hash);
$$;

create or replace function set_password(p_owner_type text, p_owner_id uuid, p_pass text)
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  if length(coalesce(p_pass,'')) < 4 then raise exception 'La contraseña debe tener al menos 4 caracteres'; end if;
  insert into credentials(owner_type, owner_id, password_hash, updated_at)
  values (p_owner_type, p_owner_id, crypt(p_pass, gen_salt('bf', 10)), now())
  on conflict (owner_type, owner_id)
  do update set password_hash = excluded.password_hash, updated_at = now();
end $$;

-- Recuperación: genera una clave temporal nueva y la devuelve para mostrarla
-- (las contraseñas se guardan cifradas, por eso no se puede "leer" la anterior).
create or replace function recover_password(p_email text)
returns json language plpgsql security definer set search_path = public, extensions as $$
declare v_id uuid; v_type text; v_name text; v_user text; v_pass text;
begin
  select id, 'staff', full_name, username into v_id, v_type, v_name, v_user
    from staff where lower(email) = lower(trim(p_email)) and active limit 1;
  if v_id is null then
    select id, 'member', full_name, coalesce(email, cedula) into v_id, v_type, v_name, v_user
      from members where lower(email) = lower(trim(p_email)) and active limit 1;
  end if;
  if v_id is null then return json_build_object('ok', false); end if;
  v_pass := upper(substr(md5(random()::text), 1, 4)) || '-' || substr(md5(random()::text), 1, 4);
  perform set_password(v_type, v_id, v_pass);
  return json_build_object('ok', true, 'name', v_name, 'username', v_user, 'password', v_pass, 'type', v_type);
end $$;

-- =====================================================================
-- SEGURIDAD (RLS)
-- Mientras no exista auth de Google, la app usa la anon key; se permite
-- acceso a las tablas de negocio y se BLOQUEA por completo "credentials".
-- =====================================================================
alter table credentials enable row level security;  -- sin políticas = sin acceso directo
revoke all on credentials from anon, authenticated;

do $$
declare t text;
begin
  foreach t in array array['staff','training_types','plans','members','memberships','exercises','routines',
                           'client_groups','group_members','assignments','workout_sessions','workout_logs',
                           'body_metrics','attendance']
  loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists app_all on %I', t);
    execute format('create policy app_all on %I for all to anon, authenticated using (true) with check (true)', t);
  end loop;
end $$;

grant select on member_status to anon, authenticated;
grant execute on function staff_login(text,text), member_login(text,text),
  set_password(text,uuid,text), recover_password(text) to anon, authenticated;

-- =====================================================================
-- DATOS INICIALES
-- =====================================================================

-- Admin por defecto: usuario "admin" / contraseña "admin123" (cámbiala)
insert into staff (full_name, email, username, role)
values ('Administrador', 'admin@ironyellow.gym', 'admin', 'admin')
on conflict (username) do nothing;
select set_password('staff', (select id from staff where username = 'admin'), 'admin123')
where not exists (select 1 from credentials c join staff s on s.id = c.owner_id where s.username = 'admin');

insert into plans (name, days, price)
select * from (values
  ('Diario', 1, 3), ('Semanal', 7, 12), ('Quincenal', 15, 20),
  ('Mensual', 30, 35), ('Trimestral', 90, 95), ('Anual', 365, 330)
) v(name, days, price) where not exists (select 1 from plans);

-- wger categories: 8 brazos, 9 piernas, 10 abdomen, 11 pecho, 12 espalda, 13 hombros, 14 pantorrillas, 15 cardio
insert into training_types (name, description, emoji, wger_categories, met) values
  ('Musculación', 'Hipertrofia con pesas y máquinas, cargas progresivas', '💪', '{8,9,10,11,12,13,14}', 5.0),
  ('Cardio', 'Cinta, bici, elíptica, remo: resistencia aeróbica', '🫀', '{15}', 7.0),
  ('Streetlifting', 'Fuerza con lastre: dominadas, fondos, muscle-up y sentadilla', '🔗', '{8,12,11,9}', 6.0),
  ('Powerlifting', 'Sentadilla, press banca y peso muerto a máxima fuerza', '🏋️', '{9,11,12}', 6.0),
  ('Halterofilia', 'Arranque y envión olímpicos, potencia y técnica', '🥇', '{9,13,12}', 6.0),
  ('CrossFit / Funcional', 'Movimientos funcionales a alta intensidad, WODs', '🔥', '{9,10,11,12,13,15}', 8.0),
  ('Calistenia', 'Peso corporal: control, fuerza relativa y skills', '🤸', '{8,10,11,12}', 5.5),
  ('HIIT', 'Intervalos de alta intensidad con descansos cortos', '⚡', '{15,9,10}', 8.0),
  ('Boxeo', 'Técnica de golpeo, saco, manoplas y acondicionamiento', '🥊', '{15,10,13}', 9.0),
  ('Kickboxing / Muay Thai', 'Golpes de puño, patadas, rodillas y codos', '🦵', '{15,9,10}', 9.5),
  ('Spinning / Ciclismo indoor', 'Clases de bici con intervalos y música', '🚴', '{15,9}', 8.5),
  ('Yoga', 'Movilidad, flexibilidad, respiración y equilibrio', '🧘', '{10}', 3.0),
  ('Pilates', 'Core, postura y control del movimiento', '🌀', '{10}', 3.5),
  ('TRX / Suspensión', 'Entrenamiento en suspensión con peso corporal', '🪢', '{10,12,11}', 5.0),
  ('Movilidad y estiramiento', 'Rango articular, recuperación y prevención de lesiones', '🦴', '{}', 2.5),
  ('Baile / Zumba', 'Cardio coreografiado y divertido', '💃', '{15}', 6.5)
on conflict (name) do nothing;

insert into exercises (name, muscle_group, training_type, description, default_sets, default_reps, default_work_sec, default_rest_sec)
select * from (values
  ('Press banca', 'Pecho', 'Musculación', 'Barra al pecho, escápulas retraídas', 4, 10, 40, 90),
  ('Press inclinado mancuernas', 'Pecho', 'Musculación', 'Banco a 30°', 4, 12, 40, 75),
  ('Aperturas en polea', 'Pecho', 'Musculación', 'Cruce de poleas', 3, 15, 35, 60),
  ('Dominadas', 'Espalda', 'Streetlifting', 'Agarre prono, pecho a la barra', 4, 8, 35, 120),
  ('Remo con barra', 'Espalda', 'Musculación', 'Torso a 45°, tira hacia el ombligo', 4, 10, 40, 90),
  ('Jalón al pecho', 'Espalda', 'Musculación', 'Polea alta, agarre amplio', 4, 12, 40, 75),
  ('Sentadilla', 'Piernas', 'Powerlifting', 'Profundidad paralela o más', 5, 5, 40, 150),
  ('Peso muerto', 'Espalda', 'Powerlifting', 'Columna neutra, empuja el suelo', 5, 5, 40, 180),
  ('Prensa de piernas', 'Piernas', 'Musculación', 'Pies a la anchura de hombros', 4, 12, 45, 90),
  ('Zancadas', 'Piernas', 'Musculación', 'Paso largo, rodilla trasera cerca del suelo', 3, 12, 45, 60),
  ('Press militar', 'Hombros', 'Musculación', 'De pie, core activo', 4, 8, 40, 90),
  ('Elevaciones laterales', 'Hombros', 'Musculación', 'Codos ligeramente flexionados', 3, 15, 35, 45),
  ('Curl de bíceps', 'Brazos', 'Musculación', 'Sin balanceo', 3, 12, 35, 60),
  ('Fondos en paralelas', 'Brazos', 'Streetlifting', 'Con o sin lastre', 4, 10, 35, 90),
  ('Extensión de tríceps en polea', 'Brazos', 'Musculación', 'Codos pegados', 3, 15, 35, 45),
  ('Plancha', 'Abdomen', 'Calistenia', 'Cuerpo alineado', 3, 1, 60, 30),
  ('Crunch en polea', 'Abdomen', 'Musculación', 'Flexiona la columna', 3, 15, 35, 45),
  ('Elevación de talones', 'Pantorrillas', 'Musculación', 'Pausa arriba', 4, 15, 35, 45),
  ('Cinta (trote)', 'Cardio', 'Cardio', 'Ritmo conversacional', 1, 1, 1200, 0),
  ('Burpees', 'Cardio', 'HIIT', 'Explosivo', 5, 15, 40, 20),
  ('Saco: combinaciones 1-2-3', 'Cardio', 'Boxeo', 'Jab, cruzado, gancho', 6, 1, 180, 60),
  ('Muscle-up', 'Espalda', 'Streetlifting', 'Transición explosiva', 4, 5, 30, 120)
) v(name, muscle_group, training_type, description, default_sets, default_reps, default_work_sec, default_rest_sec)
where not exists (select 1 from exercises);
