-- Versão: 1.0 | Data: 15/07/2026
-- Novos visual_type 'calculadora' (calculadora com variáveis de campos), 'nota'
-- (post-it com texto dinâmico) e 'forma' (figura geométrica com atalho para
-- widget). O CHECK widgets_visual_type_check é recriado com o conjunto completo
-- (0029) acrescido dos três novos. Idempotente (drop if exists + add).
alter table public.widgets
  drop constraint if exists widgets_visual_type_check;

alter table public.widgets
  add constraint widgets_visual_type_check
  check (visual_type in (
    'tabela', 'barra', 'barra_horizontal', 'linha', 'pizza', 'kpi',
    'funil', 'filtro', 'filtro_campo', 'tabela_editavel', 'calculado',
    'calculadora', 'nota', 'forma'
  ));
