-- Versão: 1.0 | Data: 20/07/2026
-- 0084: mocks de Data Reunião INBOUND ganham custom:fonte "Formulário de CRM".
--
-- Motivo: o predicado de sub-fonte entra no RPC em AND puro (via
-- _widget_wrap_record_types, 0054) — a regra dos mocks (0052) apenas remove o
-- gate `not is_mock` quando a consulta referencia Data Reunião; ela NÃO isenta
-- os mocks dos demais predicados. A sub `sqls` do preset Inbound filtra
-- `custom:fonte in ('Formulário de CRM','Site')` e os mocks (seeds 0051) só
-- carregavam stage + Data Reunião — logo eram excluídos do SQL em TODOS os
-- widgets (Mês x Mês, KPI SQL total, conversões). Regra geral documentada em
-- docs/arquitetura.md: mocks precisam CARREGAR os campos usados na
-- segmentação das sub-fontes que devem contá-los.
--
-- Escopo: SÓ o lote Inbound (0051, source_id 'mock_reuniao_NNN' numérico).
-- Os mocks Outbound (0053, 'mock_reuniao_out_NNN') ficam SEM fonte de
-- propósito — não podem vazar no SQL Inbound; recebem a fonte deles quando o
-- preset Outbound existir.
--
-- Efeitos colaterais checados: com fonte, o mock passa a satisfazer também os
-- predicados de mqls/sals — mas essas pernas consultam por source_created_at
-- (NULL nos mocks) e não referenciam Data Reunião (gate `not is_mock` ativo),
-- então seguem sem mocks; desq_inbound exige motivo not_null e clientes_lite
-- outra etapa. Só a sub `sqls` passa a contá-los — o comportamento desejado.
--
-- Idempotente (guard `->> 'fonte' is null`). O trigger de congelamento (0051)
-- permite: em mocks ele só protege is_mock e as duas chaves de Data Reunião.
update public.records
set custom_fields = custom_fields || jsonb_build_object('fonte', 'Formulário de CRM')
where is_mock
  and source_system = 'manual'
  and source_id ~ '^mock_reuniao_[0-9]+$'
  and (custom_fields ->> 'fonte') is null;
