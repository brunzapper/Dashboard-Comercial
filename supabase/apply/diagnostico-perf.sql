-- Versão: 1.1 | Data: 19/07/2026
-- DIAGNÓSTICO + RECUPERAÇÃO DE PERFORMANCE (dashboard lento, widgets com erro
-- 500 / "canceling statement due to statement timeout" nos logs do Supabase).
--
-- Quando usar: depois de um Backfill/Reconciliar em massa (o sync reescreve
-- TODAS as linhas de `records` — tuplas mortas + estatísticas defasadas) ou
-- sempre que o dashboard degradar de uma vez em todos os widgets.
-- Ver docs/manual-de-manutencao.md §5.
--
-- Como usar:
--   * PARTE A (passos 1–4): cole no SQL editor do Supabase e rode. Passos 1–3
--     são leitura; o passo 4 é ANALYZE (atualiza as estatísticas do planejador,
--     a correção imediata) — roda dentro de transação, então funciona no editor.
--   * PARTE B (passo 5): VACUUM. NÃO cole no SQL editor — o editor envolve tudo
--     numa transação e "VACUUM cannot run inside a transaction block" (erro
--     25001). Rode por fora (psql, conexão direta) ou deixe a cargo do
--     autovacuum. Instruções no próprio passo 5.

-- ############################################################
-- PARTE A — roda no SQL editor do Supabase
-- ############################################################

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
-- 4) CORREÇÃO IMEDIATA: estatísticas novas (ANALYZE). Depois de reescrever a
--    tabela inteira, o planejador fica com estatísticas defasadas e escolhe
--    planos ruins (seq scan / nested loop) que estouram o statement timeout —
--    ANALYZE conserta isso na hora e roda dentro de transação (SQL editor OK).
--    `records` é o principal; os demais são baratos e valem pela consistência.
-- ============================================================
analyze public.records;

analyze public.record_matches;

analyze public.snapshot_records;

-- ############################################################
-- PARTE B — VACUUM (NÃO cole no SQL editor: erro 25001)
-- ############################################################

-- ============================================================
-- 5) VACUUM recupera as tuplas mortas (bloat) que o backfill deixou. É
--    SECUNDÁRIO ao ANALYZE acima — só rode se o passo 3 mostrou n_dead_tup
--    alto e o autovacuum atrasado. Dois caminhos, ambos FORA do SQL editor:
--
--    (a) Autovacuum: normalmente basta esperar — o Postgres limpa sozinho.
--        Confirme pelo `last_autovacuum` do passo 3 subindo com o tempo. Se o
--        banco estava saturado (passo 1), o autovacuum pode ter ficado para
--        trás; ele se recupera quando a carga cede (após o ANALYZE).
--
--    (b) Forçar via psql na CONEXÃO DIRETA (porta 5432 — NÃO o pooler de
--        transação, que também recusaria o VACUUM):
--          psql "<Direct connection string>" -c "vacuum (analyze) public.records;"
--          psql "<Direct connection string>" -c "vacuum (analyze) public.record_matches;"
--          psql "<Direct connection string>" -c "vacuum (analyze) public.snapshot_records;"
--        A string está em: Supabase → Project Settings → Database →
--        Connection string → aba "Direct connection".
--        (O `-c` do psql roda cada comando fora de transação — por isso funciona
--        aqui e não no editor.)
-- ============================================================

-- ============================================================
-- 6) Depois do ANALYZE (e do VACUUM, se rodou):
--    - abra o dashboard e confira nos logs da Vercel a linha
--      `[dashboard:timing]` (total, widgets mais lentos, erros) — é ela que
--      diz se sobrou algum widget dominante;
--    - painel do Supabase → Reports/Database health: se a CPU seguir cravada
--      com o app parado, investigue o passo 1 de novo (job preso) e considere
--      restart/upgrade do compute (instâncias nano/micro não sustentam
--      dashboards grandes com listas em full-fetch).
-- ============================================================
