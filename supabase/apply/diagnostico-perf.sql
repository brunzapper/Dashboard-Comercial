-- Versão: 1.2 | Data: 19/07/2026
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
--   * PARTE C (passos 7–10): diagnóstico POR DASHBOARD quando UM dashboard
--     específico segue lento após A/B — foca a subconsulta de `match:` sobre
--     record_matches (magnitude, pg_stat_statements e EXPLAIN). Tudo leitura.

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

-- ############################################################
-- PARTE C — diagnóstico POR DASHBOARD (roda no SQL editor)
-- ############################################################
-- Quando usar: a Parte A/B já rodou (ou os OUTROS dashboards já voltaram) mas
-- UM dashboard específico segue lento / com widgets em
-- "canceling statement due to statement timeout". Aqui o alvo é a subconsulta
-- correlacionada de `_widget_match_expr` (colunas `match:` = registro casado),
-- que roda POR LINHA do agregado sobre `record_matches` — o custo residual
-- típico depois que período/bloat já foram tratados. Ver docs §5.

-- ============================================================
-- 7) PRIMEIRO SINAL (não é SQL): a linha `[dashboard:timing]` nos logs da
--    Vercel ao abrir o dashboard —
--      [dashboard:timing] "<nome>" total=…ms widgets=…ms (N widgets)
--        | top: <widget>#<id>=…ms(erro?) | …
--    O `top` aponta o(s) widget(s) dominante(s); `(erro)` = falhou (timeout).
--    Anote quais widgets dominam antes de seguir — os passos abaixo confirmam
--    a CAUSA (subconsulta de match vs volume de linhas do recorte).
-- ============================================================

-- ============================================================
-- 8) Magnitude de `record_matches` (o `match:` custa proporcional a isto POR
--    LINHA do agregado). Muitos matches por registro = subconsulta cara.
-- ============================================================
select count(*) as total_matches,
       count(distinct record_a_id) as com_match_a,
       count(*) filter (where mode = 'manual') as manuais
from public.record_matches;

-- Distribuição de matches por registro (cauda longa = registros com muitos
-- parceiros → o `order by … limit 1` por linha fica caro):
select n_matches, count(*) as qtd_registros
from (
  select r.id,
         (select count(*) from public.record_matches rm
          where rm.record_a_id = r.id or rm.record_b_id = r.id) as n_matches
  from public.records r
  where not r.is_mock
) s
group by n_matches
order by n_matches desc
limit 20;

-- ============================================================
-- 9) pg_stat_statements: custo real por chamada das SELECTs geradas pelo RPC
--    que tocam record_matches. (Extensão padrão no Supabase; se vazio, habilite
--    em Database → Extensions e aguarde acumular chamadas.)
-- ============================================================
select calls,
       round(mean_exec_time::numeric, 1) as mean_ms,
       round(total_exec_time::numeric, 1) as total_ms,
       left(query, 140) as query
from pg_stat_statements
where query ilike '%record_matches%'
order by total_exec_time desc
limit 20;

-- ============================================================
-- 10) EXPLAIN da subconsulta de `match:` (decide "índice basta" vs "reescrever
--     o RPC"). Reconstrução representativa de _widget_match_expr para UMA
--     coluna match: agregada sobre o recorte do dashboard (AJUSTE record_type,
--     a coluna/valores de data e a fonte alvo 'lead'/'negocio'/'venda_site'
--     conforme o widget dominante do passo 7).
--
--     O QUE PROCURAR no plano:
--     - o SubPlan correlacionado deve usar `Index Scan using
--       idx_record_matches_a_created / _b_created` (0077). Se aparecer
--       `Seq Scan on record_matches` ou um `BitmapOr` caro, os índices não
--       estão ajudando → candidato à reescrita (union all de dois ramos).
--     - `loops=` do SubPlan ≈ nº de linhas do recorte: se o tempo TOTAL é
--       loops × (tempo por loop) e o recorte já está limitado por período, o
--       gargalo é o padrão POR LINHA — a correção é estrutural (reescrever
--       `_widget_match_expr`/`_widget_match_expr_snap` numa migração ESPELHADA),
--       não mais índice.
-- ============================================================
explain (analyze, buffers)
select
  count(*) as metric_1,
  count(nullif((
    select mm.title from public.records mm where mm.id = (
      select case when rm.record_a_id = records.id then rm.record_b_id
                   else rm.record_a_id end
      from public.record_matches rm
      join public.records p on p.id = (case when rm.record_a_id = records.id
                                            then rm.record_b_id else rm.record_a_id end)
      where (rm.record_a_id = records.id or rm.record_b_id = records.id)
        and p.record_type = 'lead'          -- << fonte alvo do match: (ajuste)
      order by (rm.mode = 'manual') desc, rm.created_at desc
      limit 1)
  ), '')) as metric_2
from public.records
where not is_mock
  and record_type = 'negocio'               -- << fonte das LINHAS do widget (ajuste)
  and closed_at >= '2026-01-01'             -- << recorte do período (ajuste col/datas)
  and closed_at <= '2026-12-31';
