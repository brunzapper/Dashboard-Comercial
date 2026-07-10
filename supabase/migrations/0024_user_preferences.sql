-- Versão: 1.0 | Data: 10/07/2026
-- Preferências por usuário. Primeiro uso: guardar o último período consultado em
-- cada dashboard (filtros de período "salvos por usuário"). settings jsonb é
-- genérico p/ futuras preferências. RLS: cada usuário lê/escreve só a própria
-- linha. Uma linha por (usuário, dashboard) — o unique permite upsert por
-- onConflict. Idempotente.

create table if not exists public.user_preferences (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  dashboard_id uuid not null references public.dashboards (id) on delete cascade,
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, dashboard_id)
);

drop trigger if exists trg_user_preferences_updated_at on public.user_preferences;
create trigger trg_user_preferences_updated_at
  before update on public.user_preferences
  for each row execute function public.set_updated_at();

alter table public.user_preferences enable row level security;

drop policy if exists user_preferences_select on public.user_preferences;
create policy user_preferences_select on public.user_preferences for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists user_preferences_write on public.user_preferences;
create policy user_preferences_write on public.user_preferences for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
