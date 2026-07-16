-- Versão: 1.0 | Data: 16/07/2026
-- Kanbans dedicados: `dashboards.kind` distingue dashboards de kanbans.
-- Um kanban reusa TODA a infraestrutura de dashboards (RLS de visibilidade
-- owner/visible_to_roles/admin, permissão create_dashboards no INSERT, delete,
-- rename) — a diferença é o shape da configuração (settings.kanban, chaves
-- disjuntas de DashboardSettings) e a rota (/kanbans/[id], sem widgets/abas).
-- Idempotente.

alter table public.dashboards
  add column if not exists kind text not null default 'dashboard';

alter table public.dashboards
  drop constraint if exists dashboards_kind_check;
alter table public.dashboards
  add constraint dashboards_kind_check
  check (kind in ('dashboard', 'kanban'));

create index if not exists idx_dashboards_kind on public.dashboards (kind);
