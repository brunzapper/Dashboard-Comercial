-- Versão: 1.0 | Data: 17/07/2026
-- PERFORMANCE (índices): `records` não tinha índice em source_created_at,
-- que é (a) o sort padrão de TODA lista de registros (runRecordList e
-- /registros ordenam por source_created_at desc nulls last) e (b) o
-- default_period_field das fontes leads/estudo (0060) — ou seja, o filtro de
-- período mais comum do run_widget_query. deals usa closed_at (já indexado
-- sozinho desde 0004, mas sem composto com record_type).
--
-- Compostos (record_type, <data>) servem o shape quase universal
-- "record_type in (...) AND data between ..." dos widgets; o índice simples em
-- source_created_at serve o sort de listas multi-fonte (sem filtro de tipo).
-- DESC NULLS LAST casa exatamente com o ORDER BY usado no app.
-- snapshot_records: a PK (snapshot_id, id) já cobre o predicado obrigatório
-- snapshot_id = X do RPC; o composto abaixo serve o sort do modo lista do
-- viewer de snapshots. Idempotente.

create index if not exists idx_records_type_source_created
  on public.records (record_type, source_created_at desc nulls last);

create index if not exists idx_records_type_closed
  on public.records (record_type, closed_at);

create index if not exists idx_records_source_created
  on public.records (source_created_at desc nulls last);

create index if not exists idx_snapshot_records_created
  on public.snapshot_records (snapshot_id, source_created_at desc nulls last);
