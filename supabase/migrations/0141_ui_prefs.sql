-- Migração 0141 | Data: 12/09/2026
-- Personalização da INTERFACE em 3 camadas (padrão do app → padrão da ORG, com
-- trava opcional por chave → preferência do USUÁRIO) e descrição de board.
--
-- 1) organizations.ui_prefs — molde exato da 0108 (organizations.theme):
--    { "values": { ...UiPrefs }, "locked": ["hubColumns", ...],
--      "operacaoDescriptions": { "<cardKey>": "texto" } }
--    Resolução SÓ em lib/config/ui-prefs.ts (resolveUiPrefs): chave travada faz
--    o valor da org vencer o override do usuário — destravar devolve a escolha
--    pessoal de cada um (a trava NÃO apaga override). "Aplicar a todos" é outra
--    coisa: apaga o override dos membros (service role escopado por org).
--    Sem RLS nova: as políticas de `organizations` (0089/0091) já cobrem a
--    coluna, e escrita segue org_admin.
--
-- 2) dashboards.description — descrição exibida (opcionalmente) no card do hub.
--    COLUNA, e não chave em `settings`: updateDashboardSettings sobrescreve a
--    coluna `settings` INTEIRA, e toda chave nova em DashboardSettings exigiria
--    entrada no dicionário exaustivo de lib/import/dashboard/settings-docs.ts.
--    Descrição é propriedade do board, não configuração de render — como coluna
--    fica naturalmente fora do contrato da IA.

alter table public.organizations
  add column if not exists ui_prefs jsonb not null default '{}'::jsonb;

comment on column public.organizations.ui_prefs is
  'Padrão de INTERFACE da org + travas por chave (0141). Formato: {values:{...}, locked:[...], operacaoDescriptions:{...}}. Resolvido só por resolveUiPrefs (lib/config/ui-prefs.ts).';

alter table public.dashboards
  add column if not exists description text;

comment on column public.dashboards.description is
  'Descrição livre do board, exibida no card do hub quando a preferência de interface pedir (0141). Fora do contrato de import/export da IA.';
