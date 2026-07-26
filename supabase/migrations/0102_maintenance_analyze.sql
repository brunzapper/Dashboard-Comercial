-- Versão: 1.0 | Data: 26/07/2026
-- PERFORMANCE (estatísticas pós-sync em massa): um backfill/reconcile grande
-- reescreve dezenas de milhares de linhas de `records` e deixa as estatísticas
-- do planner defasadas — plano ruim nos RPCs de widget até alguém rodar
-- ANALYZE na mão (era o passo manual do runbook de dashboard lento, manual de
-- manutenção §5). Esta função permite ao runner do sync (service role) disparar
-- o ANALYZE automaticamente ao concluir um job volumoso.
--
-- SECURITY DEFINER é necessário: ANALYZE exige ser dono da tabela (ou MAINTAIN)
-- e a service role não é dona — a função roda como o owner (postgres). ANALYZE
-- pode rodar dentro de transação (VACUUM não — segue fora, no runbook); em
-- plpgsql, comandos utilitários vão via EXECUTE. Escopo fixo e sem parâmetros:
-- nada de SQL dinâmico derivado de input.
--
-- Só a service role executa (o runner usa o service client) — nenhum EXECUTE
-- para anon/authenticated. Idempotente (create or replace).

create or replace function public.maintenance_analyze()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  execute 'analyze public.records';
  execute 'analyze public.record_matches';
end;
$$;

revoke execute on function public.maintenance_analyze() from public;
revoke execute on function public.maintenance_analyze() from anon;
revoke execute on function public.maintenance_analyze() from authenticated;
grant execute on function public.maintenance_analyze() to service_role;
