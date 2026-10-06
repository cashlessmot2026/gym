-- =====================================================================
-- IronYellow Gym · Clases grupales (Box y otras), horarios, grupos,
-- reservas/asistencia y alertas push 10 minutos antes.
-- Ejecutar DESPUÉS de 01..03 (SQL Editor > New query > Run)
-- =====================================================================

-- Clase = grupo de entrenamiento (p. ej. "Box Principiantes")
create table if not exists gym_classes (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  training_type text not null default 'Boxeo',
  coach_id uuid references staff(id) on delete set null,
  description text,
  capacity int not null default 20,
  room text,
  color text default '#FFD60A',
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- Horarios semanales (weekday: 0=Domingo ... 6=Sábado), hora local del gimnasio
create table if not exists class_schedules (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references gym_classes(id) on delete cascade,
  weekday int not null check (weekday between 0 and 6),
  start_time time not null,
  duration_min int not null default 60,
  coach_id uuid references staff(id) on delete set null,   -- opcional: coach distinto ese día
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (class_id, weekday, start_time)
);
create index if not exists idx_sched_day on class_schedules(weekday, start_time);

-- Grupo de clientes fijos de la clase
create table if not exists class_members (
  class_id uuid references gym_classes(id) on delete cascade,
  member_id uuid references members(id) on delete cascade,
  added_at timestamptz not null default now(),
  primary key (class_id, member_id)
);

-- Reservas y asistencia por fecha
create table if not exists class_bookings (
  id uuid primary key default gen_random_uuid(),
  schedule_id uuid not null references class_schedules(id) on delete cascade,
  class_id uuid not null references gym_classes(id) on delete cascade,
  member_id uuid not null references members(id) on delete cascade,
  date date not null,
  status text not null default 'reservado' check (status in ('reservado','asistio','cancelado')),
  checked_in_at timestamptz,
  created_at timestamptz not null default now(),
  unique (schedule_id, member_id, date)
);
create index if not exists idx_book_date on class_bookings(date, schedule_id);

-- Control para no repetir alertas
create table if not exists class_reminders (
  schedule_id uuid references class_schedules(id) on delete cascade,
  date date not null,
  sent_at timestamptz not null default now(),
  primary key (schedule_id, date)
);

-- Push también para el personal (coaches)
alter table push_subscriptions add column if not exists staff_id uuid references staff(id) on delete cascade;
create index if not exists idx_push_staff on push_subscriptions(staff_id);

-- Nueva categoría de notificación: alerta de clase
alter table notifications drop constraint if exists notifications_category_check;
alter table notifications add constraint notifications_category_check
  check (category in ('promo','publicidad','aviso','evento','recordatorio','clase'));

do $$
declare t text;
begin
  foreach t in array array['gym_classes','class_schedules','class_members','class_bookings','class_reminders'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists app_all on %I', t);
    execute format('create policy app_all on %I for all to anon, authenticated using (true) with check (true)', t);
  end loop;
end $$;

do $$ begin alter publication supabase_realtime add table class_bookings; exception when others then null; end $$;

-- =====================================================================
-- Programador: cada minuto llama a la función "class-reminders", que envía
-- la alerta push a los clientes y al coach 10 minutos antes de cada clase.
-- Requiere desplegar la función:  supabase functions deploy class-reminders --no-verify-jwt
-- =====================================================================
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

do $$ begin perform cron.unschedule('class-reminders'); exception when others then null; end $$;
select cron.schedule(
  'class-reminders',
  '* * * * *',
  $cron$
    select net.http_post(
      url := 'https://bjctrivmobbilxvyopul.supabase.co/functions/v1/class-reminders',
      headers := '{"Content-Type": "application/json"}'::jsonb,
      body := '{}'::jsonb
    );
  $cron$
);
