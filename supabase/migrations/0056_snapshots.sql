-- Versão: 1.0 | Data: 15/07/2026
-- Snapshots: acesso PÚBLICO (sem autenticação) e somente-leitura aos resultados
-- de UMA aba de um dashboard, sobre um DATASET CONGELADO — a cada refresh
-- (manual ou agendado) as linhas de `records` permitidas pelas restrições do
-- snapshot (responsáveis/operações/fontes) são copiadas para snapshot_records;
-- o viewer re-agrega SEMPRE sobre a cópia, nunca sobre dados vivos.
--
-- Modelo de segurança (não relaxar):
--  * token de 256 bits mostrado UMA vez; aqui só vive o sha256 (token_hash);
--  * NENHUMA política RLS `to anon` — o caminho público é exclusivamente a
--    rota server-side com service role, DEPOIS de validar o token;
--  * funções novas executáveis SÓ pela service role (revoke de public/anon/
--    authenticated);
--  * restrições aplicadas em dupla camada: linhas fora da restrição nem
--    existem na cópia E os filtros são re-injetados na consulta do viewer.
--
-- ATENÇÃO (manutenção): run_widget_query_snapshot abaixo é uma CÓPIA do corpo
-- de run_widget_query (0054_widget_rpc_filter_sources.sql) com 3 mudanças
-- (FROM snapshot_records, WHERE por snapshot_id/partner_only e o helper de
-- match). Toda mudança futura em run_widget_query DEVE ser espelhada aqui.
-- Idempotente (create or replace / drop if exists).

-- ============ Tabela: snapshots (metadados + config congelado) ============
create table if not exists public.snapshots (
  id uuid primary key default gen_random_uuid(),
  dashboard_id uuid not null references public.dashboards (id) on delete cascade,
  -- '' = dashboard sem abas (tela única) ou primeira aba.
  tab_id text not null default '',
  name text not null,
  -- sha256 hex do token (o token em claro NUNCA é armazenado).
  token_hash text not null unique,
  -- Restrições de visibilidade: null = todos. allowed_sources guarda
  -- record_type ('lead' | 'negocio' | 'venda_site') — ver lib/sources.ts.
  allowed_responsible_ids uuid[],
  allowed_operation_ids uuid[],
  allowed_sources text[],
  -- Interatividade do visitante (filtros rápidos / filtros de widget).
  allow_quick_filters boolean not null default true,
  allow_widget_filters boolean not null default true,
  -- Agendamento por presets. refresh_time = "HH:MM" (horário de Brasília);
  -- refresh_weekday = 1..7 (ISO, segunda=1) para o modo semanal.
  refresh_mode text not null default 'manual'
    check (refresh_mode in ('manual', 'hourly', 'daily', 'weekly')),
  refresh_time text,
  refresh_weekday int check (refresh_weekday between 1 and 7),
  next_refresh_at timestamptz,
  -- Pausa desliga o link imediatamente (o loader público exige 'active').
  status text not null default 'active' check (status in ('active', 'paused')),
  -- Bundle congelado no refresh: dashboard {name, settings}, widgets da aba,
  -- field_definitions, correspondences, moedas/câmbio, opções de filtros
  -- (restritas!), calcExprById e tableCellsById. Shape: lib/snapshots/types.ts.
  config jsonb not null default '{}'::jsonb,
  last_refreshed_at timestamptz,
  last_refresh_error text,
  last_accessed_at timestamptz,
  access_count bigint not null default 0,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_snapshots_dashboard on public.snapshots (dashboard_id);
-- Busca do tick: snapshots agendados vencidos.
create index if not exists idx_snapshots_due
  on public.snapshots (next_refresh_at)
  where status = 'active' and refresh_mode <> 'manual';

drop trigger if exists trg_snapshots_updated_at on public.snapshots;
create trigger trg_snapshots_updated_at
  before update on public.snapshots
  for each row execute function public.set_updated_at();

-- ============ Tabela: snapshot_records (cópia congelada de records) ============
-- Espelho das colunas que o RPC (v_allowed_cols) e o modo lista (RECORD_COLS de
-- lib/widgets/record-list.ts) consomem, + custom_fields e is_mock. SEM FKs para
-- tabelas vivas (é uma cópia; ids ficam como uuid puro). partner_only=true =
-- registro casado (match/related_lead) FORA das restrições, presente apenas
-- para resolver colunas `match:<fonte>:<ref>`; nunca conta como linha de dados
-- (o RPC força `not partner_only`; no modo lista os filtros de restrição
-- re-injetados o excluem por construção).
create table if not exists public.snapshot_records (
  snapshot_id uuid not null references public.snapshots (id) on delete cascade,
  id uuid not null,
  record_type text not null,
  source_system text not null,
  owner_user_id uuid,
  title text,
  pipeline text,
  stage text,
  stage_semantic text,
  temperature text,
  value numeric,
  mrr numeric,
  currency text,
  sale_type text,
  channel text,
  closed boolean not null default false,
  closed_at timestamptz,
  opened_at timestamptz,
  source_created_at timestamptz,
  source_modified_at timestamptz,
  custom_fields jsonb not null default '{}'::jsonb,
  created_at timestamptz,
  updated_at timestamptz,
  last_synced_at timestamptz,
  locally_modified_at timestamptz,
  responsible_id uuid,
  operation_id uuid,
  related_lead_id uuid,
  lead_time_days numeric,
  is_mock boolean not null default false,
  partner_only boolean not null default false,
  primary key (snapshot_id, id)
);

-- ============ Tabela: snapshot_record_matches (cópia dos matches) ============
create table if not exists public.snapshot_record_matches (
  snapshot_id uuid not null references public.snapshots (id) on delete cascade,
  record_a_id uuid not null,
  record_b_id uuid not null,
  mode text not null default 'auto',
  created_at timestamptz not null default now(),
  primary key (snapshot_id, record_a_id, record_b_id)
);

create index if not exists idx_snapshot_matches_a
  on public.snapshot_record_matches (snapshot_id, record_a_id);
create index if not exists idx_snapshot_matches_b
  on public.snapshot_record_matches (snapshot_id, record_b_id);

-- ============ RLS ============
-- Gestão (UI autenticada): dono do dashboard pai ou admin — espelho de
-- dashboards_update (0009). Cópias congeladas: SELECT para gestores (preview/
-- diagnóstico); escrita SÓ via service role (bypassa RLS — sem policy de
-- escrita). NENHUMA política `to anon`: usuário anônimo não lê NADA aqui;
-- o viewer público passa pela rota com service role após validar o token.
alter table public.snapshots enable row level security;
alter table public.snapshot_records enable row level security;
alter table public.snapshot_record_matches enable row level security;

drop policy if exists snapshots_select on public.snapshots;
create policy snapshots_select on public.snapshots for select to authenticated
  using (
    exists (
      select 1 from public.dashboards d
      where d.id = snapshots.dashboard_id
        and (d.owner_user_id = (select auth.uid()) or public.auth_has_role('admin'))
    )
  );

drop policy if exists snapshots_insert on public.snapshots;
create policy snapshots_insert on public.snapshots for insert to authenticated
  with check (
    exists (
      select 1 from public.dashboards d
      where d.id = snapshots.dashboard_id
        and (d.owner_user_id = (select auth.uid()) or public.auth_has_role('admin'))
    )
  );

drop policy if exists snapshots_update on public.snapshots;
create policy snapshots_update on public.snapshots for update to authenticated
  using (
    exists (
      select 1 from public.dashboards d
      where d.id = snapshots.dashboard_id
        and (d.owner_user_id = (select auth.uid()) or public.auth_has_role('admin'))
    )
  )
  with check (
    exists (
      select 1 from public.dashboards d
      where d.id = snapshots.dashboard_id
        and (d.owner_user_id = (select auth.uid()) or public.auth_has_role('admin'))
    )
  );

drop policy if exists snapshots_delete on public.snapshots;
create policy snapshots_delete on public.snapshots for delete to authenticated
  using (
    exists (
      select 1 from public.dashboards d
      where d.id = snapshots.dashboard_id
        and (d.owner_user_id = (select auth.uid()) or public.auth_has_role('admin'))
    )
  );

drop policy if exists snapshot_records_select on public.snapshot_records;
create policy snapshot_records_select on public.snapshot_records for select to authenticated
  using (
    exists (
      select 1
      from public.snapshots s
      join public.dashboards d on d.id = s.dashboard_id
      where s.id = snapshot_records.snapshot_id
        and (d.owner_user_id = (select auth.uid()) or public.auth_has_role('admin'))
    )
  );

drop policy if exists snapshot_record_matches_select on public.snapshot_record_matches;
create policy snapshot_record_matches_select on public.snapshot_record_matches for select to authenticated
  using (
    exists (
      select 1
      from public.snapshots s
      join public.dashboards d on d.id = s.dashboard_id
      where s.id = snapshot_record_matches.snapshot_id
        and (d.owner_user_id = (select auth.uid()) or public.auth_has_role('admin'))
    )
  );

-- Belt-and-braces: anon não tem nem GRANT de tabela; escrita nas cópias fica
-- exclusiva da service role mesmo no nível de GRANT.
revoke all on public.snapshots from anon;
revoke all on public.snapshot_records from anon;
revoke all on public.snapshot_record_matches from anon;
revoke insert, update, delete on public.snapshot_records from authenticated;
revoke insert, update, delete on public.snapshot_record_matches from authenticated;

-- ============ Função: snapshot_refresh_copy ============
-- Cópia set-based e ATÔMICA (uma transação): sem janela de dados vazios para o
-- viewer e sem trafegar linhas pelo Node (teto de 60s da Vercel). Aplica as
-- restrições do snapshot; depois copia os matches com ao menos um lado dentro
-- e insere os parceiros ausentes (lado de fora do match + related_lead_id)
-- com partner_only = true. Retorna o nº de linhas de DADOS copiadas.
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

  -- Linhas de dados: records dentro das restrições (null = sem restrição).
  -- is_mock é copiado como está — a regra dos mocks (0052) decide na consulta.
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
  where (v_snap.allowed_sources is null
         or r.record_type = any (v_snap.allowed_sources))
    and (v_snap.allowed_responsible_ids is null
         or r.responsible_id = any (v_snap.allowed_responsible_ids))
    and (v_snap.allowed_operation_ids is null
         or r.operation_id = any (v_snap.allowed_operation_ids));

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

-- ============ Função: _widget_match_expr_snap ============
-- Cópia de _widget_match_expr (0042) apontada para as tabelas congeladas,
-- correlacionada por records.snapshot_id (o FROM do RPC abaixo usa o alias
-- `records`, então a correlação continua válida). Parceiros (partner_only)
-- são alcançáveis SÓ por aqui — é a razão de existirem na cópia.
create or replace function public._widget_match_expr_snap(p_spec text, p_numeric boolean)
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

  v_inner := public._widget_col_expr(v_ref, p_numeric);

  -- Igual ao original, com snapshot_records/snapshot_record_matches e a
  -- correlação extra por snapshot_id em cada nível.
  v_match_sub :=
    '(select ' || v_inner || ' from public.snapshot_records mm' ||
    ' where mm.snapshot_id = records.snapshot_id and mm.id = (' ||
    'select case when rm.record_a_id = records.id then rm.record_b_id' ||
    '   else rm.record_a_id end' ||
    ' from public.snapshot_record_matches rm' ||
    ' join public.snapshot_records p on p.snapshot_id = records.snapshot_id' ||
    '   and p.id = (case when rm.record_a_id = records.id' ||
    '   then rm.record_b_id else rm.record_a_id end)' ||
    ' where rm.snapshot_id = records.snapshot_id' ||
    '   and (rm.record_a_id = records.id or rm.record_b_id = records.id)' ||
    '   and p.record_type = ' || quote_literal(v_rt) ||
    ' order by (rm.mode = ''manual'') desc, rm.created_at desc limit 1))';

  if v_rt = 'lead' then
    v_lead_sub :=
      '(select ' || v_inner || ' from public.snapshot_records mm' ||
      ' where mm.snapshot_id = records.snapshot_id' ||
      '   and mm.id = records.related_lead_id)';
    return 'coalesce(' || v_match_sub || ', ' || v_lead_sub || ')';
  end if;

  return v_match_sub;
end;
$$;

revoke execute on function public._widget_match_expr_snap(text, boolean) from public, anon, authenticated;
grant execute on function public._widget_match_expr_snap(text, boolean) to service_role;

-- ============ Função: run_widget_query_snapshot ============
-- CÓPIA LITERAL do corpo de run_widget_query (0054) com exatamente 3 mudanças:
--  1. FROM: `public.snapshot_records records` (o alias mantém válidas todas as
--     expressões geradas, inclusive as correlações do match);
--  2. WHERE sempre inicia com `records.snapshot_id = <id>` e
--     `not records.partner_only` (garantia no banco, independente do JS);
--  3. `_widget_match_expr` -> `_widget_match_expr_snap`.
-- Reusa como estão os helpers imutáveis já instalados (_widget_col_expr,
-- _widget_unified_expr, _widget_unified_date_expr, _widget_wrap_record_types,
-- _widget_norm_text, _widget_safe_numeric, _widget_col_date_expr).
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
