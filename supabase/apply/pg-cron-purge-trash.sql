-- Versão: 1.0 | Data: 22/07/2026
-- Purga diária da Lixeira de boards (dashboards.status 'trashed', 0087):
-- exclui DEFINITIVAMENTE os boards na lixeira há mais de 14 dias. SQL puro no
-- próprio banco — sem hop HTTP (diferente dos ticks): o DELETE cascateia
-- widgets (→ dashboard_table_cells), snapshots (→ snapshot_records),
-- kanban_placements e user_preferences; `tasks.board_id` é ON DELETE SET NULL
-- (tarefas sobrevivem órfãs, mesmo comportamento do hard delete de sempre).
--
-- O hub esconde itens com mais de 14 dias mesmo sem este job instalado
-- (filtro na consulta) — o cron garante a limpeza física.
--
-- Aplicar UMA vez no SQL editor do Supabase.

create extension if not exists pg_cron;

select cron.schedule(
  'purge-dashboard-trash',
  '30 3 * * *',  -- diário às 03:30 UTC (00:30 em Brasília)
  $$
  delete from public.dashboards
  where status = 'trashed'
    and trashed_at is not null
    and trashed_at < now() - interval '14 days';
  $$
);

-- Verificação:
--   select * from cron.job;
--   select * from cron.job_run_details order by start_time desc limit 20;
-- Para remover: select cron.unschedule('purge-dashboard-trash');
