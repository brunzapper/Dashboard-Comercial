-- Versão: 1.0 | Data: 25/07/2026
-- Novo visual_type 'linha_divisoria': a Forma "linha" vira widget próprio
-- ("Linha divisória" no menu de inserção). Os settings ficam IGUAIS
-- (settings.shape: kind "linha" + line) — o backfill é um flip puro de
-- visual_type nos widgets vivos (forma + shape.kind 'linha'). Snapshots
-- congelados (snapshots.config.widgets) e payloads antigos de clipboard NÃO
-- são reescritos — o front mantém o predicado de compat (isLineShapeWidget em
-- lib/widgets/lines.ts aceita as duas identidades).
-- O CHECK widgets_visual_type_check é recriado com o conjunto completo (0073)
-- acrescido do novo (padrão 0055/0064/0073); CHECK antes do UPDATE, senão o
-- backfill violaria o conjunto antigo. Widget sem dados: fica fora de
-- dataWidgets no frontend e nunca chega a run_widget_query, logo a regra de
-- espelhamento com run_widget_query_snapshot não é acionada.
-- Idempotente (drop if exists + add; update com where estável).
alter table public.widgets
  drop constraint if exists widgets_visual_type_check;

alter table public.widgets
  add constraint widgets_visual_type_check
  check (visual_type in (
    'tabela', 'barra', 'barra_horizontal', 'linha', 'pizza', 'kpi',
    'funil', 'filtro', 'filtro_campo', 'tabela_editavel', 'calculado',
    'calculadora', 'nota', 'forma', 'kanban', 'agenda', 'imagem',
    'linha_divisoria'
  ));

update public.widgets
   set visual_type = 'linha_divisoria'
 where visual_type = 'forma'
   and settings->'shape'->>'kind' = 'linha';
