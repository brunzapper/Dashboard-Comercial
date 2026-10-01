-- 0149_indicators_tree_ops.sql
-- Versão: 1.0 | Data: 01/10/2026
-- INDICADORES, a Tree OPERACIONAL e a Tabela de metas.
--
-- Por que existe: uma apresentação de metas ("N1 MRR novo inbound = vendas ×
-- ticket", metas Out/Nov/Dez, planos de ação, ritmo de acompanhamento) não
-- cabia no sistema sem ser escrita à mão. Faltavam quatro peças, todas
-- genéricas:
--
--  1. `indicators` — o CATÁLOGO de indicadores. `goals` sempre guardou só o
--     ALVO (`metric` é texto livre, 0016) e `goal_metrics` (sync_config) só
--     `{key,label,money}`; o REALIZADO era remontado em cada widget. Aqui o
--     indicador ganha unidade, rollup entre meses, direção (CAC: menor é
--     melhor), tolerância de desvio, dono e a fórmula do realizado — definida
--     UMA vez, consumida pela Tabela de metas e pelos nós da Tree. A `key` é a
--     MESMA de `goals.metric`: o indicador não duplica a meta, ele a explica.
--     O realizado é avaliado SÓ por `runCalculatedWidget` (engine): as RPCs de
--     widget ficam INTOCADAS (invariante 1).
--  2. `tree_nodes` ganha os tipos `indicator`/`plan`/`ritual` + `payload`
--     (jsonb, parse FAIL-CLOSED em lib/tree/payload.ts) e `preset_key` — a
--     identidade do seed idempotente do preset (ensure-if-absent: nó editado
--     ou movido nunca é tocado de novo).
--  3. `tasks.ritual_node_id`/`ritual_occurrence` — o ritual sem registro
--     (revisão diária, reunião mensal). A ocorrência é DERIVADA do calendário
--     (lib/rituals/cadence.ts), como a da série (0132): a trava é o índice
--     único, sem `completed_at is null` — "a 3ª revisão aconteceu uma vez".
--  4. `widgets.visual_type` ganha 'metas' (Tabela de metas). O CHECK é sempre
--     recriado INTEIRO (precedente 0100/0134/0142).
--
-- RLS de `tree_nodes`/`tasks` INTOCADAS. Idempotente. Aplicar ANTES do deploy
-- do código (invariante 6).

-- ===================== 1) indicators =====================
create table if not exists public.indicators (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null default '00000000-0000-4000-a000-000000000001'
    references public.organizations (id) on delete cascade,
  -- Mesma regra de slug de goal_metrics (lib/metas/metrics.ts cleanKey):
  -- IMUTÁVEL na prática — é a chave de goals.metric e dos refs `meta:`.
  key text not null check (key ~ '^[a-z0-9_]{1,40}$'),
  label text not null check (char_length(label) between 1 and 80),
  description text,
  unit text not null default 'quantidade'
    check (unit in ('moeda', 'quantidade', 'percentual', 'numero')),
  -- Como os meses viram total: MRR final é o ÚLTIMO, vendas SOMAM, conversão
  -- é MÉDIA, premissa não totaliza.
  rollup text not null default 'soma'
    check (rollup in ('soma', 'ultimo', 'media', 'nenhum')),
  direction text not null default 'maior_melhor'
    check (direction in ('maior_melhor', 'menor_melhor')),
  -- "Desvios >5%: fato, causa e ação" — o limiar a partir do qual o status
  -- vira "fora".
  tolerance_pct numeric not null default 5
    check (tolerance_pct >= 0 and tolerance_pct <= 100),
  owner_responsible_id uuid references public.responsibles (id) on delete set null,
  -- null = só meta (premissa). Senão {v:1, formula, formula_text?, sources,
  -- filters} — parse fail-closed em lib/indicators/model.ts.
  realized jsonb,
  sort_order integer not null default 0,
  -- Identidade do seed do preset (ensure-if-absent; nunca sobrescreve).
  preset_key text,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists uq_indicators_org_key
  on public.indicators (organization_id, key);

drop trigger if exists trg_indicators_updated on public.indicators;
create trigger trg_indicators_updated
  before update on public.indicators
  for each row execute function public.set_updated_at();

alter table public.indicators enable row level security;

-- Leitura: a org inteira (os números alimentam os dashboards dela).
drop policy if exists indicators_select on public.indicators;
create policy indicators_select on public.indicators
  for select to authenticated
  using (organization_id in (select public.auth_org_ids()));

-- Escrita: admin da org — o indicador define o que "realizado" significa para
-- todo dashboard que o cita (precedente de goals/metas, área admin-only).
drop policy if exists indicators_write on public.indicators;
create policy indicators_write on public.indicators
  for all to authenticated
  using (
    organization_id in (select public.auth_org_ids())
    and (select public.auth_has_role('admin'))
  )
  with check (
    organization_id in (select public.auth_org_ids())
    and (select public.auth_has_role('admin'))
  );

comment on table public.indicators is
  'Catálogo de indicadores (0149): unidade, rollup, direção, tolerância, dono e fórmula do REALIZADO de uma chave de goals.metric. Avaliado só no engine (runCalculatedWidget).';

-- ===================== 2) tree_nodes =====================
alter table public.tree_nodes
  add column if not exists payload jsonb,
  add column if not exists preset_key text;

alter table public.tree_nodes
  drop constraint if exists tree_nodes_kind_check;
alter table public.tree_nodes
  add constraint tree_nodes_kind_check
  check (kind in (
    'task', 'comment', 'record', 'field', 'note',
    'indicator', 'plan', 'ritual'
  ));

create unique index if not exists uq_tree_nodes_preset
  on public.tree_nodes (scope_kind, scope_id, preset_key)
  where preset_key is not null;

comment on column public.tree_nodes.payload is
  'Nós operacionais (0149): indicador {indicator, level, scope, childrenOp…}, plano 5W2H, ritual {cadence…}. Parse fail-closed em lib/tree/payload.ts.';
comment on column public.tree_nodes.preset_key is
  'Identidade do nó semeado por preset (ensure-if-absent: existente nunca é sobrescrito).';

-- ===================== 3) tasks — ocorrência de ritual =====================
alter table public.tasks
  add column if not exists ritual_node_id uuid
    references public.tree_nodes (id) on delete set null,
  add column if not exists ritual_occurrence integer;

-- A TRAVA: uma tarefa por (ritual, ocorrência), para sempre — sem
-- `completed_at is null` de propósito (mesma semântica da 0132).
create unique index if not exists uq_tasks_ritual_occurrence
  on public.tasks (ritual_node_id, ritual_occurrence)
  where ritual_node_id is not null and ritual_occurrence is not null;

comment on column public.tasks.ritual_occurrence is
  'N-ésima ocorrência de um ritual da Tree (0149), DERIVADA do calendário (lib/rituals/cadence.ts) — nunca um contador.';

-- ===================== 4) Widget "Tabela de metas" =====================
alter table public.widgets
  drop constraint if exists widgets_visual_type_check;

alter table public.widgets
  add constraint widgets_visual_type_check
  check (visual_type in (
    'tabela', 'barra', 'barra_horizontal', 'linha', 'pizza', 'kpi',
    'funil', 'filtro', 'filtro_campo', 'tabela_editavel', 'calculado',
    'calculadora', 'nota', 'forma', 'kanban', 'agenda', 'imagem',
    'linha_divisoria', 'tree', 'base_manual', 'metas'
  ));
