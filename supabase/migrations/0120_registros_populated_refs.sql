-- 0120_registros_populated_refs.sql
-- Versão: 1.0 | Data: 07/08/2026
-- COLUNAS POPULADAS DA PÁGINA /registros: função de agregação que informa, por
-- record_type, quais colunas do NÚCLEO e quais chaves de `custom_fields` têm ao
-- menos um valor não-vazio (mocks fora). A tabela de Registros usa isso para
-- exibir 100% das colunas COM dados e ocultar as vazias que não pertencem à
-- base — dirigido pela BASE inteira (não pela página atual, senão colunas
-- sumiriam ao paginar/ordenar).
-- SECURITY INVOKER de propósito: a RLS de `records` (org + visibilidade por
-- papel) recorta o que conta como "populado" para CADA usuário — nada vaza além
-- do que o próprio usuário já pode listar. NÃO toca o par
-- run_widget_query/run_widget_query_snapshot (invariante 1 não acionada).
-- Custo: uma varredura agregada por chamada (uma por load da página) —
-- aceitável na escala atual; se pesar, memoizar no app (nunca cachear entre
-- usuários: o resultado é RLS-dependente). Idempotente.

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
    case when count(closed)            > 0 then 'closed' end,
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
  'Refs núcleo e chaves custom com >=1 valor não-vazio no record_type (mocks fora). SECURITY INVOKER: RLS de records recorta por usuário. Consumidor: página /registros (colunas dirigidas por dados).';

-- Acesso: só usuários autenticados (e service role). Nunca anon — regra do
-- caminho público de snapshots (app/s/[token] + service role) não passa por cá.
revoke execute on function public.registros_populated_refs(text) from public, anon;
grant execute on function public.registros_populated_refs(text) to authenticated;
grant execute on function public.registros_populated_refs(text) to service_role;
