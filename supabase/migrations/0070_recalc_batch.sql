-- Versão: 1.0 | Data: 17/07/2026
-- PERFORMANCE (recalc em lote): recalcAllFormulaFields (lib/records/recalc.ts)
-- fazia UM UPDATE por linha alterada, em série — O(N) round trips a cada
-- recálculo (diário via /api/sync/recalc-daily, pós-import, pós-match e ao
-- editar fórmula/moeda, que bloqueia a UI). Esta função aplica um lote inteiro
-- num único UPDATE set-based.
--
-- Semântica preservada: os triggers BEFORE por linha (trg_records_updated_at,
-- trg_records_reuniao_freeze/0051) disparam identicamente em UPDATE set-based;
-- o recalc segue NÃO setando app.reuniao_freeze_bypass (o freeze de Data
-- Reunião continua governando o recalc, como documentado na 0051).
-- custom_fields nulo no item = "não mexer"; lead_time_days usa flag
-- set_lead_time porque o valor novo pode ser legitimamente NULL.
--
-- Só a service role executa (o recalc roda com o service client) — nenhum
-- EXECUTE para anon/authenticated. Idempotente (create or replace).

create or replace function public.recalc_apply_updates(p_updates jsonb)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_count integer;
begin
  update public.records r
  set custom_fields  = coalesce(u.custom_fields, r.custom_fields),
      lead_time_days = case when u.set_lead_time then u.lead_time_days
                            else r.lead_time_days end
  from jsonb_to_recordset(p_updates)
       as u(id uuid, custom_fields jsonb, set_lead_time boolean, lead_time_days numeric)
  where r.id = u.id;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke execute on function public.recalc_apply_updates(jsonb) from public;
revoke execute on function public.recalc_apply_updates(jsonb) from anon;
revoke execute on function public.recalc_apply_updates(jsonb) from authenticated;
grant execute on function public.recalc_apply_updates(jsonb) to service_role;
