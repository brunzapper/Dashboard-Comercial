-- Versão: 1.0 | Data: 07/09/2026
-- v1.0 (07/09/2026): job pg_cron nº 8 — retenção do audit_log. Mantém apenas
--   as 100 alterações mais recentes por (organização, origem, campo) e apaga o
--   resto, todo dia às 03:40 UTC (00:40 em Brasília).
--
-- SQL puro no próprio banco — sem hop HTTP, mesmo desenho de
-- purge-dashboard-trash e purge-records-trash. O audit_log é folha: nada
-- referencia a tabela, e o `record_id` que ela referencia é `on delete
-- cascade` a partir de `records`. Apagar linhas daqui não cascateia para
-- lugar nenhum e não dispara trigger (audit_log_set_org é BEFORE INSERT).
--
-- PARTIÇÃO POR ORGANIZAÇÃO: sem `organization_id` na partição, o volume de
-- uma organização despejaria o rastro de outra — a tabela é global e o sync
-- de uma org sozinho gera 99% das linhas. Hoje há 1 org; a partição existe
-- para quando não houver.
--
-- ORDEM: rode `apply/sanitize-audit-log.sql` ANTES deste arquivo. Ele aplica
-- a mesma regra retroativamente às ~868 mil linhas acumuladas e roda o
-- VACUUM FULL que devolve o espaço ao disco (o DELETE diário daqui em diante
-- é de poucas centenas de linhas — o autovacuum dá conta). Instalar o cron
-- primeiro funciona, mas a primeira execução vai apagar ~850 mil linhas de
-- uma vez e demorar bastante, sem devolver o espaço.
--
-- Aplicar UMA vez no SQL editor do Supabase.

create extension if not exists pg_cron;

select cron.schedule(
  'purge-audit-log',
  '40 3 * * *',  -- diário às 03:40 UTC (00:40 em Brasília)
  $$
  delete from public.audit_log a
  where a.id in (
    select id
    from (
      select id,
             row_number() over (
               partition by organization_id, origin, field
               order by changed_at desc, id desc
             ) as rn
      from public.audit_log
    ) t
    where rn > 100
  );
  $$
);

-- Verificação:
--   select * from cron.job;
--   select * from cron.job_run_details order by start_time desc limit 20;
--
-- Conferir a regra (deve voltar VAZIO após a primeira execução):
--   select organization_id, origin, field, count(*)
--   from public.audit_log
--   group by organization_id, origin, field
--   having count(*) > 100;
--
-- Para remover: select cron.unschedule('purge-audit-log');
