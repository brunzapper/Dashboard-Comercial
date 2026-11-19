-- Versão: 1.0 | Data: 19/11/2026
-- 0156 — ESQUEMA POR BASE (`source_fields`).
--
-- Até a 0155 o campo era uma entidade da ORGANIZAÇÃO: `field_definitions` tem
-- `field_key` único por org e a única ligação com a Base é `applies_to`, onde
-- VAZIO significa "todas as Bases" (0018). Consequência medida em produção
-- (19/11/2026): 18 campos "globais" apareciam em TODA Base — inclusive numa
-- Base recém-criada —, 32 campos de CSV eram compartilhados entre Bases por
-- colisão de slug, e as colunas do núcleo de negócio do Bitrix (pipeline,
-- MRR, "Fechado?") apareciam em registros de Meetime/Eventos.
--
-- Esta migração dá à Base um ESQUEMA próprio:
--   1. `source_fields` — quais campos UMA Base (raiz, `data_sources`) tem:
--      `field_ref` = `core:<coluna>` (perfil do núcleo) ou `custom:<key>`,
--      com rótulo/ordem/visibilidade por Base, origem e ciclo de vida
--      (first/last_seen, removed_at). Sub-base herda o da pai (fase 1).
--   2. BACKFILL idempotente a partir do que já existe: campos com
--      `applies_to` contendo o record_type da Base ∪ campos "globais"
--      (applies_to vazio) que TÊM dado nos registros dela ∪ colunas do núcleo
--      preenchidas. Global sem dado na Base NÃO entra — é exatamente o
--      vazamento que se quer fechar. Campo DECLARADO para outra Base com valor
--      solto aqui (ex.: `mrr_contrato` em leads) também não entra: segue
--      aparecendo só no registro que tem valor, sem virar "—" em todos os
--      outros. `calculado_agg` fica fora (é métrica, não valor por registro).
--   3. `registros_populated_refs` (0121) recriada com UMA mudança: `closed`
--      só conta como preenchido quando algum registro está FECHADO. O default
--      `false` fazia "Fechado?" virar coluna em toda Base.
--
-- `applies_to` continua existindo e valendo como declaração (os escritores
-- ainda o mantêm — fase 2 os move para cá). O resolvedor único é
-- `lib/records/base-schema.ts`. `custom_fields`, `field_key` e os refs
-- `custom:<key>` NÃO mudam ⇒ run_widget_query/_snapshot INTOCADAS (inv. 1).
-- Idempotente.

-- ===================== 1) Tabela =====================
create table if not exists public.source_fields (
  organization_id uuid not null default '00000000-0000-4000-a000-000000000001'
    references public.organizations (id) on delete cascade,
  source_key      text not null references public.data_sources (key) on delete cascade,
  field_ref       text not null
    check (field_ref ~ '^(core|custom):[A-Za-z0-9_]+$'),
  -- Rótulo DESTA Base (null = herda o da definição / da linha core).
  label           text,
  sort_order      int,
  visible         boolean not null default true,
  origin          text not null default 'manual'
    check (origin in ('core', 'bitrix', 'spa', 'csv', 'sheet', 'api', 'manual', 'calc')),
  -- Identificador na ORIGEM (UF_CRM_…, cabeçalho do CSV) — busca e conferência.
  origin_ref      text,
  first_seen_at   timestamptz not null default now(),
  last_seen_at    timestamptz,
  -- A origem deixou de enviar o campo (ex.: apagado no Bitrix). NUNCA apaga a
  -- linha: widgets e valores antigos seguem resolvendo.
  removed_at      timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  primary key (organization_id, source_key, field_ref)
);

create index if not exists idx_source_fields_source
  on public.source_fields (source_key);

alter table public.source_fields enable row level security;

-- Leitura: qualquer membro da org (metadado, como field_definitions).
drop policy if exists source_fields_select on public.source_fields;
create policy source_fields_select on public.source_fields
  for select to authenticated
  using (organization_id in (select public.auth_org_ids()));

-- Escrita: mesma permissão que governa field_definitions.
drop policy if exists source_fields_write on public.source_fields;
create policy source_fields_write on public.source_fields
  for all to authenticated
  using (
    organization_id in (select public.auth_org_ids())
    and (select public.auth_has_permission('manage_field_definitions'))
  )
  with check (
    organization_id in (select public.auth_org_ids())
    and (select public.auth_has_permission('manage_field_definitions'))
  );

comment on table public.source_fields is
  'Esquema por Base (0156): quais campos (core:<coluna> | custom:<key>) cada Base raiz tem, com rótulo/ordem/visibilidade por Base e ciclo de vida. Resolvedor único: lib/records/base-schema.ts.';

-- ===================== 2) Backfill =====================
-- 2a) Perfil do NÚCLEO: colunas com ≥1 valor nos registros vivos da Base.
with agg as (
  select
    r.record_type,
    bool_or(nullif(r.pipeline, '') is not null)       as pipeline,
    bool_or(nullif(r.stage, '') is not null)          as stage,
    bool_or(nullif(r.stage_semantic, '') is not null) as stage_semantic,
    bool_or(nullif(r.sale_type, '') is not null)      as sale_type,
    bool_or(nullif(r.channel, '') is not null)        as channel,
    bool_or(nullif(r.currency, '') is not null)       as currency,
    bool_or(r.closed)                                 as closed,
    bool_or(r.responsible_id is not null)             as responsible_id,
    bool_or(r.operation_id is not null)               as operation_id,
    bool_or(r.related_lead_id is not null)            as related_lead_id,
    bool_or(r.value is not null)                      as value,
    bool_or(r.mrr is not null)                        as mrr,
    bool_or(r.lead_time_days is not null)             as lead_time_days,
    bool_or(r.closed_at is not null)                  as closed_at,
    bool_or(r.opened_at is not null)                  as opened_at,
    bool_or(r.source_created_at is not null)          as source_created_at
  from public.records r
  where r.deleted_at is null and r.is_mock = false
  group by r.record_type
)
insert into public.source_fields (organization_id, source_key, field_ref, origin)
select ds.organization_id, ds.key, 'core:' || c.col, 'core'
from public.data_sources ds
join agg on agg.record_type = ds.record_type
cross join lateral (values
  ('pipeline', agg.pipeline), ('stage', agg.stage),
  ('stage_semantic', agg.stage_semantic), ('sale_type', agg.sale_type),
  ('channel', agg.channel), ('currency', agg.currency),
  ('closed', agg.closed), ('responsible_id', agg.responsible_id),
  ('operation_id', agg.operation_id), ('related_lead_id', agg.related_lead_id),
  ('value', agg.value), ('mrr', agg.mrr),
  ('lead_time_days', agg.lead_time_days), ('closed_at', agg.closed_at),
  ('opened_at', agg.opened_at), ('source_created_at', agg.source_created_at)
) as c(col, has)
where c.has
on conflict do nothing;

-- 2b) Campos CUSTOM: declarados para a Base (applies_to) ∪ globais
--     (applies_to vazio) preenchidos nela.
with pop as (
  select distinct r.record_type, e.key
  from public.records r,
       lateral jsonb_each_text(coalesce(r.custom_fields, '{}'::jsonb)) e
  where r.deleted_at is null and r.is_mock = false
    and coalesce(e.value, '') <> ''
)
insert into public.source_fields
  (organization_id, source_key, field_ref, origin, origin_ref, sort_order)
select distinct on (ds.key, fd.field_key)
  ds.organization_id,
  ds.key,
  'custom:' || fd.field_key,
  case
    when fd.source_system = 'bitrix' and ds.bitrix_entity_type_id is not null then 'spa'
    when fd.source_system = 'bitrix' then 'bitrix'
    when fd.source_system = 'csv' then 'csv'
    when fd.source_system = 'sheet_site' then 'sheet'
    when fd.data_type = 'calculado' then 'calc'
    else 'manual'
  end,
  fd.source_field_id,
  fd.sort_order
from public.data_sources ds
join public.field_definitions fd
  on fd.organization_id = ds.organization_id
where coalesce(fd.source_system, '') <> 'core'
  and fd.data_type <> 'calculado_agg'
  and fd.field_key ~ '^[A-Za-z0-9_]+$'
  and (
    ds.record_type = any (fd.applies_to)
    or (
      coalesce(cardinality(fd.applies_to), 0) = 0
      and exists (
        select 1 from pop
        where pop.record_type = ds.record_type and pop.key = fd.field_key
      )
    )
  )
on conflict do nothing;

-- ===================== 3) registros_populated_refs =====================
-- Corpo da 0121 verbatim, exceto `closed`: conta só com algum registro
-- FECHADO (o default false não é informação).
create or replace function public.registros_populated_refs(p_record_type text)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
with base as (
  select *
  from public.records
  where record_type = p_record_type
    and is_mock = false
    -- 0121: lixeira fora das colunas populadas.
    and deleted_at is null
),
core as (
  -- Colunas núcleo de EXIBIÇÃO (title/record_type/source_system ficam de fora:
  -- identidade/cabeçalho, sempre presentes na UI). Texto vazio não conta.
  select array_remove(array[
    case when count(nullif(pipeline, ''))       > 0 then 'pipeline' end,
    case when count(nullif(stage, ''))          > 0 then 'stage' end,
    case when count(nullif(stage_semantic, '')) > 0 then 'stage_semantic' end,
    case when count(nullif(sale_type, ''))      > 0 then 'sale_type' end,
    case when count(nullif(channel, ''))        > 0 then 'channel' end,
    case when count(nullif(currency, ''))       > 0 then 'currency' end,
    -- 0156: false é o DEFAULT da coluna, não um dado.
    case when count(*) filter (where closed) > 0 then 'closed' end,
    case when count(responsible_id)    > 0 then 'responsible_id' end,
    case when count(operation_id)      > 0 then 'operation_id' end,
    case when count(related_lead_id)   > 0 then 'related_lead_id' end,
    case when count(value)             > 0 then 'value' end,
    case when count(mrr)               > 0 then 'mrr' end,
    case when count(lead_time_days)    > 0 then 'lead_time_days' end,
    case when count(closed_at)         > 0 then 'closed_at' end,
    case when count(opened_at)         > 0 then 'opened_at' end,
    case when count(source_created_at) > 0 then 'source_created_at' end
  ], null) as refs
  from base
),
cust as (
  select coalesce(jsonb_agg(distinct e.key), '[]'::jsonb) as keys
  from base r,
       lateral jsonb_each_text(coalesce(r.custom_fields, '{}'::jsonb)) e
  where coalesce(e.value, '') <> ''
)
select jsonb_build_object(
  'core', coalesce(to_jsonb((select refs from core)), '[]'::jsonb),
  'custom', (select keys from cust)
);
$$;
comment on function public.registros_populated_refs(text) is
  'Refs núcleo e chaves custom com >=1 valor não-vazio no record_type (mocks e lixeira fora; closed só conta se TRUE — 0156). SECURITY INVOKER: RLS de records recorta por usuário. Consumidor: página /registros (colunas dirigidas por dados).';

revoke execute on function public.registros_populated_refs(text) from public, anon;
grant execute on function public.registros_populated_refs(text) to authenticated;
grant execute on function public.registros_populated_refs(text) to service_role;
