-- IronYellow Gym · Tienda virtual
-- Ejecutar en Supabase → SQL Editor (una sola vez). Es seguro repetirlo.

-- ---------- Categorías ----------
create table if not exists store_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  emoji text default '🛒',
  sort int not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- ---------- Productos ----------
create table if not exists store_products (
  id uuid primary key default gen_random_uuid(),
  category_id uuid references store_categories(id) on delete set null,
  name text not null,
  description text,
  price numeric not null default 0,          -- precio de venta
  list_price numeric,                         -- valor anterior / de lista (se muestra tachado)
  image_id text,                              -- "r2:tienda/xxx.jpg" (Cloudflare R2)
  pay_url text,                               -- link de pago de este producto
  active boolean not null default true,
  sort int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists idx_store_products_cat on store_products(category_id, sort);

-- ---------- Ajustes de la tienda (p. ej. link de pago general) ----------
create table if not exists store_settings (
  key text primary key,
  value text
);
insert into store_settings(key, value) values ('default_pay_url', '') on conflict do nothing;

-- ---------- Categorías iniciales ----------
insert into store_categories(name, emoji, sort) values
  ('Proteínas y suplementos', '🥤', 1),
  ('Accesorios', '🧤', 2),
  ('Elementos de gym', '🏋️', 3)
on conflict (name) do nothing;

-- ---------- Permisos (mismo modelo que el resto: anon key) ----------
do $$
declare t text;
begin
  foreach t in array array['store_categories','store_products','store_settings'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists app_all on %I', t);
    execute format('create policy app_all on %I for all to anon, authenticated using (true) with check (true)', t);
  end loop;
end $$;

do $$ begin alter publication supabase_realtime add table store_products; exception when others then null; end $$;
