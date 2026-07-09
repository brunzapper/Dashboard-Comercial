-- Versão: 1.0 | Data: 09/07/2026
-- Fase 8: correspondências de colunas GLOBAIS (compartilhadas entre todos os
-- dashboards). Um "campo unificado" (field_correspondences) agrupa colunas
-- equivalentes de fontes diferentes (field_correspondence_members) para que o
-- construtor de widgets possa tratá-las como a mesma coluna nos cálculos.
--   field_ref = coluna do núcleo (ex.: 'mrr') ou 'custom:<field_key>'.
-- Leitura liberada a todo autenticado (é config global); escrita exige
-- manage_field_definitions (mesma permissão de Campos). Idempotente.

create table if not exists public.field_correspondences (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  label text not null,
  data_type text not null default 'texto'
    check (data_type in ('texto', 'numero', 'data', 'selecao', 'moeda', 'booleano', 'calculado')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.field_correspondence_members (
  id uuid primary key default gen_random_uuid(),
  correspondence_id uuid not null
    references public.field_correspondences (id) on delete cascade,
  record_type text not null check (record_type in ('lead', 'negocio', 'venda_site')),
  field_ref text not null,           -- coluna do núcleo ou 'custom:<key>'
  created_at timestamptz not null default now(),
  unique (correspondence_id, record_type)
);

create index if not exists idx_fc_members_correspondence
  on public.field_correspondence_members (correspondence_id);

drop trigger if exists trg_field_correspondences_updated_at on public.field_correspondences;
create trigger trg_field_correspondences_updated_at
  before update on public.field_correspondences
  for each row execute function public.set_updated_at();

-- ============ RLS ============
alter table public.field_correspondences        enable row level security;
alter table public.field_correspondence_members enable row level security;

-- field_correspondences: leitura p/ autenticados; escrita = manage_field_definitions.
drop policy if exists field_correspondences_select on public.field_correspondences;
create policy field_correspondences_select on public.field_correspondences
  for select to authenticated using (true);

drop policy if exists field_correspondences_write on public.field_correspondences;
create policy field_correspondences_write on public.field_correspondences
  for all to authenticated
  using (public.auth_has_permission('manage_field_definitions'))
  with check (public.auth_has_permission('manage_field_definitions'));

-- members: mesma regra.
drop policy if exists fc_members_select on public.field_correspondence_members;
create policy fc_members_select on public.field_correspondence_members
  for select to authenticated using (true);

drop policy if exists fc_members_write on public.field_correspondence_members;
create policy fc_members_write on public.field_correspondence_members
  for all to authenticated
  using (public.auth_has_permission('manage_field_definitions'))
  with check (public.auth_has_permission('manage_field_definitions'));
