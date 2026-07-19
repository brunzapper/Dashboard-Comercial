-- Versão: 1.0 | Data: 19/07/2026
-- DIAGNÓSTICO + RECUPERAÇÃO DE PERFORMANCE (dashboard lento, widgets com erro
-- 500 / "canceling statement due to statement timeout" nos logs do Supabase).
--
-- Quando usar: depois de um Backfill/Reconciliar em massa (o sync reescreve
-- TODAS as linhas de `records` — tuplas mortas + estatísticas defasadas) ou
-- sempre que o dashboard degradar de uma vez em todos os widgets.
-- Ver docs/manual-de-manutencao.md §5.
--
-- Como usar: cole no SQL editor do Supabase e execute UM BLOCO POR VEZ, na
-- ordem. Os passos 1–3 são só leitura; o passo 4 (VACUUM) é a correção e não
-- roda dentro de transação — execute cada VACUUM sozinho.

-- ============================================================
-- 1) O que está rodando AGORA (flagra query/job preso segurando o banco).
--    Atenção a `state = 'active'` com `duration` alta e a wait_event de lock.
-- ============================================================
select
  pid,
  state,
  wait_event_type,
  wait_event,
  now() - query_start as duration,
  usename,
  left(query, 120) as query
from pg_stat_activity
where state <> 'idle'
  and pid <> pg_backend_pid()
order by query_start;

-- ============================================================
-- 2) Jobs do pg_cron (o log "cron job N job startup timeout" indica o banco
--    sem folga até para iniciar um job). Confira falhas em série no histórico.
-- ============================================================
select jobid, jobname, schedule, active from cron.job order by jobid;

select jobid, status, return_message, start_time, end_time
from cron.job_run_details
order by start_time desc
limit 50;

-- ============================================================
-- 3) Bloat e estatísticas das tabelas quentes. Sinais de problema:
--    - n_dead_tup da ordem de n_live_tup (ou maior);
--    - last_autovacuum / last_autoanalyze anteriores ao backfill.
-- ============================================================
select
  relname,
  n_live_tup,
  n_dead_tup,
  last_autovacuum,
  last_autoanalyze,
  pg_size_pretty(pg_total_relation_size(relid)) as total_size
from pg_stat_user_tables
where relname in ('records', 'record_matches', 'snapshot_records', 'audit_log')
order by pg_total_relation_size(relid) desc;

-- ============================================================
-- 4) CORREÇÃO: vacuum + estatísticas novas. Rode CADA statement sozinho
--    (VACUUM não aceita transação). `records` é o principal; os demais são
--    baratos e valem pela consistência.
-- ============================================================
vacuum (analyze) public.records;

vacuum (analyze) public.record_matches;

vacuum (analyze) public.snapshot_records;

-- ============================================================
-- 5) Depois do vacuum:
--    - abra o dashboard e confira nos logs da Vercel a linha
--      `[dashboard:timing]` (total, widgets mais lentos, erros) — é ela que
--      diz se sobrou algum widget dominante;
--    - painel do Supabase → Reports/Database health: se a CPU seguir cravada
--      com o app parado, investigue o passo 1 de novo (job preso) e considere
--      restart/upgrade do compute (instâncias nano/micro não sustentam
--      dashboards grandes com listas em full-fetch).
-- ============================================================
