-- Versão: 1.0 | Data: 15/07/2026
-- Snapshots × mocks de "Data Reunião" (0051/0053): os mocks passam a entrar
-- SEMPRE no dataset congelado, ignorando as restrições do snapshot
-- (responsáveis/operações/fontes) — antes, um snapshot restrito por
-- responsáveis deixava os mocks de fora (responsável casado por nome, às
-- vezes NULL) e os widgets de Data Reunião divergiam do dashboard.
-- A regra da 0052 segue intacta: mock só conta em consulta que referencia as
-- chaves de Data Reunião (`not is_mock` nas demais).
--
-- Junto com isso, as RESTRIÇÕES do snapshot passam a ser aplicadas DENTRO de
-- run_widget_query_snapshot (predicado `(is_mock or restrições)` lido da
-- própria linha do snapshot) em vez de filtros injetados pelo viewer — que,
-- por serem AND puros, derrubavam os mocks. Defesa em profundidade continua
-- em dupla camada, agora inteiramente no banco: cópia restrita (linhas reais
-- fora da restrição nem existem) + predicado interno do RPC.
--
-- Recria (create or replace) as duas funções da 0056_snapshots.sql — o resto
-- da 0056 (tabelas, RLS, _widget_match_expr_snap) permanece como está.
--
-- ATENÇÃO (manutenção): este arquivo passa a ser a CÓPIA VIGENTE de
-- run_widget_query_snapshot. Toda mudança futura em run_widget_query
-- (0054_widget_rpc_filter_sources.sql) deve ser espelhada AQUI (não mais na
-- 0056). Idempotente.

-- ============ Função: snapshot_refresh_copy ============
-- Igual à 0056, com UMA mudança: mocks são copiados incondicionalmente como
-- linhas de DADOS (`r.is_mock or (restrições)`).
create or replace function public.snapshot_refresh_copy(p_snapshot_id uuid)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_snap public.snapshots%rowtype;
  v_rows integer := 0;
begin
  select * into v_snap from public.snapshots where id = p_snapshot_id;
  if not found then
    raise exception 'Snapshot inexistente: %', p_snapshot_id;
  end if;

  delete from public.snapshot_record_matches where snapshot_id = p_snapshot_id;
  delete from public.snapshot_records where snapshot_id = p_snapshot_id;

  -- Linhas de dados: records dentro das restrições (null = sem restrição) OU
  -- mocks de Data Reunião (sempre — a regra 0052 decide na consulta quando
  -- eles contam; is_mock é copiado como está).
  insert into public.snapshot_records (
    snapshot_id, id, record_type, source_system, owner_user_id, title, pipeline,
    stage, stage_semantic, temperature, value, mrr, currency, sale_type, channel,
    closed, closed_at, opened_at, source_created_at, source_modified_at,
    custom_fields, created_at, updated_at, last_synced_at, locally_modified_at,
    responsible_id, operation_id, related_lead_id, lead_time_days, is_mock,
    partner_only
  )
  select
    p_snapshot_id, r.id, r.record_type, r.source_system, r.owner_user_id,
    r.title, r.pipeline, r.stage, r.stage_semantic, r.temperature, r.value,
    r.mrr, r.currency, r.sale_type, r.channel, r.closed, r.closed_at,
    r.opened_at, r.source_created_at, r.source_modified_at, r.custom_fields,
    r.created_at, r.updated_at, r.last_synced_at, r.locally_modified_at,
    r.responsible_id, r.operation_id, r.related_lead_id, r.lead_time_days,
    r.is_mock, false
  from public.records r
  where r.is_mock
     or ((v_snap.allowed_sources is null
          or r.record_type = any (v_snap.allowed_sources))
     and (v_snap.allowed_responsible_ids is null
          or r.responsible_id = any (v_snap.allowed_responsible_ids))
     and (v_snap.allowed_operation_ids is null
          or r.operation_id = any (v_snap.allowed_operation_ids)));

  get diagnostics v_rows = row_count;

  -- Matches com ao menos um lado dentro do snapshot.
  insert into public.snapshot_record_matches
    (snapshot_id, record_a_id, record_b_id, mode, created_at)
  select p_snapshot_id, rm.record_a_id, rm.record_b_id, rm.mode, rm.created_at
  from public.record_matches rm
  where exists (
    select 1 from public.snapshot_records sr
    where sr.snapshot_id = p_snapshot_id
      and sr.id in (rm.record_a_id, rm.record_b_id)
  );

  -- Parceiros ausentes (lado de fora dos matches + related_lead_id): entram
  -- SÓ para resolver colunas match:<fonte>:<ref>, marcados partner_only.
  insert into public.snapshot_records (
    snapshot_id, id, record_type, source_system, owner_user_id, title, pipeline,
    stage, stage_semantic, temperature, value, mrr, currency, sale_type, channel,
    closed, closed_at, opened_at, source_created_at, source_modified_at,
    custom_fields, created_at, updated_at, last_synced_at, locally_modified_at,
    responsible_id, operation_id, related_lead_id, lead_time_days, is_mock,
    partner_only
  )
  select
    p_snapshot_id, r.id, r.record_type, r.source_system, r.owner_user_id,
    r.title, r.pipeline, r.stage, r.stage_semantic, r.temperature, r.value,
    r.mrr, r.currency, r.sale_type, r.channel, r.closed, r.closed_at,
    r.opened_at, r.source_created_at, r.source_modified_at, r.custom_fields,
    r.created_at, r.updated_at, r.last_synced_at, r.locally_modified_at,
    r.responsible_id, r.operation_id, r.related_lead_id, r.lead_time_days,
    r.is_mock, true
  from public.records r
  where r.id in (
      select m.record_a_id from public.snapshot_record_matches m
      where m.snapshot_id = p_snapshot_id
      union
      select m.record_b_id from public.snapshot_record_matches m
      where m.snapshot_id = p_snapshot_id
      union
      select sr.related_lead_id from public.snapshot_records sr
      where sr.snapshot_id = p_snapshot_id and sr.related_lead_id is not null
    )
    and not exists (
      select 1 from public.snapshot_records sr2
      where sr2.snapshot_id = p_snapshot_id and sr2.id = r.id
    );

  return v_rows;
end;
$$;

revoke execute on function public.snapshot_refresh_copy(uuid) from public, anon, authenticated;
grant execute on function public.snapshot_refresh_copy(uuid) to service_role;

-- ============ Função: run_widget_query_snapshot ============
-- Cópia da 0056 com UM bloco novo: as restrições do snapshot são aplicadas
-- AQUI, mock-aware — `(records.is_mock or (restrições))`. Para consultas sem
-- Data Reunião, o `not is_mock` (regra 0052, mais abaixo) reduz o predicado
-- às restrições puras sobre linhas reais. O viewer NÃO injeta mais filtros de
-- restrição (eram AND puros e derrubavam os mocks).
-- Continua sendo uma cópia do corpo de run_widget_query (0054) com as 3
-- mudanças originais (FROM snapshot_records, escopo por snapshot_id/
-- partner_only e _widget_match_expr_snap) + este bloco.
create or replace function public.run_widget_query_snapshot(
  p_snapshot_id uuid,
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
  -- Fontes-alvo do filtro (pass-through): array jsonb de record_types.
  v_rts jsonb;
  v_sql text; v_result jsonb; v_idx int;
  -- Fase 12: mocks de Data Reunião (0051) só entram em consultas que
  -- referenciam uma das duas chaves do campo (lead/negócio).
  v_mock_params text;
  v_include_mocks boolean := false;
  -- Restrições do snapshot (aplicadas aqui, mock-aware — 0057).
  v_snap public.snapshots%rowtype;
  v_restr text[] := array[]::text[];
begin
  if p_source is distinct from 'records' then
    raise exception 'Fonte não suportada: %', p_source;
  end if;
  if p_snapshot_id is null then
    raise exception 'Snapshot obrigatório';
  end if;

  -- ===== Escopo do snapshot (garantia no banco) =====
  v_where_parts := v_where_parts
    || format('records.snapshot_id = %L', p_snapshot_id)
    || 'not records.partner_only'::text;

  -- ===== Restrições do snapshot, mock-aware (0057) =====
  -- Mocks de Data Reunião ignoram as restrições (entram sempre na cópia);
  -- linhas reais fora da restrição nem existem na cópia — este predicado é a
  -- segunda camada, no próprio banco. Restrição vazia ({}) fica fail-closed
  -- para linhas reais.
  select * into v_snap from public.snapshots where id = p_snapshot_id;
  if not found then
    raise exception 'Snapshot inexistente: %', p_snapshot_id;
  end if;
  if v_snap.allowed_sources is not null then
    v_restr := v_restr
      || format('records.record_type = any (%L::text[])', v_snap.allowed_sources);
  end if;
  if v_snap.allowed_responsible_ids is not null then
    v_restr := v_restr
      || format('records.responsible_id = any (%L::uuid[])', v_snap.allowed_responsible_ids);
  end if;
  if v_snap.allowed_operation_ids is not null then
    v_restr := v_restr
      || format('records.operation_id = any (%L::uuid[])', v_snap.allowed_operation_ids);
  end if;
  if array_length(v_restr, 1) is not null then
    v_where_parts := v_where_parts
      || ('(records.is_mock or (' || array_to_string(v_restr, ' and ') || '))');
  end if;

  -- ===== Regra dos mocks (Fase 12) =====
  v_mock_params := coalesce(p_dimensions::text, '')
    || coalesce(p_metrics::text, '') || coalesce(p_filters::text, '');
  v_include_mocks :=
    v_mock_params like '%bitrix_uf_crm_1743441331%'
    or v_mock_params like '%bitrix_uf_crm_67eacefcccd98%';
  if not v_include_mocks then
    declare
      v_ck text;
      v_carr jsonb;
    begin
      for v_ck, v_carr in
        select key, value from jsonb_each(coalesce(p_correspondences, '{}'::jsonb))
      loop
        if position('unified:' || v_ck in v_mock_params) > 0
           and (v_carr::text like '%bitrix_uf_crm_1743441331%'
                or v_carr::text like '%bitrix_uf_crm_67eacefcccd98%') then
          v_include_mocks := true;
          exit;
        end if;
      end loop;
    end;
  end if;
  if not v_include_mocks then
    v_where_parts := v_where_parts || 'not is_mock'::text;
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
      v_base := public._widget_match_expr_snap(substring(v_field from 7), false);
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
        v_expr := format('count(nullif(%s, %L))', public._widget_match_expr_snap(substring(v_field from 7), false), '');
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
        v_expr := format('%s(%s)', v_agg, public._widget_match_expr_snap(substring(v_field from 7), true));
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
  -- Todo predicado gerado neste loop passa por _widget_wrap_record_types:
  -- com `record_types` no filtro vira o pass-through por fonte; sem, é no-op.
  for v_item in select value from jsonb_array_elements(coalesce(p_filters, '[]'::jsonb))
  loop
    v_field := v_item->>'field';
    v_op := lower(coalesce(v_item->>'op', 'eq'));
    v_val := v_item->'value';
    v_rts := v_item->'record_types';
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
          v_where_parts := v_where_parts || public._widget_wrap_record_types(
            '(' || array_to_string(v_or, ' or ') || ')', v_rts
          );
        end if;
      end;
      continue;
    end if;

    -- Filtro rápido por BUCKET de data (formato das dimensões): campo sintético
    -- `@bucket` (op 'in'). value = { field, transform, weekMode, keys: [...] }.
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

        if v_bfield like 'unified:%' then
          v_dexpr := public._widget_unified_date_expr(substring(v_bfield from 9), p_correspondences);
        elsif v_bfield like 'match:%' then
          v_dexpr := public._widget_match_expr_snap(substring(v_bfield from 7), false);
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

        v_where_parts := v_where_parts || public._widget_wrap_record_types(format(
          '%s in (select jsonb_array_elements_text(%L::jsonb))', v_kexpr, v_keys::text
        ), v_rts);
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
            v_sub_expr := public._widget_match_expr_snap(substring(v_sub from 7), false);
          else
            v_sub_expr := public._widget_col_expr(v_sub, false);
          end if;
          v_or := v_or || format('%s ilike %L', v_sub_expr, v_term);
        end loop;
        if array_length(v_or, 1) is not null then
          v_where_parts := v_where_parts || public._widget_wrap_record_types(
            '(' || array_to_string(v_or, ' or ') || ')', v_rts
          );
        end if;
      end;
      continue;
    end if;

    if v_field like 'unified:%' then
      v_expr := public._widget_unified_expr(substring(v_field from 9), p_correspondences, false);
    elsif v_field like 'match:%' then
      v_expr := public._widget_match_expr_snap(substring(v_field from 7), false);
    elsif v_field like 'custom:%' then
      v_expr := format('(custom_fields ->> %L)', substring(v_field from 8));
    elsif v_field = any(v_allowed_cols) then
      v_expr := format('%I', v_field);
    else
      raise exception 'Coluna de filtro não permitida: %', v_field;
    end if;

    if v_op = 'is_null' then
      v_where_parts := v_where_parts || public._widget_wrap_record_types(
        format('%s is null', v_expr), v_rts);
    elsif v_op = 'not_null' then
      v_where_parts := v_where_parts || public._widget_wrap_record_types(
        format('%s is not null', v_expr), v_rts);
    elsif v_op in ('eq_ci', 'neq_ci') then
      declare
        v_txt text := case when jsonb_typeof(v_val) = 'string'
          then v_val #>> '{}' else coalesce(v_val::text, '') end;
        v_cmp text := case when v_op = 'eq_ci' then '=' else '<>' end;
      begin
        if v_field = any(v_date_cols) then
          v_where_parts := v_where_parts || public._widget_wrap_record_types(
            format('%s %s %L', v_expr, v_cmp, v_txt), v_rts);
        else
          v_where_parts := v_where_parts || public._widget_wrap_record_types(format(
            'public._widget_norm_text((%s)::text) %s public._widget_norm_text(%L)',
            v_expr, v_cmp, v_txt
          ), v_rts);
        end if;
      end;
    elsif v_op in ('eq_num', 'neq_num', 'gt_num', 'gte_num', 'lt_num', 'lte_num') then
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
          v_where_parts := v_where_parts || public._widget_wrap_record_types(
            format('%s is distinct from %s', v_lhs, v_num), v_rts);
        else
          v_where_parts := v_where_parts || public._widget_wrap_record_types(
            format('%s %s %s', v_lhs, v_cmp, v_num), v_rts);
        end if;
      end;
    elsif v_op = 'in' then
      -- `::text` no lado esquerdo: a lista vem do jsonb como TEXTO; colunas
      -- uuid (responsible_id/operation_id) não comparam com text sem cast.
      v_where_parts := v_where_parts || public._widget_wrap_record_types(format(
        '(%s)::text in (select jsonb_array_elements_text(%L::jsonb))', v_expr, coalesce(v_val, '[]'::jsonb)::text
      ), v_rts);
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
      v_where_parts := v_where_parts || public._widget_wrap_record_types(
        format('%s %s %L', v_expr, v_op,
          case when jsonb_typeof(v_val) = 'string' then v_val #>> '{}' else v_val::text end),
        v_rts);
    end if;
  end loop;

  -- ===== Monta e executa =====
  v_sql := 'select coalesce(jsonb_agg(t), ''[]''::jsonb) from (select '
        || array_to_string(v_select_parts, ', ')
        || ' from public.snapshot_records records';
  -- v_where_parts nunca é vazio (escopo do snapshot entra sempre).
  v_sql := v_sql || ' where ' || array_to_string(v_where_parts, ' and ');
  if array_length(v_group_parts, 1) is not null then
    v_sql := v_sql || ' group by ' || array_to_string(v_group_parts, ', ');
  end if;
  v_sql := v_sql || ') t';

  execute v_sql into v_result;
  return coalesce(v_result, '[]'::jsonb);
end;
$$;

revoke execute on function public.run_widget_query_snapshot(uuid, text, jsonb, jsonb, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.run_widget_query_snapshot(uuid, text, jsonb, jsonb, jsonb, jsonb) to service_role;
