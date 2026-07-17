-- Versão: 1.0 | Data: 17/07/2026
-- Fases "Personalizar" do kanban de REGISTROS (KanbanSettings.columnSource
-- 'custom'): as colunas são 100% definidas pelo usuário e a coluna de cada
-- card é DADO DA VISÃO — não altera o registro. Este posicionamento vive aqui,
-- escopado ao dono da visão: um WIDGET kanban (widget_id) OU um kanban
-- DEDICADO (board_id = dashboards.kind 'kanban') — check de exatamente um.
-- Registro sem linha aqui cai na primeira coluna do quadro. RLS segue o
-- precedente de 0026 (dashboard_table_cells): QUALQUER visualizador do
-- dashboard pai pode ler e gravar (mover card personalizado é entrada de dado
-- da visão, como editar célula da tabela editável). SEM acesso anon
-- (snapshots públicos ficam de fora por regra do projeto). Idempotente.

create table if not exists public.kanban_placements (
  id uuid primary key default gen_random_uuid(),
  widget_id uuid references public.widgets (id) on delete cascade,
  board_id uuid references public.dashboards (id) on delete cascade,
  record_id uuid not null references public.records (id) on delete cascade,
  column_key text not null,
  -- Ordenação fracionária dentro da coluna (novo/movido = -Date.now(), topo).
  position double precision not null default 0,
  updated_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint kanban_placements_one_owner check (
    ((widget_id is not null)::int + (board_id is not null)::int) = 1
  )
);

-- Um posicionamento por registro por visão. Índices COMPLETOS (não parciais):
-- o upsert via PostgREST (on_conflict=widget_id,record_id) não infere índice
-- parcial; NULLs distintos já isolam as pernas (linha de board tem widget_id
-- null e nunca conflita no índice de widget, e vice-versa).
create unique index if not exists uq_kanban_placements_widget
  on public.kanban_placements (widget_id, record_id);
create unique index if not exists uq_kanban_placements_board
  on public.kanban_placements (board_id, record_id);
create index if not exists idx_kanban_placements_record
  on public.kanban_placements (record_id);

drop trigger if exists trg_kanban_placements_updated_at on public.kanban_placements;
create trigger trg_kanban_placements_updated_at
  before update on public.kanban_placements
  for each row execute function public.set_updated_at();

alter table public.kanban_placements enable row level security;

-- Visualizador do dashboard pai lê e grava (duas pernas: widget→dashboard e
-- board dedicado).
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
            or d.visible_to_roles && public.auth_roles()
            or public.auth_has_role('admin')
          )
      )
    )
    or (
      board_id is not null and exists (
        select 1 from public.dashboards d
        where d.id = kanban_placements.board_id
          and (
            d.owner_user_id = (select auth.uid())
            or d.visible_to_roles && public.auth_roles()
            or public.auth_has_role('admin')
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
            or d.visible_to_roles && public.auth_roles()
            or public.auth_has_role('admin')
          )
      )
    )
    or (
      board_id is not null and exists (
        select 1 from public.dashboards d
        where d.id = kanban_placements.board_id
          and (
            d.owner_user_id = (select auth.uid())
            or d.visible_to_roles && public.auth_roles()
            or public.auth_has_role('admin')
          )
      )
    )
  );
