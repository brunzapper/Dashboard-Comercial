<!-- Versão: 1.4 | Data: 20/07/2026 -->
<!-- v1.4 (20/07/2026): auditoria — proteção de edição manual permanente
     (release do marcador quando a fonte alcança o local), migrações 0083/0084,
     confirmações nas exclusões de configuração, períodos no fuso de Brasília. -->
<!-- v1.3 (20/07/2026): §4.7 — runbook de dias não úteis (cadastro/import CSV),
     métricas de meta custom e geração/atualização de presets. -->
<!-- v1.2 (19/07/2026): fuso da fonte (0079/0080) — checklist em §4.4/§4.6 e
     linha de troubleshooting "datas do Bitrix 1 dia depois". -->

# Manual de manutenção

Runbook para manter o sistema **manualmente, sem IA**: setup do zero, rotina de
mudanças seguras e troubleshooting. Pressupõe a leitura de
[`arquitetura.md`](./arquitetura.md) (especialmente a seção **Invariantes críticas**)
e usa [`banco-de-dados.md`](./banco-de-dados.md) como referência de schema.

## 1. Setup do zero (novo ambiente)

Ordem completa para levantar o sistema num projeto Supabase + Vercel novos:

1. **Supabase** — crie o projeto e anote URL, anon key e service role key.
2. **Banco** — no SQL Editor, aplique os blocos de `supabase/apply/` na ordem do
   runbook [`../supabase/README.md`](../supabase/README.md) (fase-1 → fase-2 → ... →
   fase-14, mais as migrações avulsas citadas lá, ex.: 0038 e 0056–0059). Tudo é
   idempotente: se falhar no meio, corrija e rode de novo. Termine com as migrações
   posteriores ao último bloco de fase (0065–0076, em ordem).
3. **Vercel** — importe o repositório (deploy automático a cada push; não há CI).
   Configure as Environment Variables usando `.env.example` como checklist:
   `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
   `SUPABASE_SERVICE_ROLE_KEY`, `BITRIX_WEBHOOK_URL`, `SYNC_SECRET`,
   `KEY_ENCRYPTION_KEY` (gere: `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`).
   Não existe `.env.local` — valores só na Vercel/Supabase.
4. **Primeiro admin** — Authentication → Users → Add user no painel Supabase; depois
   `insert into public.user_roles (user_id, role_key) values ('<UID>', 'admin')`.
   Passo a passo completo no `supabase/README.md` ("bootstrap").
5. **Agendamentos (pg_cron)** — no SQL Editor, nesta ordem:
   1. `apply/pg-cron-tick.sql` — **cria os segredos no Vault**
      (`app_base_url` = domínio de produção, `sync_secret` = SYNC_SECRET) e agenda o
      tick do sync a cada minuto;
   2. `apply/pg-cron-recalc.sql` — recalc diário dos campos calculados (05:00 UTC);
   3. `apply/pg-cron-snapshots.sql` — tick dos snapshots a cada 5 min;
   4. `apply/pg-cron-webhooks.sql` — tick dos webhooks de saída a cada minuto.
   Os três últimos **pressupõem os segredos criados pelo primeiro**.
6. **Sync Bitrix** — logado como admin, em Registros: **Backfill inicial** (importa o
   ano) e depois **Reconciliar**. Os responsáveis são criados automaticamente; cure a
   lista em Configurações → Responsáveis e monte as Operações.
7. **Planilha "Estudo de Fechamentos"** — instale o Apps Script
   `integrations/apps-script/push_estudo_fechamentos.gs` na planilha (instruções no
   cabeçalho do arquivo) e rode `installHourlyTrigger()`.
8. **Conferência** — rode as queries de verificação do `supabase/README.md`
   (políticas `anon` em snapshots = 0 linhas; EXECUTE das funções de snapshot só
   `service_role`; contagem de mocks = 302).

## 2. Rotina de desenvolvimento

```bash
npm install
npm run dev        # http://localhost:3000
npm run typecheck  # tsc --noEmit  — rode SEMPRE antes de commitar
npm run lint
npm run build      # o que a Vercel roda no deploy
```

- **Convenção de versionamento**: todo arquivo tem cabeçalho
  `Versão: X.Y | Data: DD/MM/AAAA`. Ao editar, incremente a versão menor e comente a
  mudança no local (`// vX.Y (data): ...`). Este é o único changelog do projeto.
- Não há testes automatizados: `typecheck` + `lint` + verificação manual no app são a
  rede de segurança (ver §6).

## 3. Como fazer uma mudança de banco

1. Crie `supabase/migrations/NNNN_nome.sql` com o próximo número livre (hoje: 0077).
   Cabeçalho `-- Versão / -- Data` + comentário explicando o quê/porquê.
2. Escreva SQL **idempotente** (`if not exists`, `create or replace`,
   `drop ... if exists` antes de `create trigger/policy`).
3. Se o app passa a **selecionar colunas novas**, o SQL deve ser aplicado **antes**
   do deploy do código — deixe isso avisado no cabeçalho da migração e no
   `supabase/README.md`.
4. Aplique manualmente no SQL Editor do Supabase (não há pipeline).
5. Atualize: a seção correspondente do `supabase/README.md` (como aplicar), o
   [`banco-de-dados.md`](./banco-de-dados.md) (schema + histórico) e, se a mudança
   for de fase, o bloco `supabase/apply/fase-N.sql`.
6. **Não renumere nem "conserte"** as anomalias históricas (0014 ausente; 0017 e
   0049 duplicados) — a ordem real de aplicação é a do runbook.

## 4. Checklists de mudança segura (áreas de risco)

### 4.1 Mudou `run_widget_query` (motor de widgets)

- [ ] A migração recria **também** `run_widget_query_snapshot` (e
  `_widget_match_expr` ↔ `_widget_match_expr_snap`) **no mesmo arquivo** — parta da
  0072, que contém o par completo.
- [ ] A regra dos mocks (substring das chaves `bitrix_uf_crm_1743441331` /
  `bitrix_uf_crm_67eacefcccd98`) permanece idêntica nos dois lados **e** em
  `lib/widgets/mock-reuniao.ts`.
- [ ] Buckets de data continuam batendo com `canonicalBucketKey` no cliente.
- [ ] EXECUTE da versão snapshot continua restrito à service role.
- [ ] Teste manual: um mesmo widget no dashboard e num snapshot recém-refrescado
  mostra os mesmos números (crie um snapshot de teste; "Atualizar agora" no menu ⋮).

### 4.2 Mexeu em snapshots

- [ ] Nenhuma política RLS `to anon`, nenhum GRANT a `anon`/`authenticated` nas
  funções de snapshot (rode as queries de conferência do `supabase/README.md`).
- [ ] O viewer não injeta filtros de restrição (as restrições vivem DENTRO da RPC
  como `(is_mock OR restrições)`).
- [ ] `default_period` continua tratado como filtro de consulta, não restrição.
- [ ] Mudanças no dataset exigem refresh dos snapshots existentes ("Atualizar agora"
  ou `select public.snapshot_refresh_copy(id) from public.snapshots;`).

### 4.3 Mexeu em RLS / permissões

- [ ] Helpers (`auth_has_role` etc.) chamados como `(select ...)` nas policies
  (InitPlan — 0068); chamada "nua" reavalia por linha.
- [ ] Visibilidade de registros continua pelo vínculo vivo
  `records.responsible_id → responsibles.user_id`; **nunca** por `owner_user_id`.
- [ ] Tabelas de segredo (`api_keys`, `webhook_*`, `sync_jobs`) continuam sem policy
  de escrita (só service role).

### 4.4 Criou/alterou fontes de dados

- [ ] Fonte nova via UI (Configurações → Fontes) segue a convenção
  `key === record_type`.
- [ ] O resolver de período cobre a fonte (mapa `fieldBySource` —
  `lib/widgets/period-resolve.ts`); fontes fora do mapa são **excluídas** pelo
  `@period` do RPC.
- [ ] `default_period_field` da fonte faz sentido (é o campo da barra de período).
- [ ] Fonte com origem em OUTRO fuso horário? Configure o "Fuso horário da
  origem" (Configurações → Fontes; `data_sources.timezone`, 0079) — sem isso,
  datas/horas de 18h+ locais caem no dia seguinte no dashboard (o read side lê
  o prefixo `YYYY-MM-DD` da string). Só afeta valores DATETIME ingeridos; campo
  de calendário puro (Bitrix `date`) e date-only nunca convertem.

### 4.5 Mexeu em campos calculados / fórmulas

- [ ] Valores são materializados em `records.custom_fields` — mudou fórmula, dispare
  o recálculo (a UI de Campos faz isso; em lote usa `recalc_apply_updates`).
- [ ] Fórmulas com "Data atual" dependem do cron diário (`pg-cron-recalc.sql`).
- [ ] Campos calculados são sempre recomputados pelo sync (não são protegidos por
  `field_modified_at`).
- [ ] Aninhamento (19/07/2026): ciclos são bloqueados no salvamento
  (`findFormulaCycle`, `lib/records/formula-deps.ts`) — **não** pré-ordene os
  defs nos chamadores: a ordem topológica é interna a `computeFormulaFields`.
- [ ] Excluir campo referenciado pela fórmula de outro é bloqueado
  (`deleteField`); não remova a guarda — a ref órfã degradaria para null em
  silêncio e congelaria o valor materializado dos dependentes.
- [ ] Aninhamento de agregados expande tokens em runtime: novo consumidor de
  fórmula de `calculado_agg` deve passar por `resolveCalcMetric` ou
  `runCalculatedWidget` (nunca ler `def.formula` cru direto para avaliar) — o
  mesmo par de choke points ABAIXA os operandos com escopo de fonte
  (`agg:…@<fonte>` → chave `aggif:`; 19/07/2026). Passe o catálogo de fontes
  (`SourceDef[]`) quando houver sub-fontes; o default (builtins) cobre raízes.
- [ ] Operandos por-registro dos campos calculados saem SEMPRE de
  `perRecordCalcOperands` (`lib/records/calc-operands.ts`) — os dois editores
  (/campos e o FieldForm inline do widget-builder) e a validação do servidor
  derivam do mesmo catálogo. Não monte lista paralela: foi exatamente essa
  divergência que deixou fórmulas com datas/casados como refs cruas
  irrecriáveis no editor inline.
- [ ] Operandos AGREGADOS de registro casado (`agg:*:match:<fonte>:<ref>`) valem
  nos DOIS lados do catálogo (20/07/2026): `defsAggCatalogInput` os deriva do
  `buildMatchFields` exportado (`lib/widgets/fields.ts`) — a mesma construção
  do lado widget; ref+rótulo `↪` idênticos byte a byte. Foi a ausência deles no
  lado defs que fazia o save de campo `calculado_agg` rejeitar ("Coluna
  inválida na fórmula: agg:count:match:…") fórmulas legítimas dos editores de
  widget. Lacuna conhecida: `agg:*:unified:<key>` segue rejeitado no save de
  campo reutilizável (o lado defs não carrega correspondências) — se aparecer,
  é follow-up, não regressão.
- [ ] Relações em fórmula comparam por NOME: por-registro o contexto recebe o
  `display_name` (recalc/`applyCalcFields`); no agregado o literal resolve
  nome→id antes do RPC (`resolveFkCondFilters`). Renomear um responsável exige
  recalc (o valor materializado guarda o resultado da comparação antiga).
- [ ] Aritmética sobre texto NÃO é bloqueada (decisão de produto, 19/07/2026):
  texto numérico coage (`"10" * 2` = 20); não-numérico avalia null → "—". A
  sintaxe é responsabilidade do usuário; o sistema erra claro só no
  genuinamente impossível (SOMASE em por-registro, `agg:*` em por-registro,
  "Data atual" em fórmula agregada, nome de responsável inexistente no save).

### 4.6 Mexeu no sync do Bitrix

- [ ] Edições manuais continuam protegidas (conflito por campo via
  `field_modified_at`). A proteção é PERMANENTE (20/07/2026): o marcador só é
  solto quando o valor da FONTE iguala o local (`releaseCaughtUpMarker`,
  lib/sync/shared) — não reintroduza a expiração por `last_synced_at`.
- [ ] Há no máximo 1 job `running` (índice único 0084); corrida no createJob
  reusa o vencedor (23505).
- [ ] Jobs continuam resumíveis (uma página por requisição; estado em `sync_jobs`).
- [ ] Mapper/catalog: rótulos visuais vêm de `FIELD_LABELS`
  (`lib/sync/bitrix/catalog.ts`); após mudar catálogo, rode um Backfill.
- [ ] Ao promover um campo descoberto (`bitrix_<id>`) a chave curada, reconcilie a
  linha antiga de `field_definitions` numa migração ANTES do próximo catálogo — o
  índice único `(source_system, source_field_id)` (0017) rejeita a chave nova
  enquanto a descoberta existir (precedente: 0075, `fonte`/`implementacao`).
- [ ] O sync **nunca** toca linhas mock (`source_system='manual'`,
  `source_id='mock_reuniao_*'`).
- [ ] Fuso (0079): o mapper converte valores **datetime** do fuso da fonte
  (`data_sources.timezone`, portal Bitrix = `Europe/Moscow`) para Brasília via
  `lib/date/normalize.ts` (`dateOrNull`/`resolveCustom`). Campo tipo `date`
  NUNCA converte. Após ligar/mudar o fuso de uma fonte já populada, rode um
  **Backfill** para reescrever os valores antigos (a 0080 só cobre as chaves
  datetime conhecidas: Data Reunião lead/negócio e `bitrix_moved_time`).

### 4.7 Dias não úteis, métricas de meta e presets (20/07/2026)

**Cadastrar/importar feriados** (afeta meta ideal/ritmo, alinhamento "mesmo dia
útil" e a comparação "mesmo dia útil"):

- Configurações → Metas → seção **Dias não úteis**: cadastro manual (data +
  rótulo), edição do rótulo inline e exclusão.
- **Importar CSV**: 1ª coluna = data (`dd/mm/aaaa` ou `aaaa-mm-dd`), 2ª coluna
  opcional = rótulo; linha de cabeçalho é detectada e ignorada; linhas sem data
  válida são reportadas e puladas. Reimportar o mesmo arquivo é seguro (upsert
  por dia). Teto de 500 datas por importação.
- Sem nenhum cadastro, dia útil = seg–sex (a feature degrada, não quebra).
- O viewer público de snapshots lê o calendário AO VIVO — não precisa refresh.

**Criar métrica de meta** (ex.: SQL): Configurações → Metas → combobox de
métrica → "+ Nova métrica…". Isso só registra a CHAVE (rótulo → slug) no
`sync_config` `goal_metrics` — o realizado de um KPI meta é sempre a consulta
do próprio widget (ex.: contagem sobre a sub-fonte de SQLs). A meta em si é
cadastrada normalmente por período/escopo.

**Gerar/atualizar presets**: `generatePresets()` (todos) e
`applyPreset(presetKey)` (um) em `app/(app)/dashboards/actions.ts` — ainda sem
UI. São idempotentes: rodar de novo ATUALIZA os widgets do preset (identidade
`settings.presetKey`, ids preservados) sem tocar widgets adicionados à mão;
sub-fontes/campos já existentes nunca são sobrescritos.

## 5. Troubleshooting

| Sintoma | Causa provável | Ação |
|---|---|---|
| Dashboard lento/widgets com erro após Backfill ou Reconciliar em massa | O sync reescreveu todas as linhas de `records` → tuplas mortas + estatísticas defasadas; logs do Supabase mostram `57014 statement timeout` e RPC 500; a carga simultânea dos widgets realimenta o problema | Rode a **Parte A** de `supabase/apply/diagnostico-perf.sql` (`ANALYZE`, roda no SQL editor) — correção imediata das estatísticas do planejador. `VACUUM` (Parte B) é secundário e NÃO roda no SQL editor (erro 25001): deixe ao autovacuum ou force via `psql` na conexão direta. Depois confira `[dashboard:timing]` nos logs da Vercel para achar widget dominante remanescente |
| UM dashboard específico segue lento (statement timeout em alguns widgets) mesmo após a correção global e após limitar o período | Widgets com colunas `match:` (registro casado): `_widget_match_expr` (0042) roda uma subconsulta correlacionada sobre `record_matches` POR LINHA do agregado; "todo o período" agrava (varre `records` inteira). As linhas de `record_matches` persistem após excluir a tabela que as gerou | 1) fixe um período padrão limitado na barra (`defaultPreset`); 2) aplique a migração `0077` (índices em `record_matches`); 3) se persistir, rode a **Parte C** de `supabase/apply/diagnostico-perf.sql` — o `[dashboard:timing]` aponta o widget e o `EXPLAIN` diz se falta a reescrita ESPELHADA de `_widget_match_expr`/`_widget_match_expr_snap` (nova migração recriando ambos os RPCs) |
| Snapshot mostra números ≠ dashboard | RPCs divergiram (espelhamento esquecido) ou snapshot sem refresh após migração | Compare `pg_get_functiondef` das duas funções; refaça o espelhamento; "Atualizar agora" |
| Mocks sumiram de um widget/snapshot | A consulta deixou de referenciar Data Reunião (ex.: snapshot sem `default_period`, período "todo o período") | Confira o campo de período; para snapshots antigos, defina `default_period` (SQL de exemplo no `supabase/README.md`, seção 0059) |
| Vendedor não vê os próprios registros/mocks | `responsibles` sem `user_id` vinculado (ou duplicata sem vínculo) | Vincule na tela de Usuários; para mocks, ver migração 0058 |
| Sync "travado" | Job em `sync_jobs` com status `running` órfão | Reabra a página Registros (o job é detectado e retomável); em último caso, marque `status='canceled'` via SQL |
| Tick não roda (sync/snapshot/webhook) | pg_cron não agendado, ou segredos ausentes no Vault | `select * from cron.job;` — confira os 4 jobs; recrie segredos conforme `pg-cron-tick.sql`; teste `POST` manual na rota com `SYNC_SECRET` |
| Ruído no `audit_log` com Data Reunião | Trigger de congelamento descartando tentativas do sync (esperado) | Inofensivo — ver migração 0051 |
| Datas do Bitrix aparecem 1 dia depois (ex.: reunião do dia 17 no dia 18) | Valor datetime gravado no fuso do portal (Moscou, +03:00) sem normalização — reuniões 18h+ BRT viram o dia seguinte no prefixo | Confira `data_sources.timezone` da fonte (`Europe/Moscow`); aplique 0079+0080 e rode um Backfill (o mapper v1.4+ normaliza p/ Brasília na entrada) |
| Webhook de saída parou | Auto-desativado após falhas consecutivas | Configurações → Integrações: ver `disabled_reason`, corrigir o endpoint e reativar |
| Tela de snapshots/listagens quebrou após deploy | Código selecionando coluna que a migração ainda não criou | Aplique o SQL pendente (regra "SQL antes do deploy") |
| Erro de env em runtime | Variável ausente na Vercel | `lib/env.ts` diz qual; confira `.env.example` |
| Remover os mocks de vez | — | `supabase/apply/undo-mock-reuniao.sql` (única forma prevista) |

## 6. Lacunas conhecidas e recomendações

Registradas para o futuro — **nada disto está implementado**:

1. **Testes de paridade das RPCs** (maior risco hoje): um script SQL que rode a mesma
   config de widget em `run_widget_query` e, sobre um snapshot de teste, em
   `run_widget_query_snapshot`, comparando resultados. Alternativa mínima: comparar
   `pg_get_functiondef` das duas funções módulo o nome da tabela.
2. **CI mínimo**: GitHub Actions rodando `npm run lint` + `npm run typecheck` a cada
   push — hoje nada impede um push que não compila.
3. **Testes de unidade** dos módulos puros (`lib/widgets/period-resolve.ts`,
   `lib/records/formulas.ts`, `lib/widgets/mock-reuniao.ts`) — são funções puras,
   fáceis de testar sem banco.
4. Manter **este manual e o `banco-de-dados.md` atualizados a cada migração** — eles
   substituem a leitura das 75 migrações; desatualizados, viram armadilha.
