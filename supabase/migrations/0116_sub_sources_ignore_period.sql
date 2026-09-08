-- 0116_sub_sources_ignore_period.sql
-- Versão: 1.0 | Data: 06/08/2026
-- SUB-BASE QUE IGNORA O FILTRO DE PERÍODO: flag por sub-base
-- (sub_sources.ignore_period). Marcada, as linhas da sub entram nas consultas
-- SEM recorte de período (barra do dashboard, filtro rápido de período, janela
-- do card) — sempre "todo período". Uso: misturar resultados dependentes de
-- período (ex.: fechamentos no período) com independentes (ex.: todos os leads
-- ativos hoje, não importa quando entraram). Filtros de data explícitos do
-- widget seguem valendo.
-- Resolução 100% no ENGINE (invariante 10): applyPeriodToFilters
-- (lib/widgets/period.ts) particiona as fontes cobertas e omite do
-- `byType` os record_types cujas fontes cobertas TODAS ignoram; no caso misto
-- o filtro sintético `@period` sai com `record_types` = record_types que
-- respeitam, e o wrapper JÁ EXISTENTE `_widget_wrap_record_types` (0054)
-- deixa os isentos passarem — esta migração NÃO recria
-- run_widget_query/run_widget_query_snapshot (invariante 1 não acionada).
-- Sem RLS nova (herda as policies existentes de sub_sources). Idempotente.

alter table public.sub_sources
  add column if not exists ignore_period boolean not null default false;

comment on column public.sub_sources.ignore_period is
  'Sub-base não respeita o filtro de período do dashboard: linhas sempre consideradas ("todo período"). Resolvido no engine (applyPeriodToFilters); nunca no RPC.';
