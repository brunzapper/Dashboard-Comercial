-- 0148_tree_root.sql
-- Versão: 1.0 | Data: 30/09/2026
-- TREE — visualização ROOT: geometria, anotação-etapa e tarefa de mapa.
--
-- A Root desenha a mesma árvore num canvas de galhos ARRASTÁVEIS, que expandem
-- para o lado ou para baixo. A modelagem da 0133 não muda: a árvore segue
-- DERIVADA e `tree_nodes` guarda só a EXCEÇÃO. O que entra é mais exceção:
--
--  1. GEOMETRIA — `offset_x`/`offset_y` são o deslocamento do nó em relação ao
--     SLOT que o layout calcula (não uma posição absoluta): assim o offset se
--     soma ao dos ancestrais e arrastar um galho leva os subgalhos junto.
--     `direction` ('h' | 'v') é para onde o galho abre os filhos; null herda o
--     padrão do widget. Numa linha de exceção (`node_ref`), `parent_ref` null
--     passa a significar "sem exceção de pai" (só geometria) — como o
--     comentário da 0133 já dizia; '-' continua sendo "soltar na raiz". Nenhum
--     escritor jamais gravou null ali, então nada muda para as linhas atuais.
--  2. ANOTAÇÃO-ETAPA — `status` ('pendente' | 'concluida') faz da anotação
--     (o `kind='note'`, que pertence à própria Tree) um item checável; null é
--     texto livre. `is_goal` marca o RESULTADO esperado: a Root destaca o
--     caminho de qualquer nó até ele.
--  3. TAREFA DE MAPA — no escopo `livre` (mapa sem registro) a tarefa não é
--     fato derivado de nada, então a linha `kind='task'` + `ref_id` a pendura
--     no mapa. Uma vez por mapa: `uq_tree_nodes_map_task`.
--
-- A RLS da 0133 fica INTOCADA — ela já cobre as duas coisas (registro: quem
-- mexe no registro; livre: o autor ou admin/gestor). As RPCs de widget também.
-- Idempotente.

alter table public.tree_nodes
  add column if not exists offset_x double precision,
  add column if not exists offset_y double precision,
  add column if not exists direction text,
  add column if not exists status text,
  add column if not exists is_goal boolean not null default false;

alter table public.tree_nodes
  drop constraint if exists tree_nodes_direction_check;
alter table public.tree_nodes
  add constraint tree_nodes_direction_check
  check (direction is null or direction in ('h', 'v'));

alter table public.tree_nodes
  drop constraint if exists tree_nodes_status_check;
alter table public.tree_nodes
  add constraint tree_nodes_status_check
  check (status is null or status in ('pendente', 'concluida'));

create unique index if not exists uq_tree_nodes_map_task
  on public.tree_nodes (scope_kind, scope_id, ref_id)
  where kind = 'task' and node_ref is null;

comment on column public.tree_nodes.offset_x is
  'Root: deslocamento horizontal relativo ao slot calculado (soma-se ao dos ancestrais). Null/0 = no slot.';
comment on column public.tree_nodes.offset_y is
  'Root: deslocamento vertical relativo ao slot calculado (soma-se ao dos ancestrais). Null/0 = no slot.';
comment on column public.tree_nodes.direction is
  'Root: para onde o galho abre os filhos (h = para o lado, v = para baixo). Null = padrão do widget.';
comment on column public.tree_nodes.status is
  'Só em anotação: null = texto livre; pendente/concluida = etapa checável (conta no progresso da Root).';
comment on column public.tree_nodes.is_goal is
  'Só em anotação: o Resultado esperado. A Root destaca o caminho de um nó até ele.';
