-- Versão: 1.0 | Data: 11/07/2026
-- Adiciona o transform de dimensão `weekday` (dia da semana) ao run_widget_query:
-- agrupa por extract(isodow) (1=segunda … 7=domingo); o rótulo PT-BR (Segunda-feira…)
-- é montado no engine (lib/widgets/date-buckets.ts). Recria a mesma função de
-- 0034_widget_rpc_date_buckets.sql apenas acrescentando esse ramo. Os transforms
-- quarter/year continuam com date_trunc (a rotulagem "T1/26"/"2026" é no engine).
-- Idempotente (create or replace).

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
  v_expr text; v_op text; v_val jsonb;
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

    if v_field like 'unified:%' then
      v_expr := public._widget_unified_expr(substring(v_field from 9), p_correspondences, false);
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
      if v_field is null or v_field = '*' then
        v_expr := 'count(*)';
      elsif v_field like 'unified:%' then
        v_expr := format('count(%s)', public._widget_unified_expr(substring(v_field from 9), p_correspondences, false));
      elsif v_field like 'custom:%' then
        v_expr := format('count(custom_fields ->> %L)', substring(v_field from 8));
      elsif v_field = any(v_allowed_cols) then
        v_expr := format('count(%I)', v_field);
      else
        raise exception 'Coluna de métrica não permitida: %', v_field;
      end if;
    else
      if v_field like 'unified:%' then
        v_expr := format('%s(%s)', v_agg, public._widget_unified_expr(substring(v_field from 9), p_correspondences, true));
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

    -- Busca textual (contém). O field pode unir vários campos com '|' → OR entre
    -- colunas. Cada subcampo é resolvido/validado pela MESMA whitelist.
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
    elsif v_op = 'in' then
      v_where_parts := v_where_parts || format(
        '%s in (select jsonb_array_elements_text(%L::jsonb))', v_expr, coalesce(v_val, '[]'::jsonb)::text
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
