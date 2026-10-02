-- 0150_tree_node_size_display.sql
-- Versão: 1.0 | Data: 02/10/2026
-- O que o preset "Metas 4T26" deixou fixo no código vira DADO editável.
--
--  1. TREE — tamanho e exibição por nó. `width`/`height` (px do canvas da
--     Root) são o tamanho escolhido ao REDIMENSIONAR o cartão; null = o
--     tamanho automático do tipo. `display` (jsonb) guarda escolhas de exibição
--     do cartão — hoje `kindBadge` ("show" | "hide": o rótulo de tipo no modo
--     Apresentar) e `tone` (cor do cartão); o widget tem o padrão
--     (settings.tree.presentation). `due_date` é a data PRÓPRIA da anotação
--     (prazo): antes a anotação exibia a data de CRIAÇÃO (o dia do apply do
--     preset) e nada a editava. Valem para nó próprio e para a linha de
--     exceção de fato derivado (`node_ref`), no mesmo regime da geometria da
--     0148. A RLS da 0133 fica INTOCADA (cobre as colunas novas).
--  2. INDICADORES — `attention_pct`: até quanto de desvio o status é
--     "Atenção" (antes fixo em 2× a tolerância). null = o padrão de sempre.
--
-- As RPCs de widget ficam intocadas. Idempotente.

alter table public.tree_nodes
  add column if not exists width double precision,
  add column if not exists height double precision,
  add column if not exists display jsonb,
  add column if not exists due_date date;

alter table public.tree_nodes
  drop constraint if exists tree_nodes_size_check;
alter table public.tree_nodes
  add constraint tree_nodes_size_check
  check (
    (width is null or (width >= 120 and width <= 1600))
    and (height is null or (height >= 60 and height <= 1600))
  );

alter table public.tree_nodes
  drop constraint if exists tree_nodes_display_check;
alter table public.tree_nodes
  add constraint tree_nodes_display_check
  check (display is null or jsonb_typeof(display) = 'object');

alter table public.indicators
  add column if not exists attention_pct numeric;

alter table public.indicators
  drop constraint if exists indicators_attention_pct_check;
alter table public.indicators
  add constraint indicators_attention_pct_check
  check (attention_pct is null or (attention_pct >= 0 and attention_pct <= 100));
