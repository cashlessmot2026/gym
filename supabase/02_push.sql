-- =====================================================================
-- IronYellow Gym · Notificaciones push y promociones
-- Ejecutar DESPUÉS de schema.sql (SQL Editor > New query > Run)
-- =====================================================================

-- Dispositivos suscritos (Web Push en navegador/PWA o token FCM en Android nativo)
create table if not exists push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  member_id uuid references members(id) on delete cascade,
  platform text not null default 'web' check (platform in ('web','android','ios')),
  endpoint text unique not null,       -- endpoint Web Push o token FCM
  p256dh text,
  auth text,
  user_agent text,
  created_at timestamptz not null default now(),
  last_seen timestamptz not null default now()
);
create index if not exists idx_push_member on push_subscriptions(member_id);

-- Promociones / notificaciones enviadas por el admin
create table if not exists notifications (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  body text not null,
  image_url text,
  url text default '/',
  category text default 'promo' check (category in ('promo','publicidad','aviso','evento','recordatorio')),
  audience jsonb not null default '{"type":"all"}',
  recipients uuid[],                   -- null = todos los clientes
  sent_count int default 0,
  failed_count int default 0,
  devices_count int default 0,
  status text default 'pendiente' check (status in ('pendiente','enviando','enviada','error')),
  error text,
  created_by uuid references staff(id) on delete set null,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
create index if not exists idx_notif_created on notifications(created_at desc);

alter table push_subscriptions enable row level security;
alter table notifications enable row level security;
drop policy if exists app_all on push_subscriptions;
create policy app_all on push_subscriptions for all to anon, authenticated using (true) with check (true);
drop policy if exists app_all on notifications;
create policy app_all on notifications for all to anon, authenticated using (true) with check (true);

-- Realtime: la app abierta recibe las notificaciones al instante
do $$ begin
  alter publication supabase_realtime add table notifications;
exception when duplicate_object then null; end $$;

-- Bucket público para imágenes de promociones
insert into storage.buckets (id, name, public)
values ('promos', 'promos', true)
on conflict (id) do nothing;

drop policy if exists promos_read on storage.objects;
create policy promos_read on storage.objects for select to anon, authenticated using (bucket_id = 'promos');
drop policy if exists promos_write on storage.objects;
create policy promos_write on storage.objects for insert to anon, authenticated with check (bucket_id = 'promos');
