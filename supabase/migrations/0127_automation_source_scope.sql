-- 0127_automation_source_scope.sql
-- Versão: 1.0 | Data: 08/09/2026
-- AUTOMAÇÃO SEM QUADRO — a regra passa a poder ter uma BASE como universo.
--
-- Até aqui toda automação era de um kanban: o universo eram os cards de um
-- quadro, e a ação típica era mover de coluna. Mas o motor (0109) nunca foi
-- sobre kanban: `decideActions` (lib/kanban/automations/evaluate.ts) usa a
-- coluna SÓ para validar o alvo de `move_to_column`, e as condições de tempo
-- (`field_changed`, `created`) já são de registro, não de card. O que prendia
-- ao quadro era a origem das linhas.
--
-- Então entra um terceiro tipo de dono: `source_key` (uma Base). Mesma tabela,
-- mesmo parse fail-closed, mesmo `saveAutomation`, mesmo tick — só a montagem
-- do universo ramifica. Duplicar a tabela criaria dois lugares onde uma regra
-- pode estar e um tick que varre os dois.
--
-- Esta migração ainda usa o nome antigo (`kanban_automations`); a 0128, logo em
-- seguida, renomeia a tabela para `automation_rules` — foi exatamente o escopo
-- de Base introduzido aqui que tornou o nome antigo mentiroso. As duas andam
-- juntas; aplicar só esta deixa o banco consistente, mas com o nome velho.
--
-- Idempotente. Não recria RPC nenhuma.

alter table public.kanban_automations
  add column if not exists source_key text;

-- O CHECK de dono único vira TRÊS. Recriado por nome (o antigo aceita só dois).
alter table public.kanban_automations
  drop constraint if exists kanban_automations_one_owner;

alter table public.kanban_automations
  add constraint kanban_automations_one_owner check (
    ((widget_id is not null)::int
      + (board_id is not null)::int
      + (source_key is not null)::int) = 1
  );

create index if not exists idx_kanban_automations_source
  on public.kanban_automations (organization_id, source_key)
  where source_key is not null;

comment on column public.kanban_automations.source_key is
  'Base (data_sources.key) quando a regra NÃO tem quadro: o universo são os registros da base, não os cards de um kanban. Exatamente um de (widget_id, board_id, source_key).';

-- O trigger de stamp de org (0109) já cobre este caso SEM mudança: o subselect
-- do dashboard dono devolve null quando não há widget nem board, e o
-- `coalesce` cai em `new.organization_id`. Ou seja, a regra de Base depende do
-- carimbo EXPLÍCITO da action — que é o padrão das tabelas-raiz sem pai
-- (value_mappings 0117, workflow_schemas 0125), e por isso o gate do app falha
-- alto sem org ativa.

-- ============ RLS: terceiro ramo ============
-- Os dois ramos existentes derivam autoridade do QUADRO (auth_board_editable).
-- Uma regra de Base não tem quadro de onde derivar nada, então a autoridade
-- passa a ser o papel: admin da org. É deliberadamente mais restrito que
-- "editor de um board" — a regra alcança a base inteira, não os cards de um
-- quadro que alguém já podia editar.
drop policy if exists kanban_automations_all on public.kanban_automations;
create policy kanban_automations_all on public.kanban_automations
  for all to authenticated
  using (
    organization_id in (select public.auth_org_ids())
    and (
      (
        widget_id is not null
        and (select public.auth_board_editable(
          (select w.dashboard_id from public.widgets w
            where w.id = kanban_automations.widget_id)))
      )
      or (
        board_id is not null
        and (select public.auth_board_editable(kanban_automations.board_id))
      )
      or (
        source_key is not null
        and (select public.auth_has_role('admin'))
      )
    )
  )
  with check (
    organization_id in (select public.auth_org_ids())
    and (
      (
        widget_id is not null
        and (select public.auth_board_editable(
          (select w.dashboard_id from public.widgets w
            where w.id = kanban_automations.widget_id)))
      )
      or (
        board_id is not null
        and (select public.auth_board_editable(kanban_automations.board_id))
      )
      or (
        source_key is not null
        and (select public.auth_has_role('admin'))
      )
    )
  );

revoke all on public.kanban_automations from anon;
