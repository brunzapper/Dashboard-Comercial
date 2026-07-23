-- Versão: 1.0 | Data: 23/07/2026
-- MULTI-ORGANIZAÇÃO (colunas): adiciona `organization_id` às tabelas-RAIZ de
-- cada domínio, com `not null default <Zapper>` — o ADD COLUMN carimba todo o
-- legado como Zapper sem rewrite (Postgres 11+) e os caminhos service-role da
-- integração Bitrix (exclusiva da Zapper hoje) seguem funcionando sem tocar o
-- sync. Um usuário de OUTRA org que esqueça o carimbo explícito falha ALTO no
-- WITH CHECK da RLS (0091) — nunca vaza linha para a Zapper em silêncio.
--
-- Filhas SEM coluna (derivam da pai na RLS/consulta): sub_sources (via
-- data_sources.parent_key), field_correspondence_members, widgets,
-- dashboard_table_cells, kanban_placements, comments, responsible_operations,
-- snapshots/snapshot_records/snapshot_record_matches (via dashboards),
-- webhook_deliveries/webhook_inbound_events (via endpoint/api_key), currencies/
-- currency_rates e user_* (globais/por usuário).
--
-- Triggers de STAMP (before insert) onde a org é derivável — cobrem TODOS os
-- caminhos de escrita (sync, CSV, API, manual) sem tocar cada um:
--   records ← data_sources (por record_type); audit_log ← records;
--   record_matches ← records (record_a); entity_custom_values ← responsável/
--   operação. O derivado VENCE o valor passado (a org do registro é a da
--   fonte, sempre).
--
-- Unicidades que viram POR-ORG (org nova precisa criar as próprias):
--   field_definitions.field_key, field_correspondences.key, uq_goals_scope,
--   sync_config PK (organization_id, key), non_working_days PK
--   (organization_id, day). `data_sources.key`/`record_type` seguem GLOBAIS
--   (a FK de records em record_type depende disso) — colisão de key entre
--   orgs é resolvida na action de criação de fonte (sufixo).
-- Idempotente. Aplicar após a 0089 e antes da 0091.

-- ===================== Colunas =====================
alter table public.data_sources          add column if not exists organization_id uuid not null default '00000000-0000-4000-a000-000000000001' references public.organizations (id) on delete cascade;
alter table public.field_definitions     add column if not exists organization_id uuid not null default '00000000-0000-4000-a000-000000000001' references public.organizations (id) on delete cascade;
alter table public.field_correspondences add column if not exists organization_id uuid not null default '00000000-0000-4000-a000-000000000001' references public.organizations (id) on delete cascade;
alter table public.dashboards            add column if not exists organization_id uuid not null default '00000000-0000-4000-a000-000000000001' references public.organizations (id) on delete cascade;
alter table public.responsibles          add column if not exists organization_id uuid not null default '00000000-0000-4000-a000-000000000001' references public.organizations (id) on delete cascade;
alter table public.operations            add column if not exists organization_id uuid not null default '00000000-0000-4000-a000-000000000001' references public.organizations (id) on delete cascade;
alter table public.goals                 add column if not exists organization_id uuid not null default '00000000-0000-4000-a000-000000000001' references public.organizations (id) on delete cascade;
alter table public.non_working_days      add column if not exists organization_id uuid not null default '00000000-0000-4000-a000-000000000001' references public.organizations (id) on delete cascade;
alter table public.tasks                 add column if not exists organization_id uuid not null default '00000000-0000-4000-a000-000000000001' references public.organizations (id) on delete cascade;
alter table public.match_rules           add column if not exists organization_id uuid not null default '00000000-0000-4000-a000-000000000001' references public.organizations (id) on delete cascade;
alter table public.api_keys              add column if not exists organization_id uuid not null default '00000000-0000-4000-a000-000000000001' references public.organizations (id) on delete cascade;
alter table public.webhook_endpoints     add column if not exists organization_id uuid not null default '00000000-0000-4000-a000-000000000001' references public.organizations (id) on delete cascade;
alter table public.webhook_events        add column if not exists organization_id uuid not null default '00000000-0000-4000-a000-000000000001' references public.organizations (id) on delete cascade;
alter table public.sync_config           add column if not exists organization_id uuid not null default '00000000-0000-4000-a000-000000000001' references public.organizations (id) on delete cascade;
alter table public.entity_custom_values  add column if not exists organization_id uuid not null default '00000000-0000-4000-a000-000000000001' references public.organizations (id) on delete cascade;
alter table public.records               add column if not exists organization_id uuid not null default '00000000-0000-4000-a000-000000000001' references public.organizations (id) on delete cascade;
alter table public.audit_log             add column if not exists organization_id uuid not null default '00000000-0000-4000-a000-000000000001' references public.organizations (id) on delete cascade;
alter table public.record_matches        add column if not exists organization_id uuid not null default '00000000-0000-4000-a000-000000000001' references public.organizations (id) on delete cascade;
-- Encanamento Bitrix (exclusivo da Zapper hoje — default cobre tudo):
alter table public.bitrix_user_map       add column if not exists organization_id uuid not null default '00000000-0000-4000-a000-000000000001' references public.organizations (id) on delete cascade;
alter table public.bitrix_lookup_cache   add column if not exists organization_id uuid not null default '00000000-0000-4000-a000-000000000001' references public.organizations (id) on delete cascade;
alter table public.sync_jobs             add column if not exists organization_id uuid not null default '00000000-0000-4000-a000-000000000001' references public.organizations (id) on delete cascade;
alter table public.bitrix_writeback_queue add column if not exists organization_id uuid not null default '00000000-0000-4000-a000-000000000001' references public.organizations (id) on delete cascade;

-- ===================== Índices =====================
create index if not exists idx_records_org           on public.records (organization_id);
create index if not exists idx_dashboards_org        on public.dashboards (organization_id);
create index if not exists idx_tasks_org             on public.tasks (organization_id);
create index if not exists idx_goals_org             on public.goals (organization_id);
create index if not exists idx_field_definitions_org on public.field_definitions (organization_id);
create index if not exists idx_audit_log_org         on public.audit_log (organization_id);
create index if not exists idx_responsibles_org      on public.responsibles (organization_id);
create index if not exists idx_operations_org        on public.operations (organization_id);
create index if not exists idx_data_sources_org      on public.data_sources (organization_id);

-- ===================== Unicidades por org =====================
-- field_definitions.field_key: global → (organization_id, field_key).
alter table public.field_definitions
  drop constraint if exists field_definitions_field_key_key;
create unique index if not exists uq_field_definitions_org_key
  on public.field_definitions (organization_id, field_key);

-- field_correspondences.key: global → (organization_id, key).
alter table public.field_correspondences
  drop constraint if exists field_correspondences_key_key;
create unique index if not exists uq_field_correspondences_org_key
  on public.field_correspondences (organization_id, key);

-- goals: uma meta por período/escopo/alvo/métrica POR ORG.
drop index if exists public.uq_goals_scope;
create unique index if not exists uq_goals_scope on public.goals (
  organization_id,
  period_year,
  coalesce(period_month, 0),
  scope,
  coalesce(operation_id, '00000000-0000-0000-0000-000000000000'::uuid),
  coalesce(responsible_id, '00000000-0000-0000-0000-000000000000'::uuid),
  metric
);

-- sync_config: PK key → (organization_id, key).
do $$
begin
  if not exists (
    select 1 from pg_constraint c
    where c.conname = 'sync_config_pkey'
      and c.conrelid = 'public.sync_config'::regclass
      and array_length(c.conkey, 1) = 2
  ) then
    alter table public.sync_config drop constraint if exists sync_config_pkey;
    alter table public.sync_config add primary key (organization_id, key);
  end if;
end $$;

-- non_working_days: PK day → (organization_id, day).
do $$
begin
  if not exists (
    select 1 from pg_constraint c
    where c.conname = 'non_working_days_pkey'
      and c.conrelid = 'public.non_working_days'::regclass
      and array_length(c.conkey, 1) = 2
  ) then
    alter table public.non_working_days drop constraint if exists non_working_days_pkey;
    alter table public.non_working_days add primary key (organization_id, day);
  end if;
end $$;

-- ===================== Triggers de stamp =====================
-- records: a org é SEMPRE a da fonte (data_sources por record_type) — cobre
-- sync/CSV/API/manual sem tocar nenhum caminho de escrita.
create or replace function public.records_set_org()
returns trigger
language plpgsql
as $$
begin
  new.organization_id := coalesce(
    (select ds.organization_id
       from public.data_sources ds
      where ds.record_type = new.record_type),
    new.organization_id
  );
  return new;
end;
$$;

drop trigger if exists trg_records_set_org on public.records;
create trigger trg_records_set_org
  before insert on public.records
  for each row execute function public.records_set_org();

-- audit_log: org do registro auditado (quando houver).
create or replace function public.audit_log_set_org()
returns trigger
language plpgsql
as $$
begin
  if new.record_id is not null then
    new.organization_id := coalesce(
      (select r.organization_id from public.records r where r.id = new.record_id),
      new.organization_id
    );
  end if;
  return new;
end;
$$;

drop trigger if exists trg_audit_log_set_org on public.audit_log;
create trigger trg_audit_log_set_org
  before insert on public.audit_log
  for each row execute function public.audit_log_set_org();

-- record_matches: org do registro A (matching nunca cruza orgs — as fontes de
-- uma match_rule pertencem à mesma org).
create or replace function public.record_matches_set_org()
returns trigger
language plpgsql
as $$
begin
  new.organization_id := coalesce(
    (select r.organization_id from public.records r where r.id = new.record_a_id),
    new.organization_id
  );
  return new;
end;
$$;

drop trigger if exists trg_record_matches_set_org on public.record_matches;
create trigger trg_record_matches_set_org
  before insert on public.record_matches
  for each row execute function public.record_matches_set_org();

-- entity_custom_values: org da entidade (responsável/operação).
create or replace function public.entity_custom_values_set_org()
returns trigger
language plpgsql
as $$
begin
  if new.entity_type = 'responsible' then
    new.organization_id := coalesce(
      (select r.organization_id from public.responsibles r where r.id = new.entity_id),
      new.organization_id
    );
  elsif new.entity_type = 'operation' then
    new.organization_id := coalesce(
      (select o.organization_id from public.operations o where o.id = new.entity_id),
      new.organization_id
    );
  end if;
  return new;
end;
$$;

drop trigger if exists trg_entity_custom_values_set_org on public.entity_custom_values;
create trigger trg_entity_custom_values_set_org
  before insert on public.entity_custom_values
  for each row execute function public.entity_custom_values_set_org();
