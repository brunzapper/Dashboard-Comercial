-- Versão: 1.0 | Data: 07/09/2026
-- v1.0 (07/09/2026): saneamento ÚNICO do audit_log — aplica retroativamente a
--   regra de retenção "últimas 100 alterações por (organização, origem, campo)"
--   que o job `purge-audit-log` (apply/pg-cron-purge-audit-log.sql) passa a
--   manter todo dia. Rode ESTE arquivo uma vez; depois instale o cron.
--
-- ============================ POR QUE ============================
-- O audit_log é ESCRITO por 9 caminhos (updateRecord/createRecord,
-- bulk-update, lixeira, sync Bitrix, sync Sheets, ingest/CSV, ações em massa e
-- automações do kanban) e NUNCA é lido: não há um único `select` na tabela em
-- todo o TypeScript, nenhum trigger/view/função em SQL e nenhuma tela de
-- histórico. `pg_stat_user_tables` confirma — seq_scan = 0, idx_scan = 0.
--
-- Medição em 07/09/2026 (produção): 868.178 linhas / 163 MB = 40% do banco
-- inteiro (414 MB), contra 224 MB de shared_buffers. Composição:
--
--   sync_bitrix  862.544  (99,4%)
--   import_csv     5.004
--   app              594   ← as únicas edições humanas
--   sync_sheet        36
--
-- Dois campos sozinhos são 30% da tabela: `source_modified_at` (132.985) e
-- `source_created_at` (126.642). O segundo é resíduo MORTO do churn de
-- comparação byte-a-byte de timestamptz corrigido em 26/07/2026 por
-- `timestampValuesDiffer` (lib/sync/shared.ts) — só 52 das 126 mil linhas são
-- dos últimos 30 dias.
--
-- ATENÇÃO: isto NÃO acelera dashboards. As consultas de widget já rodam 100%
-- em RAM (shared_blks_read ~ 1,4 por chamada) e o gargalo é CPU da instância.
-- O ganho aqui é indireto: menos pressão no cache, backups menores, banco
-- cabendo com folga em memória.
--
-- ======================= IMPACTO ESPERADO ========================
-- Regra: manter as 100 mais recentes por (organization_id, origin, field).
-- Simulado em 07/09/2026 — 283 pares origem×campo, 253 campos distintos:
--
--   origem        hoje      mantidas   apagadas
--   sync_bitrix   862.544     14.941    847.603
--   import_csv      5.004      1.970      3.034
--   app               594        568         26
--   sync_sheet         36         36          0
--   TOTAL         868.178     17.515    850.663   (-98,0%)
--
-- `organization_id` entra na partição por causa da invariante multi-org: sem
-- ele, o volume de uma organização despejaria o rastro de outra. Hoje há 1
-- org e o resultado é idêntico; a partição é para quando não for.
--
-- ===================== ORDEM DE APLICAÇÃO ========================
-- Rode os passos NA ORDEM, um de cada vez, no SQL Editor do Supabase.
-- O passo 3 (VACUUM FULL) toma ACCESS EXCLUSIVE na tabela: é seguro
-- justamente porque ninguém LÊ o audit_log — o único impacto são os INSERTs
-- do sync durante alguns segundos. Rode fora do minuto do tick do Bitrix.


-- ============ PASSO 0 — fotografia do antes (guarde o resultado) ============
select origin,
       count(*)                as linhas,
       min(changed_at)::date   as mais_antigo,
       max(changed_at)::date   as mais_recente
from public.audit_log
group by origin
order by count(*) desc;

select pg_size_pretty(pg_total_relation_size('public.audit_log')) as total,
       pg_size_pretty(pg_relation_size('public.audit_log'))       as heap,
       pg_size_pretty(pg_indexes_size('public.audit_log'))        as indices;


-- ============ PASSO 1 — materializar os ids sobreviventes ============
-- Tabela REAL, não TEMP: o SQL Editor do Supabase não garante a mesma sessão
-- entre execuções, e uma temp table sumiria antes do passo 2.
drop table if exists public.audit_log_keep;

create table public.audit_log_keep as
select id
from (
  select id,
         row_number() over (
           partition by organization_id, origin, field
           order by changed_at desc, id desc
         ) as rn
  from public.audit_log
) t
where rn <= 100;

create unique index on public.audit_log_keep (id);
analyze public.audit_log_keep;

-- Confira ANTES de apagar qualquer coisa (esperado ~17.515):
select count(*) as vao_sobreviver from public.audit_log_keep;


-- ============ PASSO 2 — apagar o resto ============
-- Anti-join contra a tabela do passo 1. ~850 mil linhas: o timeout padrão do
-- SQL Editor não basta, por isso o `set` abaixo (vale só para esta sessão).
set statement_timeout = '10min';

delete from public.audit_log a
where not exists (
  select 1 from public.audit_log_keep k where k.id = a.id
);

-- SE O PASSO 2 ESTOURAR O TEMPO (instância pequena, WAL cheio), use a versão
-- em lotes: rode o bloco abaixo REPETIDAS VEZES até ele reportar 0 linhas.
-- Cada execução é uma transação curta e independente.
--
--   delete from public.audit_log a
--   where a.id in (
--     select a2.id
--     from public.audit_log a2
--     where not exists (
--       select 1 from public.audit_log_keep k where k.id = a2.id
--     )
--     limit 50000
--   );


-- ============ PASSO 3 — devolver o espaço ao disco ============
-- DELETE só marca tuplas mortas; sem VACUUM FULL os 163 MB continuam
-- ocupados. Não pode rodar dentro de bloco de transação — statement próprio.
-- Reconstrói também o índice idx_audit_record (40 MB dos 163).
vacuum full public.audit_log;
analyze public.audit_log;


-- ============ PASSO 4 — limpeza ============
drop table if exists public.audit_log_keep;


-- ============ PASSO 5 — conferência ============
-- Esperado: ~17.515 linhas no total, nenhum par (origem, campo) acima de 100,
-- e o tamanho total na casa de poucos MB.
select count(*) as linhas_agora from public.audit_log;

select organization_id, origin, field, count(*) as n
from public.audit_log
group by organization_id, origin, field
having count(*) > 100
order by n desc;
-- ↑ deve voltar VAZIO.

select pg_size_pretty(pg_total_relation_size('public.audit_log')) as total,
       pg_size_pretty(pg_relation_size('public.audit_log'))       as heap,
       pg_size_pretty(pg_indexes_size('public.audit_log'))        as indices;

-- Depois disto, instale apply/pg-cron-purge-audit-log.sql para que a regra
-- passe a ser mantida sozinha, todo dia.
