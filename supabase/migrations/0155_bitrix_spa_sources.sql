-- Versão: 1.0 | Data: 11/10/2026
-- 0155 — PROCESSOS INTELIGENTES do Bitrix como Bases de Sync.
--
-- Até a 0154 o sync só conhecia lead e negócio. Os Processos Inteligentes
-- (Smart Process Automation, `crm.item.*`) são uma terceira família ABERTA —
-- um entityTypeId por processo criado no portal. Esta migração:
--
--   1. marca a Base como SPA (`data_sources.bitrix_entity_type_id`) e guarda a
--      configuração APROVADA dela (`bitrix_spa_config`: campos incluídos,
--      rótulos, funis) + o carimbo da carga inicial (`bitrix_spa_loaded_at`);
--   2. abre as três colunas de entidade (`data_sources.bitrix_activity_owner`,
--      `bitrix_task_queue.owner_entity`, `bitrix_writeback_queue.entity`) para
--      `dynamic_<entityTypeId>` — o vocabulário único vive em
--      lib/sync/bitrix/entities.ts;
--   3. cria a TRIAGEM (`sync_source_requests`): nada vira Base direto. O
--      processo é descoberto pelo nome, avaliado por amostra, SOLICITADO,
--      ajustado e só então APROVADO (Registros → Novas bases de Sync).
--
-- IDENTIDADE: o `records.source_id` de item SPA é PREFIXADO pelo tipo
-- ("<entityTypeId>:<id>") — `uq_records_source (source_system, source_id)`
-- faria o item 5 de um processo sobrescrever o lead/negócio 5. Nenhuma coluna
-- nova em `records`; nenhum RPC de widget recriado.
-- Idempotente.

-- ============ 1. Base de processo inteligente ============
alter table public.data_sources
  add column if not exists bitrix_entity_type_id int
    check (bitrix_entity_type_id is null or bitrix_entity_type_id > 0),
  add column if not exists bitrix_spa_config jsonb,
  add column if not exists bitrix_spa_loaded_at timestamptz;

-- Um processo vira no máximo UMA Base por organização.
create unique index if not exists uq_data_sources_spa_type
  on public.data_sources (organization_id, bitrix_entity_type_id)
  where bitrix_entity_type_id is not null;

comment on column public.data_sources.bitrix_entity_type_id is
  'entityTypeId do Processo Inteligente do Bitrix de onde os registros desta Base vêm (crm.item.*). NULL = não é SPA.';
comment on column public.data_sources.bitrix_spa_config is
  'Configuração APROVADA da Base SPA (campos incluídos/rótulos/funis) — parse fail-closed em lib/sync/bitrix/spa-config.ts.';
comment on column public.data_sources.bitrix_spa_loaded_at is
  'Quando a carga inicial completa (todos os itens) terminou. NULL = o próximo job lê o processo inteiro.';

-- ============ 2. Entidades abertas a dynamic_<id> ============
alter table public.data_sources
  drop constraint if exists data_sources_activity_owner_check;
alter table public.data_sources
  add constraint data_sources_activity_owner_check
    check (bitrix_activity_owner ~ '^(deal|lead|dynamic_[1-9][0-9]*)$');

do $$
declare c record;
begin
  for c in
    select conname, conrelid::regclass::text as rel
      from pg_constraint
     where contype = 'c'
       and (
         (conrelid = 'public.bitrix_task_queue'::regclass
           and pg_get_constraintdef(oid) ilike '%owner_entity%')
         or (conrelid = 'public.bitrix_writeback_queue'::regclass
           and pg_get_constraintdef(oid) ilike '%entity%'
           and pg_get_constraintdef(oid) not ilike '%status%')
       )
  loop
    execute format('alter table %s drop constraint %I', c.rel, c.conname);
  end loop;
end $$;

alter table public.bitrix_task_queue
  add constraint bitrix_task_queue_owner_entity_check
    check (owner_entity ~ '^(deal|lead|dynamic_[1-9][0-9]*)$');
alter table public.bitrix_writeback_queue
  add constraint bitrix_writeback_queue_entity_check
    check (entity ~ '^(deal|lead|dynamic_[1-9][0-9]*)$');

-- ============ 3. Triagem: solicitações de nova Base de Sync ============
create table if not exists public.sync_source_requests (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null default '00000000-0000-4000-a000-000000000001'
                    references public.organizations (id) on delete cascade,
  -- Origem: hoje só o Bitrix (processo inteligente). O campo deixa a porta
  -- aberta para outras origens de Sync sem outra tabela.
  provider        text not null default 'bitrix_spa'
                    check (provider in ('bitrix_spa')),
  entity_type_id  int not null check (entity_type_id > 0),
  -- Nome do processo NO PORTAL no momento da solicitação (para a lista).
  title           text not null,
  status          text not null default 'pending'
                    check (status in ('pending', 'approved', 'rejected')),
  -- Ajustes do usuário antes de aprovar (nome/chave da Base, campos,
  -- período, fuso, espelho de atividades, funis).
  config          jsonb not null default '{}'::jsonb,
  note            text,
  source_key      text references public.data_sources (key) on delete set null,
  requested_by    uuid references auth.users (id) on delete set null,
  decided_by      uuid references auth.users (id) on delete set null,
  decided_at      timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- Uma solicitação ABERTA por processo e org (aprovada/rejeitada podem
-- coexistir no histórico).
create unique index if not exists uq_sync_source_requests_pending
  on public.sync_source_requests (organization_id, provider, entity_type_id)
  where status = 'pending';

alter table public.sync_source_requests enable row level security;

drop policy if exists sync_source_requests_admin on public.sync_source_requests;
create policy sync_source_requests_admin on public.sync_source_requests
  for all to authenticated
  using (
    organization_id in (select public.auth_org_ids())
    and (select public.auth_has_role('admin'))
  )
  with check (
    organization_id in (select public.auth_org_ids())
    and (select public.auth_has_role('admin'))
  );

comment on table public.sync_source_requests is
  'Triagem de novas Bases de Sync (0155): processo descoberto → amostra → solicitação ajustável → aprovação, que cria a data_sources.';
