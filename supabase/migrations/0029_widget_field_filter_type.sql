-- Versão: 1.0 | Data: 11/07/2026
-- Novo visual_type 'filtro_campo' (widget "Filtro por campo"): filtra os demais
-- widgets por campo/valor e/ou busca textual, no dashboard já renderizado.
-- O CHECK widgets_visual_type_check é recriado com o conjunto completo (0027)
-- acrescido de 'filtro_campo'. Idempotente (drop if exists + add).
alter table public.widgets
  drop constraint if exists widgets_visual_type_check;

alter table public.widgets
  add constraint widgets_visual_type_check
  check (visual_type in (
    'tabela', 'barra', 'barra_horizontal', 'linha', 'pizza', 'kpi',
    'funil', 'filtro', 'filtro_campo', 'tabela_editavel', 'calculado'
  ));
