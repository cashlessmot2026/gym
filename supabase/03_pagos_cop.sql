-- =====================================================================
-- IronYellow Gym · Comprobantes de transferencia y moneda COP
-- Ejecutar DESPUÉS de schema.sql y 02_push.sql (SQL Editor > New query > Run)
-- =====================================================================

-- Comprobante y referencia en cada membresía registrada por el admin
alter table memberships add column if not exists proof_path text;
alter table memberships add column if not exists payment_ref text;

-- Comprobantes enviados por los clientes desde su perfil (renovación por transferencia)
create table if not exists payment_proofs (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references members(id) on delete cascade,
  plan_id uuid references plans(id) on delete set null,
  plan_name text,
  amount numeric default 0,
  reference text,
  proof_path text not null,
  status text not null default 'pendiente' check (status in ('pendiente','aprobado','rechazado')),
  notes text,
  membership_id uuid references memberships(id) on delete set null,
  reviewed_by uuid references staff(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists idx_proofs_status on payment_proofs(status, created_at desc);
create index if not exists idx_proofs_member on payment_proofs(member_id, created_at desc);

alter table payment_proofs enable row level security;
drop policy if exists app_all on payment_proofs;
create policy app_all on payment_proofs for all to anon, authenticated using (true) with check (true);

-- Bucket PRIVADO para comprobantes (se ven con enlaces firmados temporales)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('comprobantes', 'comprobantes', false, 8388608, array['image/jpeg','image/png','image/webp','image/heic','application/pdf'])
on conflict (id) do nothing;

drop policy if exists comprobantes_read on storage.objects;
create policy comprobantes_read on storage.objects for select to anon, authenticated using (bucket_id = 'comprobantes');
drop policy if exists comprobantes_write on storage.objects;
create policy comprobantes_write on storage.objects for insert to anon, authenticated with check (bucket_id = 'comprobantes');

-- Precios en pesos colombianos: sólo se actualizan los planes que siguen con los
-- valores iniciales de ejemplo (en dólares). Ajústalos luego en /admin > Planes.
update plans set price = case days
    when 1 then 10000 when 7 then 40000 when 15 then 70000
    when 30 then 120000 when 90 then 330000 when 365 then 1200000 else price end
where price < 1000;
