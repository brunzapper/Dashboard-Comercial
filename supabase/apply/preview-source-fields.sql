-- Versão: 1.0 | Data: 19/11/2026
-- MODO SECO da 0156 (somente leitura): mostra, por Base, quantos campos o
-- backfill de `source_fields` vai gravar e quantos campos "globais"
-- (applies_to vazio) cada Base deixa de exibir. Rode ANTES de aplicar a 0156
-- e compare com o que se vê hoje em /registros. Não escreve nada.

with pop as (
  select distinct r.record_type, e.key
  from public.records r,
       lateral jsonb_each_text(coalesce(r.custom_fields, '{}'::jsonb)) e
  where r.deleted_at is null and r.is_mock = false
    and coalesce(e.value, '') <> ''
),
schema_custom as (
  select distinct ds.key, fd.field_key,
         coalesce(cardinality(fd.applies_to), 0) = 0 as was_global
  from public.data_sources ds
  join public.field_definitions fd on fd.organization_id = ds.organization_id
  left join pop on pop.record_type = ds.record_type and pop.key = fd.field_key
  where coalesce(fd.source_system, '') <> 'core'
    and fd.data_type <> 'calculado_agg'
    and (ds.record_type = any (fd.applies_to)
         or (coalesce(cardinality(fd.applies_to), 0) = 0
             and pop.key is not null))
),
legacy as (
  -- O que a regra antiga considerava "da Base" (vazio = todas).
  select ds.key, count(*) as n
  from public.data_sources ds
  join public.field_definitions fd on fd.organization_id = ds.organization_id
  where coalesce(fd.source_system, '') <> 'core'
    and fd.data_type <> 'calculado_agg'
    and (coalesce(cardinality(fd.applies_to), 0) = 0
         or ds.record_type = any (fd.applies_to))
  group by ds.key
),
globals as (
  select ds.key, count(*) as n
  from public.data_sources ds
  join public.field_definitions fd on fd.organization_id = ds.organization_id
  where coalesce(fd.source_system, '') <> 'core'
    and fd.data_type <> 'calculado_agg'
    and coalesce(cardinality(fd.applies_to), 0) = 0
  group by ds.key
)
select
  s.key as base,
  l.n as campos_hoje_regra_antiga,
  count(*) as campos_no_esquema,
  count(*) filter (where s.was_global) as globais_mantidos_por_ter_dado,
  coalesce(g.n, 0) - count(*) filter (where s.was_global)
    as globais_que_deixam_de_aparecer
from schema_custom s
join legacy l on l.key = s.key
left join globals g on g.key = s.key
group by s.key, l.n, g.n
order by s.key;
