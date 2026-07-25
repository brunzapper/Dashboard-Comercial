-- 0099: campo core "Base" (`records.source_system`) vira SELEÇÃO.
-- Só dados + recreate do seed de provisioning; NÃO recria as RPCs de widget
-- (nada aqui aciona a paridade run_widget_query/_snapshot).
--
-- Os valores de source_system são um conjunto pequeno e fechado, controlado
-- pelo app (bitrix/sheet_site/manual/csv — todos os pontos de escrita), então
-- o campo entra na whitelist CORE_SELECT_CAPABLE (lib/records/core-defs.ts) e
-- as linhas core existentes viram data_type='selecao'. Com isso o "Filtro por
-- campo" (page viva, viewer de snapshot) e o picker "Opções visíveis" ganham
-- dropdown pelo fallback selecao+options já existente — sem código novo.
--
-- Options por org = valores DISTINTOS dos registros da org ∪ lista fixa das 4
-- origens que o app grava hoje: a união garante que nenhuma origem gravável
-- fique fora do dropdown (opção ausente = registros infiltráveis). O admin
-- pode podar no /campos; diferente do `pipeline`, NADA reescreve estas
-- options depois (o sync só reescreve as do pipeline).
--
-- Idempotente: o `where data_type = 'texto'` preserva customização do admin
-- em re-execuções (uma vez selecao, as options nunca são sobrescritas aqui).

update public.field_definitions fd
set data_type = 'selecao',
    options = (
      select coalesce(jsonb_agg(v order by v), '[]'::jsonb)
      from (
        select distinct r.source_system as v
          from public.records r
         where r.organization_id = fd.organization_id
           and r.source_system is not null
           and r.source_system <> ''
        union
        select unnest(array['bitrix', 'sheet_site', 'manual', 'csv'])
      ) s
    )
where fd.source_system = 'core'
  and fd.field_key = 'source_system'
  and fd.data_type = 'texto';

-- seed_org_defaults (0093) re-emitida por inteiro com UMA mudança: a linha do
-- `source_system` nasce 'selecao' com as 4 origens padrão (org nova não tem
-- registros para derivar). Mesmos atributos (security definer, search_path
-- vazio); o create or replace preserva os grants/revokes da 0093.

create or replace function public.seed_org_defaults(p_org uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.field_definitions
    (organization_id, field_key, label, data_type, options, source_system,
     source_field_id, show_in_builder, applies_to, is_local, sort_order)
  values
    (p_org, 'title',             'Nome (título)',                   'texto',    '[]'::jsonb, 'core', null, true, '{}', false, 0),
    (p_org, 'record_type',       'Tipo de registro',                'texto',    '[]'::jsonb, 'core', null, true, '{}', false, 0),
    (p_org, 'source_system',     'Base',                            'selecao',
       '["bitrix","csv","manual","sheet_site"]'::jsonb,
                                                                                'core', null, true, '{}', false, 0),
    (p_org, 'pipeline',          'Pipeline',                        'selecao',  '[]'::jsonb, 'core', null, true, '{}', false, 0),
    (p_org, 'stage',             'Etapa',                           'texto',    '[]'::jsonb, 'core', null, true, '{}', false, 0),
    (p_org, 'stage_semantic',    'Situação (aberto/ganho/perdido)', 'texto',    '[]'::jsonb, 'core', null, true, '{}', false, 0),
    (p_org, 'sale_type',         'Tipo de venda',                   'texto',    '[]'::jsonb, 'core', null, true, '{}', false, 0),
    (p_org, 'channel',           'Canal',                           'texto',    '[]'::jsonb, 'core', null, true, '{}', false, 0),
    (p_org, 'currency',          'Moeda',                           'texto',    '[]'::jsonb, 'core', null, true, '{}', false, 0),
    (p_org, 'closed',            'Fechado?',                        'booleano', '[]'::jsonb, 'core', null, true, '{}', false, 0),
    (p_org, 'responsible_id',    'Responsável',                     'texto',    '[]'::jsonb, 'core', null, true, '{}', false, 0),
    (p_org, 'operation_id',      'Operação',                        'texto',    '[]'::jsonb, 'core', null, true, '{}', false, 0),
    (p_org, 'related_lead_id',   'Lead relacionado',                'texto',    '[]'::jsonb, 'core', null, true, '{}', false, 0),
    (p_org, 'value',             'Valor',                           'moeda',    '[]'::jsonb, 'core', null, true, '{}', false, 0),
    (p_org, 'mrr',               'MRR',                             'moeda',    '[]'::jsonb, 'core', null, true, '{}', false, 0),
    (p_org, 'lead_time_days',    'Lead time (dias)',                'numero',   '[]'::jsonb, 'core', null, true, '{}', false, 0),
    (p_org, 'closed_at',         'Data de fechamento',              'data',     '[]'::jsonb, 'core', null, true, '{}', false, 0),
    (p_org, 'opened_at',         'Data de abertura',                'data',     '[]'::jsonb, 'core', null, true, '{}', false, 0),
    (p_org, 'source_created_at', 'Data de criação (origem)',        'data',     '[]'::jsonb, 'core', null, true, '{}', false, 0)
  on conflict (organization_id, field_key) do nothing;
end;
$$;
