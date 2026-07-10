-- ============================================================================
-- Versão: 1.0 | Data: 10/07/2026
-- BLOCO ÚNICO — FASE 10 — colar no SQL Editor do Supabase APÓS a Fase 9.
-- Customização de layout/aparência (migração 0027). Idempotente.
--  1) user_settings: preferências GLOBAIS por usuário (barra lateral fixada).
--  2) widgets.visual_type aceita 'barra_horizontal' (CHECK recriado com o
--     conjunto completo, inclusive 'calculado').
-- Aparência de widgets e fundo do dashboard não exigem SQL: vivem nos jsonb
-- widgets.settings.appearance e dashboards.settings.background já existentes.
-- ============================================================================

-- ===================== user_settings (global por usuário) =====================
create table if not exists public.user_settings (
  user_id uuid primary key references auth.users (id) on delete cascade,
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_user_settings_updated_at on public.user_settings;
create trigger trg_user_settings_updated_at
  before update on public.user_settings
  for each row execute function public.set_updated_at();

alter table public.user_settings enable row level security;

drop policy if exists user_settings_select on public.user_settings;
create policy user_settings_select on public.user_settings for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists user_settings_write on public.user_settings;
create policy user_settings_write on public.user_settings for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- ===================== widgets: novo visual_type 'barra_horizontal' ===========
alter table public.widgets
  drop constraint if exists widgets_visual_type_check;

alter table public.widgets
  add constraint widgets_visual_type_check
  check (visual_type in (
    'tabela', 'barra', 'barra_horizontal', 'linha', 'pizza', 'kpi',
    'funil', 'filtro', 'tabela_editavel', 'calculado'
  ));
