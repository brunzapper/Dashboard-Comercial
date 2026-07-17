-- Versão: 1.0 | Data: 17/07/2026
-- Novo visual_type 'imagem' (imagem por URL externa, renderizada frameless e
-- redimensionável pelo grid; config em settings.image — url/fit/alt/click).
-- O CHECK widgets_visual_type_check é recriado com o conjunto completo (0064)
-- acrescido do novo. Widget sem dados: fica fora de dataWidgets no frontend e
-- nunca chega a run_widget_query, logo a regra de espelhamento com
-- run_widget_query_snapshot não é acionada.
-- Idempotente (drop if exists + add).
alter table public.widgets
  drop constraint if exists widgets_visual_type_check;

alter table public.widgets
  add constraint widgets_visual_type_check
  check (visual_type in (
    'tabela', 'barra', 'barra_horizontal', 'linha', 'pizza', 'kpi',
    'funil', 'filtro', 'filtro_campo', 'tabela_editavel', 'calculado',
    'calculadora', 'nota', 'forma', 'kanban', 'agenda', 'imagem'
  ));
