-- 0134_widget_tree_type.sql
-- Versão: 1.0 | Data: 09/09/2026
-- Widget TREE: a árvore de acompanhamento (e o mapa mental) dentro do
-- dashboard.
--
-- Só isto: o CHECK de `widgets.visual_type` recriado com o conjunto completo
-- mais 'tree' (precedente exato da 0100 — o CHECK é sempre recriado inteiro,
-- nunca "alterado"). A configuração do widget vive em `widgets.settings.tree`
-- e os NÓS vivem em `tree_nodes` (0133), que guarda só o que não é derivável.
--
-- Idempotente.
alter table public.widgets
  drop constraint if exists widgets_visual_type_check;

alter table public.widgets
  add constraint widgets_visual_type_check
  check (visual_type in (
    'tabela', 'barra', 'barra_horizontal', 'linha', 'pizza', 'kpi',
    'funil', 'filtro', 'filtro_campo', 'tabela_editavel', 'calculado',
    'calculadora', 'nota', 'forma', 'kanban', 'agenda', 'imagem',
    'linha_divisoria', 'tree'
  ));
