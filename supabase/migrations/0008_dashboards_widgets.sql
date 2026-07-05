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
