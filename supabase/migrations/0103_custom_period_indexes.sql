-- Versão: 1.0 | Data: 26/07/2026
-- PERFORMANCE (índices, continuação da 0069): filtros de PERÍODO sobre campo
-- custom de data comparam o texto ISO de `custom_fields->>key` (prefix-based,
-- lexicográfico — mesmo precedente do ramo custom do @period no RPC, 0085).
-- Sem índice de expressão isso é seq scan da fonte inteira a cada widget.
--
-- Índices parciais para os DOIS campos custom de data mais consultados do
-- app — "Data Reunião" de Lead e de Negócio (as chaves fixas da regra de
-- mocks 0051/0052, referenciadas em widgets/filtros o tempo todo) — cada um
-- restrito ao record_type dono da chave. Campos custom de período de OUTRAS
-- fontes/sub-fontes (data_sources/sub_sources.default_period_field
-- 'custom:...', 0082) são dado de instalação: gere os índices deles pelo
-- runbook supabase/apply/indices-periodo-custom.sql.
--
-- Composto multi-org: prefixo organization_id p/ o shape universal
-- "organization_id in (...) AND record_type in (...) AND data between ..."
-- que a RLS de org (0090) soma a toda consulta — inócuo com 1 org, evita
-- degradação quando houver 2+ orgs volumosas. DESC NULLS LAST casa com o
-- ORDER BY do app (como na 0069). Idempotente; não recria as RPCs.

create index if not exists idx_records_lead_data_reuniao
  on public.records ((custom_fields->>'bitrix_uf_crm_1743441331'))
  where record_type = 'lead';

create index if not exists idx_records_negocio_data_reuniao
  on public.records ((custom_fields->>'bitrix_uf_crm_67eacefcccd98'))
  where record_type = 'negocio';

create index if not exists idx_records_org_type_source_created
  on public.records (organization_id, record_type, source_created_at desc nulls last);
