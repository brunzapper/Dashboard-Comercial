-- Versão: 1.0 | Data: 13/07/2026
-- Auto-fonte em `match:<fonte>:<ref>`: quando o record_type do registro é a
-- própria fonte alvo, resolve para o PRÓPRIO registro (um registro nunca casa
-- com outro da mesma fonte, então antes disto `match:<própria fonte>` dava sempre
-- null). Assim `↪ <própria fonte>` num campo calculado/widget vale o dado deste
-- registro. Espelha lib/records/recalc.ts e lib/widgets/record-list.ts.
-- Recria SÓ o helper _widget_match_expr de 0042_widget_rpc_match.sql; a
-- run_widget_query continua chamando-o. Idempotente.

create or replace function public._widget_match_expr(p_spec text, p_numeric boolean)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_pos int := position(':' in p_spec);
  v_src text;
  v_ref text;
  v_rt text;
  v_inner text;
  v_match_sub text;
  v_lead_sub text;
  v_partner text;
begin
  if v_pos = 0 then
    raise exception 'match: sem "<fonte>:<campo>" — %', p_spec;
  end if;
  v_src := substring(p_spec from 1 for v_pos - 1);
  v_ref := substring(p_spec from v_pos + 1);
  v_rt := case v_src
    when 'leads' then 'lead'
    when 'deals' then 'negocio'
    when 'estudo' then 'venda_site'
    else null
  end;
  if v_rt is null then
    raise exception 'Fonte de match inválida: %', v_src;
  end if;

  -- Coluna do registro casado (mm). _widget_col_expr devolve refs sem qualificar;
  -- dentro da subconsulta só mm (public.records) tem essas colunas. A MESMA
  -- expressão, sem qualificar, resolve para o `records` externo no ramo auto-fonte.
  v_inner := public._widget_col_expr(v_ref, p_numeric);

  -- O SELECT do valor tem SÓ public.records mm no FROM (assim v_inner, sem
  -- qualificar, resolve para mm — evita ambiguidade com colunas homônimas de
  -- record_matches, ex.: created_at). A escolha do parceiro (prioriza manual,
  -- depois mais recente, filtra pela fonte alvo) vai numa subconsulta interna.
  v_match_sub :=
    '(select ' || v_inner || ' from public.records mm where mm.id = (' ||
    'select case when rm.record_a_id = records.id then rm.record_b_id' ||
    '   else rm.record_a_id end' ||
    ' from public.record_matches rm' ||
    ' join public.records p on p.id = (case when rm.record_a_id = records.id' ||
    '   then rm.record_b_id else rm.record_a_id end)' ||
    ' where (rm.record_a_id = records.id or rm.record_b_id = records.id)' ||
    '   and p.record_type = ' || quote_literal(v_rt) ||
    ' order by (rm.mode = ''manual'') desc, rm.created_at desc limit 1))';

  if v_rt = 'lead' then
    v_lead_sub :=
      '(select ' || v_inner ||
      ' from public.records mm where mm.id = records.related_lead_id)';
    v_partner := 'coalesce(' || v_match_sub || ', ' || v_lead_sub || ')';
  else
    v_partner := v_match_sub;
  end if;

  -- Auto-fonte: o parceiro casado tem precedência (inclui o fallback do lead);
  -- se não houver parceiro e o registro for da própria fonte alvo, cai no PRÓPRIO
  -- registro (v_inner sem qualificar → resolve contra o `records` externo). Espelha
  -- o `??=` de recalc.ts e record-list.ts.
  return 'coalesce(' || v_partner ||
    ', case when records.record_type = ' || quote_literal(v_rt) ||
    ' then ' || v_inner || ' else null end)';
end;
$$;
