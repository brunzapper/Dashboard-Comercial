-- Versão: 1.0 | Data: 23/07/2026
-- MULTI-ORGANIZAÇÃO (RLS): recria as policies das tabelas org-scoped (0090)
-- prefixando o gate `organization_id in (select public.auth_org_ids())` ao
-- predicado VIGENTE de cada uma — inclusive nos ramos admin/permission: um
-- admin da org B NUNCA alcança linhas da org A (o papel `admin` é o
-- "Administrador comum" DENTRO da org; quem cruza orgs é só o service role).
-- Filhas herdam via pai: policies com EXISTS na tabela-pai reaplicam a RLS
-- dela para o usuário consultante (comments, fc_members, sub_sources via
-- data_sources, snapshot_records via snapshots), então só as pais mudam aqui.
-- A família dashboards/widgets/células/placements é gateada num ponto ÚNICO:
-- os helpers auth_board_* (0088) são RECRIADOS com o gate de org dentro.
-- Idempotente. Aplicar após 0089/0090, imediatamente antes do deploy.

-- ===================== Família dashboards (helpers 0088 + org) =====================
create or replace function public.auth_board_manageable(p_dashboard uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.dashboards d
    where d.id = p_dashboard
      and d.organization_id in (select public.auth_org_ids())
      and (
        d.owner_user_id = (select auth.uid())
        or public.auth_has_role('admin')
      )
  );
$$;

create or replace function public.auth_board_visible(p_dashboard uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.dashboards d
    where d.id = p_dashboard
      and d.organization_id in (select public.auth_org_ids())
      and (
        d.owner_user_id = (select auth.uid())
        or public.auth_has_role('admin')
        or coalesce(public.auth_board_access_level(p_dashboard), '')
             in ('view', 'edit')
        or (
          d.visible_to_roles && public.auth_roles()
          and coalesce(public.auth_board_access_level(p_dashboard), '')
                <> 'blocked'
        )
      )
  );
$$;

create or replace function public.auth_board_editable(p_dashboard uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.dashboards d
    where d.id = p_dashboard
      and d.organization_id in (select public.auth_org_ids())
      and (
        d.owner_user_id = (select auth.uid())
        or public.auth_has_role('admin')
        or coalesce(public.auth_board_access_level(p_dashboard), '') = 'edit'
      )
  );
$$;

-- dashboards_insert: além de create_dashboards, a org da linha nova precisa
-- ser uma org do usuário (uma org B não nasce dashboard carimbado Zapper).
drop policy if exists dashboards_insert on public.dashboards;
create policy dashboards_insert on public.dashboards for insert to authenticated
  with check (
    organization_id in (select public.auth_org_ids())
    and (select public.auth_has_permission('create_dashboards'))
    and owner_user_id = (select auth.uid())
  );

-- ===================== records =====================
drop policy if exists records_select on public.records;
create policy records_select on public.records for select to authenticated
  using (
    organization_id in (select public.auth_org_ids())
    and (
      (select public.auth_has_permission('view_all_records'))
      or responsible_id in (select public.auth_responsible_ids())
    )
  );

drop policy if exists records_update on public.records;
create policy records_update on public.records for update to authenticated
  using (
    organization_id in (select public.auth_org_ids())
    and (select public.auth_has_permission('edit_record_values'))
    and (
      (select public.auth_has_permission('view_all_records'))
      or responsible_id in (select public.auth_responsible_ids())
    )
  )
  with check (
    organization_id in (select public.auth_org_ids())
    and (select public.auth_has_permission('edit_record_values'))
    and (
      (select public.auth_has_permission('view_all_records'))
      or responsible_id in (select public.auth_responsible_ids())
    )
  );

drop policy if exists records_insert on public.records;
create policy records_insert on public.records for insert to authenticated
  with check (
    organization_id in (select public.auth_org_ids())
    and (
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
        -- Ramo 2: registro criado no app E espelhado no Bitrix (0065).
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
    )
  );

drop policy if exists records_delete on public.records;
create policy records_delete on public.records for delete to authenticated
  using (
    organization_id in (select public.auth_org_ids())
    and (select public.auth_has_role('admin'))
  );

-- ===================== data_sources / sub_sources =====================
drop policy if exists data_sources_select on public.data_sources;
create policy data_sources_select on public.data_sources
  for select to authenticated
  using (organization_id in (select public.auth_org_ids()));

drop policy if exists data_sources_write on public.data_sources;
create policy data_sources_write on public.data_sources
  for all to authenticated
  using (
    organization_id in (select public.auth_org_ids())
    and (select public.auth_has_permission('manage_field_definitions'))
  )
  with check (
    organization_id in (select public.auth_org_ids())
    and (select public.auth_has_permission('manage_field_definitions'))
  );

-- sub_sources deriva da PAI (o exists reaplica a RLS de data_sources para o
-- usuário consultante — org-gated acima).
drop policy if exists sub_sources_select on public.sub_sources;
create policy sub_sources_select on public.sub_sources
  for select to authenticated
  using (
    exists (
      select 1 from public.data_sources ds
      where ds.key = sub_sources.parent_key
    )
  );

drop policy if exists sub_sources_write on public.sub_sources;
create policy sub_sources_write on public.sub_sources
  for all to authenticated
  using (
    (select public.auth_has_permission('manage_field_definitions'))
    and exists (
      select 1 from public.data_sources ds
      where ds.key = sub_sources.parent_key
    )
  )
  with check (
    (select public.auth_has_permission('manage_field_definitions'))
    and exists (
      select 1 from public.data_sources ds
      where ds.key = sub_sources.parent_key
    )
  );

-- ===================== field_definitions =====================
drop policy if exists field_definitions_select on public.field_definitions;
create policy field_definitions_select on public.field_definitions
  for select to authenticated
  using (organization_id in (select public.auth_org_ids()));

drop policy if exists field_definitions_insert on public.field_definitions;
create policy field_definitions_insert on public.field_definitions
  for insert to authenticated
  with check (
    organization_id in (select public.auth_org_ids())
    and (select public.auth_has_permission('manage_field_definitions'))
  );

drop policy if exists field_definitions_update on public.field_definitions;
create policy field_definitions_update on public.field_definitions
  for update to authenticated
  using (
    organization_id in (select public.auth_org_ids())
    and (select public.auth_has_permission('manage_field_definitions'))
  )
  with check (
    organization_id in (select public.auth_org_ids())
    and (select public.auth_has_permission('manage_field_definitions'))
  );

drop policy if exists field_definitions_delete on public.field_definitions;
create policy field_definitions_delete on public.field_definitions
  for delete to authenticated
  using (
    organization_id in (select public.auth_org_ids())
    and (select public.auth_has_permission('manage_field_definitions'))
  );

-- ===================== field_correspondences (+ members via pai) =====================
drop policy if exists field_correspondences_select on public.field_correspondences;
create policy field_correspondences_select on public.field_correspondences
  for select to authenticated
  using (organization_id in (select public.auth_org_ids()));

drop policy if exists field_correspondences_write on public.field_correspondences;
create policy field_correspondences_write on public.field_correspondences
  for all to authenticated
  using (
    organization_id in (select public.auth_org_ids())
    and (select public.auth_has_permission('manage_field_definitions'))
  )
  with check (
    organization_id in (select public.auth_org_ids())
    and (select public.auth_has_permission('manage_field_definitions'))
  );

drop policy if exists fc_members_select on public.field_correspondence_members;
create policy fc_members_select on public.field_correspondence_members
  for select to authenticated
  using (
    exists (
      select 1 from public.field_correspondences fc
      where fc.id = field_correspondence_members.correspondence_id
    )
  );

drop policy if exists fc_members_write on public.field_correspondence_members;
create policy fc_members_write on public.field_correspondence_members
  for all to authenticated
  using (
    (select public.auth_has_permission('manage_field_definitions'))
    and exists (
      select 1 from public.field_correspondences fc
      where fc.id = field_correspondence_members.correspondence_id
    )
  )
  with check (
    (select public.auth_has_permission('manage_field_definitions'))
    and exists (
      select 1 from public.field_correspondences fc
      where fc.id = field_correspondence_members.correspondence_id
    )
  );

-- ===================== responsibles / operations / responsible_operations =====================
drop policy if exists responsibles_select on public.responsibles;
create policy responsibles_select on public.responsibles for select to authenticated
  using (organization_id in (select public.auth_org_ids()));

drop policy if exists responsibles_write on public.responsibles;
create policy responsibles_write on public.responsibles for all to authenticated
  using (
    organization_id in (select public.auth_org_ids())
    and (select public.auth_has_role('admin'))
  )
  with check (
    organization_id in (select public.auth_org_ids())
    and (select public.auth_has_role('admin'))
  );

drop policy if exists operations_select on public.operations;
create policy operations_select on public.operations for select to authenticated
  using (organization_id in (select public.auth_org_ids()));

drop policy if exists operations_write on public.operations;
create policy operations_write on public.operations for all to authenticated
  using (
    organization_id in (select public.auth_org_ids())
    and (select public.auth_has_role('admin'))
  )
  with check (
    organization_id in (select public.auth_org_ids())
    and (select public.auth_has_role('admin'))
  );

-- responsible_operations deriva do responsável.
drop policy if exists responsible_operations_select on public.responsible_operations;
create policy responsible_operations_select on public.responsible_operations
  for select to authenticated
  using (
    exists (
      select 1 from public.responsibles r
      where r.id = responsible_operations.responsible_id
    )
  );

drop policy if exists responsible_operations_write on public.responsible_operations;
create policy responsible_operations_write on public.responsible_operations
  for all to authenticated
  using (
    (select public.auth_has_role('admin'))
    and exists (
      select 1 from public.responsibles r
      where r.id = responsible_operations.responsible_id
    )
  )
  with check (
    (select public.auth_has_role('admin'))
    and exists (
      select 1 from public.responsibles r
      where r.id = responsible_operations.responsible_id
    )
  );

-- ===================== goals / non_working_days =====================
drop policy if exists goals_select on public.goals;
create policy goals_select on public.goals for select to authenticated
  using (organization_id in (select public.auth_org_ids()));

drop policy if exists goals_write on public.goals;
create policy goals_write on public.goals for all to authenticated
  using (
    organization_id in (select public.auth_org_ids())
    and (select public.auth_has_role('admin'))
  )
  with check (
    organization_id in (select public.auth_org_ids())
    and (select public.auth_has_role('admin'))
  );

drop policy if exists non_working_days_select on public.non_working_days;
create policy non_working_days_select on public.non_working_days
  for select to authenticated
  using (organization_id in (select public.auth_org_ids()));

drop policy if exists non_working_days_write on public.non_working_days;
create policy non_working_days_write on public.non_working_days
  for all to authenticated
  using (
    organization_id in (select public.auth_org_ids())
    and (select public.auth_has_role('admin'))
  )
  with check (
    organization_id in (select public.auth_org_ids())
    and (select public.auth_has_role('admin'))
  );

-- ===================== tasks =====================
drop policy if exists tasks_select on public.tasks;
create policy tasks_select on public.tasks for select to authenticated
  using (
    organization_id in (select public.auth_org_ids())
    and (
      is_global
      or (select public.auth_has_permission('view_all_records'))
      or created_by = (select auth.uid())
      or responsible_id in (select public.auth_responsible_ids())
    )
  );

drop policy if exists tasks_insert on public.tasks;
create policy tasks_insert on public.tasks for insert to authenticated
  with check (
    organization_id in (select public.auth_org_ids())
    and created_by = (select auth.uid())
    and (
      (select public.auth_has_permission('view_all_records'))
      or responsible_id is null
      or responsible_id in (select public.auth_responsible_ids())
    )
  );

drop policy if exists tasks_update on public.tasks;
create policy tasks_update on public.tasks for update to authenticated
  using (
    organization_id in (select public.auth_org_ids())
    and (
      (select public.auth_has_permission('view_all_records'))
      or created_by = (select auth.uid())
      or responsible_id in (select public.auth_responsible_ids())
    )
  )
  with check (
    organization_id in (select public.auth_org_ids())
    and (
      (select public.auth_has_permission('view_all_records'))
      or created_by = (select auth.uid())
      or responsible_id in (select public.auth_responsible_ids())
    )
  );

drop policy if exists tasks_delete on public.tasks;
create policy tasks_delete on public.tasks for delete to authenticated
  using (
    organization_id in (select public.auth_org_ids())
    and (
      (select public.auth_has_role('admin'))
      or (select public.auth_has_role('gestor'))
      or (
        not locked
        and (
          created_by = (select auth.uid())
          or responsible_id in (select public.auth_responsible_ids())
        )
      )
    )
  );

-- ===================== audit_log =====================
drop policy if exists audit_log_select on public.audit_log;
create policy audit_log_select on public.audit_log for select to authenticated
  using (
    organization_id in (select public.auth_org_ids())
    and (select public.auth_has_permission('view_all_records'))
  );

drop policy if exists audit_log_insert on public.audit_log;
create policy audit_log_insert on public.audit_log for insert to authenticated
  with check (
    organization_id in (select public.auth_org_ids())
    and user_id = (select auth.uid())
    and origin = 'app'
  );

-- ===================== sync_config / encanamento Bitrix =====================
drop policy if exists sync_config_select on public.sync_config;
create policy sync_config_select on public.sync_config for select to authenticated
  using (organization_id in (select public.auth_org_ids()));

drop policy if exists sync_config_write on public.sync_config;
create policy sync_config_write on public.sync_config for all to authenticated
  using (
    organization_id in (select public.auth_org_ids())
    and (select public.auth_has_role('admin'))
  )
  with check (
    organization_id in (select public.auth_org_ids())
    and (select public.auth_has_role('admin'))
  );

drop policy if exists bitrix_user_map_select on public.bitrix_user_map;
create policy bitrix_user_map_select on public.bitrix_user_map
  for select to authenticated
  using (organization_id in (select public.auth_org_ids()));

drop policy if exists bitrix_user_map_write on public.bitrix_user_map;
create policy bitrix_user_map_write on public.bitrix_user_map
  for all to authenticated
  using (
    organization_id in (select public.auth_org_ids())
    and (select public.auth_has_permission('manage_users_roles'))
  )
  with check (
    organization_id in (select public.auth_org_ids())
    and (select public.auth_has_permission('manage_users_roles'))
  );

drop policy if exists bitrix_lookup_cache_select on public.bitrix_lookup_cache;
create policy bitrix_lookup_cache_select on public.bitrix_lookup_cache
  for select to authenticated
  using (organization_id in (select public.auth_org_ids()));

drop policy if exists sync_jobs_select on public.sync_jobs;
create policy sync_jobs_select on public.sync_jobs for select to authenticated
  using (organization_id in (select public.auth_org_ids()));

drop policy if exists writeback_select on public.bitrix_writeback_queue;
create policy writeback_select on public.bitrix_writeback_queue
  for select to authenticated
  using (
    organization_id in (select public.auth_org_ids())
    and (select public.auth_has_permission('view_all_records'))
  );

-- ===================== match_rules / record_matches / entity_custom_values =====================
drop policy if exists match_rules_select on public.match_rules;
create policy match_rules_select on public.match_rules
  for select to authenticated
  using (organization_id in (select public.auth_org_ids()));

drop policy if exists match_rules_write on public.match_rules;
create policy match_rules_write on public.match_rules
  for all to authenticated
  using (
    organization_id in (select public.auth_org_ids())
    and (select public.auth_has_permission('manage_field_definitions'))
  )
  with check (
    organization_id in (select public.auth_org_ids())
    and (select public.auth_has_permission('manage_field_definitions'))
  );

drop policy if exists record_matches_select on public.record_matches;
create policy record_matches_select on public.record_matches
  for select to authenticated
  using (organization_id in (select public.auth_org_ids()));

drop policy if exists record_matches_write on public.record_matches;
create policy record_matches_write on public.record_matches
  for all to authenticated
  using (
    organization_id in (select public.auth_org_ids())
    and (select public.auth_has_permission('manage_field_definitions'))
  )
  with check (
    organization_id in (select public.auth_org_ids())
    and (select public.auth_has_permission('manage_field_definitions'))
  );

drop policy if exists entity_custom_values_select on public.entity_custom_values;
create policy entity_custom_values_select on public.entity_custom_values
  for select to authenticated
  using (organization_id in (select public.auth_org_ids()));

drop policy if exists entity_custom_values_write on public.entity_custom_values;
create policy entity_custom_values_write on public.entity_custom_values
  for all to authenticated
  using (
    organization_id in (select public.auth_org_ids())
    and (select public.auth_has_permission('edit_record_values'))
  )
  with check (
    organization_id in (select public.auth_org_ids())
    and (select public.auth_has_permission('edit_record_values'))
  );

-- ===================== api_keys / webhooks =====================
drop policy if exists api_keys_select on public.api_keys;
create policy api_keys_select on public.api_keys for select to authenticated
  using (
    organization_id in (select public.auth_org_ids())
    and (select public.auth_has_role('admin'))
  );

drop policy if exists webhook_endpoints_select on public.webhook_endpoints;
create policy webhook_endpoints_select on public.webhook_endpoints
  for select to authenticated
  using (
    organization_id in (select public.auth_org_ids())
    and (select public.auth_has_role('admin'))
  );

drop policy if exists webhook_events_select on public.webhook_events;
create policy webhook_events_select on public.webhook_events
  for select to authenticated
  using (
    organization_id in (select public.auth_org_ids())
    and (select public.auth_has_role('admin'))
  );

-- Entregas/entradas derivam do endpoint/da chave (o exists reaplica a RLS
-- org-gated da pai).
drop policy if exists webhook_deliveries_select on public.webhook_deliveries;
create policy webhook_deliveries_select on public.webhook_deliveries
  for select to authenticated
  using (
    (select public.auth_has_role('admin'))
    and exists (
      select 1 from public.webhook_endpoints e
      where e.id = webhook_deliveries.endpoint_id
    )
  );

drop policy if exists webhook_inbound_select on public.webhook_inbound_events;
create policy webhook_inbound_select on public.webhook_inbound_events
  for select to authenticated
  using (
    (select public.auth_has_role('admin'))
    and exists (
      select 1 from public.api_keys k
      where k.id = webhook_inbound_events.api_key_id
    )
  );

-- ===================== snapshots (gestão) =====================
drop policy if exists snapshots_select on public.snapshots;
create policy snapshots_select on public.snapshots for select to authenticated
  using (
    exists (
      select 1 from public.dashboards d
      where d.id = snapshots.dashboard_id
        and d.organization_id in (select public.auth_org_ids())
        and (d.owner_user_id = (select auth.uid()) or (select public.auth_has_role('admin')))
    )
  );

drop policy if exists snapshots_insert on public.snapshots;
create policy snapshots_insert on public.snapshots for insert to authenticated
  with check (
    exists (
      select 1 from public.dashboards d
      where d.id = snapshots.dashboard_id
        and d.organization_id in (select public.auth_org_ids())
        and (d.owner_user_id = (select auth.uid()) or (select public.auth_has_role('admin')))
    )
  );

drop policy if exists snapshots_update on public.snapshots;
create policy snapshots_update on public.snapshots for update to authenticated
  using (
    exists (
      select 1 from public.dashboards d
      where d.id = snapshots.dashboard_id
        and d.organization_id in (select public.auth_org_ids())
        and (d.owner_user_id = (select auth.uid()) or (select public.auth_has_role('admin')))
    )
  )
  with check (
    exists (
      select 1 from public.dashboards d
      where d.id = snapshots.dashboard_id
        and d.organization_id in (select public.auth_org_ids())
        and (d.owner_user_id = (select auth.uid()) or (select public.auth_has_role('admin')))
    )
  );

drop policy if exists snapshots_delete on public.snapshots;
create policy snapshots_delete on public.snapshots for delete to authenticated
  using (
    exists (
      select 1 from public.dashboards d
      where d.id = snapshots.dashboard_id
        and d.organization_id in (select public.auth_org_ids())
        and (d.owner_user_id = (select auth.uid()) or (select public.auth_has_role('admin')))
    )
  );
