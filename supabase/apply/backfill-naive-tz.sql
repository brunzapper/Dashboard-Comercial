-- Versão: 1.0 | Data: 26/07/2026
-- BACKFILL de fuso das colunas CORE timestamptz gravadas por fontes NAIVE
-- (planilha "Estudo de Fechamentos" e CSV do Meetime): os valores "yyyy-MM-dd
-- [HH:mm]" eram hora de parede de BRASÍLIA, mas entraram sem âncora e o
-- Postgres os interpretou como UTC — 3h adiantados. No read side (dia de
-- Brasília, invariante 11) todo valor 00:00–02:59 recuava um dia: vendas do
-- dia 1 caíam no mês anterior ("este mês" as perdia). O write side foi
-- corrigido em 26/07/2026 (anchorNaiveToBrasilia em lib/sync/sheets/adapter.ts
-- e lib/import/ingest.ts); este script conserta o legado somando +3h.
-- O sync da planilha NÃO reescreve source_created_at após o insert (não está
-- em CORE_SYNC_FIELDS) e o reconcile de datas core compara por INSTANTE
-- (timestampValuesDiffer) — o backfill não sofre churn nem reversão.

-- 1) Planilha (sheet_site — 70 registros na aplicação original, todos à
--    meia-noite UTC). O WHERE de hora garante idempotência: após o update os
--    valores ficam às 03:00 UTC e não casam de novo.
update public.records
set source_created_at = source_created_at + interval '3 hours'
where source_system = 'sheet_site'
  and (source_created_at at time zone 'UTC')::time = '00:00:00';

-- 2) Meetime (CSV — 3.198 registros na aplicação original; horários de parede
--    de Brasília gravados como UTC, confirmado pelo usuário em 26/07/2026).
--    SEM marcador natural de idempotência — RODAR UMA ÚNICA VEZ. Se precisar
--    reaplicar em outra base, confira antes o histograma:
--    select extract(hour from source_created_at at time zone 'UTC'), count(*)
--    from public.records where record_type='meetime_outbound' group by 1;
--    (pico às 9h UTC = ainda não corrigido; pico às 12h UTC = já corrigido.)
update public.records
set source_created_at = source_created_at + interval '3 hours'
where source_system = 'csv'
  and record_type = 'meetime_outbound';

-- Conferência (vendas do site de julho/2026, operação Inbound BR): a janela
-- de Brasília deve bater com o dia da planilha (17 em 26/07/2026).
-- select count(*) from public.records r
-- where r.record_type = 'venda_site' and r.mrr > 0
--   and (r.stage is null or lower(r.stage) <> 'dsq') and r.is_mock = false
--   and r.source_created_at >= '2026-07-01T00:00:00-03:00'
--   and r.source_created_at <  '2026-08-01T00:00:00-03:00';

-- Snapshots congelados capturados ANTES do backfill preservam os dias antigos
-- (dataset congelado por design) — recapture/atualize os snapshots afetados
-- pela UI (SnapshotsPanel → Atualizar) se precisarem refletir a correção.
