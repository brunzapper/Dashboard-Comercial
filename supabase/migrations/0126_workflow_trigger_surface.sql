-- 0126_workflow_trigger_surface.sql
-- Versão: 1.0 | Data: 08/09/2026
-- WORKFLOW v2 — o esquema declara o GATILHO, e o gatilho decide a SUPERFÍCIE.
--
-- A 0125 tratou todo esquema como formulário e o renderizou dentro da própria
-- tela do Workflow. Errado nas duas pontas: o Workflow é a FÁBRICA (onde se
-- cria e configura), e o que ele produz vive fora dele —
--   gatilho `form`      → uma pessoa preenche  → página própria (URL copiável,
--                         para mandar ao time) + card em Operação;
--   gatilho `automacao` → condição sobre registros → nenhuma tela; é mecanismo,
--                         roda no tick.
--
-- `show_card` separa "tem página" de "aparece no hub": um formulário de uso
-- pontual pode existir só pelo link, sem poluir a aba Operação de todo mundo.
--
-- Idempotente. Não recria RPC nenhuma.

alter table public.workflow_schemas
  add column if not exists trigger_kind text not null default 'form';

alter table public.workflow_schemas
  add column if not exists show_card boolean not null default true;

-- CHECK adicionado à parte (add column ... check não é idempotente num
-- re-run; o constraint nomeado é).
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'workflow_schemas_trigger_kind_check'
  ) then
    alter table public.workflow_schemas
      add constraint workflow_schemas_trigger_kind_check
      check (trigger_kind in ('form', 'automacao'));
  end if;
end $$;

-- Índice do caminho quente: montar os cards de Operação da org é uma leitura
-- por request (hub + layout de /operacao), sempre com os três predicados.
create index if not exists idx_workflow_schemas_org_cards
  on public.workflow_schemas (organization_id, trigger_kind, show_card)
  where enabled;

comment on column public.workflow_schemas.trigger_kind is
  'O que inicia o esquema: form (uma pessoa preenche) | automacao (condição sobre registros, roda no tick). Decide a superfície: form tem página própria e card; automacao não tem tela.';

comment on column public.workflow_schemas.show_card is
  'Formulário aparece como card na aba Operação do hub. false = existe só pela URL direta (link compartilhado com o time).';
