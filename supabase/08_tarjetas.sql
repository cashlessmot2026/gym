-- IronYellow Gym · Tarjetas de fidelidad para clientes temporales
-- Ejecutar en Supabase → SQL Editor (una sola vez). Es seguro repetirlo.
--
-- Reglas:
--   · Plan 7 días  → sin obsequio. Al confirmar el día 7 la tarjeta termina y se elimina.
--   · Plan 14 días → al confirmar el día 14 se regala 1 día. Al usar ese día la tarjeta se elimina.
--   · Un solo día confirmado cada 12 horas por tarjeta.
--   · Para que el cliente siga, el admin crea una tarjeta nueva.

create table if not exists loyalty_cards (
  id uuid primary key default gen_random_uuid(),
  token uuid not null unique default gen_random_uuid(),   -- link privado del cliente (/tarjeta/<token>)
  code text not null unique,                              -- código público: va en el QR
  full_name text not null,
  phone text,
  plan_days int not null check (plan_days in (7, 14)),
  days_done int not null default 0,
  gift_days int not null default 0,                       -- días de regalo disponibles (0 o 1)
  price numeric,                                          -- lo que pagó (opcional)
  created_by uuid references staff(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists loyalty_visits (
  id bigint generated always as identity primary key,
  card_id uuid not null references loyalty_cards(id) on delete cascade,
  kind text not null default 'dia',                       -- dia | regalo
  note text,
  staff_id uuid references staff(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists idx_loyalty_visits_card on loyalty_visits(card_id, created_at desc);

-- ---------- Confirmar un día pagado ----------
create or replace function loyalty_confirm_day(p_code text, p_staff uuid default null)
returns json language plpgsql security definer set search_path = public as $$
declare v loyalty_cards; last_at timestamptz; n int; done boolean;
begin
  select * into v from loyalty_cards
   where code = upper(trim(p_code)) or token::text = trim(p_code) or id::text = trim(p_code)
   for update;
  if not found then raise exception 'Tarjeta no encontrada'; end if;
  if v.days_done >= v.plan_days then raise exception 'La tarjeta de % ya completó sus % días', v.full_name, v.plan_days; end if;
  select max(created_at) into last_at from loyalty_visits where card_id = v.id and kind = 'dia';
  if last_at is not null and last_at > now() - interval '12 hours' then
    raise exception 'El día de % ya fue confirmado hoy', v.full_name;
  end if;
  n := v.days_done + 1;
  done := n = v.plan_days;
  -- Plan 7: termina sin obsequio y se elimina.
  if done and v.plan_days = 7 then
    delete from loyalty_cards where id = v.id;
    return json_build_object('name', v.full_name, 'day', n, 'plan_days', v.plan_days, 'gift', 0, 'closed', true);
  end if;
  update loyalty_cards set days_done = n, gift_days = case when done then 1 else gift_days end
   where id = v.id returning * into v;
  insert into loyalty_visits(card_id, kind, note, staff_id)
  values (v.id, 'dia', 'Día ' || n || ' de ' || v.plan_days || case when done then ' · +1 día de regalo' else '' end, p_staff);
  return json_build_object('name', v.full_name, 'day', n, 'plan_days', v.plan_days,
                           'gift', case when done then 1 else 0 end, 'closed', false);
end $$;

-- ---------- Usar el día de regalo (cierra y elimina la tarjeta) ----------
create or replace function loyalty_use_gift(p_code text, p_staff uuid default null)
returns json language plpgsql security definer set search_path = public as $$
declare v loyalty_cards;
begin
  select * into v from loyalty_cards
   where code = upper(trim(p_code)) or token::text = trim(p_code) or id::text = trim(p_code)
   for update;
  if not found then raise exception 'Tarjeta no encontrada'; end if;
  if v.gift_days < 1 then raise exception '% no tiene día de regalo disponible', v.full_name; end if;
  delete from loyalty_cards where id = v.id;
  return json_build_object('name', v.full_name, 'closed', true);
end $$;

-- ---------- Permisos (mismo modelo que el resto: anon key) ----------
do $$
declare t text;
begin
  foreach t in array array['loyalty_cards','loyalty_visits'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists app_all on %I', t);
    execute format('create policy app_all on %I for all to anon, authenticated using (true) with check (true)', t);
  end loop;
end $$;
grant execute on function loyalty_confirm_day(text, uuid), loyalty_use_gift(text, uuid) to anon, authenticated;

-- La tarjeta del cliente se actualiza sola cuando recepción confirma un día
do $$ begin alter publication supabase_realtime add table loyalty_cards; exception when others then null; end $$;
