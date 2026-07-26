-- 0106_source_auto_operations.sql
-- Versão: 1.0 | Data: 26/07/2026
-- Parcerias (fase B): SUB-OPERAÇÕES AUTOMÁTICAS por registro de uma base.
-- `source_auto_operations` guarda a config (1 por base): cada registro da base
-- (ex.: Parceiros) materializa uma sub-operação sob a operação-pai, com perfil
-- gerado `[{ field: target_field (ref no LEAD), op: profile_op, value: valor
-- do value_field no registro PARCEIRO, sources: target_sources }]`. A rotina
-- (lib/operations/auto-operations.ts, service role) roda nos ganchos de
-- ingestão (CSV/API/criação manual) e no botão da tela de Fontes.
-- Identidade da sub-operação = operations.auto_source_record_id (rename do
-- parceiro renomeia a MESMA operação; sumiu da base → active=false, nunca
-- delete — goals/vínculos/snapshots podem referenciar).
-- Config em TABELA (não jsonb em data_sources): FKs derrubam a config junto
-- com a fonte/pai — uuid pendurado em jsonb falharia opaco na rotina.
-- Idempotente.

create table if not exists public.source_auto_operations (
  source_key text primary key
    references public.data_sources (key) on delete cascade,
  parent_operation_id uuid not null
    references public.operations (id) on delete cascade,
  -- Ref no registro da BASE (núcleo ou custom:<key>) que dá o NOME da sub-op.
  name_field text not null default 'title',
  -- Ref no registro da BASE com o IDENTIFICADOR gravado no lead (o valor do
  -- perfil), ex.: custom:email.
  value_field text not null default 'title',
  -- Ref no LEAD comparado pelo perfil, ex.: custom:bitrix_uf_crm_1784828550.
  target_field text not null,
  -- Fontes-alvo do perfil (source keys; vazio = todas as fontes do widget).
  target_sources text[] not null default '{}',
  profile_op text not null default 'eq_ci' check (profile_op in ('eq', 'eq_ci')),
  enabled boolean not null default true,
  organization_id uuid not null default '00000000-0000-4000-a000-000000000001'
    references public.organizations (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_source_auto_operations_updated on public.source_auto_operations;
create trigger trg_source_auto_operations_updated
  before update on public.source_auto_operations
  for each row execute function public.set_updated_at();

create index if not exists idx_source_auto_operations_org
  on public.source_auto_operations (organization_id);

alter table public.source_auto_operations enable row level security;

-- Espelho das policies de operations (0091): leitura da org; escrita admin.
drop policy if exists source_auto_operations_select on public.source_auto_operations;
create policy source_auto_operations_select on public.source_auto_operations
  for select to authenticated
  using (organization_id in (select public.auth_org_ids()));

drop policy if exists source_auto_operations_write on public.source_auto_operations;
create policy source_auto_operations_write on public.source_auto_operations
  for all to authenticated
  using (
    organization_id in (select public.auth_org_ids())
    and (select public.auth_has_role('admin'))
  )
  with check (
    organization_id in (select public.auth_org_ids())
    and (select public.auth_has_role('admin'))
  );

-- Vínculo sub-operação -> registro de origem (identidade da geração).
alter table public.operations
  add column if not exists auto_source_record_id uuid
    references public.records (id) on delete set null;

create unique index if not exists uq_operations_auto_source
  on public.operations (auto_source_record_id)
  where auto_source_record_id is not null;
