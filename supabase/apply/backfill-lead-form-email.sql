-- Versão: 1.0 | Data: 12/09/2026
-- BACKFILL do endereço padrão de e-mail no esquema de fábrica
-- "Formulário de criação Bitrix" (lib/workflow/seeds/bitrix-lead-form.ts).
-- Rode no SQL Editor.
--
-- Por que um runbook e não o seed: `ensureDefaultWorkflowSchemas`
-- (lib/workflow/schemas.ts) semeia UMA vez por org e grava o marcador
-- `workflow_seeded` em `sync_config`. Isso é de propósito — ensure-if-absent
-- ressuscitaria um esquema que alguém excluiu. A consequência é que mudar o
-- arquivo do seed só alcança org NOVA: a org que já existe tem a definição dela
-- gravada em `workflow_schemas.definition`, e é essa linha que este script
-- corrige.
--
-- O que faz: acrescenta `defaultValue: "sememail@sememail.com"` ao campo
-- `email` do formulário. `readForm` (app/(app)/operacao/workflow/actions.ts) já
-- cai no defaultValue quando o campo chega VAZIO, e `FieldInput`
-- (components/operacao/workflow-runner.tsx) já inicializa a caixa com ele —
-- nenhum código precisou mudar, só o dado.
--
-- Idempotente por construção: o `where` exige que o campo `email` exista e
-- AINDA NÃO tenha `defaultValue`. Rodar de novo não faz nada, e — importante —
-- um admin que já tenha escolhido outro endereço à mão NÃO é sobrescrito.
-- Esquemas com `definition` inválido (jsonb que o parse fail-closed recusa) são
-- ignorados pelo mesmo `where`: se não há o campo na forma esperada, o script
-- não inventa.

begin;

with alvo as (
  select
    s.id,
    -- Índice do campo `email` dentro de definition->form->fields.
    (
      select (i - 1)
      from jsonb_array_elements(s.definition -> 'form' -> 'fields')
             with ordinality as f(campo, i)
      where campo ->> 'key' = 'email'
        and not (campo ? 'defaultValue')
      limit 1
    ) as idx
  from public.workflow_schemas s
  where s.key = 'bitrix_lead_form'
    and jsonb_typeof(s.definition -> 'form' -> 'fields') = 'array'
)
update public.workflow_schemas s
set definition = jsonb_set(
      s.definition,
      array['form', 'fields', alvo.idx::text, 'defaultValue'],
      to_jsonb('sememail@sememail.com'::text),
      true
    )
from alvo
where alvo.id = s.id
  and alvo.idx is not null;

-- Conferência: uma linha por org, com o valor que ficou gravado.
select
  s.organization_id,
  s.key,
  campo ->> 'defaultValue' as email_padrao
from public.workflow_schemas s
     cross join lateral jsonb_array_elements(s.definition -> 'form' -> 'fields') as campo
where s.key = 'bitrix_lead_form'
  and campo ->> 'key' = 'email';

commit;
