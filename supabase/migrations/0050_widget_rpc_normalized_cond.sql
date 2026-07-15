-- Versão: 1.0 | Data: 15/07/2026
-- Operadores NORMALIZADOS para as condições de SOMASE/CONT.SE/MÉDIASE
-- (fórmulas calculadas de agregados), espelhando a semântica do SE() no
-- avaliador JS (lib/records/formulas.ts):
--   eq_ci / neq_ci  — igualdade de texto normalizada: lower(btrim(...)),
--     booleanos canonizados (verdadeiro/sim/true → 'true'; falso/não/nao/
--     false → 'false') e null ≡ '' (campo vazio casa `= ""` e satisfaz
--     `<> "Ganho"`). Colunas de data do núcleo caem na comparação tipada
--     plain (data não tem caixa).
--   eq_num / neq_num / gt_num / gte_num / lt_num / lte_num — comparação
--     NUMÉRICA com cast seguro (texto que não parseia → não casa em `=`,
--     casa em `<>` via IS DISTINCT FROM, como o valEquals do avaliador).
--     Corrige também a comparação lexicográfica de campos custom numéricos.
-- Os operadores existentes (eq/neq/gt/.../in/ilike/@bucket) NÃO mudam —
-- filtros de widget atuais seguem exatos/case-sensitive.
-- Novos helpers: _widget_norm_text (normalização) e _widget_safe_numeric
-- (cast que devolve null em texto inválido).
-- Recria run_widget_query a partir de 0049_widget_rpc_count_nonempty.sql.
-- Idempotente (create or replace).

-- Canonicaliza texto para comparação normalizada: espelha normStr de
-- lib/records/formulas.ts (trim + minúsculas + booleanos em pt canonizados).
-- coalesce(t,'') faz null ≡ '' (valEquals trata os dois como "vazio").
create or replace function public._widget_norm_text(t text)
returns text
language sql
immutable
set search_path = ''
as $norm$
  select case
    when s.v in ('verdadeiro', 'sim', 'true') then 'true'
    when s.v in ('falso', 'não', 'nao', 'false') then 'false'
    else s.v
  end
  from (select lower(btrim(coalesce(t, '')))) as s(v)
$norm$;

-- Cast numérico seguro: texto que não parseia (ou null) → null, sem exceção.
create or replace function public._widget_safe_numeric(t text)
returns numeric
language plpgsql
immutable
set search_path = ''
as $num$
begin
  return t::numeric;
exception when others then
  return null;
end;
$num$;

create or replace function public.run_widget_query(
  p_source text,
  p_dimensions jsonb default '[]'::jsonb,
  p_metrics jsonb default '[]'::jsonb,
  p_filters jsonb default '[]'::jsonb,
  p_correspondences jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_allowed_cols text[] := array[
    'title',
    'record_type','source_system','owner_user_id','pipeline','stage','stage_semantic',
    'temperature','sale_type','channel','currency','closed','value','mrr',
    'responsible_id','operation_id','related_lead_id','lead_time_days',
    'closed_at','opened_at','source_created_at','source_modified_at',
    'created_at','updated_at','last_synced_at'
  ];
  v_num_cols  text[] := array['value','mrr','lead_time_days'];
  v_date_cols text[] := array[
    'closed_at','opened_at','source_created_at','source_modified_at',
    'created_at','updated_at','last_synced_at'
  ];
  v_select_parts text[] := array[]::text[];
  v_group_parts  text[] := array[]::text[];
  v_where_parts  text[] := array[]::text[];
  v_item jsonb;
  v_field text; v_transform text; v_agg text; v_alias text; v_week_mode text;
  v_expr text; v_op text; v_val jsonb; v_base text;
  v_sql text; v_result jsonb; v_idx int;
begin
  if p_source is distinct from 'records' then
    raise exception 'Fonte não suportada: %', p_source;
  end if;

  -- ===== Dimensões =====
  v_idx := 0;
  for v_item in select value from jsonb_array_elements(coalesce(p_dimensions, '[]'::jsonb))
  loop
    v_idx := v_idx + 1;
    v_field := v_item->>'field';
    v_transform := coalesce(v_item->>'transform', 'none');
    v_week_mode := coalesce(v_item->>'weekMode', 'restricted');
    if v_field is null then raise exception 'Dimensão sem "field"'; end if;

    if v_field = '@rate_date' then
      if v_transform in ('day','week','month','quarter','year') then
        v_expr := format(
          'date_trunc(%L, coalesce(closed_at, opened_at, source_created_at))',
          v_transform
        );
      elsif v_transform = 'none' then
        v_expr := 'coalesce(closed_at, opened_at, source_created_at)';
      else
        raise exception 'transform "%" não suportado para @rate_date', v_transform;
      end if;
    elsif v_field like 'unified:%' then
      -- Campo unificado: sem transform usa o coalesce textual; com transform de
      -- data, os membros viram timestamptz (cast seguro) e aplica a mesma
      -- escada do ramo match:%.
      if v_transform = 'none' then
        v_expr := public._widget_unified_expr(substring(v_field from 9), p_correspondences, false);
      else
        v_base := public._widget_unified_date_expr(substring(v_field from 9), p_correspondences);
        if v_transform in ('day','week','month','quarter','year') then
          v_expr := format('date_trunc(%L, %s)', v_transform, v_base);
        elsif v_transform = 'weekday' then
          v_expr := format('extract(isodow from %s)::int', v_base);
        elsif v_transform in ('month_name','month_year') then
          v_expr := format('date_trunc(%L, %s)', 'month', v_base);
        elsif v_transform = 'week_year' then
          v_expr := format('date_trunc(%L, %s)', 'week', v_base);
        elsif v_transform = 'week_month' then
          if v_week_mode = 'full' then
            v_expr := format('date_trunc(%L, %s)', 'week', v_base);
          else
            v_expr := format('greatest(date_trunc(%L, %s), date_trunc(%L, %s))',
              'week', v_base, 'month', v_base);
          end if;
        else
          raise exception 'transform inválido: %', v_transform;
        end if;
      end if;
    elsif v_field like 'match:%' then
      -- Campo do registro casado: subconsulta escalar (aceita transform de data).
      v_base := public._widget_match_expr(substring(v_field from 7), false);
      if v_transform = 'none' then
        v_expr := v_base;
      elsif v_transform in ('day','week','month','quarter','year') then
        v_expr := format('date_trunc(%L, %s)', v_transform, v_base);
      elsif v_transform = 'weekday' then
        v_expr := format('extract(isodow from %s)::int', v_base);
      elsif v_transform in ('month_name','month_year') then
        v_expr := format('date_trunc(%L, %s)', 'month', v_base);
      elsif v_transform = 'week_year' then
        v_expr := format('date_trunc(%L, %s)', 'week', v_base);
      elsif v_transform = 'week_month' then
        if v_week_mode = 'full' then
          v_expr := format('date_trunc(%L, %s)', 'week', v_base);
        else
          v_expr := format('greatest(date_trunc(%L, %s), date_trunc(%L, %s))',
            'week', v_base, 'month', v_base);
        end if;
      else
        raise exception 'transform inválido: %', v_transform;
      end if;
    elsif v_field like 'custom:%' then
      v_expr := format('(custom_fields ->> %L)', substring(v_field from 8));
    elsif v_field = any(v_allowed_cols) then
      if v_transform <> 'none' then
        if not (v_field = any(v_date_cols)) then
          raise exception 'transform "%" exige coluna de data', v_transform;
        end if;
        if v_transform in ('day','week','month','quarter','year') then
          v_expr := format('date_trunc(%L, %I)', v_transform, v_field);
        elsif v_transform = 'weekday' then
          v_expr := format('extract(isodow from %I)::int', v_field);
        elsif v_transform in ('month_name','month_year') then
          v_expr := format('date_trunc(%L, %I)', 'month', v_field);
        elsif v_transform = 'week_year' then
          v_expr := format('date_trunc(%L, %I)', 'week', v_field);
        elsif v_transform = 'week_month' then
          if v_week_mode = 'full' then
            v_expr := format('date_trunc(%L, %I)', 'week', v_field);
          else
            v_expr := format(
              'greatest(date_trunc(%L, %I), date_trunc(%L, %I))',
              'week', v_field, 'month', v_field
            );
          end if;
        else
          raise exception 'transform inválido: %', v_transform;
        end if;
      else
        v_expr := format('%I', v_field);
      end if;
    else
      raise exception 'Coluna de dimensão não permitida: %', v_field;
    end if;

    v_alias := 'dim_' || v_idx;
    v_select_parts := v_select_parts || format('%s as %I', v_expr, v_alias);
    v_group_parts  := v_group_parts || v_expr;
  end loop;

  -- ===== Métricas =====
  v_idx := 0;
  for v_item in select value from jsonb_array_elements(coalesce(p_metrics, '[]'::jsonb))
  loop
    v_idx := v_idx + 1;
    v_field := v_item->>'field';
    v_agg := lower(coalesce(v_item->>'agg', 'count'));
    if v_agg not in ('sum','count','avg') then
      raise exception 'Agregação inválida: %', v_agg;
    end if;
    v_alias := 'metric_' || v_idx;

    if v_agg = 'count' then
      -- nullif(expr, ''): string vazia conta como "não preenchido" (0049).
      if v_field is null or v_field = '*' then
        v_expr := 'count(*)';
      elsif v_field like 'unified:%' then
        v_expr := format('count(nullif(%s, %L))', public._widget_unified_expr(substring(v_field from 9), p_correspondences, false), '');
      elsif v_field like 'match:%' then
        v_expr := format('count(nullif(%s, %L))', public._widget_match_expr(substring(v_field from 7), false), '');
      elsif v_field like 'custom:%' then
        v_expr := format('count(nullif(custom_fields ->> %L, %L))', substring(v_field from 8), '');
      elsif v_field = any(v_allowed_cols) then
        v_expr := format('count(%I)', v_field);
      else
        raise exception 'Coluna de métrica não permitida: %', v_field;
      end if;
    else
      if v_field like 'unified:%' then
        v_expr := format('%s(%s)', v_agg, public._widget_unified_expr(substring(v_field from 9), p_correspondences, true));
      elsif v_field like 'match:%' then
        v_expr := format('%s(%s)', v_agg, public._widget_match_expr(substring(v_field from 7), true));
      elsif v_field like 'custom:%' then
        v_expr := format('%s(nullif(custom_fields ->> %L, %L)::numeric)', v_agg, substring(v_field from 8), '');
      elsif v_field = any(v_num_cols) then
        v_expr := format('%s(%I)', v_agg, v_field);
      else
        raise exception 'Métrica %/% requer coluna numérica', v_agg, coalesce(v_field, 'null');
      end if;
    end if;

    v_select_parts := v_select_parts || format('%s as %I', v_expr, v_alias);
  end loop;

  if array_length(v_select_parts, 1) is null then
    raise exception 'Widget sem dimensões nem métricas';
  end if;

  -- ===== Filtros =====
  for v_item in select value from jsonb_array_elements(coalesce(p_filters, '[]'::jsonb))
  loop
    v_field := v_item->>'field';
    v_op := lower(coalesce(v_item->>'op', 'eq'));
    v_val := v_item->'value';
    if v_field is null then raise exception 'Filtro sem "field"'; end if;

    -- Período por fonte: campo sintético `@period` (op 'between').
    if v_field = '@period' and v_op = 'between' then
      declare
        v_from text := v_val->>'from';
        v_to   text := v_val->>'to';
        v_or   text[] := array[]::text[];
        v_rt   text;
        v_col  text;
        v_colexpr text;
        v_conds text[];
      begin
        for v_rt, v_col in
          select key, value from jsonb_each_text(coalesce(v_val->'byType', '{}'::jsonb))
        loop
          -- Coluna de data por fonte: núcleo OU custom (comparação textual —
          -- os valores de data em custom_fields são ISO, ordem lexicográfica
          -- correta; mesmo precedente do ramo de filtro custom abaixo).
          if v_col like 'custom:%' then
            v_colexpr := format('(custom_fields ->> %L)', substring(v_col from 8));
          elsif v_col = any(v_date_cols) then
            v_colexpr := format('%I', v_col);
          else
            raise exception 'Coluna de data inválida no período: %', v_col;
          end if;
          v_conds := array[ format('record_type = %L', v_rt) ];
          if v_from is not null and v_from <> '' then
            v_conds := v_conds || format('%s >= %L', v_colexpr, v_from);
          end if;
          if v_to is not null and v_to <> '' then
            v_conds := v_conds || format('%s <= %L', v_colexpr, v_to);
          end if;
          v_or := v_or || ('(' || array_to_string(v_conds, ' and ') || ')');
        end loop;
        if array_length(v_or, 1) is not null then
          v_where_parts := v_where_parts || ('(' || array_to_string(v_or, ' or ') || ')');
        end if;
      end;
      continue;
    end if;

    -- Filtro rápido por BUCKET de data (formato das dimensões): campo sintético
    -- `@bucket` (op 'in'). value = { field, transform, weekMode, keys: [...] }.
    -- A chave canônica gerada aqui DEVE bater com canonicalBucketKey no cliente.
    if v_field = '@bucket' and v_op = 'in' then
      declare
        v_bfield text := v_val->>'field';
        v_btrans text := coalesce(v_val->>'transform', 'none');
        v_bweek  text := coalesce(v_val->>'weekMode', 'restricted');
        v_keys   jsonb := coalesce(v_val->'keys', '[]'::jsonb);
        v_dexpr  text;
        v_kexpr  text;
      begin
        if v_bfield is null or v_bfield = '' then
          raise exception 'Filtro @bucket sem "field"';
        end if;
        if jsonb_typeof(v_keys) is distinct from 'array'
           or jsonb_array_length(v_keys) = 0 then
          continue; -- sem seleção = sem filtro
        end if;

        -- Expressão de data (timestamptz) do campo, com os mesmos helpers das
        -- dimensões: núcleo/custom (cast seguro), unificado e registro casado.
        if v_bfield like 'unified:%' then
          v_dexpr := public._widget_unified_date_expr(substring(v_bfield from 9), p_correspondences);
        elsif v_bfield like 'match:%' then
          v_dexpr := public._widget_match_expr(substring(v_bfield from 7), false);
        else
          v_dexpr := public._widget_col_date_expr(v_bfield);
        end if;

        v_kexpr := case v_btrans
          when 'weekday'    then format('extract(isodow from %s)::int::text', v_dexpr)
          when 'month_name' then format('extract(month from %s)::int::text', v_dexpr)
          when 'year'       then format('extract(year from %s)::int::text', v_dexpr)
          when 'quarter'    then format('to_char(%s, %L)', v_dexpr, 'YYYY-"Q"Q')
          when 'month_year' then format('to_char(%s, %L)', v_dexpr, 'YYYY-MM')
          when 'week_year'  then format('to_char(date_trunc(%L, %s), %L)', 'week', v_dexpr, 'YYYY-MM-DD')
          when 'week_month' then
            case when v_bweek = 'full'
              then format('to_char(date_trunc(%L, %s), %L)', 'week', v_dexpr, 'YYYY-MM-DD')
              else format('to_char(greatest(date_trunc(%L, %s), date_trunc(%L, %s)), %L)',
                'week', v_dexpr, 'month', v_dexpr, 'YYYY-MM-DD')
            end
          else null
        end;
        if v_kexpr is null then
          raise exception 'transform inválido no @bucket: %', v_btrans;
        end if;

        v_where_parts := v_where_parts || format(
          '%s in (select jsonb_array_elements_text(%L::jsonb))', v_kexpr, v_keys::text
        );
      end;
      continue;
    end if;

    -- Busca textual (contém).
    if v_op = 'ilike' then
      declare
        v_or text[] := array[]::text[];
        v_sub text;
        v_sub_expr text;
        v_term text := '%' ||
          (case when jsonb_typeof(v_val) = 'string' then v_val #>> '{}'
                else coalesce(v_val::text, '') end) || '%';
      begin
        foreach v_sub in array string_to_array(v_field, '|')
        loop
          if v_sub is null or v_sub = '' then continue; end if;
          if v_sub like 'unified:%' then
            v_sub_expr := public._widget_unified_expr(substring(v_sub from 9), p_correspondences, false);
          elsif v_sub like 'match:%' then
            v_sub_expr := public._widget_match_expr(substring(v_sub from 7), false);
          else
            v_sub_expr := public._widget_col_expr(v_sub, false);
          end if;
          v_or := v_or || format('%s ilike %L', v_sub_expr, v_term);
        end loop;
        if array_length(v_or, 1) is not null then
          v_where_parts := v_where_parts || ('(' || array_to_string(v_or, ' or ') || ')');
        end if;
      end;
      continue;
    end if;

    if v_field like 'unified:%' then
      v_expr := public._widget_unified_expr(substring(v_field from 9), p_correspondences, false);
    elsif v_field like 'match:%' then
      v_expr := public._widget_match_expr(substring(v_field from 7), false);
    elsif v_field like 'custom:%' then
      v_expr := format('(custom_fields ->> %L)', substring(v_field from 8));
    elsif v_field = any(v_allowed_cols) then
      v_expr := format('%I', v_field);
    else
      raise exception 'Coluna de filtro não permitida: %', v_field;
    end if;

    if v_op = 'is_null' then
      v_where_parts := v_where_parts || format('%s is null', v_expr);
    elsif v_op = 'not_null' then
      v_where_parts := v_where_parts || format('%s is not null', v_expr);
    elsif v_op in ('eq_ci', 'neq_ci') then
      -- Igualdade de texto NORMALIZADA (0050; condições de SOMASE/CONT.SE):
      -- lower(btrim(...)) + booleanos canonizados + null ≡ ''. Colunas de data
      -- do núcleo comparam tipado plain (data não tem caixa).
      declare
        v_txt text := case when jsonb_typeof(v_val) = 'string'
          then v_val #>> '{}' else coalesce(v_val::text, '') end;
        v_cmp text := case when v_op = 'eq_ci' then '=' else '<>' end;
      begin
        if v_field = any(v_date_cols) then
          v_where_parts := v_where_parts || format('%s %s %L', v_expr, v_cmp, v_txt);
        else
          v_where_parts := v_where_parts || format(
            'public._widget_norm_text((%s)::text) %s public._widget_norm_text(%L)',
            v_expr, v_cmp, v_txt
          );
        end if;
      end;
    elsif v_op in ('eq_num', 'neq_num', 'gt_num', 'gte_num', 'lt_num', 'lte_num') then
      -- Comparação NUMÉRICA com cast seguro (0050; condição com literal
      -- numérico). Campo que não parseia → null: não casa em '=', casa em '<>'
      -- (IS DISTINCT FROM), como o valEquals do avaliador JS.
      declare
        v_num numeric := public._widget_safe_numeric(
          case when jsonb_typeof(v_val) = 'string'
            then v_val #>> '{}' else v_val::text end
        );
        v_lhs text;
        v_cmp text := case v_op
          when 'eq_num' then '=' when 'gt_num' then '>'
          when 'gte_num' then '>=' when 'lt_num' then '<'
          when 'lte_num' then '<=' else '<>' end;
      begin
        if v_num is null then
          raise exception 'Valor numérico inválido no filtro: %', v_val;
        end if;
        if v_field = any(v_num_cols) then
          v_lhs := v_expr;
        else
          v_lhs := format(
            'public._widget_safe_numeric(nullif((%s)::text, %L))', v_expr, ''
          );
        end if;
        if v_op = 'neq_num' then
          v_where_parts := v_where_parts || format('%s is distinct from %s', v_lhs, v_num);
        else
          v_where_parts := v_where_parts || format('%s %s %s', v_lhs, v_cmp, v_num);
        end if;
      end;
    elsif v_op = 'in' then
      -- `::text` no lado esquerdo: a lista vem do jsonb como TEXTO; colunas
      -- uuid (responsible_id/operation_id) não comparam com text sem cast.
      v_where_parts := v_where_parts || format(
        '(%s)::text in (select jsonb_array_elements_text(%L::jsonb))', v_expr, coalesce(v_val, '[]'::jsonb)::text
      );
    else
      v_op := case v_op
        when 'eq'  then '='
        when 'neq' then '<>'
        when 'gt'  then '>'
        when 'gte' then '>='
        when 'lt'  then '<'
        when 'lte' then '<='
        else null
      end;
      if v_op is null then raise exception 'Operador inválido'; end if;
      v_where_parts := v_where_parts || format('%s %s %L', v_expr, v_op,
        case when jsonb_typeof(v_val) = 'string' then v_val #>> '{}' else v_val::text end);
    end if;
  end loop;

  -- ===== Monta e executa =====
  v_sql := 'select coalesce(jsonb_agg(t), ''[]''::jsonb) from (select '
        || array_to_string(v_select_parts, ', ')
        || ' from public.records';
  if array_length(v_where_parts, 1) is not null then
    v_sql := v_sql || ' where ' || array_to_string(v_where_parts, ' and ');
  end if;
  if array_length(v_group_parts, 1) is not null then
    v_sql := v_sql || ' group by ' || array_to_string(v_group_parts, ', ');
  end if;
  v_sql := v_sql || ') t';

  execute v_sql into v_result;
  return coalesce(v_result, '[]'::jsonb);
end;
$$;

grant execute on function public.run_widget_query(text, jsonb, jsonb, jsonb, jsonb) to authenticated;
