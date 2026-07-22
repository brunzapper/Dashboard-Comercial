-- 0086: colunas do NÚCLEO de `records` como linhas de field_definitions
-- (source_system='core') — a aba Campos passa a exibi-las e gerenciá-las
-- (rótulo, olho/show_in_builder, ordem; texto↔selecao numa whitelist).
--
-- SEMÂNTICA (ver docs/arquitetura.md e lib/records/core-defs.ts): estas linhas
-- são OVERRIDES das colunas núcleo hardcoded (CORE_FIELDS em
-- lib/widgets/fields.ts) — o ref de widget segue sendo o nome cru da coluna
-- ("pipeline"), NUNCA `custom:pipeline`; os loaders particionam via
-- splitCoreDefs. NÃO aplicar esta migração antes do código que a acompanha:
-- código antigo trataria as linhas como campos custom (refs duplicados).
--
-- `applies_to` vazio = todas as fontes (colunas núcleo existem em todas).
-- `source_field_id` NULL não colide com o índice único
-- (source_system, source_field_id) da 0017 (NULLs múltiplos são permitidos).
--
-- `pipeline` nasce 'selecao' com as options tiradas do distinct dos registros
-- ("Vendas"/"Enterprise"); o sync as reescreve a cada rodada com os funis
-- vivos do Bitrix (crm.dealcategory.list — ver lib/sync/bitrix/catalog.ts).
-- Idempotente: `on conflict do nothing` preserva qualquer edição do admin.

insert into public.field_definitions
  (field_key, label, data_type, options, source_system, source_field_id,
   show_in_builder, applies_to, is_local, sort_order)
values
  ('title',             'Nome (título)',                   'texto',    '[]'::jsonb, 'core', null, true, '{}', false, 0),
  ('record_type',       'Tipo de registro',                'texto',    '[]'::jsonb, 'core', null, true, '{}', false, 0),
  -- Rótulo "Base" (não "Fonte"): o conceito de fonte de dados do sistema passa
  -- a se chamar Base na UI — desambigua do campo CRM "Fonte" (custom `fonte`).
  ('source_system',     'Base',                            'texto',    '[]'::jsonb, 'core', null, true, '{}', false, 0),
  ('pipeline',          'Pipeline',                        'selecao',
     coalesce(
       (select jsonb_agg(distinct r.pipeline order by r.pipeline)
          from public.records r
         where r.pipeline is not null and r.pipeline <> ''),
       '[]'::jsonb),
                                                                        'core', null, true, '{}', false, 0),
  ('stage',             'Etapa',                           'texto',    '[]'::jsonb, 'core', null, true, '{}', false, 0),
  ('stage_semantic',    'Situação (aberto/ganho/perdido)', 'texto',    '[]'::jsonb, 'core', null, true, '{}', false, 0),
  ('sale_type',         'Tipo de venda',                   'texto',    '[]'::jsonb, 'core', null, true, '{}', false, 0),
  ('channel',           'Canal',                           'texto',    '[]'::jsonb, 'core', null, true, '{}', false, 0),
  ('currency',          'Moeda',                           'texto',    '[]'::jsonb, 'core', null, true, '{}', false, 0),
  ('closed',            'Fechado?',                        'booleano', '[]'::jsonb, 'core', null, true, '{}', false, 0),
  ('responsible_id',    'Responsável',                     'texto',    '[]'::jsonb, 'core', null, true, '{}', false, 0),
  ('operation_id',      'Operação',                        'texto',    '[]'::jsonb, 'core', null, true, '{}', false, 0),
  ('related_lead_id',   'Lead relacionado',                'texto',    '[]'::jsonb, 'core', null, true, '{}', false, 0),
  ('value',             'Valor',                           'moeda',    '[]'::jsonb, 'core', null, true, '{}', false, 0),
  ('mrr',               'MRR',                             'moeda',    '[]'::jsonb, 'core', null, true, '{}', false, 0),
  ('lead_time_days',    'Lead time (dias)',                'numero',   '[]'::jsonb, 'core', null, true, '{}', false, 0),
  ('closed_at',         'Data de fechamento',              'data',     '[]'::jsonb, 'core', null, true, '{}', false, 0),
  ('opened_at',         'Data de abertura',                'data',     '[]'::jsonb, 'core', null, true, '{}', false, 0),
  ('source_created_at', 'Data de criação (origem)',        'data',     '[]'::jsonb, 'core', null, true, '{}', false, 0)
on conflict (field_key) do nothing;
