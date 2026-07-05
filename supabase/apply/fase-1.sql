-- ============================================================================
-- Versão: 1.0 | Data: 05/07/2026
-- BLOCO ÚNICO — FASE 1 (Fundação) — colar no SQL Editor do Supabase.
-- Gerado a partir de supabase/migrations/0001..0011 na ordem de execução.
-- Idempotente: pode ser reaplicado. NÃO cria usuários (isso é feito
-- na tela de admin / painel Supabase).
-- ============================================================================


-- >>>>>>>>>>>>>>>>>>>> migrations/0001_extensions_utils.sql <<<<<<<<<<<<<<<<<<<<
-- Versão: 1.0 | Data: 04/07/2026
-- Extensões e utilitários compartilhados.
-- Idempotente: pode ser reaplicado sem quebrar.

-- gen_random_uuid() e funções de hash.
create extension if not exists pgcrypto;

-- Trigger genérico para manter updated_at.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- >>>>>>>>>>>>>>>>>>>> migrations/0002_roles_permissions.sql <<<<<<<<<<<<<<<<<<<<
-- Versão: 1.0 | Data: 04/07/2026
-- Papéis, permissões e vínculos. As duas camadas de permissão da Parte 1.4
-- (editar valor vs criar/alterar coluna) são permissões distintas aqui.
-- Idempotente.

create table if not exists public.roles (
  key text primary key,
  label text not null
);

create table if not exists public.permissions (
  key text primary key,
  label text not null
);

create table if not exists public.role_permissions (
  role_key text not null references public.roles (key) on delete cascade,
  permission_key text not null references public.permissions (key) on delete cascade,
  primary key (role_key, permission_key)
);

create table if not exists public.user_roles (
  user_id uuid not null references auth.users (id) on delete cascade,
  role_key text not null references public.roles (key) on delete cascade,
  primary key (user_id, role_key)
);

create index if not exists idx_user_roles_user on public.user_roles (user_id);

-- >>>>>>>>>>>>>>>>>>>> migrations/0003_rls_helpers.sql <<<<<<<<<<<<<<<<<<<<
-- Versão: 1.0 | Data: 04/07/2026
-- Funções auxiliares de RLS (SECURITY DEFINER). Rodam como owner para poder
-- ler user_roles/role_permissions sem recursão de RLS. search_path vazio +
-- identificadores totalmente qualificados por segurança.
-- Idempotente (create or replace).

create or replace function public.auth_roles()
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(ur.role_key), array[]::text[])
  from public.user_roles ur
  where ur.user_id = (select auth.uid());
$$;

create or replace function public.auth_has_role(p_role text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.user_roles ur
    where ur.user_id = (select auth.uid())
      and ur.role_key = p_role
  );
$$;

create or replace function public.auth_has_permission(p_permission text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.user_roles ur
    join public.role_permissions rp on rp.role_key = ur.role_key
    where ur.user_id = (select auth.uid())
      and rp.permission_key = p_permission
  );
$$;

grant execute on function public.auth_roles() to authenticated, anon;
grant execute on function public.auth_has_role(text) to authenticated, anon;
grant execute on function public.auth_has_permission(text) to authenticated, anon;

-- >>>>>>>>>>>>>>>>>>>> migrations/0004_core_records.sql <<<<<<<<<<<<<<<<<<<<
-- Versão: 1.0 | Data: 04/07/2026
-- Núcleo `records`: fonte de verdade da UI. Fontes externas alimentam esta
-- tabela; a UI nunca lê as fontes diretamente. Campos locais (temperature e,
-- via field_definitions is_local, Forecast/Status/Ações/Check) nunca vêm de sync.
-- Idempotente.

create table if not exists public.records (
  id uuid primary key default gen_random_uuid(),
  record_type text not null check (record_type in ('lead', 'negocio', 'venda_site')),
  source_system text not null check (source_system in ('bitrix', 'sheet_site', 'manual')),
  source_id text,
  owner_user_id uuid references auth.users (id) on delete set null,
  title text,
  pipeline text,
  stage text,
  stage_semantic text,            -- open | won | lose (derivado de STAGE_SEMANTIC_ID)
  temperature text,               -- campo LOCAL do app (nunca sincronizado)
  value numeric,
  mrr numeric,
  currency text,
  sale_type text,
  channel text,
  closed boolean not null default false,
  closed_at timestamptz,
  opened_at timestamptz,
  source_created_at timestamptz,  -- DATE_CREATE na origem
  source_modified_at timestamptz, -- DATE_MODIFY na origem
  custom_fields jsonb not null default '{}'::jsonb,
  field_modified_at jsonb not null default '{}'::jsonb, -- {campo: timestamp} de edições manuais
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_synced_at timestamptz,
  locally_modified_at timestamptz
);

-- Chave natural por origem (nulls distintos permitem múltiplos manuais sem source_id).
create unique index if not exists uq_records_source
  on public.records (source_system, source_id);
create index if not exists idx_records_owner on public.records (owner_user_id);
create index if not exists idx_records_type on public.records (record_type);
create index if not exists idx_records_stage on public.records (stage);
create index if not exists idx_records_closed_at on public.records (closed_at);
create index if not exists idx_records_custom_fields on public.records using gin (custom_fields);

drop trigger if exists trg_records_updated_at on public.records;
create trigger trg_records_updated_at
  before update on public.records
  for each row execute function public.set_updated_at();

-- >>>>>>>>>>>>>>>>>>>> migrations/0005_field_definitions.sql <<<<<<<<<<<<<<<<<<<<
-- Versão: 1.0 | Data: 04/07/2026
-- Colunas dinâmicas: definições de campo com visibilidade/edição por papel.
-- Os valores vivem em records.custom_fields; nenhum schema físico muda ao criar
-- uma coluna. is_local = campo que existe só no app (nunca vem de fonte).
-- Idempotente.

create table if not exists public.field_definitions (
  id uuid primary key default gen_random_uuid(),
  field_key text not null unique,
  label text not null,
  data_type text not null check (data_type in ('texto', 'numero', 'data', 'selecao', 'moeda')),
  options jsonb not null default '[]'::jsonb,      -- opções para data_type = 'selecao'
  visible_to_roles text[] not null default '{}',
  editable_by_roles text[] not null default '{}',
  is_local boolean not null default false,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_field_definitions_updated_at on public.field_definitions;
create trigger trg_field_definitions_updated_at
  before update on public.field_definitions
  for each row execute function public.set_updated_at();

-- >>>>>>>>>>>>>>>>>>>> migrations/0006_audit_log.sql <<<<<<<<<<<<<<<<<<<<
-- Versão: 1.0 | Data: 04/07/2026
-- Auditoria: toda edição de valor gera uma linha aqui. user_id nulo quando a
-- origem é sincronização. Idempotente.

create table if not exists public.audit_log (
  id bigint generated always as identity primary key,
  record_id uuid references public.records (id) on delete cascade,
  user_id uuid references auth.users (id) on delete set null,
  field text not null,
  old_value jsonb,
  new_value jsonb,
  changed_at timestamptz not null default now(),
  origin text not null check (origin in ('app', 'sync_bitrix', 'sync_sheet'))
);

create index if not exists idx_audit_record on public.audit_log (record_id, changed_at desc);

-- >>>>>>>>>>>>>>>>>>>> migrations/0007_mappings_sync_config.sql <<<<<<<<<<<<<<<<<<<<
-- Versão: 1.0 | Data: 04/07/2026
-- Mapeamentos e configuração de sync.
--   bitrix_user_map: ASSIGNED_BY_ID do Bitrix -> user_id do Supabase (owner/RLS)
--   bitrix_lookup_cache: cache persistente de status.list/user.get/enums
--   sync_config: configuração editável (filtros do forecast, janelas, flags)
-- Idempotente.

create table if not exists public.bitrix_user_map (
  bitrix_id text primary key,
  user_id uuid references auth.users (id) on delete set null,
  name text,
  updated_at timestamptz not null default now()
);

create table if not exists public.bitrix_lookup_cache (
  lookup_type text not null,   -- ex.: 'status', 'user', 'deal_enum:<field>'
  source_id text not null,
  label text,
  updated_at timestamptz not null default now(),
  primary key (lookup_type, source_id)
);

-- Configuração key-value (um registro por chave).
create table if not exists public.sync_config (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_bitrix_user_map_updated_at on public.bitrix_user_map;
create trigger trg_bitrix_user_map_updated_at
  before update on public.bitrix_user_map
  for each row execute function public.set_updated_at();

drop trigger if exists trg_sync_config_updated_at on public.sync_config;
create trigger trg_sync_config_updated_at
  before update on public.sync_config
  for each row execute function public.set_updated_at();

-- >>>>>>>>>>>>>>>>>>>> migrations/0008_dashboards_widgets.sql <<<<<<<<<<<<<<<<<<<<
-- Versão: 1.0 | Data: 04/07/2026
-- Dashboards e widgets. Widget = configuração salva (json), nunca código novo:
-- fonte, dimensões, métricas, filtros, tipo de visual e posição no grid.
-- Idempotente.

create table if not exists public.dashboards (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  owner_user_id uuid references auth.users (id) on delete set null,
  visible_to_roles text[] not null default '{}',
  is_shared boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.widgets (
  id uuid primary key default gen_random_uuid(),
  dashboard_id uuid not null references public.dashboards (id) on delete cascade,
  title text,
  visual_type text not null check (visual_type in ('tabela', 'barra', 'linha', 'pizza', 'kpi', 'funil')),
  source text not null default 'records',
  dimensions jsonb not null default '[]'::jsonb,
  metrics jsonb not null default '[]'::jsonb,
  filters jsonb not null default '[]'::jsonb,
  grid_position jsonb not null default '{}'::jsonb,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_widgets_dashboard on public.widgets (dashboard_id);

drop trigger if exists trg_dashboards_updated_at on public.dashboards;
create trigger trg_dashboards_updated_at
  before update on public.dashboards
  for each row execute function public.set_updated_at();

drop trigger if exists trg_widgets_updated_at on public.widgets;
create trigger trg_widgets_updated_at
  before update on public.widgets
  for each row execute function public.set_updated_at();

-- >>>>>>>>>>>>>>>>>>>> migrations/0009_rls_policies.sql <<<<<<<<<<<<<<<<<<<<
-- Versão: 1.0 | Data: 04/07/2026
-- Políticas RLS. Reforçam as permissões no Postgres, não só na UI.
-- Writes de sync usam a service role key (bypassa RLS). Idempotente:
-- drop policy if exists antes de cada create.

-- ============ Habilita RLS ============
alter table public.roles                enable row level security;
alter table public.permissions          enable row level security;
alter table public.role_permissions     enable row level security;
alter table public.user_roles           enable row level security;
alter table public.records              enable row level security;
alter table public.field_definitions    enable row level security;
alter table public.audit_log            enable row level security;
alter table public.bitrix_user_map      enable row level security;
alter table public.bitrix_lookup_cache  enable row level security;
alter table public.sync_config          enable row level security;
alter table public.dashboards           enable row level security;
alter table public.widgets              enable row level security;

-- ============ roles / permissions / role_permissions (leitura p/ autenticados; escrita admin) ============
drop policy if exists roles_select on public.roles;
create policy roles_select on public.roles for select to authenticated using (true);
drop policy if exists roles_write on public.roles;
create policy roles_write on public.roles for all to authenticated
  using (public.auth_has_permission('manage_users_roles'))
  with check (public.auth_has_permission('manage_users_roles'));

drop policy if exists permissions_select on public.permissions;
create policy permissions_select on public.permissions for select to authenticated using (true);
drop policy if exists permissions_write on public.permissions;
create policy permissions_write on public.permissions for all to authenticated
  using (public.auth_has_permission('manage_users_roles'))
  with check (public.auth_has_permission('manage_users_roles'));

drop policy if exists role_permissions_select on public.role_permissions;
create policy role_permissions_select on public.role_permissions for select to authenticated using (true);
drop policy if exists role_permissions_write on public.role_permissions;
create policy role_permissions_write on public.role_permissions for all to authenticated
  using (public.auth_has_permission('manage_users_roles'))
  with check (public.auth_has_permission('manage_users_roles'));

-- ============ user_roles (usuário lê os próprios; admin lê/gerencia todos) ============
drop policy if exists user_roles_select on public.user_roles;
create policy user_roles_select on public.user_roles for select to authenticated
  using (user_id = (select auth.uid()) or public.auth_has_permission('manage_users_roles'));
drop policy if exists user_roles_write on public.user_roles;
create policy user_roles_write on public.user_roles for all to authenticated
  using (public.auth_has_permission('manage_users_roles'))
  with check (public.auth_has_permission('manage_users_roles'));

-- ============ records (edição de valor vs visão) ============
drop policy if exists records_select on public.records;
create policy records_select on public.records for select to authenticated
  using (
    public.auth_has_permission('view_all_records')
    or owner_user_id = (select auth.uid())
  );

drop policy if exists records_update on public.records;
create policy records_update on public.records for update to authenticated
  using (
    public.auth_has_permission('edit_record_values')
    and (public.auth_has_permission('view_all_records') or owner_user_id = (select auth.uid()))
  )
  with check (
    public.auth_has_permission('edit_record_values')
    and (public.auth_has_permission('view_all_records') or owner_user_id = (select auth.uid()))
  );

drop policy if exists records_insert on public.records;
create policy records_insert on public.records for insert to authenticated
  with check (public.auth_has_role('admin'));

drop policy if exists records_delete on public.records;
create policy records_delete on public.records for delete to authenticated
  using (public.auth_has_role('admin'));

-- ============ field_definitions (leitura por papel; escrita = manage_field_definitions) ============
drop policy if exists field_definitions_select on public.field_definitions;
create policy field_definitions_select on public.field_definitions for select to authenticated
  using (
    public.auth_has_role('admin')
    or visible_to_roles && public.auth_roles()
  );

drop policy if exists field_definitions_insert on public.field_definitions;
create policy field_definitions_insert on public.field_definitions for insert to authenticated
  with check (public.auth_has_permission('manage_field_definitions'));

drop policy if exists field_definitions_update on public.field_definitions;
create policy field_definitions_update on public.field_definitions for update to authenticated
  using (public.auth_has_permission('manage_field_definitions'))
  with check (public.auth_has_permission('manage_field_definitions'));

drop policy if exists field_definitions_delete on public.field_definitions;
create policy field_definitions_delete on public.field_definitions for delete to authenticated
  using (public.auth_has_permission('manage_field_definitions'));

-- ============ audit_log (leitura = view_all_records; app insere as próprias) ============
drop policy if exists audit_log_select on public.audit_log;
create policy audit_log_select on public.audit_log for select to authenticated
  using (public.auth_has_permission('view_all_records'));

drop policy if exists audit_log_insert on public.audit_log;
create policy audit_log_insert on public.audit_log for insert to authenticated
  with check (user_id = (select auth.uid()) and origin = 'app');

-- ============ bitrix_user_map / bitrix_lookup_cache / sync_config ============
drop policy if exists bitrix_user_map_select on public.bitrix_user_map;
create policy bitrix_user_map_select on public.bitrix_user_map for select to authenticated using (true);
drop policy if exists bitrix_user_map_write on public.bitrix_user_map;
create policy bitrix_user_map_write on public.bitrix_user_map for all to authenticated
  using (public.auth_has_permission('manage_users_roles'))
  with check (public.auth_has_permission('manage_users_roles'));

drop policy if exists bitrix_lookup_cache_select on public.bitrix_lookup_cache;
create policy bitrix_lookup_cache_select on public.bitrix_lookup_cache for select to authenticated using (true);
-- escrita apenas via service role (sync), que bypassa RLS: sem policy de escrita.

drop policy if exists sync_config_select on public.sync_config;
create policy sync_config_select on public.sync_config for select to authenticated using (true);
drop policy if exists sync_config_write on public.sync_config;
create policy sync_config_write on public.sync_config for all to authenticated
  using (public.auth_has_role('admin'))
  with check (public.auth_has_role('admin'));

-- ============ dashboards / widgets ============
drop policy if exists dashboards_select on public.dashboards;
create policy dashboards_select on public.dashboards for select to authenticated
  using (
    owner_user_id = (select auth.uid())
    or visible_to_roles && public.auth_roles()
    or public.auth_has_role('admin')
  );

drop policy if exists dashboards_insert on public.dashboards;
create policy dashboards_insert on public.dashboards for insert to authenticated
  with check (
    public.auth_has_permission('create_dashboards')
    and owner_user_id = (select auth.uid())
  );

drop policy if exists dashboards_update on public.dashboards;
create policy dashboards_update on public.dashboards for update to authenticated
  using (owner_user_id = (select auth.uid()) or public.auth_has_role('admin'))
  with check (owner_user_id = (select auth.uid()) or public.auth_has_role('admin'));

drop policy if exists dashboards_delete on public.dashboards;
create policy dashboards_delete on public.dashboards for delete to authenticated
  using (owner_user_id = (select auth.uid()) or public.auth_has_role('admin'));

-- Widgets herdam o acesso do dashboard pai.
drop policy if exists widgets_select on public.widgets;
create policy widgets_select on public.widgets for select to authenticated
  using (
    exists (
      select 1 from public.dashboards d
      where d.id = widgets.dashboard_id
        and (
          d.owner_user_id = (select auth.uid())
          or d.visible_to_roles && public.auth_roles()
          or public.auth_has_role('admin')
        )
    )
  );

drop policy if exists widgets_write on public.widgets;
create policy widgets_write on public.widgets for all to authenticated
  using (
    exists (
      select 1 from public.dashboards d
      where d.id = widgets.dashboard_id
        and (d.owner_user_id = (select auth.uid()) or public.auth_has_role('admin'))
    )
  )
  with check (
    exists (
      select 1 from public.dashboards d
      where d.id = widgets.dashboard_id
        and (d.owner_user_id = (select auth.uid()) or public.auth_has_role('admin'))
    )
  );

-- >>>>>>>>>>>>>>>>>>>> migrations/0010_seeds.sql <<<<<<<<<<<<<<<<<<<<
-- Versão: 1.0 | Data: 04/07/2026
-- Seeds: papéis, permissões, vínculos e configuração inicial de sync.
-- Idempotente (on conflict). NÃO cria usuários — isso é feito na tela de admin.

-- Papéis
insert into public.roles (key, label) values
  ('admin', 'Administrador'),
  ('gestor', 'Gestor'),
  ('vendedor', 'Vendedor')
on conflict (key) do update set label = excluded.label;

-- Permissões (capacidades independentes)
insert into public.permissions (key, label) values
  ('edit_record_values',       'Editar valores de registros'),
  ('manage_field_definitions', 'Criar/alterar colunas (definições de campo)'),
  ('manage_users_roles',       'Gerenciar usuários, papéis e permissões'),
  ('create_dashboards',        'Criar e editar dashboards'),
  ('view_all_records',         'Ver todos os registros (não só os próprios)'),
  ('view_forecast_all',        'Ver o forecast de todos os vendedores')
on conflict (key) do update set label = excluded.label;

-- Vínculos papel -> permissão
-- admin: tudo
insert into public.role_permissions (role_key, permission_key)
select 'admin', p.key from public.permissions p
on conflict do nothing;

-- gestor/CEO: vê tudo e edita conforme configurado; não cria colunas nem gerencia usuários
insert into public.role_permissions (role_key, permission_key) values
  ('gestor', 'edit_record_values'),
  ('gestor', 'create_dashboards'),
  ('gestor', 'view_all_records'),
  ('gestor', 'view_forecast_all')
on conflict do nothing;

-- vendedor: edita os próprios registros e cria dashboards pessoais
insert into public.role_permissions (role_key, permission_key) values
  ('vendedor', 'edit_record_values'),
  ('vendedor', 'create_dashboards')
on conflict do nothing;

-- Configuração inicial de sync (filtros do forecast, janelas, flags).
-- Editável pelo admin. Valores em minúsculas para matching normalizado.
insert into public.sync_config (key, value) values
  (
    'forecast_ignored_owners',
    '["guillermo moane", "patricio marchionna", "daniela drielsma"]'::jsonb
  ),
  (
    'forecast_excluded_stages',
    '["demonstração de zapper", "demonstracao de zapper", "no show", "no-show", "noshow"]'::jsonb
  ),
  (
    'sync_windows',
    '{"reconcile_default_days": 3, "backfill_year": null, "page_pause_ms": 600}'::jsonb
  ),
  (
    'feature_flags',
    '{"sheets_direct_read": false}'::jsonb
  )
on conflict (key) do nothing;

-- >>>>>>>>>>>>>>>>>>>> migrations/0011_widget_rpc.sql <<<<<<<<<<<<<<<<<<<<
-- Versão: 1.0 | Data: 04/07/2026
-- Motor genérico de widgets: a config do widget (json) vira uma query
-- parametrizada. SECURITY INVOKER => respeita a RLS do chamador (um vendedor
-- só agrega os próprios registros). Nunca há SQL livre do usuário: dimensões,
-- métricas e filtros são validados contra whitelists e valores passam por
-- quoting seguro (format %L). Idempotente (create or replace).
--
-- Formato dos parâmetros (jsonb):
--   p_dimensions: [ { "field": "stage" | "custom:<key>", "transform": "none|day|week|month|quarter|year" } ]
--   p_metrics:    [ { "field": "mrr" | "custom:<key>" | "*", "agg": "sum|count|avg" } ]
--   p_filters:    [ { "field": "closed", "op": "eq|neq|gt|gte|lt|lte|in|is_null|not_null", "value": <json> } ]
-- Retorna jsonb array de linhas: dim_1..dim_N e metric_1..metric_M.

create or replace function public.run_widget_query(
  p_source text,
  p_dimensions jsonb default '[]'::jsonb,
  p_metrics jsonb default '[]'::jsonb,
  p_filters jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_allowed_cols text[] := array[
    'record_type','source_system','owner_user_id','pipeline','stage','stage_semantic',
    'temperature','sale_type','channel','currency','closed','value','mrr',
    'closed_at','opened_at','source_created_at','source_modified_at',
    'created_at','updated_at','last_synced_at'
  ];
  v_num_cols  text[] := array['value','mrr'];
  v_date_cols text[] := array[
    'closed_at','opened_at','source_created_at','source_modified_at',
    'created_at','updated_at','last_synced_at'
  ];
  v_select_parts text[] := array[]::text[];
  v_group_parts  text[] := array[]::text[];
  v_where_parts  text[] := array[]::text[];
  v_item jsonb;
  v_field text; v_transform text; v_agg text; v_alias text;
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
    if v_field is null then raise exception 'Dimensão sem "field"'; end if;

    if v_field like 'custom:%' then
      v_expr := format('(custom_fields ->> %L)', substring(v_field from 8));
    elsif v_field = any(v_allowed_cols) then
      if v_transform <> 'none' then
        if not (v_field = any(v_date_cols)) then
          raise exception 'transform "%" exige coluna de data', v_transform;
        end if;
        if v_transform not in ('day','week','month','quarter','year') then
          raise exception 'transform inválido: %', v_transform;
        end if;
        v_expr := format('date_trunc(%L, %I)', v_transform, v_field);
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
      elsif v_field like 'custom:%' then
        v_expr := format('count(custom_fields ->> %L)', substring(v_field from 8));
      elsif v_field = any(v_allowed_cols) then
        v_expr := format('count(%I)', v_field);
      else
        raise exception 'Coluna de métrica não permitida: %', v_field;
      end if;
    else
      if v_field like 'custom:%' then
        v_expr := format('%s((custom_fields ->> %L)::numeric)', v_agg, substring(v_field from 8));
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

    if v_field like 'custom:%' then
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
      -- Literal não tipado (unknown) coagido pelo tipo da coluna à esquerda.
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

grant execute on function public.run_widget_query(text, jsonb, jsonb, jsonb) to authenticated;
