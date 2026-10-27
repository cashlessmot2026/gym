-- Mercury Fitness Club · Recordatorio diario de rutina (push)
-- Ejecutar en Supabase → SQL Editor (una sola vez). Es seguro repetirlo.
--
-- · Cada inicio de sesión del cliente (login o abrir la app) queda en member_logins.
-- · members.last_login_at guarda el último; su hora es la hora del recordatorio.
-- · La función "routine-reminders" (cada 5 min) avisa una vez al día a esa hora
--   a quien no ha entrado ni entrenado ese día.
-- Requiere desplegar:  supabase functions deploy routine-reminders --no-verify-jwt

create table if not exists member_logins (
  id bigint generated always as identity primary key,
  member_id uuid not null references members(id) on delete cascade,
  at timestamptz not null default now(),
  source text not null default 'app'          -- login | app
);
create index if not exists member_logins_member_idx on member_logins (member_id, at desc);

alter table members add column if not exists last_login_at timestamptz;
alter table members add column if not exists routine_reminders boolean not null default true;

create or replace function member_logins_touch() returns trigger language plpgsql security definer as $$
begin
  update members set last_login_at = new.at where id = new.member_id and (last_login_at is null or last_login_at < new.at);
  return new;
end $$;
drop trigger if exists member_logins_touch on member_logins;
create trigger member_logins_touch after insert on member_logins for each row execute function member_logins_touch();

-- Un recordatorio por cliente y por día
create table if not exists routine_reminders (
  member_id uuid not null references members(id) on delete cascade,
  date date not null,
  sent_at timestamptz not null default now(),
  primary key (member_id, date)
);

-- Mismo modelo de acceso que el resto de la app
do $$ declare t text; begin
  foreach t in array array['member_logins', 'routine_reminders'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists app_all on %I', t);
    execute format('create policy app_all on %I for all to anon, authenticated using (true) with check (true)', t);
  end loop;
end $$;

-- Programador: cada 5 minutos
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;
do $$ begin perform cron.unschedule('routine-reminders'); exception when others then null; end $$;
select cron.schedule(
  'routine-reminders',
  '*/5 * * * *',
  $cron$
    select net.http_post(
      url := 'https://bjctrivmobbilxvyopul.supabase.co/functions/v1/routine-reminders',
      headers := '{"Content-Type": "application/json"}'::jsonb,
      body := '{}'::jsonb
    );
  $cron$
);

notify pgrst, 'reload schema';
