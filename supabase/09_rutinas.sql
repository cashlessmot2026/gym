-- Mercury Fitness Club · Rutinas del gym (reemplazan a las clases)
-- Ejecutar en Supabase → SQL Editor (una sola vez). Es seguro repetirlo.
--
-- · El admin o el coach publican rutinas por día de la semana (weekdays vacío = cualquier día).
-- · Todos los clientes ven las rutinas publicadas y pueden empezarlas.
-- · Cada sesión y cada ejercicio quedan guardados con la rutina de la que salieron.
-- · Las tablas de clases (04_clases.sql) no se borran: la app simplemente deja de usarlas.

alter table routines add column if not exists weekdays int[] not null default '{}';
alter table routines add column if not exists published boolean not null default true;
alter table routines add column if not exists level text;              -- principiante | intermedio | avanzado
alter table routines add column if not exists updated_at timestamptz not null default now();
-- items: [{exercise_id, sets, reps, work_sec, rest_sec, weight, notes}]

alter table workout_sessions add column if not exists routine_id uuid references routines(id) on delete set null;
alter table workout_sessions add column if not exists routine_name text;

alter table workout_logs add column if not exists routine_id uuid references routines(id) on delete set null;
alter table workout_logs add column if not exists item_index int;

create index if not exists workout_sessions_routine_idx on workout_sessions (routine_id);
create index if not exists workout_logs_member_ex_idx on workout_logs (member_id, exercise_id, date desc);
create index if not exists routines_published_idx on routines (published);

-- Mismo modelo de acceso que el resto de la app
alter table routines enable row level security;
drop policy if exists app_all on routines;
create policy app_all on routines for all to anon, authenticated using (true) with check (true);

-- Sin clases: se apaga el aviso automático de "tu clase empieza en 10 minutos"
do $$ begin perform cron.unschedule('class-reminders'); exception when others then null; end $$;

notify pgrst, 'reload schema';
