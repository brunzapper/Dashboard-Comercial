-- Versão: 1.0 | Data: 17/07/2026
-- PERFORMANCE (InitPlan): os helpers public.auth_has_permission(...),
-- public.auth_has_role(...) e public.auth_roles() apareciam "nus" nas policies.
-- Chamada nua em USING/WITH CHECK é reavaliada POR LINHA escaneada (cada uma é
-- um SELECT em user_roles/role_permissions via SECURITY DEFINER) — custo que
-- multiplica todo scan de widget/lista. Envolver em (select ...) transforma a
-- chamada em InitPlan: avaliada UMA vez por statement.
--
-- Esta migração recria as policies afetadas com o corpo VIGENTE reproduzido
-- verbatim, mudando APENAS:
--   public.auth_has_permission('x')        -> (select public.auth_has_permission('x'))
--   public.auth_has_role('x')              -> (select public.auth_has_role('x'))
--   visible_to_roles && public.auth_roles() -> visible_to_roles && (select public.auth_roles())
-- `(select auth.uid())` e `in (select public.auth_responsible_ids())` já eram
-- subqueries — intocados. Nenhuma semântica de acesso muda.
--
-- Corpos vigentes: 0009 (roles/permissions/user_roles/records_delete/
-- field_definitions_*/audit_log/bitrix_user_map/sync_config/dashboards/widgets),
-- 0012 (operations/responsibles), 0016 (goals), 0019 (correspondences),
-- 0026 (dashboard_table_cells), 0033 (entity_custom_values), 0036 (currencies),
-- 0037 (records select/update), 0038 (writeback), 0041 (match_rules/
-- record_matches), 0056 (snapshots*), 0060 (data_sources), 0063+0066 (tasks),
-- 0065 (records_insert), 0066 (comments), 0067 (kanban_placements).
-- Não recriadas (nada a envolver): policies using(true), user_preferences/
-- user_settings/audit_log_insert (só auth.uid()), comments_select/insert
-- (EXISTS que reaplica a RLS do pai), field_definitions_select (0043: true).
-- Idempotente (drop policy if exists antes de cada create).

-- ============ roles / permissions / role_permissions (0009) ============
drop policy if exists roles_write on public.roles;
create policy roles_write on public.roles for all to authenticated
  using ((select public.auth_has_permission('manage_users_roles')))
  with check ((select public.auth_has_permission('manage_users_roles')));

drop policy if exists permissions_write on public.permissions;
create policy permissions_write on public.permissions for all to authenticated
  using ((select public.auth_has_permission('manage_users_roles')))
  with check ((select public.auth_has_permission('manage_users_roles')));

drop policy if exists role_permissions_write on public.role_permissions;
create policy role_permissions_write on public.role_permissions for all to authenticated
  using ((select public.auth_has_permission('manage_users_roles')))
  with check ((select public.auth_has_permission('manage_users_roles')));

-- ============ user_roles (0009) ============
drop policy if exists user_roles_select on public.user_roles;
create policy user_roles_select on public.user_roles for select to authenticated
  using (user_id = (select auth.uid()) or (select public.auth_has_permission('manage_users_roles')));

drop policy if exists user_roles_write on public.user_roles;
create policy user_roles_write on public.user_roles for all to authenticated
  using ((select public.auth_has_permission('manage_users_roles')))
  with check ((select public.auth_has_permission('manage_users_roles')));

-- ============ records (0037 select/update; 0065 insert; 0009 delete) ============
drop policy if exists records_select on public.records;
create policy records_select on public.records for select to authenticated
  using (
    (select public.auth_has_permission('view_all_records'))
    or responsible_id in (select public.auth_responsible_ids())
  );

drop policy if exists records_update on public.records;
create policy records_update on public.records for update to authenticated
  using (
    (select public.auth_has_permission('edit_record_values'))
    and (
      (select public.auth_has_permission('view_all_records'))
      or responsible_id in (select public.auth_responsible_ids())
    )
  )
  with check (
    (select public.auth_has_permission('edit_record_values'))
    and (
      (select public.auth_has_permission('view_all_records'))
      or responsible_id in (select public.auth_responsible_ids())
    )
  );

drop policy if exists records_insert on public.records;
create policy records_insert on public.records for insert to authenticated
  with check (
    (select public.auth_has_role('admin'))
    or (
      -- Ramo 1: registro puramente MANUAL (0061).
      (select public.auth_has_permission('edit_record_values'))
      and source_system = 'manual'
      and source_id is null
      and not is_mock
      and exists (
        select 1 from public.data_sources ds
        where ds.record_type = records.record_type
          and ds.manual_entry
      )
      and (
        (select public.auth_has_permission('view_all_records'))
        or responsible_id in (select public.auth_responsible_ids())
      )
    )
    or (
      -- Ramo 2: registro criado no app E espelhado no Bitrix (0065). A entidade
      -- já existe na origem (source_id não nulo); mesmas garantias do ramo 1.
      (select public.auth_has_permission('edit_record_values'))
      and source_system = 'bitrix'
      and source_id is not null
      and not is_mock
      and exists (
        select 1 from public.data_sources ds
        where ds.record_type = records.record_type
          and ds.manual_entry
      )
      and (
        (select public.auth_has_permission('view_all_records'))
        or responsible_id in (select public.auth_responsible_ids())
      )
    )
  );

drop policy if exists records_delete on public.records;
create policy records_delete on public.records for delete to authenticated
  using ((select public.auth_has_role('admin')));

-- ============ field_definitions (0009; select ficou using(true) na 0043) ============
drop policy if exists field_definitions_insert on public.field_definitions;
create policy field_definitions_insert on public.field_definitions for insert to authenticated
  with check ((select public.auth_has_permission('manage_field_definitions')));

drop policy if exists field_definitions_update on public.field_definitions;
create policy field_definitions_update on public.field_definitions for update to authenticated
  using ((select public.auth_has_permission('manage_field_definitions')))
  with check ((select public.auth_has_permission('manage_field_definitions')));

drop policy if exists field_definitions_delete on public.field_definitions;
create policy field_definitions_delete on public.field_definitions for delete to authenticated
  using ((select public.auth_has_permission('manage_field_definitions')));

-- ============ audit_log (0009) ============
drop policy if exists audit_log_select on public.audit_log;
create policy audit_log_select on public.audit_log for select to authenticated
  using ((select public.auth_has_permission('view_all_records')));

-- ============ bitrix_user_map / sync_config (0009) ============
drop policy if exists bitrix_user_map_write on public.bitrix_user_map;
create policy bitrix_user_map_write on public.bitrix_user_map for all to authenticated
  using ((select public.auth_has_permission('manage_users_roles')))
  with check ((select public.auth_has_permission('manage_users_roles')));

drop policy if exists sync_config_write on public.sync_config;
create policy sync_config_write on public.sync_config for all to authenticated
  using ((select public.auth_has_role('admin')))
  with check ((select public.auth_has_role('admin')));

-- ============ dashboards / widgets (0009) ============
drop policy if exists dashboards_select on public.dashboards;
create policy dashboards_select on public.dashboards for select to authenticated
  using (
    owner_user_id = (select auth.uid())
    or visible_to_roles && (select public.auth_roles())
    or (select public.auth_has_role('admin'))
  );

drop policy if exists dashboards_insert on public.dashboards;
create policy dashboards_insert on public.dashboards for insert to authenticated
  with check (
    (select public.auth_has_permission('create_dashboards'))
    and owner_user_id = (select auth.uid())
  );

drop policy if exists dashboards_update on public.dashboards;
create policy dashboards_update on public.dashboards for update to authenticated
  using (owner_user_id = (select auth.uid()) or (select public.auth_has_role('admin')))
  with check (owner_user_id = (select auth.uid()) or (select public.auth_has_role('admin')));

drop policy if exists dashboards_delete on public.dashboards;
create policy dashboards_delete on public.dashboards for delete to authenticated
  using (owner_user_id = (select auth.uid()) or (select public.auth_has_role('admin')));

drop policy if exists widgets_select on public.widgets;
create policy widgets_select on public.widgets for select to authenticated
  using (
    exists (
      select 1 from public.dashboards d
      where d.id = widgets.dashboard_id
        and (
          d.owner_user_id = (select auth.uid())
          or d.visible_to_roles && (select public.auth_roles())
          or (select public.auth_has_role('admin'))
        )
    )
  );

drop policy if exists widgets_write on public.widgets;
create policy widgets_write on public.widgets for all to authenticated
  using (
    exists (
      select 1 from public.dashboards d
      where d.id = widgets.dashboard_id
        and (d.owner_user_id = (select auth.uid()) or (select public.auth_has_role('admin')))
    )
  )
  with check (
    exists (
      select 1 from public.dashboards d
      where d.id = widgets.dashboard_id
        and (d.owner_user_id = (select auth.uid()) or (select public.auth_has_role('admin')))
    )
  );

-- ============ operations / responsibles / responsible_operations (0012) ============
drop policy if exists operations_write on public.operations;
create policy operations_write on public.operations for all to authenticated
  using ((select public.auth_has_role('admin')))
  with check ((select public.auth_has_role('admin')));

drop policy if exists responsibles_write on public.responsibles;
create policy responsibles_write on public.responsibles for all to authenticated
  using ((select public.auth_has_role('admin')))
  with check ((select public.auth_has_role('admin')));

drop policy if exists responsible_operations_write on public.responsible_operations;
create policy responsible_operations_write on public.responsible_operations for all to authenticated
  using ((select public.auth_has_role('admin')))
  with check ((select public.auth_has_role('admin')));

-- ============ goals (0016) ============
drop policy if exists goals_write on public.goals;
create policy goals_write on public.goals for all to authenticated
  using ((select public.auth_has_role('admin')))
  with check ((select public.auth_has_role('admin')));

-- ============ field_correspondences (0019) ============
drop policy if exists field_correspondences_write on public.field_correspondences;
create policy field_correspondences_write on public.field_correspondences
  for all to authenticated
  using ((select public.auth_has_permission('manage_field_definitions')))
  with check ((select public.auth_has_permission('manage_field_definitions')));

drop policy if exists fc_members_write on public.field_correspondence_members;
create policy fc_members_write on public.field_correspondence_members
  for all to authenticated
  using ((select public.auth_has_permission('manage_field_definitions')))
  with check ((select public.auth_has_permission('manage_field_definitions')));

-- ============ dashboard_table_cells (0026) ============
drop policy if exists dashboard_table_cells_select on public.dashboard_table_cells;
create policy dashboard_table_cells_select on public.dashboard_table_cells for select to authenticated
  using (
    exists (
      select 1 from public.widgets w
      join public.dashboards d on d.id = w.dashboard_id
      where w.id = dashboard_table_cells.widget_id
        and (
          d.owner_user_id = (select auth.uid())
          or d.visible_to_roles && (select public.auth_roles())
          or (select public.auth_has_role('admin'))
        )
    )
  );

drop policy if exists dashboard_table_cells_write on public.dashboard_table_cells;
create policy dashboard_table_cells_write on public.dashboard_table_cells for all to authenticated
  using (
    exists (
      select 1 from public.widgets w
      join public.dashboards d on d.id = w.dashboard_id
      where w.id = dashboard_table_cells.widget_id
        and (
          d.owner_user_id = (select auth.uid())
          or d.visible_to_roles && (select public.auth_roles())
          or (select public.auth_has_role('admin'))
        )
    )
  )
  with check (
    exists (
      select 1 from public.widgets w
      join public.dashboards d on d.id = w.dashboard_id
      where w.id = dashboard_table_cells.widget_id
        and (
          d.owner_user_id = (select auth.uid())
          or d.visible_to_roles && (select public.auth_roles())
          or (select public.auth_has_role('admin'))
        )
    )
  );

-- ============ entity_custom_values (0033) ============
drop policy if exists entity_custom_values_write on public.entity_custom_values;
create policy entity_custom_values_write on public.entity_custom_values
  for all to authenticated
  using ((select public.auth_has_permission('edit_record_values')))
  with check ((select public.auth_has_permission('edit_record_values')));

-- ============ currencies / currency_rates (0036) ============
drop policy if exists currencies_write on public.currencies;
create policy currencies_write on public.currencies
  for all to authenticated
  using ((select public.auth_has_permission('manage_field_definitions')))
  with check ((select public.auth_has_permission('manage_field_definitions')));

drop policy if exists currency_rates_write on public.currency_rates;
create policy currency_rates_write on public.currency_rates
  for all to authenticated
  using ((select public.auth_has_permission('manage_field_definitions')))
  with check ((select public.auth_has_permission('manage_field_definitions')));

-- ============ bitrix_writeback_queue (0038) ============
drop policy if exists writeback_select on public.bitrix_writeback_queue;
create policy writeback_select on public.bitrix_writeback_queue for select to authenticated
  using ((select public.auth_has_permission('view_all_records')));

-- ============ match_rules / record_matches (0041) ============
drop policy if exists match_rules_write on public.match_rules;
create policy match_rules_write on public.match_rules
  for all to authenticated
  using ((select public.auth_has_permission('manage_field_definitions')))
  with check ((select public.auth_has_permission('manage_field_definitions')));

drop policy if exists record_matches_write on public.record_matches;
create policy record_matches_write on public.record_matches
  for all to authenticated
  using ((select public.auth_has_permission('manage_field_definitions')))
  with check ((select public.auth_has_permission('manage_field_definitions')));

-- ============ snapshots / snapshot_records / snapshot_record_matches (0056) ============
-- Somente wrap do auth_has_role; caminho público continua sendo /s/[token] +
-- service role — nada aqui é `to anon` nem muda grants.
drop policy if exists snapshots_select on public.snapshots;
create policy snapshots_select on public.snapshots for select to authenticated
  using (
    exists (
      select 1 from public.dashboards d
      where d.id = snapshots.dashboard_id
        and (d.owner_user_id = (select auth.uid()) or (select public.auth_has_role('admin')))
    )
  );

drop policy if exists snapshots_insert on public.snapshots;
create policy snapshots_insert on public.snapshots for insert to authenticated
  with check (
    exists (
      select 1 from public.dashboards d
      where d.id = snapshots.dashboard_id
        and (d.owner_user_id = (select auth.uid()) or (select public.auth_has_role('admin')))
    )
  );

drop policy if exists snapshots_update on public.snapshots;
create policy snapshots_update on public.snapshots for update to authenticated
  using (
    exists (
      select 1 from public.dashboards d
      where d.id = snapshots.dashboard_id
        and (d.owner_user_id = (select auth.uid()) or (select public.auth_has_role('admin')))
    )
  )
  with check (
    exists (
      select 1 from public.dashboards d
      where d.id = snapshots.dashboard_id
        and (d.owner_user_id = (select auth.uid()) or (select public.auth_has_role('admin')))
    )
  );

drop policy if exists snapshots_delete on public.snapshots;
create policy snapshots_delete on public.snapshots for delete to authenticated
  using (
    exists (
      select 1 from public.dashboards d
      where d.id = snapshots.dashboard_id
        and (d.owner_user_id = (select auth.uid()) or (select public.auth_has_role('admin')))
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
        and (d.owner_user_id = (select auth.uid()) or (select public.auth_has_role('admin')))
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
        and (d.owner_user_id = (select auth.uid()) or (select public.auth_has_role('admin')))
    )
  );

-- ============ data_sources (0060) ============
drop policy if exists data_sources_write on public.data_sources;
create policy data_sources_write on public.data_sources
  for all to authenticated
  using ((select public.auth_has_permission('manage_field_definitions')))
  with check ((select public.auth_has_permission('manage_field_definitions')));

-- ============ tasks (0066 select; 0063 insert/update/delete) ============
drop policy if exists tasks_select on public.tasks;
create policy tasks_select on public.tasks for select to authenticated
  using (
    is_global
    or (select public.auth_has_permission('view_all_records'))
    or created_by = (select auth.uid())
    or responsible_id in (select public.auth_responsible_ids())
  );

drop policy if exists tasks_insert on public.tasks;
create policy tasks_insert on public.tasks for insert to authenticated
  with check (
    created_by = (select auth.uid())
    and (
      (select public.auth_has_permission('view_all_records'))
      or responsible_id is null
      or responsible_id in (select public.auth_responsible_ids())
    )
  );

drop policy if exists tasks_update on public.tasks;
create policy tasks_update on public.tasks for update to authenticated
  using (
    (select public.auth_has_permission('view_all_records'))
    or created_by = (select auth.uid())
    or responsible_id in (select public.auth_responsible_ids())
  )
  with check (
    (select public.auth_has_permission('view_all_records'))
    or created_by = (select auth.uid())
    or responsible_id in (select public.auth_responsible_ids())
  );

drop policy if exists tasks_delete on public.tasks;
create policy tasks_delete on public.tasks for delete to authenticated
  using (
    (select public.auth_has_role('admin'))
    or (select public.auth_has_role('gestor'))
    or (
      not locked
      and (
        created_by = (select auth.uid())
        or responsible_id in (select public.auth_responsible_ids())
      )
    )
  );

-- ============ comments (0066; select/insert não usam helpers) ============
drop policy if exists comments_update on public.comments;
create policy comments_update on public.comments for update to authenticated
  using (
    created_by = (select auth.uid())
    or (select public.auth_has_role('admin'))
    or (select public.auth_has_role('gestor'))
  )
  with check (
    created_by = (select auth.uid())
    or (select public.auth_has_role('admin'))
    or (select public.auth_has_role('gestor'))
  );

drop policy if exists comments_delete on public.comments;
create policy comments_delete on public.comments for delete to authenticated
  using (
    created_by = (select auth.uid())
    or (select public.auth_has_role('admin'))
    or (select public.auth_has_role('gestor'))
  );

-- ============ kanban_placements (0067) ============
drop policy if exists kanban_placements_all on public.kanban_placements;
create policy kanban_placements_all on public.kanban_placements
  for all to authenticated
  using (
    (
      widget_id is not null and exists (
        select 1 from public.widgets w
        join public.dashboards d on d.id = w.dashboard_id
        where w.id = kanban_placements.widget_id
          and (
            d.owner_user_id = (select auth.uid())
            or d.visible_to_roles && (select public.auth_roles())
            or (select public.auth_has_role('admin'))
          )
      )
    )
    or (
      board_id is not null and exists (
        select 1 from public.dashboards d
        where d.id = kanban_placements.board_id
          and (
            d.owner_user_id = (select auth.uid())
            or d.visible_to_roles && (select public.auth_roles())
            or (select public.auth_has_role('admin'))
          )
      )
    )
  )
  with check (
    (
      widget_id is not null and exists (
        select 1 from public.widgets w
        join public.dashboards d on d.id = w.dashboard_id
        where w.id = kanban_placements.widget_id
          and (
            d.owner_user_id = (select auth.uid())
            or d.visible_to_roles && (select public.auth_roles())
            or (select public.auth_has_role('admin'))
          )
      )
    )
    or (
      board_id is not null and exists (
        select 1 from public.dashboards d
        where d.id = kanban_placements.board_id
          and (
            d.owner_user_id = (select auth.uid())
            or d.visible_to_roles && (select public.auth_roles())
            or (select public.auth_has_role('admin'))
          )
      )
    )
  );
