-- Versão: 1.0 | Data: 10/07/2026
-- Fase 2: widget "Tabela editável" (visual_type 'tabela_editavel'). A ESTRUTURA
-- (nomes de linhas/colunas, tipo de célula) vive em widgets.settings.matrix
-- (edição = dono/admin, via widgets_write). Os VALORES das células vivem aqui,
-- numa tabela dashboard-scoped editável por QUALQUER visualizador do dashboard
-- (mais amplo que widgets_write). Idempotente.

-- ===================== widgets: novo visual_type 'tabela_editavel' ============
-- O CHECK de 0008 é inline (widgets_visual_type_check); recria incluindo o novo
-- valor (mantém 'filtro' de 0017).
alter table public.widgets
  drop constraint if exists widgets_visual_type_check;

alter table public.widgets
  add constraint widgets_visual_type_check
  check (visual_type in ('tabela', 'barra', 'linha', 'pizza', 'kpi', 'funil', 'filtro', 'tabela_editavel'));

-- ===================== valores das células (dashboard-scoped) ==================
create table if not exists public.dashboard_table_cells (
  id uuid primary key default gen_random_uuid(),
  widget_id uuid not null references public.widgets (id) on delete cascade,
  row_key text not null,
  col_key text not null,
  value jsonb, -- número ou texto; null/ausente = célula vazia
  updated_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (widget_id, row_key, col_key)
);

create index if not exists idx_dashboard_table_cells_widget
  on public.dashboard_table_cells (widget_id);

drop trigger if exists trg_dashboard_table_cells_updated_at on public.dashboard_table_cells;
create trigger trg_dashboard_table_cells_updated_at
  before update on public.dashboard_table_cells
  for each row execute function public.set_updated_at();

alter table public.dashboard_table_cells enable row level security;

-- select E write = qualquer visualizador do dashboard pai (via widgets→dashboards).
-- Propositalmente mais amplo que widgets_write (que é só owner/admin): a entrada
-- de dados na tabela editável é compartilhada por todos que enxergam o dashboard.
drop policy if exists dashboard_table_cells_select on public.dashboard_table_cells;
create policy dashboard_table_cells_select on public.dashboard_table_cells for select to authenticated
  using (
    exists (
      select 1 from public.widgets w
      join public.dashboards d on d.id = w.dashboard_id
      where w.id = dashboard_table_cells.widget_id
        and (
          d.owner_user_id = (select auth.uid())
          or d.visible_to_roles && public.auth_roles()
          or public.auth_has_role('admin')
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
          or d.visible_to_roles && public.auth_roles()
          or public.auth_has_role('admin')
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
          or d.visible_to_roles && public.auth_roles()
          or public.auth_has_role('admin')
        )
    )
  );
