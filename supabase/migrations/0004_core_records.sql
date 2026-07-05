-- Versão: 1.0 | Data: 04/07/2026
-- Núcleo `records`: fonte de verdade da UI. Fontes externas alimentam esta
-- tabela; a UI nunca lê as fontes diretamente. Campos locais (temperature e,
-- via field_definitions is_local, Forecast/Status/Ações/Check) nunca vêm de sync.
-- Idempotente.

create table if not exists public.records (
  id uuid primary key default gen_random_uuid(),
  record_type text not null check (record_type in ('lead', 'negocio', 'venda_site')),
  source_system text not null check (source_system in ('bitrix', 'sheet_site', 'manual')),
  source_id text,
  owner_user_id uuid references auth.users (id) on delete set null,
  title text,
  pipeline text,
  stage text,
  stage_semantic text,            -- open | won | lose (derivado de STAGE_SEMANTIC_ID)
  temperature text,               -- campo LOCAL do app (nunca sincronizado)
  value numeric,
  mrr numeric,
  currency text,
  sale_type text,
  channel text,
  closed boolean not null default false,
  closed_at timestamptz,
  opened_at timestamptz,
  source_created_at timestamptz,  -- DATE_CREATE na origem
  source_modified_at timestamptz, -- DATE_MODIFY na origem
  custom_fields jsonb not null default '{}'::jsonb,
  field_modified_at jsonb not null default '{}'::jsonb, -- {campo: timestamp} de edições manuais
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_synced_at timestamptz,
  locally_modified_at timestamptz
);

-- Chave natural por origem (nulls distintos permitem múltiplos manuais sem source_id).
create unique index if not exists uq_records_source
  on public.records (source_system, source_id);
create index if not exists idx_records_owner on public.records (owner_user_id);
create index if not exists idx_records_type on public.records (record_type);
create index if not exists idx_records_stage on public.records (stage);
create index if not exists idx_records_closed_at on public.records (closed_at);
create index if not exists idx_records_custom_fields on public.records using gin (custom_fields);

drop trigger if exists trg_records_updated_at on public.records;
create trigger trg_records_updated_at
  before update on public.records
  for each row execute function public.set_updated_at();
