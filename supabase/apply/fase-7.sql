-- ============================================================================
-- Versão: 1.0 | Data: 09/07/2026
-- BLOCO ÚNICO — FASE 7 — colar no SQL Editor do Supabase APÓS a Fase 6B.
-- Filtro de período interativo: widget 'filtro' + dashboards.settings.
-- Idempotente.
-- ============================================================================

-- >>>>>>>>>>>>>>>>>>>> migrations/0017_widget_filter_type.sql <<<<<<<<<<<<<<<<<<<<
-- Versão: 1.0 | Data: 09/07/2026
-- Fase 7: filtro de período interativo nos dashboards.
--  1) widgets.visual_type passa a aceitar 'filtro' (widget de filtro de período
--     que controla outros widgets sem gerar dados próprios).
--  2) dashboards.settings (jsonb) guarda a config da barra de período global
--     (ligada/desligada, período e campo padrão) por dashboard.
-- Idempotente.

-- ===================== widgets: novo visual_type 'filtro' =====================
alter table public.widgets
  drop constraint if exists widgets_visual_type_check;

alter table public.widgets
  add constraint widgets_visual_type_check
  check (visual_type in ('tabela', 'barra', 'linha', 'pizza', 'kpi', 'funil', 'filtro'));

-- ===================== dashboards.settings =====================
alter table public.dashboards
  add column if not exists settings jsonb not null default '{}'::jsonb;
