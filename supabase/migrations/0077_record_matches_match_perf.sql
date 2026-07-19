-- Versão: 1.0 | Data: 19/07/2026
-- PERFORMANCE (índices em record_matches): assiste a subconsulta escalar
-- correlacionada de `_widget_match_expr` (0042), que resolve o registro casado
-- (colunas `match:<fonte>:<campo>` dos widgets) POR LINHA do agregado:
--
--     ... from public.record_matches rm
--     where (rm.record_a_id = records.id or rm.record_b_id = records.id)
--       and p.record_type = '<fonte>'
--     order by (rm.mode = 'manual') desc, rm.created_at desc
--     limit 1
--
-- Os índices da 0041 (`idx_record_matches_a/b`) são de COLUNA ÚNICA: servem o
-- predicado de igualdade, mas não trazem os candidatos já ordenados por
-- `created_at desc`, então cada linha ainda paga um sort do `limit 1`. Os
-- compostos abaixo entregam os matches de um registro pré-ordenados por
-- `created_at desc` (chave secundária do order by), tornando o `limit 1` um
-- index scan barato quando o plano usa um ramo por coluna. `desc` casa a
-- direção do order by; a maioria dos registros tem 0–1 match, então o resíduo
-- do sort por `mode='manual'` (chave primária) é desprezível — por isso não
-- indexamos `mode` (manter o índice enxuto).
--
-- ATENÇÃO (escopo): índice NÃO altera resultado de query — mesmas linhas,
-- mesmos totais, mesma ordem; muda só o plano/velocidade. Não toca os RPCs,
-- portanto NÃO exige espelhamento com run_widget_query_snapshot (regra do
-- projeto vale para recriação de função, não para índices). O gargalo residual
-- de fato é a subconsulta rodar por linha (fator O(nº de linhas) do agregado),
-- que índice não remove — se o EXPLAIN (supabase/apply/diagnostico-perf.sql,
-- seção per-dashboard) mostrar esse padrão dominando, a correção estrutural é a
-- reescrita espelhada de `_widget_match_expr` (migração futura). Idempotente.

create index if not exists idx_record_matches_a_created
  on public.record_matches (record_a_id, created_at desc);

create index if not exists idx_record_matches_b_created
  on public.record_matches (record_b_id, created_at desc);

-- Estatísticas novas para o planejador enxergar os índices na hora (barato;
-- roda dentro de transação, então funciona no SQL editor do Supabase).
analyze public.record_matches;
