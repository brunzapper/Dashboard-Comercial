-- Versão: 1.0 | Data: 23/07/2026
-- Acesso por PESSOA aos boards (menu ⋮ → "Acesso"): a tabela board_access
-- guarda overrides individuais por dashboard/kanban — 'view' (vê), 'edit'
-- (vê + edita widgets/estrutura) e 'blocked' (não vê, mesmo que o papel dele
-- esteja em visible_to_roles). Resolução efetiva, centralizada nos helpers
-- SECURITY DEFINER (sem recursão policy↔policy, mesmo truque do
-- auth_responsible_ids da 0037):
--   dono e admin SEMPRE veem/editam (nunca bloqueáveis — anti-lockout);
--   override view/edit CONCEDE além do papel; blocked REVOGA o que o papel
--   daria. visible_to_roles segue sendo a camada por função (coexistem).
-- Recria as policies que inlinavam a visibilidade (0068): dashboards,
-- widgets, dashboard_table_cells, kanban_placements. Aplicar ANTES do deploy
-- do código que consulta board_access (invariante 6). Idempotente.

-- ===================== Tabela =====================
create table if not exists public.board_access (
  dashboard_id uuid not null references public.dashboards (id) on delete cascade,
  user_id      uuid not null references auth.users (id) on delete cascade,
  level        text not null check (level in ('view', 'edit', 'blocked')),
  granted_by   uuid references auth.users (id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  primary key (dashboard_id, user_id)
);

create index if not exists idx_board_access_user on public.board_access (user_id);

drop trigger if exists trg_board_access_updated_at on public.board_access;
create trigger trg_board_access_updated_at
  before update on public.board_access
  for each row execute function public.set_updated_at();

alter table public.board_access enable row level security;

-- ===================== Helpers (SECURITY DEFINER) =====================
-- Nível do override do usuário logado neste board (null = sem override).
create or replace function public.auth_board_access_level(p_dashboard uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select ba.level
  from public.board_access ba
  where ba.dashboard_id = p_dashboard
    and ba.user_id = (select auth.uid());
$$;

-- Gestão do board (compartilhar/excluir/gerir acessos): dono ou admin.
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
      and (
        d.owner_user_id = (select auth.uid())
        or public.auth_has_role('admin')
      )
  );
$$;

-- Visibilidade EFETIVA: dono/admin sempre; override view/edit concede;
-- papel (visible_to_roles) vale salvo override 'blocked'.
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

-- Edição EFETIVA (settings/widgets): dono/admin ou override 'edit'.
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
      and (
        d.owner_user_id = (select auth.uid())
        or public.auth_has_role('admin')
        or coalesce(public.auth_board_access_level(p_dashboard), '') = 'edit'
      )
  );
$$;

grant execute on function public.auth_board_access_level(uuid) to authenticated;
grant execute on function public.auth_board_manageable(uuid) to authenticated;
grant execute on function public.auth_board_visible(uuid) to authenticated;
grant execute on function public.auth_board_editable(uuid) to authenticated;

-- ===================== RLS de board_access =====================
-- Usuário lê o próprio override (transparência); quem gere o board lê todos.
drop policy if exists board_access_select on public.board_access;
create policy board_access_select on public.board_access for select to authenticated
  using (
    user_id = (select auth.uid())
    or (select public.auth_board_manageable(dashboard_id))
  );

-- Escrita SÓ de quem gere o board (dono/admin) — nunca de quem tem 'edit'.
drop policy if exists board_access_write on public.board_access;
create policy board_access_write on public.board_access for all to authenticated
  using ((select public.auth_board_manageable(dashboard_id)))
  with check ((select public.auth_board_manageable(dashboard_id)));

-- ===================== dashboards =====================
drop policy if exists dashboards_select on public.dashboards;
create policy dashboards_select on public.dashboards for select to authenticated
  using ((select public.auth_board_visible(id)));

-- update inclui o nível 'edit' (settings/estrutura). Renomear/arquivar também
-- passam por update — o app só oferece essas ações a dono/admin (canManage);
-- a Lixeira é reversível, então o risco de um 'edit' malicioso é contido.
drop policy if exists dashboards_update on public.dashboards;
create policy dashboards_update on public.dashboards for update to authenticated
  using ((select public.auth_board_editable(id)))
  with check ((select public.auth_board_editable(id)));

drop policy if exists dashboards_delete on public.dashboards;
create policy dashboards_delete on public.dashboards for delete to authenticated
  using ((select public.auth_board_manageable(id)));

-- ===================== widgets =====================
drop policy if exists widgets_select on public.widgets;
create policy widgets_select on public.widgets for select to authenticated
  using ((select public.auth_board_visible(widgets.dashboard_id)));

drop policy if exists widgets_write on public.widgets;
create policy widgets_write on public.widgets for all to authenticated
  using ((select public.auth_board_editable(widgets.dashboard_id)))
  with check ((select public.auth_board_editable(widgets.dashboard_id)));

-- ===================== dashboard_table_cells =====================
-- Continua "qualquer visualizador escreve" (por design, 0026) — mas agora a
-- visibilidade é a EFETIVA (blocked perde a escrita junto com a leitura).
drop policy if exists dashboard_table_cells_select on public.dashboard_table_cells;
create policy dashboard_table_cells_select on public.dashboard_table_cells
  for select to authenticated
  using (
    exists (
      select 1 from public.widgets w
      where w.id = dashboard_table_cells.widget_id
        and public.auth_board_visible(w.dashboard_id)
    )
  );

drop policy if exists dashboard_table_cells_write on public.dashboard_table_cells;
create policy dashboard_table_cells_write on public.dashboard_table_cells
  for all to authenticated
  using (
    exists (
      select 1 from public.widgets w
      where w.id = dashboard_table_cells.widget_id
        and public.auth_board_visible(w.dashboard_id)
    )
  )
  with check (
    exists (
      select 1 from public.widgets w
      where w.id = dashboard_table_cells.widget_id
        and public.auth_board_visible(w.dashboard_id)
    )
  );

-- ===================== kanban_placements =====================
drop policy if exists kanban_placements_all on public.kanban_placements;
create policy kanban_placements_all on public.kanban_placements
  for all to authenticated
  using (
    (
      widget_id is not null and exists (
        select 1 from public.widgets w
        where w.id = kanban_placements.widget_id
          and public.auth_board_visible(w.dashboard_id)
      )
    )
    or (
      board_id is not null
      and (select public.auth_board_visible(kanban_placements.board_id))
    )
  )
  with check (
    (
      widget_id is not null and exists (
        select 1 from public.widgets w
        where w.id = kanban_placements.widget_id
          and public.auth_board_visible(w.dashboard_id)
      )
    )
    or (
      board_id is not null
      and (select public.auth_board_visible(kanban_placements.board_id))
    )
  );
