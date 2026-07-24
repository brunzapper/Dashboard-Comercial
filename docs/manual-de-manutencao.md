<!-- Versão: 1.15 | Data: 24/07/2026 -->
<!-- v1.15 (24/07/2026): painel "Editar com IA" no dashboard (0098) — sessão e
     Desfazer persistidos em dashboard_ai_sessions (linha por usuário×board,
     sobrescrita in place, cascade no delete do board — SEM job de limpeza);
     maxDuration=300 também na página do dashboard; linhas novas no
     troubleshooting. -->
<!-- v1.14 (23/07/2026): troubleshooting da IA de dashboards — KEY_ENCRYPTION_KEY,
     truncamento/timeout de turno, Desfazer edição, preset de fábrica
     re-identificado como import:. -->
<!-- v1.13 (23/07/2026): multi-org (0088–0094) — runbook de organizações,
     Owner (env OWNER_USER_ID) e acessos customizados; ver §4.9. -->
<!-- v1.12 (22/07/2026): job pg_cron nº 5 (purge-dashboard-trash — purga da
     Lixeira de boards, 0087) no setup e no troubleshooting. -->
<!-- v1.11 (22/07/2026): §4.7 — callout do preset Inbound v5 (SAL removido da
     exibição, comparação em todos os cards, cores da marca como dados de
     aparência; re-apply sobrescreve settings dos widgets geridos). -->
<!-- v1.10 (22/07/2026): 0086 (linhas core no catálogo) — checklist do sync em
     §4.6 (options do pipeline; "coluna núcleo sumiu" = olho da aba Núcleo). -->
<!-- v1.9 (21/07/2026): §4.1 — checklist do dia de Brasília (0085): probes de
     ancoragem/bucket p/ colunas timestamptz do núcleo; par de RPCs agora parte
     da 0085. -->
<!-- v1.8 (20/07/2026): §5 — linha "dashboard abre preso em Carregando…"
     (sync inicial do Filtro por campo agora é raso, sem navegação RSC). -->
<!-- v1.7 (20/07/2026): §4.7/§5 — mocks no SQL: migração 0084 (fonte nos mocks
     Inbound), preset v4 (Mês x Mês abre em "dia cheio") e linha de
     troubleshooting. -->
<!-- v1.6 (20/07/2026): §4.7 — janela de períodos equivalentes (periodWindow):
     receita p/ novos acompanhamentos + nota do preset Inbound v3 (reaplicar);
     filtro por campo agora persiste por usuário (lastFieldFilters). -->
<!-- v1.5 (20/07/2026): operações — filtro por vínculo+perfil, rename inline,
     runbook do backfill de records.operation_id. -->
<!-- v1.4 (20/07/2026): §4.7 — runbook do preset Inbound (pré-requisitos de
     dado: rótulos dos predicados, metas sql, feriados, operações, match
     rules, campos de licença do deal). -->
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
   4. `apply/pg-cron-webhooks.sql` — tick dos webhooks de saída a cada minuto;
   5. `apply/pg-cron-purge-trash.sql` — purga diária (03:30 UTC) da Lixeira de
      boards (`dashboards.status='trashed'` há mais de 14 dias; SQL puro, não
      usa os segredos). Sem o job o hub apenas ESCONDE os vencidos — a limpeza
      física depende dele.
   Os ticks (2–4) **pressupõem os segredos criados pelo primeiro**.
   Verificar/remover: `select * from cron.job;` /
   `select cron.unschedule('purge-dashboard-trash');`.
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
npm test           # Vitest: unidades + guarda de paridade RPC (sem banco)
npm run test:watch # idem, em watch durante o desenvolvimento
npm run build      # o que a Vercel roda no deploy
```

- **Convenção de versionamento**: todo arquivo tem cabeçalho
  `Versão: X.Y | Data: DD/MM/AAAA`. Ao editar, incremente a versão menor e comente a
  mudança no local (`// vX.Y (data): ...`). Este é o único changelog do projeto.
- Rede de segurança: `typecheck` + `lint` + `npm test` (Vitest — ver §2.1) +
  verificação manual no app. O CI (`.github/workflows/ci.yml`) roda os três a
  cada push/PR.

### 2.1 Testes automatizados (24/07/2026)

- **Como rodar**: `npm test` (uma vez) ou `npm run test:watch`. Não precisa de
  banco, env nem rede — só `npm install` antes. Config em `vitest.config.ts`
  (ambiente node, alias `@` e `TZ=America/Sao_Paulo` pinado — os presets de
  período usam Date local).
- **Onde vivem**: unidades colocated (`lib/**/*.test.ts`, ao lado do módulo);
  guardas cross-cutting em `tests/` (hoje: `tests/rpc-parity.test.ts`).
- **Guarda de paridade RPC**: acha a ÚLTIMA migração que define
  `run_widget_query` e `run_widget_query_snapshot` (e o par
  `_widget_match_expr`/`_snap`), normaliza (comentários fora + substituições
  snapshot→base) e exige que o diff caiba na allowlist do bloco snapshot-only
  (escopo 0056 + restrições mock-aware 0057). **Quando falhar após uma
  migração**: espelhe a mudança na função irmã NA MESMA migração (invariante 1
  do AGENTS.md). Só estenda a allowlist se a divergência for snapshot-only
  INTENCIONAL — com comentário justificando na própria regex.
- Teste novo segue a convenção do repo: cabeçalho `// Versão | Data`,
  comentários em pt-BR, imports explícitos de `vitest` (sem globals) e NUNCA
  importar `lib/env.ts`/`lib/supabase/*`/`lib/auth/*` (módulos com IO/env).

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
  0085, que contém o par completo.
- [ ] A regra dos mocks (substring das chaves `bitrix_uf_crm_1743441331` /
  `bitrix_uf_crm_67eacefcccd98`) permanece idêntica nos dois lados **e** em
  `lib/widgets/mock-reuniao.ts`.
- [ ] Buckets de data continuam batendo com `canonicalBucketKey` no cliente.
- [ ] Dia de BRASÍLIA preservado (0085): comparações/buckets de coluna
  `timestamptz` do núcleo seguem ancorados/convertidos (a sessão do banco é
  UTC — literal naive desloca o dia em 3h). Probes no SQL Editor:

  ```sql
  show timezone;  -- esperado: UTC (por isso a ancoragem existe)
  -- bucket: 30/06 22h BRT deve cair em JUNHO
  select date_trunc('month', public._widget_local_ts('2026-06-30T22:00:00-03:00'::timestamptz));
  -- limite: 30/06 22h BRT NÃO pode entrar em "julho"
  select '2026-06-30T22:00:00-03:00'::timestamptz >= '2026-07-01T00:00:00-03:00'::timestamptz; -- false
  -- texto: prefixo preserva naive e date-only
  select public._widget_local_ts('2026-07-01T01:00:00'), public._widget_local_ts('2026-07-01');
  ```
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
  `field_modified_at`).
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
- [ ] Linhas core (0086): `syncFieldCatalog` NÃO upserta as linhas
  `source_system='core'` (chaves distintas), mas reescreve as `options` do
  `pipeline` (quando `data_type='selecao'`) com `lookups.categoryNames()` —
  rótulo/olho/ordem do admin ficam intactos. "Coluna núcleo sumiu dos
  seletores" = olho desligado na aba **Núcleo** do /campos (a linha core
  oculta remove o campo de todos os dropdowns; religue o olho). "Options do
  pipeline erradas" = conferir `crm.dealcategory.list` e rodar um sync.

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

**Gerar/atualizar presets**: **Configurações → Presets** — botão por preset
("Gerar" vira "Atualizar" com link p/ o dashboard) e "Gerar/atualizar todos".
As actions (`applyPreset`/`generatePresets`, `app/(app)/dashboards/actions.ts`)
são idempotentes: rodar de novo ATUALIZA os widgets do preset (identidade
`settings.presetKey`, ids preservados) sem tocar widgets adicionados à mão;
sub-fontes/campos/correspondências já existentes nunca são sobrescritos.
Dashboard homônimo sem marcador é ADOTADO (carimbado) em vez de duplicado.

**Gerar o preset "Inbound"** (`lib/presets/inbound.ts`) — pré-requisitos de
DADO antes de gerar (o preset cria estrutura, não dados):

1. **Rótulos dos predicados**: as sub-fontes usam os rótulos legíveis do
   Bitrix — `custom:fonte` ∈ {"Formulário de CRM", "Site"}, etapas
   ("Lead Qualificado", "Clientes Lite", "Contrato assinado", "Inacessível",
   "Desqualificado Marketing", "Novos Leads", "1º contato", "Em
   qualificação"), motivos ("Monitoramento pessoal", "Sem resposta",
   "Outros") e "DSQ" no Estudo. Se os rótulos do portal divergirem
   (caixa/acento), ajuste as sub-fontes geradas em Configurações → Fontes
   (o preset nunca sobrescreve subs existentes).
2. **Metas**: métrica `sql` é registrada automaticamente; cadastre as metas
   MENSAIS em Configurações → Metas (a linha "Meta SQL" do Mês x Mês usa o
   modo ritmo/pace por dia útil).
3. **Feriados**: Configurações → Metas → Dias não úteis (alimenta o
   alinhamento "mesmo dia útil" e o pace).
4. **Operações BR/INTL**: cadastre as operações e vincule os responsáveis.
   O widget "Operação (todas as abas)" filtra o dashboard inteiro pelo
   VÍNCULO vivo (responsáveis da subárvore) + o PERFIL da operação
   (Configurações → Operações → botão "Perfil": condições de
   inclusão/exclusão com fonte-alvo opcional) — não pela coluna derivada
   `records.operation_id`. Para dimensões "por Operação" e restrições de
   snapshot, rode `supabase/apply/backfill-operation-id.sql` após
   criar/alterar vínculos. Renomear operação: direto no nome, na tabela.
5. **Match rules** (widget "Evolução por Criação do Lead"): crie em /campos →
   Matching as regras lead↔negócio e lead↔venda do site (par primário
   `custom:email` dos dois lados) e rode o auto-match. Sem elas o widget
   mostra o bucket "—" (degrada, não quebra).
6. **Campos do deal**: o MRR usa o campo calculado `mrr_contrato` = "Valor
   por licença do contrato (R$)" × "Número de licenças contratadas"
   (UF_CRM_1715111926953 × UF_CRM_1715258133683) — confira que esse par está
   preenchido nos deals assinados; a geração dispara o recálculo global.

Conferências pós-geração: mocks de Data Reunião aparecendo no SQL (período
que referencia a Data Reunião), moedas no MRR (BRL/USD via `currency` do
deal), linha de meta no Mês x Mês, e comparação dos números com o dashboard
antigo no MESMO período.

> **Preset v3 (20/07/2026):** o Mês x Mês trocou a janela fixa
> (`windowMonths: 6`) pelo **dropdown de janela no card** (`periodWindow` —
> "3 meses" … "Este ano", padrão 6 meses, com o toggle dia útil × dia
> cheio). Rode **Configurações → Presets → Atualizar** para o widget do
> banco receber a config nova; sem isso o card segue no comportamento
> antigo.

> **Preset v4 + migração 0084 (20/07/2026) — mocks no SQL:** aplique a
> migração `0084_mock_fonte_inbound.sql` (SQL editor) — ela dá
> `custom:fonte = "Formulário de CRM"` aos 270 mocks Inbound, exigido pelo
> predicado da sub-fonte `sqls` (predicados de sub valem em AND para mocks;
> a regra 0052 só remove o gate `not is_mock`). Conferência:
> `select count(*) from public.records where is_mock and custom_fields ? 'fonte';`
> → 270 (os 32 Outbound ficam sem, de propósito). Depois rode
> **Configurações → Presets → Atualizar**: o v4 abre o Mês x Mês em **"dia
> cheio"** (mês corrente inteiro — reuniões AGENDADAS, mocks inclusive,
> visíveis já; o toggle do card alterna para "dia útil"). Quem já tocou o
> toggle no card não é afetado (a escolha compartilhada vence o default).
> Regra geral ao criar NOVOS mocks ou NOVAS sub-fontes: o mock precisa
> carregar os campos usados na segmentação da sub que deve contá-lo.

> **Preset v5 (21/07/2026) — sem SAL, comparação em todos os cards, cores da
> marca:** rode **Configurações → Presets → Atualizar**. O GC do aplicador
> DELETA os cards "SAL" e "Conv. MQL → SAL" dos dashboards já aplicados (a
> sub-fonte `sals` e os dados ficam; links/atalhos de nota apontando p/ esses
> dois widgets ficam órfãos — baixa probabilidade, revise se houver). Todos
> os cards passam a exibir o badge "vs. período anterior (mesmo dia útil)" —
> os de fórmula (SQL total e conversões) dependem do deploy desta entrega
> (comparação no `runCardWidget`). A identidade visual (canvas cinza, faixa
> roxa nos cards, séries roxo/verde/âmbar, paleta "inbound" nas barras por
> categoria e na pizza) entra como DADOS de aparência. ATENÇÃO: o update por
> `presetKey` sobrescreve o `settings` inteiro dos widgets do preset —
> ajustes manuais de aparência feitos neles se perdem no re-apply (widgets
> criados à mão não são tocados).

**Usar a janela de períodos em NOVOS acompanhamentos** (receita curta —
qualquer widget de barra/linha/tabela agregada com dimensão de data mensal,
ex.: "Mês/ano"):

1. Editar o widget → seção **"Dia útil e meta"** → marcar **"Janela de meses
   no card (períodos equivalentes)"**.
2. Escolher quais opções aparecem no dropdown ("3 meses", "Este trimestre",
   "6 meses", "Este semestre", "Últimos 12 meses", "Este ano"), a **janela
   padrão** e se o card expõe o seletor **"dia útil × dia cheio"**.
3. Opcional: marcar **"Alinhar meses pelo mesmo dia útil"** para o corte por
   estágio ser o modo inicial (o toggle do card alterna depois).
4. Salvar. O dropdown aparece no topo do card; a seleção é COMPARTILHADA
   entre os usuários do dashboard (como os filtros rápidos) e cada mês da
   janela mostra o recorte EQUIVALENTE ao período da barra global — a barra
   continua mandando no mês final. Em snapshots, vale a janela padrão
   congelada.

Limitação estrutural: os meses (barras) vêm das FONTES DO WIDGET — mês com
registro só em fonte de perna (`Metric.sources`) não vira barra; inclua a
fonte no widget se precisar do mês.

### 4.9 Multi-organização, Owner e acessos (0088–0094)

- **Ordem de aplicação**: 0088→0094 na MESMA janela, imediatamente antes do
  deploy (runbook em `supabase/README.md`, com as queries de conferência e os
  testes das proteções). Depois do deploy, configure a env `OWNER_USER_ID`
  (User UID da conta do Owner) na Vercel — sem ela o modo Owner nega
  sempre (fail-closed, proposital).
- **Criar uma organização**: login como Owner → tela "Como você quer entrar?"
  → Owner → "Nova organização" (admin = o próprio Owner ou conta nova
  email/senha). A org nasce VAZIA (só as core defs de `seed_org_defaults`);
  o admin loga e cria bases/campos/dashboards do zero. Excluir exige digitar
  o nome exato; a org inicial (Zapper) só sai via SQL direto.
- **Trocar o org_admin de uma org** (só via banco, por design):
  `select set_config('app.allow_protected_change','on',true);` na MESMA
  transação de um UPDATE que demova o atual e promova o novo (o índice
  parcial exige demover antes de promover).
- **Bitrix/planilha/pg_cron são da Zapper**: as tabelas de encanamento
  (`bitrix_*`, `sync_jobs`, fila de write-back) têm `organization_id` default
  Zapper — org nova usa criação manual/CSV/API de ingestão. Conectar um CRM
  de outra org é trabalho futuro (credenciais por org).
- **Acessos**: por board no ⋮ → Acesso (funções + pessoas Ver/Editar/
  Bloqueado); matriz central em Configurações → Acessos (áreas allow/deny,
  bases deny, boards). Semântica: allow de ÁREA concede só a TELA; a escrita
  dentro dela segue o papel (RLS + gate da action). Deny de área esconde
  aba/page E barra a escrita das server actions (`isSettingsAreaDenied` nos
  guards de metas/operacoes/responsaveis/moedas/integracoes/fontes/usuarios) —
  um admin negado não escreve nem chamando a action direto.
- **Escopo de bases do board** (⋮ → Bases) é OFERTA (listas menores), não
  autorização — para PRIVAR use o deny de base por usuário.

## 5. Troubleshooting

| Sintoma | Causa provável | Ação |
|---|---|---|
| Dashboard lento/widgets com erro após Backfill ou Reconciliar em massa | O sync reescreveu todas as linhas de `records` → tuplas mortas + estatísticas defasadas; logs do Supabase mostram `57014 statement timeout` e RPC 500; a carga simultânea dos widgets realimenta o problema | Rode a **Parte A** de `supabase/apply/diagnostico-perf.sql` (`ANALYZE`, roda no SQL editor) — correção imediata das estatísticas do planejador. `VACUUM` (Parte B) é secundário e NÃO roda no SQL editor (erro 25001): deixe ao autovacuum ou force via `psql` na conexão direta. Depois confira `[dashboard:timing]` nos logs da Vercel para achar widget dominante remanescente |
| UM dashboard específico segue lento (statement timeout em alguns widgets) mesmo após a correção global e após limitar o período | Widgets com colunas `match:` (registro casado): `_widget_match_expr` (0042) roda uma subconsulta correlacionada sobre `record_matches` POR LINHA do agregado; "todo o período" agrava (varre `records` inteira). As linhas de `record_matches` persistem após excluir a tabela que as gerou | 1) fixe um período padrão limitado na barra (`defaultPreset`); 2) aplique a migração `0077` (índices em `record_matches`); 3) se persistir, rode a **Parte C** de `supabase/apply/diagnostico-perf.sql` — o `[dashboard:timing]` aponta o widget e o `EXPLAIN` diz se falta a reescrita ESPELHADA de `_widget_match_expr`/`_widget_match_expr_snap` (nova migração recriando ambos os RPCs) |
| Snapshot mostra números ≠ dashboard | RPCs divergiram (espelhamento esquecido) ou snapshot sem refresh após migração | Compare `pg_get_functiondef` das duas funções; refaça o espelhamento; "Atualizar agora" |
| Mocks sumiram de um widget/snapshot | A consulta deixou de referenciar Data Reunião (ex.: snapshot sem `default_period`, período "todo o período") | Confira o campo de período; para snapshots antigos, defina `default_period` (SQL de exemplo no `supabase/README.md`, seção 0059) |
| Mocks não contam no SQL (Mês x Mês, KPI SQL total, conversões) | (a) o predicado da sub-fonte (`sqls`: `custom:fonte in …`) vale em AND para mocks e o mock não carrega o campo (0084 corrige o lote Inbound); (b) modo "Dia útil" no card corta o mês corrente em hoje — reunião com data FUTURA fica fora até a data chegar | (a) aplique a 0084 e confira `custom_fields ? 'fonte'` nos mocks; ao criar novos mocks/subs, o mock precisa carregar os campos da segmentação; (b) alterne o toggle do card para "Dia cheio" (padrão do preset v4) |
| Vendedor não vê os próprios registros/mocks | `responsibles` sem `user_id` vinculado (ou duplicata sem vínculo) | Vincule na tela de Usuários; para mocks, ver migração 0058 |
| Sync "travado" | Job em `sync_jobs` com status `running` órfão | Reabra a página Registros (o job é detectado e retomável); em último caso, marque `status='canceled'` via SQL |
| Tick não roda (sync/snapshot/webhook) | pg_cron não agendado, ou segredos ausentes no Vault | `select * from cron.job;` — confira os 5 jobs (ticks + purga da Lixeira); recrie segredos conforme `pg-cron-tick.sql`; teste `POST` manual na rota com `SYNC_SECRET` |
| Board na Lixeira não some após 14 dias | Job `purge-dashboard-trash` não agendado (o hub esconde o card, mas a linha continua no banco) | Aplique `apply/pg-cron-purge-trash.sql`; para purgar já, rode o `DELETE` do arquivo à mão no SQL editor |
| Ruído no `audit_log` com Data Reunião | Trigger de congelamento descartando tentativas do sync (esperado) | Inofensivo — ver migração 0051 |
| Datas do Bitrix aparecem 1 dia depois (ex.: reunião do dia 17 no dia 18) | Valor datetime gravado no fuso do portal (Moscou, +03:00) sem normalização — reuniões 18h+ BRT viram o dia seguinte no prefixo | Confira `data_sources.timezone` da fonte (`Europe/Moscow`); aplique 0079+0080 e rode um Backfill (o mapper v1.4+ normaliza p/ Brasília na entrada) |
| Dashboard abre com o grid esmaecido e "Carregando…" preso (só hard refresh resolve) | O widget "Filtro por campo" com valor salvo (`lastFieldFilters`) disparava uma navegação RSC na montagem só p/ sincronizar a URL; sob rajadas de `router.refresh()` do realtime (ex.: pós-recalc do preset, sync do Bitrix) a fila do router nunca drenava e o overlay nunca fechava | Corrigido em 20/07/2026 (`FieldFilterControls` v1.2: sync raso via `history.replaceState`, sem navegação). Se reaparecer, procure QUEM liga o overlay (`useNavPending().run`) na montagem — nenhum efeito de mount deve navegar |
| Webhook de saída parou | Auto-desativado após falhas consecutivas | Configurações → Integrações: ver `disabled_reason`, corrigir o endpoint e reativar |
| Tela de snapshots/listagens quebrou após deploy | Código selecionando coluna que a migração ainda não criou | Aplique o SQL pendente (regra "SQL antes do deploy") |
| CI falhou no teste de paridade RPC (`tests/rpc-parity.test.ts`) | Migração nova recriou `run_widget_query` sem espelhar `run_widget_query_snapshot` (ou vice-versa), recriou os dois em migrações DIFERENTES, ou introduziu divergência snapshot-only nova | Espelhe a mudança na função irmã NA MESMA migração (invariante 1 do AGENTS.md — inclui o par `_widget_match_expr`/`_snap`); se a divergência for snapshot-only intencional, adicione-a à allowlist do teste com comentário justificando |
| Erro de env em runtime | Variável ausente na Vercel | `lib/env.ts` diz qual; confira `.env.example` |
| Remover os mocks de vez | — | `supabase/apply/undo-mock-reuniao.sql` (única forma prevista) |
| Salvar chave de IA falha ("Não foi possível cifrar a chave") | `KEY_ENCRYPTION_KEY` ausente/inválida no ambiente (32 bytes base64) | Configure na Vercel (Production+Preview+Development, MESMO valor) e refaça o deploy; NUNCA troque o valor depois (invalida os ciphertexts já gravados) |
| Conversa de IA aborta com "resposta cortada pelo limite de tokens" | Dashboard grande demais para um turno (o modo Editar aceita resposta parcial, mas "Criar a partir de" ecoa o estado inteiro) | Peça mudanças menores/mais específicas por turno; em último caso edite por partes (widget a widget) |
| Turno da IA demorou e estourou o tempo | Provedor lento + laço de correção (timeout 120s/chamada, orçamento ~240s; Home E a página do dashboard têm `maxDuration=300`) | Reenvie o pedido (turnos são idempotentes — a identidade canônica converge); se recorrente, troque o modelo em Configurações → Integrações |
| Edição da IA saiu errada | — | Botão "Desfazer edição da IA" (janela da Home ou painel do dashboard) restaura o snapshot pré-turno: widgets, settings e células; vale para o ÚLTIMO turno aplicado. No painel do dashboard o snapshot é PERSISTIDO (`dashboard_ai_sessions.undo_snapshot`) — sobrevive a F5; na Home continua só em memória |
| Conversa do painel "Editar com IA" sumiu/não carrega | A sessão é por USUÁRIO×dashboard (`dashboard_ai_sessions`, 0098) — outro usuário/board não vê a mesma conversa; RLS own-row + org | Confirme usuário e board; a linha é sobrescrita in place e some com o board (cascade) — não há job de limpeza para criar/monitorar |
| "Gerar presets" recriou um dashboard que eu editava por IA | Editar por IA re-identifica o board como `import:` — ele sai da gestão do preset de fábrica (comportamento esperado, avisado no seletor) | Use o board editado normalmente; o recriado é o preset de fábrica "puro" (pode arquivar/excluir um dos dois) |

## 6. Lacunas conhecidas e recomendações

Estado em 24/07/2026 (itens 2 e 3 da lista original foram implementados; o 1,
parcialmente — ver §2.1 para operar os testes):

1. **Paridade das RPCs** — PARCIALMENTE coberta: a "alternativa mínima"
   (comparação textual das definições, módulo nome de tabela) está implementada
   como teste estático (`tests/rpc-parity.test.ts`, roda no CI sem banco).
   Segue como lacuna a paridade EXECUTANDO: um script SQL que rode a mesma
   config de widget em `run_widget_query` e, sobre um snapshot de teste, em
   `run_widget_query_snapshot`, comparando RESULTADOS (pegaria divergência de
   comportamento que o texto idêntico não revela, ex.: dados/índices).
2. **CI mínimo** — IMPLEMENTADO: `.github/workflows/ci.yml` roda `lint` +
   `typecheck` + `npm test` a cada push/PR.
3. **Testes de unidade dos módulos puros** — IMPLEMENTADO (Vitest, colocated
   `lib/**/*.test.ts`): period/period-resolve, formulas, mock-reuniao,
   calc-metrics, sources/sub-fontes, date/normalize (fuso 0079/0080),
   business-days, core-defs, formula-validate e import de IA (rewrite).
   Lacunas remanescentes de teste: componentes/UI, E2E (Playwright) e os
   caminhos com IO (engine/record-list/widget-scope — exigiriam
   fixtures/mocks de Supabase).
4. Manter **este manual e o `banco-de-dados.md` atualizados a cada migração** — eles
   substituem a leitura das 75 migrações; desatualizados, viram armadilha.
