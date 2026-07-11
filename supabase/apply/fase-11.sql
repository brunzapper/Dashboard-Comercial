-- ============================================================================
-- Versão: 1.0 | Data: 11/07/2026
-- BLOCO ÚNICO — FASE 11 — colar no SQL Editor do Supabase APÓS a Fase 10.
-- Tabela editável descontinuada + edição de campos por entidade (migração 0033).
-- Idempotente.
--  1) entity_custom_values: valores de campos personalizados ligados a
--     responsável/operação (tabelas de dashboard em modo lista por entidade).
--     Valores GLOBAIS/compartilhados; estrutura (colunas) vive em
--     widgets.settings.columns.
-- Observações:
--  - O widget "Tabela editável" (visual_type 'tabela_editavel') foi removido do
--    app. O CHECK de widgets.visual_type pode permanecer permissivo; nada precisa
--    ser alterado no schema para desativá-lo (o app apenas para de criar/renderizar).
--  - dashboard_table_cells (Fase 2) permanece como storage de fallback
--    dashboard-scoped; não é removida.
-- ============================================================================

-- ===================== entity_custom_values ==================================
create table if not exists public.entity_custom_values (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null check (entity_type in ('responsible', 'operation')),
  entity_id uuid not null,
  field_key text not null,
  value jsonb,
  updated_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (entity_type, entity_id, field_key)
);

create index if not exists idx_entity_custom_values_entity
  on public.entity_custom_values (entity_type, entity_id);

drop trigger if exists trg_entity_custom_values_updated_at on public.entity_custom_values;
create trigger trg_entity_custom_values_updated_at
  before update on public.entity_custom_values
  for each row execute function public.set_updated_at();

alter table public.entity_custom_values enable row level security;

drop policy if exists entity_custom_values_select on public.entity_custom_values;
create policy entity_custom_values_select on public.entity_custom_values
  for select to authenticated
  using (true);

drop policy if exists entity_custom_values_write on public.entity_custom_values;
create policy entity_custom_values_write on public.entity_custom_values
  for all to authenticated
  using (public.auth_has_permission('edit_record_values'))
  with check (public.auth_has_permission('edit_record_values'));
