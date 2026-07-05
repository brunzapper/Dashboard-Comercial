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
