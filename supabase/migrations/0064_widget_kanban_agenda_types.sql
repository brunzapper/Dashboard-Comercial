-- Versão: 1.0 | Data: 16/07/2026
-- Novos visual_type 'kanban' (quadro de cards por valor de campo/bucket de
-- data/fases de tarefas) e 'agenda' (calendário de registros por campo de data
-- + tarefas por vencimento). O CHECK widgets_visual_type_check é recriado com
-- o conjunto completo (0055) acrescido dos dois novos. Nenhuma mudança em
-- run_widget_query (kanban/agenda consultam via record-list, não via RPC), logo
-- a regra de espelhamento com run_widget_query_snapshot não é acionada.
-- Idempotente (drop if exists + add).
alter table public.widgets
  drop constraint if exists widgets_visual_type_check;

alter table public.widgets
  add constraint widgets_visual_type_check
  check (visual_type in (
    'tabela', 'barra', 'barra_horizontal', 'linha', 'pizza', 'kpi',
    'funil', 'filtro', 'filtro_campo', 'tabela_editavel', 'calculado',
    'calculadora', 'nota', 'forma', 'kanban', 'agenda'
  ));
