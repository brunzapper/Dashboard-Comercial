-- Versão: 1.0 | Data: 07/08/2026
-- Purga diária da Lixeira de REGISTROS (records.deleted_at, 0121): exclui
-- DEFINITIVAMENTE os registros na lixeira há mais de 30 dias. SQL puro no
-- próprio banco — sem hop HTTP (mesmo desenho do purge-dashboard-trash): o
-- DELETE cascateia audit_log, tarefas, comentários, kanban_placements,
-- record_matches e a fila de write-back; related_lead_id (self), o vínculo de
-- operação automática e comp_entries.mirror_record_id vão a NULL pelas regras
-- de FK existentes. Sem webhook — o record.deleted já foi emitido quando o
-- registro entrou na lixeira (lib/records/trash-actions.ts).
--
-- A página /registros/lixeira esconde itens com mais de 30 dias mesmo sem
-- este job instalado (withinRecordsTrashTtl) — o cron garante a limpeza
-- física. O trigger enforce_records_trash_guard não interfere (é
-- insert/update; a purga é DELETE).
--
-- Aplicar UMA vez no SQL editor do Supabase.

create extension if not exists pg_cron;

select cron.schedule(
  'purge-records-trash',
  '35 3 * * *',  -- diário às 03:35 UTC (00:35 em Brasília)
  $$
  delete from public.records
  where deleted_at is not null
    and deleted_at < now() - interval '30 days';
  $$
);

-- Verificação:
--   select * from cron.job;
--   select * from cron.job_run_details order by start_time desc limit 20;
-- Para remover: select cron.unschedule('purge-records-trash');
