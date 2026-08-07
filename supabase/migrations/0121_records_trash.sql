-- 0121_records_trash.sql
-- Versão: 1.0 | Data: 07/08/2026
-- LIXEIRA DE REGISTROS (soft delete, 30 dias). `records.deleted_at` marca o
-- registro como "na lixeira": some de toda leitura de consulta (RPCs de
-- widget, modo lista, kanban, agenda, /registros, export, buscas — os
-- leitores client-side filtram `deleted_at is null` nos choke points) mas a
-- LINHA continua existindo: cascatas (audit/tarefas/comentários/placements/
-- matches) preservadas e o reconcile do sync (upsert por source_system+
-- source_id) atualiza in-place SEM ressuscitar nem duplicar. Restauração =
-- limpar a coluna. Purga definitiva após 30 dias por pg_cron
-- (supabase/apply/pg-cron-purge-records-trash.sql) ou pela action de exclusão
-- definitiva; as cascatas de FK levam os filhos.
--
-- Guarda de permissão: enviar/restaurar é UPDATE e cairia na records_update
-- (qualquer editor) — o trigger enforce_records_trash_guard exige papel
-- `admin` para MUDAR deleted_at (espelha a records_delete de hoje; RLS
-- intocada, precedente 0087). Escape hatch de manutenção: GUC
-- app.allow_protected_change = 'on' (padrão 0089). Escritores service-role
-- (sync/mappings/automações/alocação) nunca incluem deleted_at no payload —
-- o trigger é inerte para eles; a purga é DELETE (fora do trigger).
--
-- Recria as leituras no banco que precisam do predicado:
--   - registros_populated_refs (0120 verbatim + `deleted_at is null`);
--   - snapshot_refresh_copy (0057 verbatim + `deleted_at is null` nas linhas
--     de DADOS; o ramo PARTNER-only segue sem filtro de propósito — espelha
--     os helpers _widget_match_expr(_snap), que seguem resolvendo parceiro
--     na lixeira; a purga cascateia record_matches e se auto-corrige);
--   - run_widget_query e run_widget_query_snapshot (0105 verbatim +
--     `deleted_at is null` nos DOIS — invariante 1, paridade byte a byte).
--     No snapshot o predicado é NO-OP: snapshot_records ganha a coluna
--     deleted_at SEMPRE NULL (abaixo) só para o predicado espelhado e o
--     filtro do engine (buildRecordListQuery passa pelo snapshotClient, que
--     re-aponta records → snapshot_records) resolverem sem erro.
-- Idempotente.

-- ===================== 1) Colunas + índice =====================
alter table public.records add column if not exists deleted_at timestamptz;
alter table public.records add column if not exists deleted_by uuid
  references auth.users (id) on delete set null;
-- Parcial: a lixeira é minoria — leituras vivas não pagam o índice.
create index if not exists idx_records_deleted_at
  on public.records (deleted_at) where deleted_at is not null;
-- Espelho MORTO no dataset congelado (sempre null): existe só para o
-- predicado espelhado do RPC e o `.is("deleted_at", null)` do engine (via
-- snapshotClient) não errarem. A captura nunca a preenche.
alter table public.snapshot_records add column if not exists deleted_at timestamptz;

-- ===================== 2) Trigger guard (só admin muda deleted_at) ==========
create or replace function public.enforce_records_trash_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if coalesce(current_setting('app.allow_protected_change', true), '') = 'on' then
    return new;
  end if;
  if (tg_op = 'INSERT' and new.deleted_at is not null)
     or (tg_op = 'UPDATE' and new.deleted_at is distinct from old.deleted_at) then
    if not public.auth_has_role('admin') then
      raise exception 'Só administradores podem enviar registros à Lixeira ou restaurá-los';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_records_trash_guard on public.records;
create trigger trg_records_trash_guard
  before insert or update on public.records
  for each row execute function public.enforce_records_trash_guard();

-- ===================== 3) registros_populated_refs =====================
-- Corpo da 0120 + lixeira fora do CTE base.
create or replace function public.registros_populated_refs(p_record_type text)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
with base as (
  select *
  from public.records
  where record_type = p_record_type
    and is_mock = false
    -- 0121: lixeira fora das colunas populadas.
    and deleted_at is null
),
core as (
  -- Colunas núcleo de EXIBIÇÃO (title/record_type/source_system ficam de fora:
  -- identidade/cabeçalho, sempre presentes na UI). Texto vazio não conta.
  select array_remove(array[
    case when count(nullif(pipeline, ''))       > 0 then 'pipeline' end,
    case when count(nullif(stage, ''))          > 0 then 'stage' end,
    case when count(nullif(stage_semantic, '')) > 0 then 'stage_semantic' end,
    case when count(nullif(sale_type, ''))      > 0 then 'sale_type' end,
    case when count(nullif(channel, ''))        > 0 then 'channel' end,
    case when count(nullif(currency, ''))       > 0 then 'currency' end,
    case when count(closed)            > 0 then 'closed' end,
    case when count(responsible_id)    > 0 then 'responsible_id' end,
    case when count(operation_id)      > 0 then 'operation_id' end,
    case when count(related_lead_id)   > 0 then 'related_lead_id' end,
    case when count(value)             > 0 then 'value' end,
    case when count(mrr)               > 0 then 'mrr' end,
    case when count(lead_time_days)    > 0 then 'lead_time_days' end,
    case when count(closed_at)         > 0 then 'closed_at' end,
    case when count(opened_at)         > 0 then 'opened_at' end,
    case when count(source_created_at) > 0 then 'source_created_at' end
  ], null) as refs
  from base
),
cust as (
  select coalesce(jsonb_agg(distinct e.key), '[]'::jsonb) as keys
  from base r,
       lateral jsonb_each_text(coalesce(r.custom_fields, '{}'::jsonb)) e
  where coalesce(e.value, '') <> ''
)
select jsonb_build_object(
  'core', coalesce(to_jsonb((select refs from core)), '[]'::jsonb),
  'custom', (select keys from cust)
);
$$;

comment on function public.registros_populated_refs(text) is
  'Refs núcleo e chaves custom com >=1 valor não-vazio no record_type (mocks e lixeira fora). SECURITY INVOKER: RLS de records recorta por usuário. Consumidor: página /registros (colunas dirigidas por dados).';

-- Acesso: só usuários autenticados (e service role). Nunca anon — regra do
-- caminho público de snapshots (app/s/[token] + service role) não passa por cá.
revoke execute on function public.registros_populated_refs(text) from public, anon;
grant execute on function public.registros_populated_refs(text) to authenticated;
grant execute on function public.registros_populated_refs(text) to service_role;

-- ===================== 4) snapshot_refresh_copy =====================
-- Corpo da 0057 (versão vigente) + lixeira fora das linhas de DADOS.
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
  -- 0121: a lixeira fica fora do dataset congelado (defesa em profundidade
  -- também para mocks — a action de lixeira já os pula).
  where r.deleted_at is null
    and (r.is_mock
     or ((v_snap.allowed_sources is null
          or r.record_type = any (v_snap.allowed_sources))
     and (v_snap.allowed_responsible_ids is null
          or r.responsible_id = any (v_snap.allowed_responsible_ids))
     and (v_snap.allowed_operation_ids is null
          or r.operation_id = any (v_snap.allowed_operation_ids))));

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

-- ===================== 5) Par de RPCs de widget =====================
-- Corpos da 0105 (versão vigente). run_widget_query ganha o predicado da
-- lixeira; run_widget_query_snapshot segue byte-idêntico à 0105 (recriado
-- aqui SÓ para cumprir a regra "última definição na MESMA migração" do
-- teste de paridade).
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
  -- Fontes-alvo do filtro (pass-through): array jsonb de record_types.
  v_rts jsonb;
  v_sql text; v_result jsonb; v_idx int;
  -- Fase 12: mocks de Data Reunião (0051) só entram em consultas que
  -- referenciam uma das duas chaves do campo (lead/negócio).
  v_mock_params text;
  v_include_mocks boolean := false;
begin
  if p_source is distinct from 'records' then
    raise exception 'Fonte não suportada: %', p_source;
  end if;

  -- ===== Regra dos mocks (Fase 12) =====
  -- Referência direta em dimensões/métricas/filtros (inclui o byType do
  -- @period e o field do @bucket, que viajam dentro de p_filters)...
  v_mock_params := coalesce(p_dimensions::text, '')
    || coalesce(p_metrics::text, '') || coalesce(p_filters::text, '');
  v_include_mocks :=
    v_mock_params like '%bitrix_uf_crm_1743441331%'
    or v_mock_params like '%bitrix_uf_crm_67eacefcccd98%';
  -- ...ou indireta, via campo unificado REFERENCIADO cuja correspondência
  -- contenha uma das chaves de Data Reunião.
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
    -- `::text` explícito: literal sem tipo à direita de || vira array e quebra.
    v_where_parts := v_where_parts || 'not is_mock'::text;
  end if;

  -- ===== Lixeira (0121) =====
  -- Registro na lixeira (soft delete) fica fora de TODA consulta de widget.
  -- No snapshot o predicado é NO-OP deliberado: snapshot_records.deleted_at
  -- é sempre null (a CAPTURA já exclui a lixeira e não copia a coluna) —
  -- espelhado mesmo assim para manter a paridade byte a byte.
  v_where_parts := v_where_parts || 'deleted_at is null'::text;

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
        -- 0085: trunc no dia de Brasília (coalesce de timestamptz → overload).
        v_expr := format(
          'date_trunc(%L, public._widget_local_ts(coalesce(closed_at, opened_at, source_created_at)))',
          v_transform
        );
      elsif v_transform = 'none' then
        v_expr := 'coalesce(closed_at, opened_at, source_created_at)';
      else
        raise exception 'transform "%" não suportado para @rate_date', v_transform;
      end if;
    elsif v_field like 'unified:%' then
      -- Campo unificado: sem transform usa o coalesce textual; com transform de
      -- data, os membros já saem como timestamp no dia de Brasília
      -- (_widget_col_date_expr 0085) — NÃO embrulhar de novo.
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
      if v_transform <> 'none' then
        -- 0085: a subconsulta é tipada pela coluna do parceiro (timestamptz
        -- núcleo / text custom) — o overload resolve o dia de Brasília.
        v_base := format('public._widget_local_ts(%s)', v_base);
      end if;
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
        -- 0085: transforms de data do núcleo no dia de Brasília.
        if v_transform in ('day','week','month','quarter','year') then
          v_expr := format('date_trunc(%L, public._widget_local_ts(%I))', v_transform, v_field);
        elsif v_transform = 'weekday' then
          v_expr := format('extract(isodow from public._widget_local_ts(%I))::int', v_field);
        elsif v_transform in ('month_name','month_year') then
          v_expr := format('date_trunc(%L, public._widget_local_ts(%I))', 'month', v_field);
        elsif v_transform = 'week_year' then
          v_expr := format('date_trunc(%L, public._widget_local_ts(%I))', 'week', v_field);
        elsif v_transform = 'week_month' then
          if v_week_mode = 'full' then
            v_expr := format('date_trunc(%L, public._widget_local_ts(%I))', 'week', v_field);
          else
            v_expr := format(
              'greatest(date_trunc(%L, public._widget_local_ts(%I)), date_trunc(%L, public._widget_local_ts(%I)))',
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
    if v_agg not in ('sum','count','avg','min','max') then
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
        v_from_eff text;
        v_to_eff   text;
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
            -- Bounds VERBATIM: ancorar o lower bound excluiria date-only
            -- ('2026-07-01' < '2026-07-01T00:00:00-03:00' em texto).
            v_from_eff := v_from;
            v_to_eff := v_to;
          elsif v_col = any(v_date_cols) then
            v_colexpr := format('%I', v_col);
            -- 0085: bound ancorado no dia de Brasília — literal com offset
            -- explícito compara o instante exato independente do fuso da
            -- sessão (UTC), direto contra a coluna (sargável).
            v_from_eff := case
              when v_from is null or v_from = '' then v_from
              when length(v_from) = 10 then v_from || 'T00:00:00-03:00'
              when v_from !~ '(Z|[+-]\d{2}:?\d{2})$' then v_from || '-03:00'
              else v_from end;
            v_to_eff := case
              when v_to is null or v_to = '' then v_to
              when length(v_to) = 10 then v_to || 'T23:59:59-03:00'
              when v_to !~ '(Z|[+-]\d{2}:?\d{2})$' then v_to || '-03:00'
              else v_to end;
          else
            raise exception 'Coluna de data inválida no período: %', v_col;
          end if;
          v_conds := array[ format('record_type = %L', v_rt) ];
          if v_from_eff is not null and v_from_eff <> '' then
            v_conds := v_conds || format('%s >= %L', v_colexpr, v_from_eff);
          end if;
          if v_to_eff is not null and v_to_eff <> '' then
            v_conds := v_conds || format('%s <= %L', v_colexpr, v_to_eff);
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

        -- Expressão de data (timestamp no dia de Brasília, 0085) do campo, com
        -- os mesmos helpers das dimensões: núcleo/custom, unificado e casado.
        if v_bfield like 'unified:%' then
          v_dexpr := public._widget_unified_date_expr(substring(v_bfield from 9), p_correspondences);
        elsif v_bfield like 'match:%' then
          v_dexpr := format('public._widget_local_ts(%s)',
            public._widget_match_expr(substring(v_bfield from 7), false));
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
            v_sub_expr := public._widget_match_expr(substring(v_sub from 7), false);
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
      v_expr := public._widget_match_expr(substring(v_field from 7), false);
    elsif v_field like 'custom:%' then
      v_expr := format('(custom_fields ->> %L)', substring(v_field from 8));
    elsif v_field = any(v_allowed_cols) then
      v_expr := format('%I', v_field);
    else
      raise exception 'Coluna de filtro não permitida: %', v_field;
    end if;

    if v_op = 'is_null' then
      -- Sob o pass-through, `is null` só vale nas fontes-alvo: linhas de outras
      -- fontes passam mesmo com o campo NULL (semântica desejada).
      v_where_parts := v_where_parts || public._widget_wrap_record_types(
        format('%s is null', v_expr), v_rts);
    elsif v_op = 'not_null' then
      v_where_parts := v_where_parts || public._widget_wrap_record_types(
        format('%s is not null', v_expr), v_rts);
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
          v_where_parts := v_where_parts || public._widget_wrap_record_types(
            format('%s is distinct from %s', v_lhs, v_num), v_rts);
        else
          v_where_parts := v_where_parts || public._widget_wrap_record_types(
            format('%s %s %s', v_lhs, v_cmp, v_num), v_rts);
        end if;
      end;
    elsif v_op = 'in_ci' then
      -- Pertencimento com a MESMA normalização do eq_ci (0050). Op INTERNO da
      -- fusão de perfis de operação (lib/config/operation-scope.ts) — fora da
      -- UI de filtros e do SPEC da IA.
      v_where_parts := v_where_parts || public._widget_wrap_record_types(format(
        'public._widget_norm_text((%s)::text) in (select public._widget_norm_text(x) from jsonb_array_elements_text(%L::jsonb) x)',
        v_expr, coalesce(v_val, '[]'::jsonb)::text
      ), v_rts);
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

-- ============ Função: run_widget_query_snapshot ============
-- Cópia da 0072 com as mudanças 0085 ESPELHADAS. Mantém as 3 diferenças
-- originais (FROM snapshot_records, escopo por snapshot_id/partner_only e
-- _widget_match_expr_snap) + o bloco de restrições mock-aware (0057).
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

  -- ===== Lixeira (0121) =====
  -- Registro na lixeira (soft delete) fica fora de TODA consulta de widget.
  -- No snapshot o predicado é NO-OP deliberado: snapshot_records.deleted_at
  -- é sempre null (a CAPTURA já exclui a lixeira e não copia a coluna) —
  -- espelhado mesmo assim para manter a paridade byte a byte.
  v_where_parts := v_where_parts || 'deleted_at is null'::text;

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
        -- 0085: trunc no dia de Brasília (coalesce de timestamptz → overload).
        v_expr := format(
          'date_trunc(%L, public._widget_local_ts(coalesce(closed_at, opened_at, source_created_at)))',
          v_transform
        );
      elsif v_transform = 'none' then
        v_expr := 'coalesce(closed_at, opened_at, source_created_at)';
      else
        raise exception 'transform "%" não suportado para @rate_date', v_transform;
      end if;
    elsif v_field like 'unified:%' then
      -- 0085: membros já saem como timestamp no dia de Brasília — não embrulhar.
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
      if v_transform <> 'none' then
        -- 0085: overload resolve o dia de Brasília pela coluna do parceiro.
        v_base := format('public._widget_local_ts(%s)', v_base);
      end if;
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
        -- 0085: transforms de data do núcleo no dia de Brasília.
        if v_transform in ('day','week','month','quarter','year') then
          v_expr := format('date_trunc(%L, public._widget_local_ts(%I))', v_transform, v_field);
        elsif v_transform = 'weekday' then
          v_expr := format('extract(isodow from public._widget_local_ts(%I))::int', v_field);
        elsif v_transform in ('month_name','month_year') then
          v_expr := format('date_trunc(%L, public._widget_local_ts(%I))', 'month', v_field);
        elsif v_transform = 'week_year' then
          v_expr := format('date_trunc(%L, public._widget_local_ts(%I))', 'week', v_field);
        elsif v_transform = 'week_month' then
          if v_week_mode = 'full' then
            v_expr := format('date_trunc(%L, public._widget_local_ts(%I))', 'week', v_field);
          else
            v_expr := format(
              'greatest(date_trunc(%L, public._widget_local_ts(%I)), date_trunc(%L, public._widget_local_ts(%I)))',
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
    if v_agg not in ('sum','count','avg','min','max') then
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
        v_from_eff text;
        v_to_eff   text;
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
            -- Bounds VERBATIM: ancorar o lower bound excluiria date-only.
            v_from_eff := v_from;
            v_to_eff := v_to;
          elsif v_col = any(v_date_cols) then
            v_colexpr := format('%I', v_col);
            -- 0085: bound ancorado no dia de Brasília (ver run_widget_query).
            v_from_eff := case
              when v_from is null or v_from = '' then v_from
              when length(v_from) = 10 then v_from || 'T00:00:00-03:00'
              when v_from !~ '(Z|[+-]\d{2}:?\d{2})$' then v_from || '-03:00'
              else v_from end;
            v_to_eff := case
              when v_to is null or v_to = '' then v_to
              when length(v_to) = 10 then v_to || 'T23:59:59-03:00'
              when v_to !~ '(Z|[+-]\d{2}:?\d{2})$' then v_to || '-03:00'
              else v_to end;
          else
            raise exception 'Coluna de data inválida no período: %', v_col;
          end if;
          v_conds := array[ format('record_type = %L', v_rt) ];
          if v_from_eff is not null and v_from_eff <> '' then
            v_conds := v_conds || format('%s >= %L', v_colexpr, v_from_eff);
          end if;
          if v_to_eff is not null and v_to_eff <> '' then
            v_conds := v_conds || format('%s <= %L', v_colexpr, v_to_eff);
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
          v_dexpr := format('public._widget_local_ts(%s)',
            public._widget_match_expr_snap(substring(v_bfield from 7), false));
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
    elsif v_op = 'in_ci' then
      -- Pertencimento com a MESMA normalização do eq_ci (0050). Op INTERNO da
      -- fusão de perfis de operação (lib/config/operation-scope.ts) — fora da
      -- UI de filtros e do SPEC da IA.
      v_where_parts := v_where_parts || public._widget_wrap_record_types(format(
        'public._widget_norm_text((%s)::text) in (select public._widget_norm_text(x) from jsonb_array_elements_text(%L::jsonb) x)',
        v_expr, coalesce(v_val, '[]'::jsonb)::text
      ), v_rts);
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
