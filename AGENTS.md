<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Regras do projeto

> Rede de segurança: `npm run lint` + `npm run typecheck` + `npm test` (Vitest —
> unidades puras, componentes em jsdom, engine com cliente fake e a guarda
> estática de paridade das RPCs; sem banco). Rode os três antes de entregar; o
> CI (`.github/workflows/ci.yml`) repete tudo (job `verify`) e ainda roda o job
> `e2e` (stack Supabase local + seed + Playwright + paridade RPC EXECUTADA em
> `tests/live/`). Como operar/estender: `docs/manual-de-manutencao.md` §2.1.

> Documentação para humanos: [`docs/arquitetura.md`](./docs/arquitetura.md)
> (fluxos + todas as invariantes, incl. as abaixo),
> [`docs/banco-de-dados.md`](./docs/banco-de-dados.md) (schema consolidado) e
> [`docs/manual-de-manutencao.md`](./docs/manual-de-manutencao.md) (runbook) e
> [`docs/manual-de-construcao-de-dashboards.md`](./docs/manual-de-construcao-de-dashboards.md)
> (manual de construção de dashboards pela UI, para usuários/IAs).
> Ao alterar schema ou invariantes, atualize esses docs na mesma entrega —
> mudanças de UI/semântica do construtor incluem o manual de construção.

- **RPC de widgets duplicado (Snapshots):** `run_widget_query_snapshot`
  (versão vigente na 0105; introduzido na 0056) é uma cópia de
  `run_widget_query` (vigente na 0105; base 0054) apontada para
  `snapshot_records`, acrescida das
  restrições do snapshot aplicadas internamente (mock-aware). Toda mudança em
  `run_widget_query` (nova migração que o recrie) DEVE ser espelhada em
  `run_widget_query_snapshot` na mesma migração — inclusive o helper
  `_widget_match_expr` ↔ `_widget_match_expr_snap` (vigentes na 0104: resolvem
  a fonte do ref `match:<fonte>:` por lookup em `data_sources.key` →
  `record_type`, com fallback nos 3 builtins — por isso são `stable`, não
  `immutable`; sub-fontes nunca casam e ficam fora de `buildMatchFields`).
  O espelhamento é
  FISCALIZADO em CI por `tests/rpc-parity.test.ts` (`npm test` — compara o SQL
  das últimas definições, sem banco); divergência snapshot-only INTENCIONAL
  nova entra na allowlist do teste com comentário justificando. Além do texto,
  o job `e2e` EXECUTA as duas funções com a mesma config sobre um snapshot sem
  restrições e exige resultados idênticos (`tests/live/rpc-parity-live.test.ts`).
- **Mocks de Data Reunião em snapshots:** mocks (`records.is_mock`) entram
  SEMPRE no dataset congelado, ignorando as restrições do snapshot (0057); a
  regra 0052 (mock só conta em consulta que referencia Data Reunião) segue
  valendo. Não reintroduza filtros de restrição injetados pelo viewer — eles
  derrubariam os mocks (AND puro). A regra 0052 só remove o gate
  `not is_mock` — NÃO isenta os mocks dos predicados de sub-fonte nem dos
  filtros do widget (AND puro): mocks precisam CARREGAR os campos usados na
  segmentação das subs que devem contá-los (0084 dá `custom:fonte` inbound
  aos mocks do lote 0051; os Outbound de 0053 ficam sem, de propósito).
- **Período congelado do snapshot (0059):** `snapshots.default_period` guarda
  o filtro de período do dashboard capturado na criação (SnapshotsPanel →
  `capturePeriod`) e o viewer o aplica via resolver padrão (periodBar sintético
  + `prefSettings.lastPeriod`). É filtro de CONSULTA (mesma semântica da barra
  do dashboard) — não é restrição; não o confunda com os filtros de restrição
  proibidos acima. Sem ele, consultas em "todo período" deixam de referenciar
  Data Reunião e a regra 0052 derruba os mocks.
- **Snapshots são acesso público:** nunca crie política RLS `to anon` nem
  conceda EXECUTE a `anon`/`authenticated` nas funções de snapshot; o caminho
  público é exclusivamente `app/s/[token]` + service role após validar o token.
- **Fonte por métrica se resolve no ENGINE, nunca no RPC:** `Metric.sources`
  (fontes próprias de uma métrica; universo de linhas segue `widgets.sources`)
  vira filtro `record_type in (...)` de uma chamada RPC separada, mesclada por
  tupla de dims (`lib/widgets/metric-sources.ts` + `engine.ts`). NÃO introduza
  parâmetro de fonte-por-métrica em `run_widget_query` — exigiria migração
  espelhada (regra acima) sem necessidade. O `@period` pré-sintetizado dos
  filtros rápidos deve cobrir fontes do widget ∪ fontes das métricas ∪ fontes
  dos operandos com ESCOPO (`agg:…@<fonte>`) — `widgetQuerySources` com
  `fieldByKey` na page, no viewer de snapshot e no widget-scope — sem
  isso as pernas perdem registros em silêncio. Pernas com fontes COBERTAS pelo
  widget (inclusive widget em "todas as fontes") reusam os registros de
  exibição + top-up de mocks `is_mock = true`
  (`runCoveredLegMockTopUp`/`recordListIncludesMocks`,
  `lib/widgets/record-list.ts`) mesclado ao stream de extras — a regra 0052
  client-side decide-se SÓ em `resolveListFilters` (record-list.ts); não a
  duplique nem a resolva via RPC. Ver `docs/arquitetura.md` §4.1 e
  invariante 9.
- **Semana Fechada se resolve no ENGINE, nunca no RPC (03/08/2026):**
  `Dimension.closedWeek` ("seg_dom" | "sab_sex", só transforms de semana)
  snapa o período da RODADA p/ semanas completas (regra da EXPANSÃO desde
  12/08/2026: toda semana que o período toca entra inteira — semanas de borda
  aparecem nos dois meses vizinhos; o RÓTULO segue o dono do 4º dia em
  date-buckets; `lib/widgets/closed-week.ts`) em `runWidget`, DEPOIS do `comparisonSpec` e
  do `lowerCalcGoalOperands` (ambos precisam do período ORIGINAL); sáb–sex
  desce ao RPC como transform 'day' e o `bucket-merge` funde client-side
  (o gate `dimNeedsClientBucket` também ativa p/ core/`unified:`/`match:`
  nesse caso). weekMode/âncora efetivos SÓ por `effectiveWeekMode`/
  `dimWeekStart`. NÃO recrie os RPCs p/ semana de sábado nem reintroduza o
  recorte "restrita" com a opção ativa. Ver `docs/arquitetura.md` §4.1.
- **Operando com escopo de fonte se resolve no ENGINE, nunca no RPC:** o ref
  `agg:<agg>:<campo>@<fonte>` é ABAIXADO em runtime para a chave condicional
  `aggif:` já existente (predicado `record_type =` + filtro da sub) por
  `lowerSourceScopedOperands` (`lib/widgets/calc-metrics.ts`), nos mesmos choke
  points do `expandAggFormula` (`resolveCalcMetric`/`runCalculatedWidget`).
  Ref bare (sem `@`) = universo em escopo (compat). NÃO recrie os RPCs para
  isso. Desde 20/07/2026: o predicado da sub aceita também `in`/`is_null`/
  `not_null`/`*_ci` (só `ilike` degrada), a chave `aggif:` ganha um 4º
  elemento OPCIONAL `scope` (chaves sem escopo seguem byte-idênticas) e a
  consulta AUXILIAR de um operando escopado roda como perna SÓ da fonte do
  escopo — período pela coluna de DATA dela (`scopedAuxPeriod`/
  `patchAuxPeriodByType`, `lib/widgets/period.ts`) e `p_correspondences` com o
  membro DELA (senão um `unified:` bucketizaria pela data da pai). Vale nos 3
  choke points (computeRows/pernas por métrica/`runCalculatedWidget`, com o
  período DA RODADA — atual, perna do businessDayAlign ou comparação);
  caminhos client-side (`dateAgg`/listas) não rejanelam pela data da sub
  (limitação documentada). Catálogo por-registro dos campos calculados é ÚNICO
  (`perRecordCalcOperands`, `lib/records/calc-operands.ts`) — os dois editores
  e a validação do servidor derivam dele; não monte listas paralelas.
- **Datas são strings no fuso de Brasília (0079/0080):** valores DATETIME
  ingeridos de fonte com `data_sources.timezone` configurado (Bitrix =
  `Europe/Moscow`) são convertidos para America/Sao_Paulo na ENTRADA
  (`lib/date/normalize.ts`, aplicado no mapper do sync — `dateOrNull`/
  `resolveCustom`). O read side inteiro é prefix-based (lê o `YYYY-MM-DD`
  literal) e depende disso. Campo Bitrix tipo `date` é calendário puro — NUNCA
  converter (recuaria um dia); date-only é sempre passthrough. O formato
  emitido (`YYYY-MM-DDTHH:mm:ss-03:00`) deve seguir byte-idêntico ao do
  backfill 0080, senão o reconcile churna. **Dia de Brasília no read side
  (0085):** colunas `timestamptz` do NÚCLEO comparam com bounds de offset
  explícito `-03:00` (`anchorCoreDateBound` em `lib/widgets/period.ts` +
  ancoragem por coluna no ramo `@period` das RPCs) e bucketizam via
  `_widget_local_ts` (timestamptz → wall time America/Sao_Paulo; text →
  prefixo de 10 chars, byte-igual ao `parseYmd`). NUNCA ancore bounds de campo
  custom (texto — o offset no lower bound excluiria date-only) e NUNCA aplique
  `at time zone` a valor texto (naive de CSV recuaria um dia). **Write side
  (26/07/2026):** valor NAIVE (planilha/CSV/form) indo para coluna CORE
  `timestamptz` é hora de parede de Brasília — ancore com
  `anchorNaiveToBrasilia` (`lib/date/normalize.ts`; adapter de Sheets +
  `ingestRows` + `coerceCore` de `lib/records/coerce.ts`, usado por
  `createRecord`/`updateRecord`/inserção por IA desde 30/07/2026), senão o
  Postgres assume UTC e o dia recua (venda do dia 1 cai
  no mês anterior; legado: `supabase/apply/backfill-naive-tz.sql`). Campo
  custom segue naive (texto). Reconcile compara colunas core de data por
  INSTANTE (`timestampValuesDiffer`, `lib/sync/shared.ts` — PostgREST `+00:00`
  × mapper `-03:00`); byte-compare (`valuesDiffer`) fica para texto. Ver
  `docs/arquitetura.md` §4.1/§4.5 e invariante 11.
- **Sub-fontes (0078) se resolvem no ENGINE, nunca no RPC:** uma **sub-fonte**
  (`sub_sources`) é uma fonte cujas linhas são as da PAI recortadas por um
  `filter` (WidgetFilter[]), com campo de data próprio. Compartilha o
  `record_type` da pai — por isso NÃO é linha de `data_sources` (quebraria o
  `record_type unique`/FK). `toRecordType`/`toSourceKey` por identidade NÃO
  servem para subs; use os resolvers cientes do catálogo em `lib/sources.ts`
  (`recordTypeOf`, `sourcePredicate`, `planSourceLegs`). Toda a resolução é no
  engine (`lib/widgets/engine.ts` + `record-list.ts`): a consulta PRINCIPAL
  resolve UMA fonte efetiva por `record_type` (subs absorvidas somem — a pai
  cobre, SEM duplicar; sub avulsa recorta as linhas da pai), então
  `@period.byType`, o `coalesce` dos unificados e o `record_type in (...)`
  seguem chaveados por `record_type` — o par `run_widget_query`/`_snapshot`
  fica INTOCADO (não recria; não aciona a invariante 1). O predicado da sub
  entra scoped via `_widget_wrap_record_types` (o mesmo wrapper de 0054). O
  membro de campo unificado passa a ser identificado pela SOURCE-KEY
  (`field_correspondence_members.source_key`) — `correspondenceMapForSources`
  monta um ref por perna (não misture o membro da pai e o da sub no mesmo
  coalesce: uma linha com as duas colunas preenchidas pegaria a 1ª). O
  `p_correspondences` de TODA consulta (`runWidget`, `runCalculatedWidget`,
  pernas por métrica) sai de `correspondenceMapForSources(corrs, fontes
  efetivas, catálogo)` — SEMPRE, não só quando há sub selecionada: o membro da
  sub num unificado vazaria pro coalesce de widget SÓ-PAI (mesmas linhas, mesmo
  `record_type`). Fallback interno perna → raízes → todos (o RPC ergue erro p/
  chave referenciada ausente). NUNCA passe `buildCorrespondenceMap` (união
  global) a uma consulta — só às opções de bucket.
  `AvailableField.unifiedMembers` (client-side, por `record_type`) é
  RAIZ-primeiro: sub nunca sobrescreve o membro da pai. Só quando
  o toggle `settings.coexistSubSources` marca uma sub como "conviver" (ou há 2+
  subs da mesma pai) é que ela vira PERNA extra (no caminho agregado); nesse
  caso o usuário garante que os conjuntos são disjuntos. A EXIBIÇÃO das pernas
  (24/07/2026) é `settings.subSeriesMode` ("stacked" default | "total" |
  "grouped"), 100% engine/chart: stacked/grouped mantêm a Base como dim líder e
  o chart pivota em séries (`lib/widgets/sub-series.ts` +
  `WidgetData.subSeries`); "total" funde por tupla no ENGINE (`foldRowGroup`)
  sem a dim "Base"; pizza/funil com dim e KPI/card fundem SEMPRE. No branch
  multi-perna, operando escopado em fonte-IRMÃ é ZERADO por perna
  (`zeroSiblingScopedOperands` + backfill 0 na basis) — cada perna exibe a
  PRÓPRIA contribuição, nunca o total global repetido. RPCs seguem intocados.
  **Sub que IGNORA o período (`sub_sources.ignore_period`, 0116):** também
  100% engine — `applyPeriodToFilters` particiona as fontes cobertas
  (record_type todo-isento sai do `byType`; caso misto força o sintético com
  `record_types` = quem respeita, pass-through do wrapper 0054, espelhado no
  `.or()` do modo lista), `planSourceLegs` NUNCA a absorve (vira perna extra
  tipo "conviver"; demovida da principal se houver candidata do mesmo
  `record_type` que respeite) e os `scopedAuxInputs` removem o sentinela
  pré-sintetizado p/ escopo isento — NÃO recrie as RPCs para isso.
  Ver `docs/arquitetura.md` §4.8 e invariante 10.
- **Filtro de OPERAÇÃO nunca compara a coluna literal (20/07/2026):**
  `records.operation_id` é derivada (priority=1 do responsável no sync) e pode
  estar NULL/defasada. Filtros de visualização por operação
  (filtro_campo/filtro rápido) são TRADUZIDOS no server — page, widget-scope
  e as actions deferidas (que passam pelo widget-scope, regra abaixo) — por
  `lib/config/operation-scope.ts` (vínculo vivo `responsible_id in` da
  subárvore + FILTROS DE PERFIL `operations.filter`, 0083). Não reintroduza
  `operation_id eq` literal nesses caminhos. Dimensões e restrições de
  snapshot seguem na coluna derivada (runbook do backfill:
  `supabase/apply/backfill-operation-id.sql`). Unificados: o coalesce ordena
  refs `custom:` antes de colunas do núcleo (ver §4.8 da arquitetura).
- **Filtros de relação aceitam NOME, resolvido no ENGINE antes do canon
  (31/07/2026):** valor não-UUID em filtro de `responsible_id`/`operation_id`
  (string OU elemento de array) é nome e vira id por `resolveFkFilterNames`
  (`lib/widgets/engine.ts` — loaders `cache()`; homônimo: responsável canônico
  vence apelido e emite o id PRINCIPAL, operação ativa vence; nome
  desconhecido ⇒ uuid-zero `FK_NO_MATCH` por elemento = vazio silencioso em
  runtime, erro amigável no validador de import). Ordem FIXA nos choke points:
  nome→id→`expandResponsibleFilters` — `runWidget`, pernas por métrica
  (`formula-metric.ts`), `expandConfigResponsibles` (record-list) e os
  ESPELHOS de operação (page + widget-scope resolvem os view filters ANTES de
  `collectOperationFilterIds`); UUID legado segue passthrough (fast path sem
  consulta). Builder/barra da tabela GRAVAM nome (`FilterValuePicker`
  storeAs "label"); sub-base/perfil de operação/automações do kanban GRAVAM ID
  com rótulo exibido (storeAs "value" — os predicados comparam a coluna crua
  fora do pipeline; avaliação local das automações não expande canon,
  limitação documentada). Export da IA emite nome (`loadExportFkNames`);
  `cleanFilters` preserva array de `in` (nome com vírgula). NÃO reintroduza
  UUID em filtro de preset nem valide nome via RPC. Ver `docs/arquitetura.md`
  §4.10.
- **Escopo de widget em server action sai SEMPRE do widget-scope
  (21/07/2026):** toda action que consulta dados de um widget (paginação,
  export, `runQuickTable`, `runKanbanWidget` e futuras) monta o recorte por
  `loadWidgetScope`/`resolveWidgetViewScope` (`lib/widgets/widget-scope.ts`) —
  nunca remonte `__qf__`/`ff_`/`tf_`/operação/`__pw__` à mão (cópias parciais
  = widget deferido ignorando filtro até F5). No cliente, o fetch deferido
  re-dispara pelo fingerprint `scopeKey` (`deferredScopeById` da page), nunca
  por `useSearchParams` (filtro persistido no banco não muda a URL); o
  fingerprint INCLUI a CONFIG do widget (`widgetConfigFingerprint`,
  `lib/widgets/deferred-fingerprint.ts` — posição/ordem fora do hash): sem o
  `c`, editar widget deferido deixava o payload velho na tela até F5 — não o
  remova. Com dado antigo em tela exibe "Atualizando…" (dim + spinner). Período personalizado
  é RASCUNHO + commit (`PeriodRangeDraft` — completo auto / aberto via
  "Aplicar"); não reintroduza navegação por tecla nos inputs de data. Agenda
  ignora filtros do dashboard POR DESIGN — e a página cheia do kanban de
  widget (`/kanbans/w/[widgetId]`, seção Kanbans do hub) idem: barra própria,
  RSC → `runKanban` direto (não é action de widget-no-dashboard; o widget NO
  dashboard segue 100% no widget-scope). Ver `docs/arquitetura.md` §4.10 e
  invariante 12.
- **Dia útil/meta se resolvem no ENGINE, nunca no RPC (20/07/2026):** feriados
  (`non_working_days`, 0081) + utilitários puros (`lib/date/business-days.ts`)
  alimentam o alinhamento "mesmo dia útil" (`businessDayAlign` — pernas por mês
  via `computeRows`), a base de comparação `previous_period_bd` e a linha de
  meta (`goalLine` — `row.__goal` via `resolveGoal`). A janela de períodos
  equivalentes (`periodWindow` — dropdown "3 meses"/"Este trimestre"… no card,
  corte por dia útil OU dia cheio) também é 100% engine: a seleção
  compartilhada vive na célula `__pw__` de `dashboard_table_cells` e page/
  `widget-scope` a mesclam nos settings EFETIVOS via
  `applyPeriodWindowChoice` ANTES do engine (que só lê `active ?? default`;
  `businessDayAlign.windowMonths` é alias legado). O N de corte do align sai
  no resultado como `WidgetData.businessDayRef` (badge "Nº dia útil" —
  `BusinessDayBadge`, rótulo único em `businessDayOrdinalLabel`; compartilhado
  entre os meses, mesmo N da goalLine "pace") — exiba-o a partir do RESULTADO,
  não recompute na UI. **Operando de META em fórmula (`meta:<chave>`,
  31/07/2026):** o valor de `goals.target` entra nas fórmulas AGREGADAS
  ABAIXADO para const pré-resolvido (`goalOperandKeys`/`lowerGoalOperands` de
  calc-metrics; `lowerCalcGoalOperands` no engine pós-`calcResolved` e o
  bloco de `runCalculatedWidget` com o período DA INVOCAÇÃO) — NUNCA via
  basis (fold aditivo somaria a meta em subtotal) e NUNCA via RPC; período
  pela regra do card modo meta EXTRAÍDA p/ `goalPeriodScope`
  (lib/metas/resolve.ts — o card a reusa byte-idêntico); escopo v1 GLOBAL;
  meta ausente/falha ⇒ ref mantido → "—" por chave (nunca 0). Proibido em
  SOMASE e no por-registro (`GOAL_IN_RECORD_MSG`). NÃO recrie as RPCs para
  nada disso; snapshots leem metas/feriados AO VIVO pelo adapter
  (`PASSTHROUGH_TABLES`; o registry do catálogo do viewer sai de leitura
  service org-scoped de `sync_config` — nunca o adicione ao passthrough). Presets são DADOS aplicados idempotentemente por
  `applyPreset` (identidade `settings.preset.key`/`settings.presetKey` — nunca
  duplicar nem tocar widgets sem presetKey). **Seções de ORG do preset
  (31/07/2026):** `operations` (árvore ensure-BY-NAME; pais antes dos filhos;
  nunca renomeia/religa; `responsibleNames` = vínculos de responsáveis
  garantidos a CADA apply — ensure-if-absent com priority max+1, nunca
  remove; nome resolvido por display_name exato com preferência à linha
  canônica), `compPlans` (planos de remuneração ensure por
  `config.presetKey`; plano existente NUNCA sobrescrito; operação de
  `memberOperationNames` ausente PULA com erro alto — nunca plano ligado a
  "todos") e `ensureCompMirror` (garante a base espelho `remuneracao` no
  apply; key com sufixo de colisão vira erro visível) aplicam SÓ com
  `opts.allowOrgSections`, que APENAS o caminho de fábrica (`applyPreset`)
  passa — o import/IA fica estruturalmente incapaz de criá-las. Filtro de
  widget de preset por responsável usa o NOME puro como valor (resolvido no
  ENGINE em runtime — bullet de filtros por nome abaixo; a antiga sentinela
  `@responsible:<Nome>` foi removida em 31/07/2026).
  `PresetField.options_source: "responsibles"` (0113) marca campo
  seleção de dropdown VIVO: options reescritas com os responsáveis ativos
  principais por `refreshResponsibleOptionFields` (`lib/config/
  responsible-options.ts` — chamado no apply, no `syncFieldCatalog` e nas
  actions de Responsáveis; padrão do refresh do `pipeline`: SÓ options, não
  editar à mão). Ver `docs/arquitetura.md` §4.9.
- **Linhas core de `field_definitions` são OVERRIDES, nunca campos custom
  (0086, 22/07/2026):** as colunas do núcleo de `records` existem no catálogo
  como linhas `source_system='core'` (`field_key` = nome da coluna) só para a
  aba Campos exibi-las/geri-las (rótulo/olho/ordem; texto↔selecao na whitelist
  `CORE_SELECT_CAPABLE`). O ref de widget segue sendo o nome CRU da coluna
  (`pipeline`) — linha core JAMAIS vira `custom:<key>` em catálogo, operando,
  coluna ou `fieldByKey`. Split ÚNICO em `lib/records/core-defs.ts`
  (`isCoreDef`/`splitCoreDefs`); `buildAvailableFields` particiona e aplica
  rótulo/olho. NUNCA exclua core com `.neq("source_system",'core')` (campos
  locais/app têm `source_system` NULL — o `<>` os derrubaria); filtre em JS.
  Loaders de builder usam `show_in_builder OR source_system='core'` (a linha
  core precisa chegar ao merge mesmo oculta). Options do `pipeline` são
  reescritas a cada sync (`lookups.categoryNames()` em `syncFieldCatalog`) —
  não as edite à mão esperando que sobrevivam. O "Aplica-se a" (`applies_to`)
  é editável na UI de Campos SÓ para campo LOCAL/app (02/08/2026): checkboxes
  das bases RAIZ + hidden `applies_to_present` (form sem o controle preserva a
  coluna); parse/guardas únicos em `lib/records/applies-to.ts` (record_types
  de raiz; estreitar não pode deixar órfão um campo de período de base/sub).
  Campo BITRIX fica read-only (o upsert do sync do catálogo é o dono da
  coluna); linha core não usa `applies_to`. Terminologia de UI: fonte de
  dados do sistema = "Base"/"Sub-base"; "Fonte" ficou só para o campo CRM
  (`custom:fonte`). Ver `docs/arquitetura.md` invariante 13.
- **Editor/validação/catálogo de fórmulas são ÚNICOS (20/07/2026):** o catálogo
  AGREGADO sai SEMPRE de `buildAggOperandCatalog`
  (`lib/widgets/agg-catalog.ts`, inputs `availableAggCatalogInput`/
  `defsAggCatalogInput`) — não recrie as montagens chamando
  `aggOperandRefs`/`sourceScopedAggOperandRefs`/… na mão. O input carrega o
  registry de metas (`goalMetrics`, OBRIGATÓRIO — operandos `meta:<chave>`;
  client via `useGoalMetrics()`/`GoalMetricsProvider`, server via
  `loadGoalMetrics`): sítio novo sem o registry é erro de compilação, nunca
  um save rejeitando fórmula que o editor aceitou. Os DOIS inputs
  incluem os campos do registro CASADO (`match:<fonte>:<ref>`; no defs desde
  20/07/2026) — refs/rótulos `↪` são construídos SÓ por `buildMatchFields`
  (`lib/widgets/fields.ts`), nunca remontados à mão. A validação de
  contexto (estrutura + refs + colocação de SOMASE/… + mensagens dedicadas)
  vive em `validateFormulaForContext` (`lib/records/formula-validate.ts`) —
  editores e servidor rodam o MESMO módulo. Edição de fórmula só pelo
  `FormulaEditor` (`components/formula/`), que preserva o contrato
  `formula`/`formula_text`/`formula_mode` do FieldForm. Prévias calculam pelos
  CHOKE POINTS existentes — por-registro:
  `lib/records/record-eval-context.ts` (compartilhado com o recalc) +
  `computeFormulaFields`; agregada: `runCalculatedWidget` — nunca crie caminho
  paralelo de consulta (RPCs intocados). Operando proibido no contexto é
  DESABILITADO com motivo (`disabledReason`), nunca escondido — e receitas
  (`formula-recipes.ts`) são atalhos que geram fórmula normal editável, nunca
  substituem o editor livre.
- **Isolamento de ORGANIZAÇÃO vive em RLS + loaders, nunca no RPC
  (0089–0091, 23/07/2026):** tabelas-raiz carregam `organization_id` (default
  Zapper; triggers de stamp cobrem sync/CSV/API) e TODA policy é prefixada por
  `organization_id in (select auth_org_ids())` — inclusive os ramos
  admin/permission. O par `run_widget_query`/`_snapshot` é SECURITY INVOKER e
  herda o isolamento — NÃO introduza parâmetro de org nos RPCs. Caminhos
  service-role bypassam RLS: escopo EXPLÍCITO por org (viewer/refresh de
  snapshots usam a org do dashboard; `snapshotClient` escopa
  goals/non_working_days). Loader novo de catálogo/campos/correspondências
  deve aceitar `orgId` e as actions de criação carimbam `organization_id`
  (sem carimbo, usuário de outra org falha ALTO no WITH CHECK — nunca vaza
  linha p/ a Zapper). Desde 22/08/2026 isso inclui `currencies`/`currency_rates`
  (0123 — antes GLOBAIS): PK/FK compostas com a org, e os loaders de
  `lib/widgets/currency.ts` aceitam `orgId` — OBRIGATÓRIO no caminho service
  role (`lib/snapshots/refresh.ts`), senão as taxas de todas as orgs colidem
  no mesmo `rateKey(code, year, quarter)`. Catálogo do SISTEMA
  (`roles`/`permissions`/`role_permissions`) é service-role-only (0122): não
  tem `organization_id`, então escrita por permissão de usuário valia p/ TODAS
  as orgs.
- **`visible_to_roles` de campo é ACL de VALOR, não só de coluna
  (22/08/2026):** `records.custom_fields` é UMA coluna jsonb — a RLS não
  esconde uma CHAVE dela. Escolher quais colunas RENDERIZAR esconde o dado da
  tela, não do payload RSC. Todo caminho que entrega `RecordRow` a um Client
  Component peneira os VALORES no servidor com `redactRestrictedFields`
  (`lib/records/field-acl.ts`; deny-list — chave órfã sem definição sobrevive):
  hoje `/registros` e a agenda. EXCEÇÃO consciente: widget de lista/tabela no
  dashboard NÃO peneira (o construtor já barra não-admin de adicionar coluna
  restrita; widget montado por admin exibe de propósito) — ver
  `docs/seguranca.md`. `data_sources.key`/`record_type` seguem GLOBAIS
  (colisão → sufixo na action). Unicidades por-org: upserts nessas tabelas
  usam onConflict composto (`organization_id,key` etc.).
- **org_admin e Owner protegidos por TRIGGER + GUC (0089):** um org_admin por
  org (índice parcial), indeletável/indemovível; `app_owner` imutável; delete
  de `organizations` só via `delete_organization`. Vale até para service role
  — desbloqueio SÓ `set_config('app.allow_protected_change','on',true)` em
  SQL direto. O modo Owner (`/owner`) exige env `OWNER_USER_ID` == uid
  (fail-closed) + linha em `app_owner` + `requireOwner()` em TODA
  page/action. NUNCA semeie org_admin/owner em `roles`/`user_roles`
  (`SPECIAL_ROLE_LABELS` é só rótulo); só org_admin concede o papel `admin`
  (0092).
- **Acesso efetivo = papel × overrides, resolvido em UM lugar por família
  (0088/0094):** boards → helpers `auth_board_visible/editable/manageable`
  (blocked vence papel; view/edit concede; dono/admin imunes; pages só
  refletem canEdit). Áreas de Configurações → `AREA_GATES` +
  `requireSettingsArea` (page) / `isSettingsAreaDenied` (escrita) /
  `checkSettingsArea` (link condicionado, sem redirect)
  (`lib/auth/access.ts`; deny vence tudo — barra page E escrita das actions;
  allow vence o papel só p/ VER a page, nunca concede escrita, que segue o
  papel). As CHAVES de área são HISTÓRICAS e desacopladas da rota
  (27/07/2026: `fontes` → `/registros/bases`, `log` → `/registros/log`,
  `moedas` → aba de `/campos`) — NUNCA renomear (overrides gravados as
  referenciam). Bases negadas → RLS de
  `data_sources`/`sub_sources`/`records` (pickers herdam via loadSources).
  Escopo de BASES por board (`settings.sourceScope`, ⋮ → Bases) é OFERTA,
  nunca autorização: catálogo efetivo via `applySourceScope`/
  `collectBoardSourceKeys` (`lib/config/source-scope.ts`), aplicado em
  page/kanban/widget-scope/kanban-actions/snapshot-form/viewer — fontes já
  referenciadas por widgets NUNCA saem do catálogo efetivo.
- **Identidade da conversa de IA é REESCRITA no servidor, nunca confiada à IA
  (23/07/2026):** `normalizeImportRaw` (`lib/import/dashboard/rewrite.ts`)
  sobrescreve a `chave` do JSON devolvido pela IA pela canônica ANTES de
  `validateDashboardImport` (edit: derivada do board via
  `importChaveForDashboard`; new/from: gerada no servidor) — uma chave copiada
  da referência sobrescreveria o board de ORIGEM no modo "Criar a partir de".
  O modo EDITAR (`applyDashboardEditJson`) ADOTA os widgets (carimba
  `settings.presetKey` pelo MESMO mapa do export — `assignWidgetKeys`,
  `lib/import/dashboard/export.ts`) e aplica com
  `applyPresetDefinition({ targetDashboardId })`, que NÃO cria dashboard e
  roda **SEM GC** (a IA nunca exclui widget; resposta parcial é válida —
  não reintroduza GC nesse caminho). **Merge por widget (24/07/2026):** no
  Editar, `normalizeImportRaw` recebe `baseWidgets` (widgets do estado
  exportado) e faz deep-merge do widget da IA (casado por `key`) sobre o do
  estado — a IA manda só o delta do widget (`settings` mescla por chave, arrays
  substituem, `null` limpa) e o resto é preservado no SERVIDOR; NÃO exija que a
  IA re-emita o widget inteiro. Widget de key nova passa intacto; widget do
  estado não referenciado NÃO entra no JSON (o sem-GC preserva a linha).
  **Cópia por referência (24/07/2026):** widget de key NOVA com
  `"copy_of": "<key existente>"` usa a origem como base do MESMO merge (cópia
  por delta) — resolvido e REMOVIDO em `normalizeImportRaw` ANTES da validação;
  sem `grid_position` no delta a cópia empilha abaixo do fundo da aba dela
  (nunca herda a posição da origem — sobreporia). O laço de geração passa
  `baseWidgets` nos DOIS modos com estado (from incluso) e a prévia pendente
  não aplicada (`input.pendingJson`) entra no system do turno seguinte com a
  semântica "a resposta SUBSTITUI a prévia inteira" — é a ÚNICA saída de
  assistant reinjetada. **Modo
  Criar a partir de (`applyFromReference`, 24/07/2026):** cópia FIEL via
  `duplicateBoard` + o delta ADITIVO da IA aplicado como Edição na cópia
  (reusa o merge); NÃO usa mais `importDashboardJson` (que recriava tudo). Só o
  `new` segue no `importDashboardJson`. Duplica só no APPLY (sem cópias órfãs).
  **Mescla multi-referência (30/07/2026):** referências ADICIONAIS do from
  (`extraReferenceIds`, cap 4) entram SÓ na geração — `fuseExtraReferences`
  (`lib/import/dashboard/multi-ref.ts`) prefixa as keys (`rN_`), une as bases
  e alimenta `refWidgets` do rewrite (origem de `copy_of` FORA do merge por
  key e do `bottomByTab`); o `copy_of` resolve ANTES do apply, então keys
  `rN_` nunca chegam ao validador e o apply segue `duplicateBoard` só da base
  — NÃO crie variante multi de `duplicateBoard` nem passe extras ao apply.
  Snapshot pré-turno (`captureDashboardSnapshot`) é o Desfazer.
  Export/serialização nunca emite `preset`/`presetKey`/`connectors`/`kanban`.
  RPCs de widget INTOCADOS. **Painel in-dashboard (24/07/2026):** o painel
  "Editar com IA" do board (`ai-edit-panel.tsx` + `ai-session-actions.ts`)
  persiste a sessão em `dashboard_ai_sessions` (0098 — turns/chat/pending/
  undo_snapshot, uma linha por usuário×board; RLS own-row + org): o SERVIDOR é
  a fonte de verdade dos turnos e a prévia/Aplicar lê o JSON do BANCO — nada
  bruto viaja do cliente; identidade/permissões inalteradas (embrulha
  `generateDashboardWithAi`/`applyGeneratedDashboard` sem tocá-los; gate
  create_dashboards + dono/admin em toda action). O snapshot pré-turno segue
  sendo o Desfazer, agora DB-backed; "Recomeçar" zera a conversa mas PRESERVA
  o undo. O fluxo da Home (`ImportDashboardSheet`) segue client-state.
  **Raciocínio ao vivo (26/07/2026):** o TURNO do painel entra pela rota de
  streaming `/api/dashboards/<id>/ai-turn`, que roda o MESMO núcleo
  (`runAiEditTurnCore`/`generateDashboardCore` em `lib/ai/edit-session.ts`/
  `lib/ai/generate-dashboard.ts`; as actions viraram wrappers — NÃO recrie
  gate/persistência fora deles) e emite o raciocínio do modelo
  (`AiGenerateInput.onThought`; Gemini via SSE + `includeThoughts`) como
  NDJSON efêmero — nunca persistido na sessão. Regra de custo: NUNCA habilitar
  thinking num modelo em que ele vem desligado (só exibir onde o raciocínio já
  é padrão — por isso Claude/OpenAI seguem sem). Título do painel = MODELO
  configurado (1ª letra maiúscula).
- **Espaço de grid v2 (grade fina) e páginas de widget (25/07/2026):**
  unidades de `grid_position`/`ShapeLine`/`canvas` dependem de
  `settings.canvas.gridVersion` (2 = fino base-120 sem margens, linha quadrada
  default; ausente = legado base-12). TODA leitura de linha crua passa por
  `normalizeGridSpace` (`lib/widgets/grid-space.ts` — page, snapshots,
  export/IA, viewer público) e TODO escritor de geometria chama
  `ensureFineGrid` ANTES de gravar (actions.ts; a ordem leitura→carimbo
  CAS→conversão impede a dupla conversão — não a mude). Snapshots congelados
  (`snapshots.config`) nunca são migrados por backfill — a conversão runtime
  do viewer é permanente; runbook: `supabase/apply/backfill-grid-v2.sql`.
  Mescla de widgets: `settings.pages` (ids dos membros no HOST) NUNCA sai em
  export/JSON/clipboard e é PRESERVADA pelo `applyPresetDefinition` no update
  in-place; `deleteWidget` mantém a integridade (host excluído devolve
  membros; membro excluído sai do `pages`). A ocultação dos membros é SÓ de
  renderização (`collectPageMembers`, `lib/widgets/pages.ts`) — não filtre
  membros da computação de dados da page. RPCs de widget INTOCADOS.
  Ver `docs/arquitetura.md` §4.12 e invariantes 18/19.
- **Prompt de importação por IA é DERIVADO do código (25/07/2026):** o SPEC
  (`lib/import/dashboard/instructions.ts`) interpola os enums das constantes
  de runtime (`VISUAL_TYPE_LABELS`/`AGG_LABELS`/`DATE_TRANSFORMS`/
  `FILTER_OPS`/`PERIOD_PRESETS`/`PALETTES`/`DATA_TYPE_LABELS`/`DATE_TOKENS` —
  este novo em `lib/widgets/period.ts`, com `resolveDateToken` consumido pelo
  engine) e renderiza settings/appearance dos dicionários EXAUSTIVOS de
  `lib/import/dashboard/settings-docs.ts` (`satisfies Record<keyof
  WidgetSettings | AppearanceSettings (+ `.table`) | DashboardSettings,
  string | null>`; funções de fórmula via `FORMULA_FUNC_GROUPS` sobre
  `FormulaFuncName`). Chave/função NOVA nesses tipos sem entrada no dicionário
  QUEBRA `npm run typecheck` — documente-a LÁ (valor = linha do pseudo-JSON)
  ou marque `null` (fora do escopo da IA), NUNCA em prosa duplicada no SPEC.
  `EDIT_RULES` (ai-generate-actions) deriva do MESMO dicionário a lista de
  chaves editáveis de `dashboard.settings`. Fiscalizado por
  `lib/import/dashboard/instructions.test.ts` (`npm test`): enums presentes no
  texto, dicionários renderizados linha a linha, transforms legados fora,
  exemplo do SPEC aceito pelo validador REAL e contagens `**Label (N)**` do
  §16.2 do manual — o conteúdo do manual segue humano (regra do topo), só as
  contagens são conferidas.
- **Kanban/Agenda no import: settings SANEADO, vínculo local NUNCA no JSON
  (07/09/2026):** `WidgetSettings.kanban`/`.agenda` deixaram de ser `null` no
  dicionário (a IA CONFIGURA quadro e calendário) e deixaram de ser
  passthrough no validador. A régua é ÚNICA —
  `sanitizeKanbanSettings`/`sanitizeAgendaSettings`
  (`lib/import/dashboard/kanban-settings.ts`, PUROS, deps por injeção porque o
  `checkRef` é closure do validador): enums contra os mapas de rótulo de
  `lib/kanban/types.ts`/`lib/agenda/types.ts` (`KANBAN_MODE_LABELS`/
  `KANBAN_DATE_BUCKET_LABELS`/`KANBAN_AGG_LABELS`/
  `KANBAN_METRIC_KIND_LABELS`/`AGENDA_VIEW_LABELS` — `satisfies`, e os MESMOS
  que a UI consome), refs por `checkRef`, keys de Base (`linked` só aceita
  Base RAIZ), tetos de colunas/badges/extraFields. Chave inválida = AVISO +
  descarte, NUNCA erro duro. `KANBAN_LOCAL_KEYS`
  (`allocationFieldKey`/`taskBoardId`) referenciam campo e board do quadro de
  ORIGEM: o export as REMOVE, o validador as DESCARTA e o
  `applyPresetDefinition` as PRESERVA do settings existente (só em widget que
  segue kanban) — os três juntos, ou o strip do export desliga a alocação
  (invariante 24) em silêncio na primeira edição por IA. `widgets.sources` de
  kanban/agenda é ALINHADO com a Base da config (âncora do período da page).
  NÃO documente os vínculos locais no SPEC e NÃO monte régua paralela de
  saneamento — o assistente do quadro reusa este módulo. Fiscalizado por
  `lib/import/dashboard/kanban-settings.test.ts` + blocos em
  `validate.test.ts`/`instructions.test.ts`.
- **Assistente do QUADRO kanban não tem régua própria (`kanban-config` v1,
  07/09/2026):** o contrato (`lib/import/kanban/*`, core
  `lib/ai/kanban-config.ts`, sheet `components/kanban/kanban-ai-sheet.tsx`,
  actions em `app/(app)/kanbans/ai-actions.ts`) cobre `quadro` (delta de
  `KanbanSettings`) + `automacoes` (lista COMPLETA). Toda validação REUSA o que
  já existia: `deepMergeValue` (exportado de `lib/import/dashboard/rewrite.ts`
  — mesma semântica de delta da IA de dashboards) → `sanitizeKanbanSettings`;
  `parseAutomationRule` fail-closed para cada regra (por isso condição/ação
  viajam na forma INTERNA — camada de tradução derivaria do parse);
  `settableFields` do `getAutomationFieldOptions` como alvo de `set_field` (é
  ele que aplica `setFieldTargetError`). NÃO monte validação paralela nem
  traduza o vocabulário das regras. Apply SÓ por
  `updateBoardSettings`/`saveWidgetSettings` + `saveAutomation`; reconciliação
  por NOME e regra ausente é DESATIVADA, nunca excluída (precedente de
  operações). Alvo = o quadro da UI (`KanbanOwner`), nunca do JSON; as colunas
  chegam da página (como no `AutomationsSheet`) e só AMPLIAM os alvos aceitos.
  Fiscalizado por `lib/import/kanban/{validate,instructions}.test.ts`.
- **Painel de IA da OPERAÇÃO: registry em código, sessão com a ORG na PK
  (0124, 08/09/2026):** o painel vive no `layout.tsx` de `/operacao` e é
  escopado pela sub-área (`scopeForPath`). Registry PARTIDO em dois —
  `lib/ai/operacao/scopes.ts` (metadata PURA, client-safe: o painel é client;
  `cards.ts` não serve de molde porque importa `checkSettingsArea`) e
  `lib/ai/operacao/handlers.ts` (`server-only`). O handler NÃO implementa
  validação nem escrita: DELEGA aos cores existentes (o escopo `mapeamentos`
  chama `classify-mappings.ts` inteiro — zero contrato/validador novo; o sheet
  da tela continua sendo a porta do fluxo offline/CSV). Escopo sem entrada ⇒
  sem painel. **`operacao_ai_sessions` tem `organization_id` na PK**
  (`organization_id,user_id,scope`) — o escopo é chave de registry em CÓDIGO,
  igual em toda org, e sem a org na chave um usuário multi-org veria numa org
  o `pending`/`undo_snapshot` gerado em OUTRA (a RLS não pega: ele é membro
  das duas; precedente da 0123 em `currencies`). NÃO há trigger de stamp
  (sem linha-pai): a action carimba com `getActiveOrgId()` e o gate FALHA ALTO
  sem org ativa. `pending` guarda o ALVO junto do JSON e o apply RECUSA alvo
  divergente do da UI. Gate = `checkSettingsArea` + `adminOnly` (a área
  `remuneracao` não tem gate de papel e a page ramifica p/ o vendedor — sem
  isso ele veria painel de ESCRITA). Sub-escopo pelo contexto
  (`usePublishOperacaoAiTarget`), NUNCA por `useSearchParams`: o domínio de
  Mapeamentos é `useState` local. Carga da sessão é EVENTO (abrir); troca de
  sub-aba REMONTA por `key={scope.key}` — efeito reagindo a escopo cai em
  `react-hooks/set-state-in-effect`. Fiscalizado por
  `lib/ai/operacao/scopes.test.ts`. Ver `docs/arquitetura.md` §4.22.
- **Escopo `remuneracao` (contrato `remuneracao-edit` v1, 08/09/2026):** duas
  seções OPCIONAIS — `plano` (DELTA de `comp_plans.config`) e `metas` (células
  membro × fator, teto `MAX_AI_COMP_TARGETS`). Alvo `"<planId>:<ano>-<mes>"`
  publicado pelo `remuneracao-manager` com o mês do SERVIDOR (o rascunho da
  navegação é um mês que o usuário ainda não confirmou). O validador
  (`lib/import/comp/validate.ts`) só TRADUZ nome/rótulo/texto de fórmula para
  um `CompPlanConfig` completo mesclado sobre o atual — a régua de validade é
  `validateCompPlanSave` (módulo ÚNICO com o savePlan; repetir checagem aqui é
  a régua paralela da invariante 25) e a MURALHA segue sendo o `savePlan`.
  Ids NUNCA no JSON: fator/bloco casados por RÓTULO HERDAM `id` (e o fator,
  o `metricKey`) — regenerar orfanaria `inputs.overrides.factors`,
  `detailGrouping.byFactor` e as linhas de `goals` de todos os meses; fator
  novo sai com o sentinela `metricKey: "__auto__"` e bloco novo herda as
  `memberTiers` do homônimo. Por ser DELTA, `presetKey`/`filters`/
  `memberTeams`/`detailGrouping` sobrevivem ao apply, e `ativo` tem por
  default o estado ATUAL do plano (default `true` reativaria plano desligado);
  `comissoes` presente é a lista COMPLETA. Fórmula em TEXTO, tokenizada pelos
  catálogos que já existem. Apply/undo SÓ por `savePlan` + **`saveTarget`**
  (nunca `upsertGoalTarget`: é o saveTarget que canonicaliza e desloca a
  apuração — o call site fala o mês do LANÇAMENTO), re-validando sobre a config
  FRESCA, resultado POR ITEM, `valor: null` EXCLUI a meta (nunca `target = 0`).
  Fiscalizado por `lib/import/comp/{instructions,validate}.test.ts`. Ver
  `docs/arquitetura.md` §4.22 e §4.18.
- **Assistente de TAREFAS (contrato `tarefas-edit` v1, 08/09/2026):** lote de
  até `MAX_AI_TASK_ACTIONS` (15) ações `criar`/`editar`/`concluir` — SEM
  exclusão (precedente de operações). Identidade por TÍTULO (ambíguo = ERRO,
  nunca uma escolha), responsável/quadro por NOME, fase pelo RÓTULO da coluna
  do quadro EFETIVO (as fases da tela saem do MESMO `deriveColumns` + extras em
  uso do `tarefas-client`; só quadro em modo `tarefas` entra no catálogo). Gate
  é só a sessão — a muralha é a RLS de `tasks` (0063) e o `coerceResponsible`
  do choke point; nada de service role. Apply item a item por
  `createTask`/`updateTask`/`completeTask` + `moveTaskPhase` (a fase é choke
  point PRÓPRIO — o updateTask não a toca). DUAS armadilhas fechadas de
  propósito: o `updateTask` monta o UPDATE do FormData INTEIRO (chave ausente
  vira NULL), então o apply parte da LINHA ATUAL e sobrepõe o delta — sem isso
  mudar só a data apagaria descrição, responsável e o vínculo com o REGISTRO
  (que o SPEC declara não-editável aqui); e `hora_fim` sem `hora` é DESCARTADA
  em silêncio pelo `readTaskForm` (CHECK 0111), então o validador a recusa
  usando a hora já gravada como base na edição parcial. Fiscalizado por
  `lib/import/tasks/{validate,instructions}.test.ts`. Ver
  `docs/arquitetura.md` §4.17.
- **Agrupamento de responsáveis se resolve no ENGINE/loaders, nunca no RPC nem
  repontando registros (0101, 26/07/2026):** `responsibles.canonical_id` marca
  um responsável como APELIDO de outro ("nome usado") — exibição reversível:
  `records.responsible_id` NUNCA é repontado e limpar a coluna desfaz tudo.
  Resolução em `lib/config/responsible-canon.ts` (loader cacheado + helpers
  puros, gate barato por referência a `responsible_id`): filtros expandem p/ o
  GRUPO (`expandResponsibleFilters` nos choke points de
  `runWidget`/`runCalculatedWidget`/`runRecordList*`, incl. o `responsible_id
  in` da tradução de operação e condições de SOMASE pós
  `resolveFkCondFilters`), a dimensão funde apelido→principal no
  `mergeRowsByBucket`/`dimValue`, rótulos saem do principal
  (`fetchFkLabels`/`collectRecordFkLabels`) e dropdowns colapsam
  (`collapseResponsibleOptions`) — MENOS os selects de write-back, que gravam
  o responsável real. Restrição de snapshot grava `allowed_responsible_ids`
  JÁ EXPANDIDA (RPC intocado); `auth_responsible_ids()` devolve o grupo
  (visibilidade do vendedor cobre o id do apelido). Grupo sempre PLANO — só a
  action `setResponsibleCanonical` (Configurações → Responsáveis) escreve.
  Fiscalizado por `lib/config/responsible-canon.test.ts` + blocos nos testes
  de engine/record-list. Ver `docs/arquitetura.md` §4.13 e invariante 20.
- **Parcerias: match dinâmico, fusão de perfis de operação e sub-operações
  automáticas (0104–0106, 26/07/2026):** (a) os helpers
  `_widget_match_expr(_snap)` resolvem a fonte por `data_sources` (regra do
  espelho acima) — base RAIZ nova casa sem migração; refs `match:` de
  SUB-fontes não existem (filtradas em `buildMatchFields`, no matches-manager
  e no validador de import da IA). (b) O sync do Bitrix dispara auto-match
  INCREMENTAL pós-job (`runAutoMatchIncremental` — lado A restrito por
  `last_synced_at`, lado B inteiro) + recalc DIRECIONADO
  (`recalcFormulaFieldsForRecords`) — best-effort, nunca derruba o job.
  (c) Multi-seleção/pai de operações "profile-only" FUNDE os perfis no ENGINE
  (`fuseOperationProfiles`, `lib/config/operation-scope.ts`) num único
  `in`/`in_ci` (op interno do RPC, 0105 — normalização do `eq_ci`; fora da UI
  de filtros e do SPEC da IA; modo lista degrada como o `eq_ci`); caso
  misto/não-fundível degrada como antes (perfis descartados). NÃO recrie os
  RPCs para fusão nova — resolva no engine. (d) Sub-operações automáticas:
  config em `source_auto_operations` (1 por base; RLS espelha
  operations_write), rotina `lib/operations/auto-operations.ts` com service
  role + carimbo EXPLÍCITO de org; identidade por
  `operations.auto_source_record_id` (rename atualiza a MESMA operação;
  registro sumido INATIVA, nunca exclui; homônima sem vínculo é adotada); o
  perfil gerado é PROPRIEDADE do gerador (edição manual é sobrescrita).
  `records.operation_id` derivado fica NULL nessas operações (sem
  responsáveis): dimensão "por Operação" e `allowed_operation_ids` de snapshot
  NÃO enxergam parcerias — limitação documentada, não bug. Ver
  `docs/arquitetura.md` §4.14 e invariantes 21/22.
- **Série periódica, atributos e a Tree (0131–0134, 09/09/2026): a ocorrência é
  DERIVADA e a árvore só persiste a EXCEÇÃO.** A ação `create_task_series` é
  irmã de `create_task`, não um passo de `run_schema`: a trava da 0130 consome
  o registro uma vez para sempre ou reexecuta quando o payload muda, e a da
  0129 permite uma tarefa ABERTA por regra×registro — uma série precisa rodar
  todo dia sem escrever e escrever quando vira a quinzena. A trava é POR
  OCORRÊNCIA: `occurrence = floor((hoje − âncora) / cadência)`
  (`lib/series/occurrence.ts`), NUNCA um contador nem "última execução"
  gravada — tick que não rodou não dessincroniza a série, e a ocorrência que
  ninguém abriu segue existindo como fato (vira o galho vazio da árvore). O
  índice `uq_tasks_series_occurrence` é a trava de verdade e 23505 é NO-OP,
  jamais `last_error`; ele é DELIBERADAMENTE sem `completed_at is null` (o da
  0129 é "uma aberta por vez"; este é "a 3ª quinzena aconteceu uma vez na
  vida") — não os uniformize. A cascata da cadência (`lib/series/cadence.ts`)
  atende dois pedidos com travessias OPOSTAS: cadência vence o PRIMEIRO escopo
  alcançado com número (precedência declarada no esquema), `active=false` em
  QUALQUER escopo alcançado desliga (um "não" é mais forte que um "sim"). O
  padrão vive no esquema e as exceções são DADO (`series_settings`): mudar a
  cadência de um registro ou desligar a série de um responsável nunca reescreve
  a regra de todos. A **Tree** (0133) é DERIVADA dos fatos que já existem
  (ocorrências calculadas por `occurrencesUntil`, tarefas, `comments` 0066,
  `audit_log`); `tree_nodes` guarda SÓ o nó livre (mapa mental) e o
  `parent_ref` de um nó re-pendurado — é o que faz as três formas
  (`por_ocorrencia`/`por_tipo`/`livre`) rodarem sobre os mesmos fatos sem
  migrar dado e o re-pendurar COMPOR com qualquer uma; nunca materialize a
  árvore (desfazer tem de ser apagar uma linha). Tarefa da série FUNDE no nó da
  ocorrência e fato anterior à primeira pendura NELA. **Atributo do
  registro** (0131) = funcionalidade de Operação pendurada num registro:
  registry em CÓDIGO (`lib/attributes/registry.ts`, PURO e client-safe —
  precedente `lib/operacao/cards.ts` × `lib/ai/operacao/scopes.ts`), chave fora
  dele não vira superfície, e **pausar ≠ excluir** (`status='pausado'` mantém
  linha, histórico e árvore; quem para é a automação, que lê o status). RLS:
  leitura transitiva pelo registro, escrita admin/gestor OU o responsável dele.
  **Foco e janela (09/09/2026):** o widget Tree sem `recordId` fixo SEGUE o
  registro em foco do painel (`components/dashboards/record-focus-context.tsx`
  — a tabela publica no clique, o widget consome); o foco é EFÊMERO de
  propósito (nunca em `dashboard_table_cells`: aquilo é config compartilhada, e
  o registro em foco é análise de UMA pessoa) e a contagem de SEGUIDORES decide
  o destino do clique (com Tree no painel foca; sem, abre a barra lateral). A
  árvore vem em JANELA (`TreeWindow {order, limit}`) que recorta a lista de
  OCORRÊNCIAS antes de ler fato nenhum — nunca linhas soltas, senão o galho
  perde o tronco; `deriveTree` segue puro. `SeriesBound` tem uma 4ª forma de
  fim, `field_changed` (para quando o campo mudar; lê o mesmo HISTÓRICO da
  âncora — ver o bullet abaixo) — e "enquanto as condições valerem" é a
  AUSÊNCIA de `until`.
  O **widget `tree`** (0134) recria o CHECK de `visual_type` inteiro
  (precedente 0100), renderiza em HTML/CSS (nós têm ações dentro; as linhas são
  bordas) e recarrega em SILÊNCIO na origem event bus (§4.10). O **clique da
  linha** é `RecordListSettings.rowAction` (ausente = `none`, tabela existente
  byte-idêntica), e o modo `detalhe` é SOMENTE LEITURA — editar segue em
  /registros (um segundo editor seria a régua paralela da invariante 25). As
  RPCs de widget seguem INTOCADAS. Ver `docs/arquitetura.md` §4.24 e
  invariantes 33/34/35.
- **O adaptador do Gemini TRANSMITE SEMPRE, e falha de transporte REPETE
  (10/09/2026):** o `onThought` decide se os RESUMOS de pensamento são pedidos
  (`thinkingConfig.includeThoughts`) — NUNCA mais o endpoint. Ele escolhia
  entre `:streamGenerateContent` e `:generateContent`, e isso fazia o "Salvar e
  analisar" da Tree devolver 503 ("high demand") enquanto o painel do dashboard
  passava, alternando as duas telas no mesmo minuto com a mesma org, chave e
  modelo: `:generateContent` produz a resposta INTEIRA antes de responder e tem
  admissão mais apertada sob carga (a orientação do Google para 503 é usar
  streaming), então apanhavam TODAS as superfícies não-streaming — Tree,
  tarefas, campos, registros, kanban, remuneração, de-para. O ramo saiu: o
  contrato do `AiTextClient` é "uma string no fim", e transmitir + acumular dá
  o mesmo resultado sem um segundo caminho para divergir. NÃO reintroduza o
  ramo não-streaming, e NÃO amarre `includeThoughts` ao streaming (transmitir
  não liga raciocínio; a regra de custo vale só para os resumos).
  A retentativa de TRANSPORTE é do `fetchProvider` (`lib/ai/util.ts`), dono
  único dos três adaptadores — nunca por adaptador nem por superfície. As três
  tentativas dos laços (`runJsonGenerationLoop` e a de `generateDashboardCore`)
  seguem sendo SÓ para resposta que não passa no validador; era por isso que um
  único 503 matava o turno. A linha: 408/429/5xx e queda de rede repetem
  (`AI_HTTP_ATTEMPTS`, backoff com jitter, `Retry-After` com teto); 4xx de
  CONTRATO (400/401/403) falha na primeira com a mensagem de sempre — repetir
  não muda nada e só atrasa o erro; abort/timeout nunca repete (o
  `AbortSignal` do chamador é o teto do turno). No SSE a repetição é ANTES do
  primeiro evento: stream começado nunca reinicia. Corpo de erro cru não vai
  para a tela — `overloadMessage` vira frase.
- **A Tree CONDUZ a série, e a árvore aceita mais de um tronco (10/09/2026):**
  criar/editar a automação de uma sequência pela árvore é o MESMO
  `AutomationRuleEditor` do quadro e do Workflow — `tree-series-sheet.tsx` é só
  HOST (semente por `seedSeriesDraft`, dono `AutomationOwner {kind:"source"}` =
  a BASE do registro, regra nova nasce DESLIGADA, gate admin do
  `saveAutomation`). Um terceiro construtor é a régua paralela da invariante 25.
  As séries de um registro saem de `granted_by_rule_id` ∪ os
  `automation_rule_id` das PRÓPRIAS tarefas (`record_attributes` é único por
  registro — a 2ª série nunca chega a conceder o atributo); o id do fato carrega
  a regra (`occ:<ruleId>:<n>`) e o agrupador sintético `series:<key>` só nasce
  com DUAS ou mais — com UMA a saída de `deriveTree` é BYTE-IDÊNTICA (pinado).
  Agrupador não é filtrável nem selecionável, e o fato avulso (comentário,
  tarefa, alteração) pendura na ocorrência da série PRIMÁRIA — nunca reparta
  por proximidade de data. **Concluir/excluir uma ocorrência PERGUNTA** o que
  fazer com as demais (`TaskSeriesScopeDialog`, disparado do dono único
  `useTaskRowActions` — logo vale na lista e na agenda também): "encerrar" faz
  as DUAS metades (`endRecordSeries` apaga as ABERTAS, lendo o
  `bitrix_activity_id` ANTES do delete, e grava `active:false` no escopo do
  registro), porque só a primeira o tick desfaz e só a segunda deixa a tela
  pedindo o que já se abandonou; concluídas e atributo FICAM. Por isso
  `resolveCadence` consulta o escopo `record` SEMPRE no liga/desliga (não na
  cadência) — ver invariante 33. `TaskCompleteButton` ("Concluir"/"Reabrir")
  substituiu a caixa: ao lado da caixa de SELEÇÃO a forma não bastava.
- **O verbo do comentário é DADO, e "Salvar e analisar" reusa o contrato de
  tarefas (10/09/2026):** `TREE_COMMENT_VERB` + `TREE_NODE_KIND_LABELS.comment`
  são os donos únicos da palavra (literal em tela é como o termo errado se
  espalhou por 37 arquivos na 0137). "Comentar aqui" num nó grava a EXCEÇÃO de
  parentesco por `setTreeParent` logo após o `createComment` — sem isso o
  comentário nasce com `created_at = now()` e pendura na ocorrência de HOJE. O
  "Salvar e analisar" (`lib/ai/analyze-comment.ts` + o enunciado em
  `lib/import/tasks/analyze-instructions.ts`) usa o contrato `tarefas-edit`
  INTEIRO — mesmo formato, mesmo `validateTasksEdit`; o enunciado REUSA
  `buildTasksPromptText` e só acrescenta o comentário, o contexto do registro,
  a data de hoje e a régua de prazo (prazo dito vence; senão, follow-up SMB de
  SaaS; SEMPRE data absoluta). Duas decisões que não se podem desfazer sem
  quebrar: `acoes: []` é RESPOSTA (o validador a recusa, e com razão, na outra
  superfície — quem a reconhece é `readEmptyAnswer`, ANTES dele), e o apply NÃO
  chama `applyTasksCore` porque o contrato não carrega vínculo com REGISTRO — o
  `record_id` entra no FormData aqui e o choke point segue `createTask`.
  Depois de validar, o core ESTREITA para no máximo UMA ação `criar`. A IA
  nunca escreve: o cartão de um clique é um humano apertando o botão
  (invariante 25).
- **"Quando este campo mudou" é `audit_log`, NUNCA `field_modified_at` (0135,
  09/09/2026):** as duas colunas parecem a mesma coisa e não são.
  `records.field_modified_at` é o marcador de "editado LOCALMENTE depois do
  último sync — não sobrescreva" (`isProtected`, `lib/sync/shared.ts`), e só o
  app escreve nele: para todo campo vindo do Bitrix ele fica VAZIO para sempre.
  Foi o que fez a âncora `field_changed` da série (0132) e a condição de tempo
  homônima do motor 0109 nunca casarem, em silêncio, para 36 de 36 deals em
  Nutrição. **Jamais mande o sync carimbar `field_modified_at`** — marcaria todo
  campo sincronizado como protegido e o sync pararia de atualizar qualquer
  coisa; os dois significados não cabem na mesma coluna. O fato certo já está em
  `audit_log`, que o sync alimenta a cada valor que muda (`audits.push` de
  `lib/sync/bitrix/sync.ts`), e é AGNÓSTICO de quem mudou. Dono único da
  leitura: `loadFieldHistory` (`lib/records/field-history.ts`), batelado por
  rodada como `loadSeriesOccurrences`, audit ∪ edição local pelo MAIOR
  timestamp; a 0135 é só o índice `(record_id, field, changed_at desc)` (o
  `idx_audit_record` não recorta por campo). Sem histórico ⇒ não cobra
  (`anchorFallback` "nenhum" é o padrão; "criacao" usa `source_created_at`) —
  nenhum caminho inventa data. Junto: a janela de ocorrências futuras NUNCA
  anda para trás (vencida que ninguém abriu segue como galho vazio da Tree, não
  vira tarefa retroativa); e o atributo `pausado` passou a PARAR a série
  (`CardFacts.pausedAttributes`) — o status era escrito e nunca lido. Ver
  `docs/arquitetura.md` §4.24 e invariantes 33/36.
- **A janela da série se repõe por CONCLUSÃO, e quem sai do recorte devolve o
  que não fez (10/09/2026):** `occurrencesToOpen` (`lib/series/occurrence.ts`,
  puro) substituiu `occurrencesAhead` no caminho do tick — mantém `lookahead`
  ocorrências FUTURAS ABERTAS (padrão 3, configurável na regra), repondo uma a
  cada conclusão; antes a janela andava pelo TEMPO e concluir uma deixava o
  vendedor com uma a menos até virar o ciclo. Por isso
  `CardFacts.seriesOccurrences` deixou de ser `"<ruleId>:<n>"` e carrega o
  ESTADO de cada ocorrência (`loadSeriesOccurrences` traz `completed_at`). As
  datas seguem do calendário (âncora + n × cadência): concluir três seguidas não
  antecipa nada. **Revogação:** registro que deixa de casar as CONDIÇÕES da
  regra emite `revokedSeries` no ramo `!matched` de `decideActions`, e
  `executeSeriesRevocations` apaga as ABERTAS e enfileira o `delete` da
  atividade no CRM — concluídas e atributo FICAM (pausar ≠ excluir). Só é
  seguro porque o universo de Base é a Base INTEIRA sem teto (`fetchAll`):
  registro ausente do universo NUNCA é revogado. Atributo pausado ou cadência
  desligada para um recorte NÃO revogam (a regra segue casando; parar de pedir
  e apagar o que já foi pedido são decisões diferentes). **Antecedência do
  espelho:** `SeriesConfig.mirrorLeadDays` (padrão 3, configurável) adia a
  criação no CRM até o vencimento se aproximar — `mirrorDueNow` é o dono ÚNICO
  da conta (executor da série + varredor), e `enqueueDueTaskMirrors` roda no
  tick ANTES do dreno. NÃO recrie as RPCs para nada disso.
- **O índice da 0129 NÃO é das tarefas de série (0138, 10/09/2026):**
  `uq_tasks_open_per_automation` ganhou `and series_occurrence is null`. As duas
  travas guardam coisas diferentes — a 0129 é "uma tarefa ABERTA por vez"
  (`create_task`), a 0132 é "a N-ésima ocorrência aconteceu uma vez na vida"
  (`create_task_series`, várias abertas lado a lado DE PROPÓSITO) — e sem o
  recorte a primeira vencia sobre a segunda, reduzindo toda série a UMA tarefa
  aberta por registro. Cada rodada do tick tentava inserir as demais e todas
  batiam em 23505, que o executor trata como no-op: invisível na aplicação,
  dezenas por minuto no log do PostgREST. Por isso `SeriesOutcome.skipped` agora
  chega ao resumo da rodada (`AutomationRunSummary.seriesSkipped`) — segue FORA
  do `last_error`, mas deixa de ser mudo. NUNCA uniformize os dois índices.
- **Tarefa espelhada no Bitrix é FILA + id externo (0136, 09/09/2026):** a
  tarefa daqui vira ATIVIDADE do CRM (`crm.activity.add`, TYPE_ID 6 /
  PROVIDER_ID CRM_TODO) na timeline do negócio — não o módulo Tasks. A chamada
  externa NUNCA fica no caminho de quem salva a tarefa (portal fora do ar
  viraria tarefa não criada aqui): enfileira em `bitrix_task_queue` e
  `drainTaskMirrorQueue` (`lib/sync/bitrix/task-mirror.ts`) drena no tick que
  já existe, DEPOIS do write-back e no mesmo orçamento. A
  `bitrix_writeback_queue` não serve (CHECK `entity in ('deal','lead')`,
  `record_id` NOT NULL com FK para `records`, dreno fixo em `crm.*.update`, e
  modela atualização de CAMPO sem devolver id). `tasks.bitrix_activity_id` é o
  que impede duplicar e o que permite fechar lá o que se conclui aqui
  (`COMPLETED: 'Y'`); 23505 no enfileirador é NO-OP. Configuração em CASCATA
  resolvida SÓ em `lib/tasks/mirror-config.ts`: Base
  (`data_sources.bitrix_activity_owner`) → automação/série (`mirrorBitrix` no
  jsonb) → tarefa (o seletor do form). `"herdar"` NÃO é `"nunca"` — é a
  ausência de decisão, e é o que faz ligar o espelho na Base valer para as
  séries que já rodam sem editá-las. Nenhum nível atravessa o piso: sem
  registro com par no CRM não há `OWNER_ID` onde pendurar, e a decisão devolve o
  MOTIVO para a tela explicar. Toda Base nasce desligada. Ver
  `docs/arquitetura.md` §4.24 e invariante 37.
- **O Bitrix nos DOIS sentidos, e o objeto que se busca fora do período é a
  ATIVIDADE, nunca o negócio (0137, 10/09/2026):** concluir uma atividade NÃO
  mexe no `DATE_MODIFY` do deal, então o reconcile inteiro
  (`">=DATE_MODIFY": since`, `buildReconcilePlan`) nunca traz de volta o
  registro cuja única mudança foi "o vendedor fechou a tarefa". Reler o DEAL
  fora do período não resolveria — ele não diz nada sobre as atividades dele;
  o que se lê independentemente de período é a LISTA DE ATIVIDADES dos donos
  com pendência aqui (`crm.activity.list` com `@OWNER_ID`), e é a mesma
  leitura que detecta EXCLUSÃO — que não emite nada: a atividade apagada
  simplesmente não volta na lista. Por isso o inbound
  (`lib/sync/bitrix/activity-inbound.ts`) NÃO é uma fase do plano: o runner é
  paginado passo a passo e não distingue "sumiu" de "está na próxima página".
  Ele roda mesmo com o job sem nada escrito — é justamente aí que há conclusão
  esperando. **ONDE ele roda (corrigido em 10/09/2026):** a 0137 pendurou o
  gancho no ramo `phaseIndex >= plan.length` de `stepJob`, que é INALCANÇÁVEL
  (o `phase_index` só chega ao fim do plano no MESMO update que grava
  `status:'done'`, e o passo seguinte volta no guard de estado terminal) — a
  leitura de volta inteira nunca rodou, nem pelo tick nem pelo botão
  Reconciliar. Hoje são DOIS sítios, divididos por CUSTO: o `if (done)` do
  passo de trabalho leva a rodada COMPLETA (~1×/h), e o tick de minuto chama com
  `{ comments: false }` — conciliar tarefas é UMA chamada de `crm.activity.list`
  por lote de 40 donos, mas a timeline é uma chamada POR registro e não cabe num
  tick. **`listActivities` devolve `{ items, truncated }` e lista truncada NÃO
  autoriza o ramo de exclusão** (teto de páginas / orçamento): "não vi" não é
  "não existe", e aqui a exclusão é definitiva; conclusão e criação seguem,
  porque dependem do que VOLTOU. QUEM ESCREVE O QUÊ é a linha que evita o cabo de
  guerra: conteúdo (título/descrição/prazo/responsável) de tarefa já espelhada
  é DAQUI (o outbound leva); `COMPLETED`, a exclusão e a atividade CRM_TODO
  ainda desconhecida são DE LÁ. O inbound NUNCA sobrescreve conteúdo de tarefa
  com `bitrix_activity_id` — por isso `tasks` não precisa de um `isProtected`
  (invariante 36) — e escreve DIRETO, sem enfileirar de volta (senão seria
  pingue-pongue). Só `PROVIDER_ID = 'CRM_TODO'` vira tarefa: ligação, e-mail e
  reunião também são atividades. Do lado de saída, a 0137 fechou três buracos
  que viravam laço com o inbound: `reopenTask`/`moveTaskPhase`/`rescheduleTask`
  passaram a enfileirar `update` (sem isso a leitura re-fecharia a tarefa
  reaberta a cada rodada, para sempre) e `deleteTask` enfileira `delete` ANTES
  de apagar a linha — a FK da fila virou `on delete set null` justamente para a
  ordem sobreviver (com o cascade, enfileirar depois sumia com a própria ordem
  e a atividade ficava órfã, para o inbound reimportar como tarefa nova).
  Comentário: `createComment` enfileira `comment_add` (a fila ganhou `target`
  com default `'task'`, para as linhas da 0136 não mudarem de significado) e a
  leitura de volta só puxa a timeline dos registros com o atributo `tree`
  ATIVO — é uma chamada por registro. `comments.bitrix_comment_id` é o que
  impede o nosso próprio comentário de virar uma segunda anotação;
  `comments` NÃO ganha `organization_id` (é transitiva ao registro desde a 0066
  e a RLS depende disso). Ver `docs/arquitetura.md` §4.24 e invariante 38.
- **Vocabulário de domínio é DADO, nunca literal no fonte (10/09/2026):** o
  substantivo de cada ocorrência de uma série vive em `SeriesConfig.noun`
  (a automação) e `tasks.occurrence_noun` (a tarefa), com padrão
  `DEFAULT_SERIES_NOUN = "Tarefa"` e UM dono da frase — `occurrenceLabel`
  (`lib/series/types.ts`). Motivo: uma entrega anterior escreveu no código uma
  palavra que esta organização não usa, e ela reapareceu em 37 arquivos —
  rótulo errado no fonte não é erro de digitação, é uma dívida que cresce a
  cada tela nova. `lib/series/noun.test.ts` tem a guarda ESTÁTICA: nenhum
  `.ts`/`.tsx` fora da allowlist (dois arquivos, ambos dado real de negócio —
  um segmento de mercado e o rótulo de um campo que existe no Bitrix) pode
  reintroduzir o radical. Nunca monte a frase da ocorrência à mão.
- **Ação `run_schema` (0130, 09/09/2026): a trava é DERIVADA dos passos.** Um
  esquema é uma sequência de alterações DENTRO e FORA do sistema (criar lead é
  só um caso) — por isso o vocabulário tem `bitrix.entity.update` (mesma chamada
  do `drainWritebackQueue`) e `record.update`, que NÃO escreve por conta
  própria: monta `FieldWrite[]` e chama `executeFieldWrites`, o executor único
  do `set_field` (agora exportado de `move.ts`). O miolo da execução é
  `runWorkflowCore` (`lib/workflow/run.ts`) — a action do formulário e o tick
  são WRAPPERS; duas cópias seriam a régua paralela da invariante 25. Quem
  responde o formulário é o REGISTRO: `WorkflowFormField.sourceRef` +
  `action.map` (precedência map → sourceRef → defaultValue), resolvido PURO em
  `decideActions` (`refs.ts` INTOCADO — sem escopo novo). A trava não é uma só,
  e não é declarada: `schemaIsIrreversible` (registry, derivado do `creates` de
  cada tipo de passo) decide — esquema que CRIA gasta `payload_hash = ''` e
  consome o registro UMA vez por regra para sempre; esquema só de ALTERAÇÃO
  guarda o hash da entrada e reexecuta quando o que seria enviado MUDA (a mesma
  idempotência por comparação do `set_field`). O índice
  `uq_workflow_runs_per_automation` (0130) é a trava de verdade e é
  REIVINDICADA antes de executar (`status='iniciado'`; processo morto no meio
  SEGURA a trava de propósito); 23505 é NO-OP, nunca `last_error`. Sentinela
  `''` em vez de NULL porque NULL em índice único é distinto de si mesmo.
  `simulate` ausente no jsonb parseia como TRUE (armar é ato explícito) e no
  ensaio nada é escrito — o payload volta em `WorkflowStepOutcome.payload` e a
  ref de passo anterior recebe `#simulado:<stepId>`. Teto PRÓPRIO
  `MAX_SCHEMA_RUNS_PER_RUN = 5`, ainda descontado do 200 compartilhado. Falha
  NÃO repete sozinha: `lib/workflow/notify.ts` mantém UMA tarefa aberta por
  regra (molde de `lib/mappings/notify.ts`) e a volta à fila é o "Tentar de
  novo" (`released_at`) da aba Execuções, admin-only. A IA do quadro RECUSA
  `run_schema` e a ação fica FORA do SPEC. Ver `docs/arquitetura.md` §4.23.0.
- **Ação `create_task` (0129, 08/09/2026): a idempotência é o problema
  INTEIRO.** `set_field` é idempotente por COMPARAÇÃO (valor igual ao alvo
  consome o card sem escrever); criar tarefa não tem estado anterior para
  comparar, e o tick roda A CADA MINUTO — sem trava, uma regra abre 1.440
  tarefas por dia por registro. DUAS camadas, ambas obrigatórias:
  (1) `CardFacts.openAutomationRuleIds` (regras que já têm tarefa ABERTA para
  o registro) faz o avaliador pular — a consulta só roda quando alguma regra
  ATIVA cria tarefa; (2) o índice único parcial `uq_tasks_open_per_automation`
  em `(automation_rule_id, record_id) where completed_at is null` é a trava de
  VERDADE (corrida entre tick e "Executar agora"), e o executor trata o 23505
  como NO-OP, nunca como falha (poluir `last_error` com "duplicate key" é ruído
  sobre o resultado desejado). O `where completed_at is null` é deliberado:
  concluída a tarefa, a regra cobra de novo se a condição voltar a valer —
  acompanhamento recorrente, não marcador de "já pedi uma vez na vida". A escrita
  NÃO usa `createTask` (action `(prevState, formData)` que depende de
  `getSessionInfo()`, inexistente num tick): reusa o padrão de
  `lib/mappings/notify.ts` — service role, org EXPLÍCITA, webhook
  `task.created` à mão; autoria = quem salvou a regra, execução = autoridade de
  sistema. Responsável padrão = o DO REGISTRO. A frase de resumo de regra é
  ÚNICA (`lib/kanban/automations/summary.ts`) e consumida pela lista do
  Workflow e pela prévia da IA do quadro — repetir a montagem foi o que fez a
  prévia esquecer da ação nova. Ver `docs/arquitetura.md` §4.15.
- **Automação SEM QUADRO: escopo de Base (0127, 08/09/2026):** o motor 0109
  nunca foi sobre kanban — `decideActions` usa a coluna SÓ p/ validar o alvo de
  `move_to_column`, as condições de tempo `field_changed`/`created` já são de
  REGISTRO e `set_field` escreve num campo. O que prendia ao quadro era a
  ORIGEM das linhas. `automation_rules.source_key` dá um terceiro tipo de
  dono (uma Base); a montagem do universo saiu p/
  `lib/kanban/automations/universe.ts` e ramifica LÁ (quadro → `runKanban`,
  byte-idêntico; Base → `runRecordList` com `columnKey` vazio e `columns: []`).
  Do universo em diante TUDO é compartilhado — não crie segundo motor, segundo
  parse nem segunda tabela. NENHUMA guarda nova: sem colunas o
  `decideActions` recusa `move_to_column` pelo MESMO caminho de "coluna
  removida" e `in_column` não casa (não há posição); o `saveAutomation` recusa
  as duas na hora com mensagem própria (regra inerte que só se explica pelo
  `last_error` é pior que erro no save). RLS: os 2 ramos existentes derivam de
  `auth_board_editable`; o de Base não tem quadro, então é `admin` da org —
  mais restrito de propósito (alcança a base inteira). O gate da action
  ESPELHA isso; a RLS é a muralha. `executeFieldWrites` passou a receber
  `writeBack: boolean` (era só isso que usava de `KanbanSettings`) — automação
  de Base escreve LOCAL; os moves seguem com `settings`. `AutomationOwner` tem
  `ownerColumn`/`isBoardOwner` — nunca reintroduza o ternário
  `kind === "widget" ? "widget_id" : "board_id"` em caminho de automação (com
  3 tipos ele manda regra de Base para `board_id`). A tabela chamava-se
  `kanban_automations` e foi RENOMEADA para `automation_rules` na 0128 — o
  escopo de Base tornou o nome antigo mentiroso, e renomear cedo evitou o
  destino das chaves de área históricas (`fontes` → `/registros/bases`), que
  não dá mais para desfazer. A ROTA do tick segue
  `/api/kanban-automations/tick`: o pg_cron já agendado aponta para ela e
  trocar o caminho derrubaria o agendamento até alguém reaplicar o SQL.
  Fiscalizado por `universe.test.ts` (o ramo de Base não pode ler
  `dashboards`/`widgets`/`kanban_placements` — o fake é fail-closed) + os 80
  testes de kanban intocados (não-regressão do ramo de quadro). Ver
  `docs/arquitetura.md` §4.15.
- **Automações do kanban e ações em massa se resolvem no ENGINE/actions, nunca
  no RPC (0109, 27/07/2026):** regras em `automation_rules` (tabela própria
  — NUNCA em `settings.kanban`: o widget-builder reconstrói o objeto no save e
  derrubaria a chave; o tick perderia a enumeração indexada), jsonb versionado
  com parse FAIL-CLOSED (`lib/kanban/automations/types.ts`). Avaliação pura em
  `evaluate.ts` (primeira regra que casa vence; decisões sobre o snapshot da
  rodada; mock nunca move; alvo overflow/coluna sumida = `last_error`, nunca
  silêncio), I/O em `engine.ts` reusando `runKanban` com period null e escopo
  EXPLÍCITO de org em TODA consulta service-role (`opts.orgId` do
  `runRecordList` — consulta nova sem o escopo vaza registro entre orgs);
  execução em `move.ts` (Personalizar = upsert de placements; escrita de CAMPO
  — move por valor E `set_field` — SÓ pelo executor único `executeFieldWrites`:
  carimbo `field_modified_at`+`locally_modified_at`, recalc/audit
  (`origin='automation'`)/write-back/webhook em lote). **Ação `set_field`
  (31/07/2026):** grava valor FIXO num campo; IDEMPOTENTE por comparação no
  snapshot da rodada (valor igual consome o card SEM escrever — decidido no
  `decideActions` de evaluate.ts, nunca no executor); alvo de data/calculado/
  relação/`match:`/`unified:`/coluna core não-editável/campo-espelho da
  alocação (`allocationFieldKey`, invariante 24) é barrado por
  `setFieldTargetError` na AVALIAÇÃO (regra inerte + `last_error`) E no save;
  o picker da UI (`settableFields`) deriva da MESMA régua — nunca lista
  paralela. Bucket de DATA nunca é
  alvo (não idempotente); modo tarefas fora do v1; teto ÚNICO de 200 AÇÕES
  (moves + sets somam — `MAX_ACTIONS_PER_RUN`)/quadro/
  rodada; `last_moved_count` conta ações. Gatilhos: tick por minuto (`pg-cron-kanban-automations.sql`) + hook
  pós-sync (DEPOIS do auto-match) + "Executar agora"; autoria = editor do
  board (RLS `auth_board_editable`), execução = autoridade de sistema. Ações
  em massa (`lib/kanban/bulk-actions.ts`): resultado POR ITEM (revert parcial
  no cliente), teto 200/chamada, sem revalidatePath; excluir REGISTRO é
  admin-only (espelha a RLS `records_delete`) e SEMPRE emite `record.deleted`.
  **Ação em massa de TAREFA espelha no Bitrix, como a unitária (10/09/2026):**
  `completeTasksBulk`/`deleteTasksBulk` não espelhavam — antes da 0137 era só
  assimetria; com a leitura de volta virou REGRESSÃO (concluir em lote deixava
  a atividade aberta lá e o inbound reabria TUDO no minuto seguinte; excluir
  deixava a atividade órfã, reimportada como tarefa nova). O excluir lê o
  `bitrix_activity_id` ANTES do delete (depois a linha some) e enfileira
  DEPOIS de a RLS deixar passar; a resolução de Base é EM LOTE
  (`loadMirrorOwners`/`enqueueTaskMirrorMany`, `lib/sync/bitrix/task-mirror.ts`)
  — `mirrorTaskAfterWrite` resolve por tarefa, e 200 itens dariam 400
  consultas. Pinado por guarda estática em `task-mirror.test.ts`.
  **A seleção múltipla tem UM dono (10/09/2026):** o `Set`/toggle/poda/Esc vive
  em `lib/feedback/use-bulk-selection.ts` e a pill sticky em
  `components/ui/bulk-bar-shell.tsx` — o desenho estava copiado em
  `records-table` e `kanban-board`, e as telas de tarefa iam somar mais quatro.
  Duas regras que o hook carrega e que consumidor novo não deve reimplementar:
  a seleção é PODADA contra os ids vivos (item que saiu da tela sai da
  seleção — ação em massa nunca mira o que ninguém vê) e o universo do
  "selecionar todas" é a lista FILTRADA em tela, jamais a consulta inteira. A
  linha selecionável é o `<Checkbox>` do shadcn ao lado da caixa NATIVA de
  concluir: duas caixas iguais lado a lado seriam armadilha. `TaskList` ganha
  seleção por props OPCIONAIS (ausentes = byte-idêntico — ele tem cinco
  consumidores e só três a ligaram). Na Tree a cascata é tri-estado e PURA
  (`lib/tree/selection.ts`): a fonte da verdade são as FOLHAS, e o estado do
  pai é derivado — guardar "o pai está marcado" tornaria indecidível desmarcar
  um filho. Nó de ALTERAÇÃO nunca é selecionável (fato do `audit_log`), e a
  seleção mista é repartida por tipo para a action dona de cada um
  (`deleteTasksBulk`/`deleteCommentsBulk`/`deleteTreeNodesBulk`).
  No board, TODO movimento passa pela fila otimista
  (`use-kanban-bulk-queue.ts`) e o resync `data`→estado local é GUARDADO com a
  fila em voo (dado mid-flight é stale e descartado) — não remova a guarda
  nem re-introduza `await` no drop. Ver `docs/arquitetura.md` §4.15 e
  invariante 23.
- **Assistentes de IA de registros/campos/operações NUNCA escrevem direto
  (30/07/2026, §4.17):** os cores (`lib/ai/insert-records.ts` — até 10
  registros em base `manual_entry`; `lib/ai/update-records.ts` — atualização
  em MASSA, contrato `registros-update` v1, até 200 registros;
  `lib/ai/csv-mapping.ts` — sugestão de
  mapeamento no wizard; `lib/ai/create-fields.ts` — até 10 campos, calculados
  inclusos; `lib/ai/manage-operations.ts` — até 15 ações de operações) só
  VALIDAM (`lib/import/{records,csv-mapping,fields,operations}/validate.ts`) e
  devolvem prévia; o
  apply RE-VALIDA o JSON (a prévia de registros é editável — célula + troca de
  coluna, `lib/import/records/preview.ts`) e escreve SÓ pelos choke points
  existentes: `createRecord` por registro (RLS `records_insert` é a muralha;
  nada de service role p/ inserir; pós-loop um
  `recalcFormulaFieldsForRecords`), `createField` por campo (ordem simples →
  calculado → calculado_agg) e o estado `plans` do wizard (a revisão da tabela
  É a confirmação — import intocado) e, p/ OPERAÇÕES (31/07/2026), as ações
  do contrato `operacoes-edit` v1 (criar/editar/vincular/desvincular por
  NOME — ids nunca no JSON; SEM delete; operação AUTOMÁTICA de parceria
  intocável — invariante 22; catálogo de TRABALHO aceita referência a
  operação criada no lote; `createOperation` devolve `id` p/ o encadeamento)
  via `createOperation`/`updateOperation`/`updateOperationFilter`/
  `addResponsibleOperation`/`removeResponsibleOperation`; a sanitização de
  perfil vive no módulo ÚNICO `lib/config/operation-profile.ts`
  (`PROFILE_OPS`/`NO_VALUE_OPS` — choke point e validador da IA usam o
  mesmo). O fluxo copiar-prompt → colar-JSON de IA EXTERNA usa o MESMO
  contrato/validador/prévia (`previewOperationsCore`/
  `buildOperationsPromptCore`; manual funciona sem IA configurada). Base/alvo
  vem SEMPRE do seletor da UI,
  nunca do JSON. Prévia de registros mostra SÓ colunas preenchidas; duplicado
  por título é AVISO. Laço de autocorreção único (`lib/ai/json-loop.ts`;
  `generateDashboardCore` mantém o dele); amostras por base compartilhadas em
  `lib/import/sample-db.ts`. SPECs DERIVADOS de constantes reais
  (`EDITABLE_CORE_COLUMNS`/`CORE_IMPORT_TARGETS`/`IMPORT_NEW_FIELD_TYPES`/
  `DATA_TYPE_LABELS`/`FORMULA_FUNC_GROUPS`/`CURRENCY_OPTIONS`/`PROFILE_OPS`) e
  FISCALIZADOS pelos testes de paridade
  (`lib/import/records/instructions.test.ts`,
  `lib/import/operations/instructions.test.ts` etc.) —
  nunca duplique em prosa. Fórmula da IA valida pelos módulos ÚNICOS extraídos
  p/ `lib/records/formula-server.ts` (campos/actions reimporta — não recrie
  catálogos). Datas core do contrato são `YYYY-MM-DD` ancoradas na escrita por
  `coerceCore`→`anchorNaiveToBrasilia` (invariante 11); custom segue texto
  naive. **Contrato `registros-update` v1 (31/07/2026):** a IA emite UMA
  operação `{filtros, alteracoes}` — NUNCA ids de registro; a base vem do
  seletor da UI. Aceita QUALQUER base visível, SUB-fontes incluídas (o gate é
  `edit_record_values` + `editable_by_roles` + RLS, não `manual_entry`).
  Prévia server-side OBRIGATÓRIA: os registros que casam saem de
  `runRecordListWindow` (caminho canônico do modo lista — predicado de sub,
  nome→id de FK, canon, regra 0052; NUNCA consulta paralela nem RPC novo) com
  contagem exata + amostra; o apply RE-RESOLVE os ids na hora (recorte > teto
  de 200 = `MAX_AI_UPDATE_RECORDS` aborta ALTO — nunca fatia em silêncio),
  pula mocks (reportados) e escreve SÓ por `updateRecordValuesBulk`
  (`lib/records/bulk-update.ts` — client RLS do usuário, coerção
  `coerce`/`coerceCore`, carimbos, UM recalc, audit `origin='app'` com user
  real, webhook por registro; write-back Bitrix FORA do v1 — campo de Sync é
  alvo válido com escrita LOCAL, flag `sync` no contexto e aviso na prévia).
  Operadores de filtro = `FILTER_OPS` ESTRITO (op interno `eq_ci`/`*_num`
  seria dropado em silêncio pelo modo lista ⇒ over-match); relação em filtro
  só eq/neq/in/is_null/not_null com NOME (nunca UUID); ≥1 filtro obrigatório;
  `null` em alteração LIMPA o campo (title nunca). SPEC derivado também de
  `FILTER_OPS` e fiscalizado por
  `lib/import/records/update-instructions.test.ts`.
  Ver `docs/arquitetura.md` §4.17 e invariante 25.
- **Remuneração variável se resolve no ENGINE e nos choke points (0112,
  30/07/2026):** `comp_plans.config` é jsonb VERSIONADO com parse FAIL-CLOSED
  (`lib/comp/model.ts`); o realizado por membro×fator sai SÓ de
  `runCalculatedWidget` (filtro `responsible_id eq` — canon no choke point;
  período de mês por `monthPeriod` com `fieldBySource` do catálogo inteiro;
  RPCs de widget INTOCADOS — engine em `lib/comp/engine.ts`). **Apuração
  sobre o mês anterior (31/07/2026):** `config.apuracao: "mes_anterior"`
  (padrão dos planos do preset e de plano novo no editor; parse normaliza
  `mes_corrente` p/ AUSÊNCIA) faz o lançamento M apurar realizado/metas/taxas
  de M-1 via `apuracaoRef` — o deslocamento vive DENTRO de
  `loadTargetsByMember`/`loadTargetRatesForConfig` + `monthPeriod` do
  recompute + key de goals do `saveTarget`; call site fala SEMPRE o mês do
  LANÇAMENTO (deslocar no caller = dupla conversão lendo M-2) e
  entry/espelho/navegação ficam no mês de PAGAMENTO; `computed.ref` carimba a
  janela apurada e o save do plan-editor RE-EMITE a chave (regra do
  presetKey). O efetivo é
  `manual ?? calculado` derivado por `computeEntry` NA LEITURA:
  `comp_entries.computed` guarda só o snapshot cru e o recompute NUNCA regrava
  `inputs`/`base_amount` (overrides sobrevivem; limpar a chave restaura a
  derivação sem re-consulta; cap/floor clampam só o calculado). Alvos são
  LINHAS de `goals` (scope 'responsible', id CANÔNICO, métrica do registry
  `goal_metrics` vinculada por `factor.metricKey`) escritas SÓ por
  `lib/metas/upsert.ts` — célula limpa EXCLUI a meta (nunca `target=0`); a
  área Metas gerencia os mesmos alvos. **Membros por operação (31/07/2026):**
  `config.memberOperationIds` = subárvore VIVA de `responsible_operations`
  resolvida SÓ nos callers (`loadOperationScopes` +
  `operationMembersFromScopes` — canonicaliza apelido→principal; NUNCA
  `records.operation_id` literal), combinada aos manuais pelos helpers PUROS
  `resolveOperationMembers`/`explicitMemberIds` de `lib/comp/model.ts`
  (grade/editor usam os MESMOS via props — client nunca importa engine.ts).
  Presença da chave ⇒ lista explícita SEMPRE (resolução vazia = plano sem
  membros; parceria profile-only contribui zero — nunca fallback "todos");
  ambos vazios = todos os ativos. A fórmula LIVRE de total
  (`config.totalFormula`) avalia SÓ por `evaluateFormula` sobre o mapa
  `comp:*` de `computeEntry` (catálogo único `compOperandCatalog` — editor e
  servidor; kind "record", SOMASE proibido); resultado não-numérico ⇒ total
  null, e `overrides.total` vence tudo. **Comissão por faixas MULTI-BLOCO
  (31/07/2026):** `config.commissions[]` (≤6 blocos; sem migração; parse
  fail-closed — gatilho/base apontando fator inexistente, kind/tierBy
  inválidos ou id duplicado derrubam o config; o LEGADO `commission` objeto é
  NORMALIZADO no parse p/ um bloco `{id:"comissao", kind:"pct",
  tierBy:"attainment"}` byte-equivalente — o tipo parseado expõe SÓ
  `commissions`) calcula SÓ em `computeEntry` via
  `resolveCommissionTiers(bloco)`/`selectCommissionTier`: o gatilho EFETIVO
  (atingimento %, ou realizado ABSOLUTO com `tierBy:"realized"`) escolhe a
  faixa (maior `fromPct` satisfeito vence, `>=`; nenhuma ⇒ 0, nunca
  fabricar) e o payout segue o `kind` — `pct` (% sobre base variável ou
  realizado EFETIVO de um fator), `flat` (R$ fixo da faixa) ou `per_unit`
  (R$ × realizado do fator-base; EXIGE basisKind "factor"); faixas são
  LOOKUP (a vencedora aplica à base inteira), nunca brackets marginais.
  `memberTiers[respId CANÔNICO]` substitui a tabela do bloco INTEIRA (config
  durável; órfão preservado e nunca selecionado). Os blocos SOMAM;
  `overrides.commission` segue override da SOMA (blocos exibem o calculado);
  breakdown por bloco em `commissionBlocks` e o agregado `commission` mantém
  o shape antigo (espelho intocado). **Memória de cálculo (01/08/2026):**
  `commissionBlocks` carrega também `basis`/`basisLabel`/`basisMoney`/
  `triggerLabel`/`triggerMoney`/`memberTiersApplied` — DERIVADOS na leitura
  (`computed` segue snapshot cru; nada persiste); os rótulos pt-BR saem SÓ de
  `commissionMemory` (`lib/comp/commission-label.ts` — helper único da grade
  E da my-comp-view, dono dos formatadores `fmtMoneyBRL`/`fmtNumBR`; nunca
  duplique o texto em componente). Na grade, a célula Comissão tem POPOVER
  clicável de memória (ícone próprio no display — o override por duplo-clique
  segue no resto da célula; com override da soma o popover exibe nota
  calculado × manual) e o Valor de fator com peso 0 sem override exibe "—"
  (display-only — a coluna NUNCA some: base/valor seguem alimentando
  `basisKind:"base"`, `totalFormula` e overrides). **Memória inline + Visão
  geral (01/08/2026):** a grade tem linha de DETALHE sempre visível sob cada
  membro — textos SÓ de `entryMemoryLines`/`factorPayoutFormula` (mesmo
  módulo commission-label; colSpan = contagem de colunas do header, PINADA em
  `comp-grid.test`). Landing do ADMIN sem `?plano` = aba `geral` ("Visão
  geral": pill PRIMEIRA do tablist) — a AUSÊNCIA do plano na URL decide, sem
  valor de query próprio; `?aba=plano` vence; 0 planos força o editor; o
  `navigate` do manager omite plano/aba nesse caso (invariante no único
  construtor de URL). A Visão geral é SOMENTE leitura, 100% client-derived
  pelo MESMO `computeEntry` (totais da derivação, nunca `entry.total`) sobre
  todos os planos ATIVOS; os dados (entries com `plan_id` numa query +
  targets/rates POR plano) carregam SÓ nessa aba (padrão editorCatalog; gate
  SIMÉTRICO — na geral as queries do plano selecionado não rodam); card único
  `comp-plan-card.tsx` (extraído da my-comp-view; `title` opcional;
  ApuracaoBadge mora LÁ — importá-lo do manager criaria ciclo); agrupamento
  por plano/por pessoa com preferência do usuário em localStorage
  `comp-overview:group` (chrome de UI, nunca dado). **Export CSV/PDF
  (02/08/2026):** Visão geral e my-comp-view exportam 100% client-derived —
  CSV pelo builder puro `lib/export/comp.ts` via o MESMO `computeEntry`
  (nunca `entry.total`; rótulos de memória SÓ de `commission-label.ts`;
  convenções de `lib/export/csv.ts`) e "PDF" = impressão do navegador via
  portal `[data-print-root]` (`comp-report-print.tsx` + `@media print` de
  `globals.css`, flag `body[data-printing="comp"]`) — nenhuma action/RPC
  nova. **Export p/ Google Planilhas (0115):** Web App do Apps Script
  "executar como usuário que acessa" grava a planilha no Drive do PRÓPRIO
  usuário (sem credencial Google no app); handshake por TICKET single-use
  (`comp_sheet_export_tickets` — token sha256 at rest, TTL 15 min, GET
  consome/POST completa, 404 uniforme em `/api/sheets-export/[token]`;
  tabela SEM policies — service role only, org carimbada na action) +
  vínculo durável `comp_sheet_links` (RLS linha-própria; upsert da rota usa
  org/user/escopo DA LINHA do ticket, nunca do corpo); payload
  client-derived → Drive do próprio usuário (tradeoff aceito); URL do Web
  App por org em `sync_config` 'comp_sheets_webapp'
  (`lib/comp/sheets-export.ts`); NUNCA policy anon. **Payload v2 =
  DEMONSTRATIVO por COLABORADOR (02/08/2026):** o grid nasce de
  `compSheetReport` (`lib/export/comp-sheet.ts` — 7 colunas fixas, números
  crus, título em `headers`), SEM quadro-resumo no topo: uma seção por
  pessoa (`section` = nome 1×, total consolidado na col F + composição
  `sheetSummaryNote` na col G), sub-cabeçalho `planHeader` por plano e fecho
  `memberTotal` ("Total — <nome>"); desde 16/08/2026 o fecho é SEMPRE emitido
  (é ele que marca o FIM do bloco no `.gs`) e, com um ÚNICO plano, ele
  SUBSTITUI o `blockTotal` daquele plano (herdando o `sheetTotalNote`) — nunca
  duas linhas "Total" idênticas; 2 linhas `blank` (era 1) abrem cada bloco.
  o ramo do
  escopo "minha" SAIU do builder junto com o botão da tela do vendedor (o
  valor segue no contrato/constraint por causa de `comp_sheet_links` já
  gravados). **Payload v3.4 = LEITURA PARA LEIGOS E PARA O RH (27/08/2026):**
  a planilha tem DOIS públicos com necessidades opostas (o colaborador quer
  "quanto e por quê"; o RH quer "quem recebe quanto e se é final") e o layout
  por pessoa atendia só o primeiro. Entram, ANTES dos cards e sem tocá-los:
  bloco `meta` (competência, mês APURADO derivado de `apuracaoRef` — a
  diferença entre mês de pagamento e mês de desempenho era invisível na
  planilha; situação publicado/prévia de `comp_entries.published_at`, status
  MISTO dito por extenso; data de geração) e RESUMO da folha
  (`rosterHeader`/`rosterRow`/`rosterTotal`, uma linha por pessoa com link p/
  a aba `Det-<Nome>`), que SUBSTITUIU o rodapé `summaryTotal` (kind mantido na
  whitelist só p/ ticket antigo em trânsito — o builder não o emite mais); e,
  no FIM, a LEGENDA das colunas (`legendHeader`/`legend`, definição na coluna
  de prosa — texto longo numa coluna do meio alargaria a planilha inteira).
  Peso 0 sem override emite "—" (célula vazia lia-se como dado faltando). A
  consolidação por pessoa é UM cálculo (`summaries`) compartilhado pelo
  resumo, pelo cabeçalho do card e pelo fecho. O que não
  participa é OMITIDO: rótulo "Peso" some do `detailHeader` quando nenhum
  fator tem peso, e a linha "Base variável" só entra quando a base participa
  — comissão `flat` sobre a base NÃO conta (computeEntry ignora o basis) e
  `totalFormula` com `comp:base` CONTA (helper `baseParticipates` do
  builder; o CSV mantém a linha incondicional). `kinds` paralelo às rows
  (whitelist `COMP_SHEET_KINDS` em `lib/comp/sheets-export.ts`, validada no
  `validateReportPayload`; `summaryHeader`/`summary`/`note` reservados — não
  emitidos); o `.gs` (v3.0) formata POR KIND (moeda/%/bold/fundos/larguras
  fixas + borda e altura que ABREM em `section` e FECHAM em `memberTotal`,
  SEM merge — `clear()` não desfaz merge; larguras próprias nas abas de
  detalhe) e escreve em DUAS PASSADAS (cria/limpa todas as abas p/ colher os
  `gid`, depois preenche com os hiperlinks resolvidos), com degradação
  bidirecional (script v2.1 × payload v3 = só a aba do mês, sem links nem
  detalhe; script v3 × ticket v2 = comportamento anterior). LARGURA de coluna
  (v3.4): `autoResizeColumns` ajusta ao conteúdo, mas com TETO
  (`LARGURA_MAX_`) — a coluna de prosa cresceria centenas de px e jogaria o
  resto para fora da tela; quem estoura é fixada no teto e ganha `setWrap`. ACABAMENTO
  (v3.5): linhas de grade do Sheets DESLIGADAS (`setHiddenGridlines`) — a
  grade nativa risca a planilha inteira, inclusive o vazio entre cards, e
  compete com as bordas desenhadas; as tabelas de registros do detalhe
  ganham divisórias VERTICAIS (a horizontal segue só sob o cabeçalho); e a
  coluna "Quanto gerou (R$)" entra em `MOEDA_POR_KIND_` nas DUAS variantes
  de linha (`detailRow` e `detailRowMoney`) — ela é sempre reais, mesmo em
  fator de contagem, e saía como número comum.
  **VOCABULÁRIO (27/08/2026):** TODA frase visível dos três exports sai de
  `commission-label.ts` (dono ÚNICO — `sheetFactorNote`/`sheetTotalNote`/
  `sheetSummaryNote`/`SHEET_*`/`detail*`) no registro de QUEM LÊ, não de quem
  modelou: "fator" → "indicador", "alvo" → "meta" (a frase-muleta "Alvos são
  metas" saiu da grade), "gatilho" → "o que define a faixa",
  "recorte"/"operando" → linguagem comum, e ⇒/≥/≠ viraram palavras. O CSV
  DEIXOU de ser byte-idêntico (v1.3, pino atualizado de propósito): ele é lido
  pelas mesmas pessoas e agora consome as frases `sheet*` — a ORDEM e a
  quantidade de colunas seguem pinadas. O PDF idem (o `entryMemoryLines` saiu
  do `comp-report-print`: quem renderiza a memória agora é o próprio
  `CompPlanCard`, em tela — antes o colaborador só a via se imprimisse) e
  ganhou a legenda impressa. Pinado em `comp-sheet.test.ts`/`comp.test.ts`/
  `commission-label.test.ts`.
  **DETALHAMENTO por registro — tela e planilha do MESMO núcleo (16/08/2026):**
  `lib/comp/detail.ts` é o dono ÚNICO de "quais registros compõem este membro ×
  fator × mês", consumido pelo painel de conferência da tela
  (`comp-detail-panel.tsx` + `detail-actions.ts`, gate admin) E pelas abas
  `Det-<Nome>` do export (`lib/export/comp-detail-sheet.ts`) — nunca monte um
  segundo caminho. A listagem é **EVIDÊNCIA**: o realizado por membro×fator
  continua saindo SÓ de `runCalculatedWidget` (via `computeEntry`/
  `statementBreakdown`) e é exibido AO LADO da soma das linhas (confronto
  NUMÉRICO, sem frase); jamais derive o realizado da lista. O recorte sai do
  choke point `factorRecordQuery` (espelha o engine: `apuracaoRef`→
  `monthPeriod`, `factor.filters` e DEPOIS `memberFilterFor` — helper
  IMPORTADO de `engine.ts`) e a consulta é `runRecordListWindow`; a coluna de
  valor vem dos operandos `agg:` da fórmula (`parseAggRef`; contagem não vira
  coluna) e `listedSum` só existe para soma/contagem — média/mín/máx não somam.
  **O recorte é por OPERANDO, nunca por fator (16/08/2026):** o realizado não
  sai de UMA consulta — `runCalculatedWidget` decompõe a fórmula e dispara uma
  por recorte. `factorOperands` repete a MESMA sequência do choke point
  (`expandAggFormula` → `lowerSourceScopedOperands` → `basisKeysFor` →
  `basisMetric`/`parseCondBasisKey`) e `operandRecordQuery` monta o recorte de
  cada operando: universo `factor.sources ∪ formulaScopedSources` (operando com
  escopo roda SÓ na fonte dele, com a coluna de data DELA via
  `scopedAuxPeriod`), filtros `factor.filters` → membro → `condFilters` do
  SOMASE/escopo → **campo preenchido**. Esse último vem do SQL da RPC
  (`sum(nullif(campo,'')::numeric)`, `count(nullif(campo,''))`): campo vazio
  NÃO contribui, e listá-lo enchia a tela de linhas R$ 0,00; `count(*)` não
  filtra nada. Chaves de basis do mesmo recorte colapsam num operando
  (MÉDIA emite sum+count). Um bloco por operando, com subtotal próprio.
  **A conferência só compara quando há um número único a confrontar**
  (`listedForCompare`: fórmula de um operando puro ⇒ Σ para soma, contagem do
  recorte para contagem) — fórmula combinada (ou com fusão da engrenagem em
  jogo) simplesmente não exibe o confronto, em vez de acusar divergência
  inexistente. Divergência ESTRUTURAL segue como
  aviso visível: filtro em campo fora da whitelist do modo lista
  (`listFilterFieldSupported`, exportado de `record-list.ts` ao lado do
  `filterColumn` que o descarta) e operando que agrega `unified:`/`match:`
  (sem Σ, `DETAIL_UNSUPPORTED_FIELD_NOTE`). Consulta sempre pelo client RLS do
  usuário — NUNCA service role. **Quem participa do plano é o membro CONFIGURADO,
  nunca a presença de lançamento (29/08/2026):** estreitar `memberIds` NÃO
  apaga os `comp_entries` já gravados, então enumerar por entry fazia quem
  saiu do plano levar os indicadores dele para a própria aba `Det-<Nome>` —
  enquanto a Visão geral, que filtra por `explicitMemberIds`, já não o
  mostrava. `DetailPlan.memberIds` (operações resolvidas VIVAS, como no
  recompute; null = todos os ativos) + o gate ÚNICO `planAppliesToMember`
  nas duas passadas do `loadCompDetail`. As duas metades do export têm de
  concordar sobre quem está no plano. **Payload v3:** `details` (uma
  `CompSheetPayloadSheet` por colaborador) + `links` paralelo às rows (nome da
  aba alvo; o `gid` só existe no Apps Script — a fórmula `=HYPERLINK("#gid=…")`
  é montada LÁ). O nome da aba sai de `detailTabName` (PURO — o cliente calcula
  os mesmos nomes do servidor); a action monta o detalhe server-side (os
  registros não existem no cliente), ANULA link sem aba correspondente e
  degrada BEST-EFFORT (falha/teto ⇒ planilha sai só com o demonstrativo +
  aviso). Abas `Det-*` órfãs são APAGADAS pelo script a cada export (só com
  payload v3). Frases do detalhe em `commission-label.ts` com prefixo
  `detail*`/`DETAIL_*` (compartilhadas pelos dois consumidores — não `sheet*`). **BÔNUS na aba de detalhe (28/08/2026):** `CompDetailPlan.bonuses` sai do
  MESMO `derived` que alimenta o `monthTotal` (`inputs.bonuses`, sem consulta
  nova) e vira linha com o kind `bonus` JÁ existente (não exige republicar o
  `.gs`). Sem ela a aba fechava com um "Total" que incluía um valor ausente
  dela inteira — no documento onde se vai justamente conferir. Rótulo único
  em `bonusRowLabel` (commission-label), compartilhado com a aba do mês.
  Kind novo exige entrada em `COMP_SHEET_KINDS` **e** nas tabelas de estilo do
  `.gs` **e** republicar o script.
  **MEMÓRIA DE CÁLCULO no lugar da prosa + agrupamento configurável
  (17/08/2026):** a aritmética "registro → dinheiro" vive no módulo PURO
  `lib/comp/payout-math.ts` (`commissionRolesOf` = blocos que o fator dispara
  e/ou embasa; `tierLadder` = escada COMPLETA com a aplicada marcada e as NÃO
  alcançadas visíveis — é ela que explica o valor pago; `unitValue`/
  `resolvedUnitValue` = quanto UMA unidade vale, derivado de
  `resolveCommissionTiers`/`selectCommissionTier` e do breakdown, NUNCA
  recalculando comissão por fora do `computeEntry`). `unitValue` devolve null
  quando a relação não é linear (cap/piso ATIVO, valor manual, sem alvo, fator
  só-gatilho, comissão `flat`) — número ali seria mentira. Isso alimenta a
  coluna "Vale (R$)" por registro, a Descrição da linha em bloco fundido
  (`detailRowPartsNote` sobre `CompDetailRecordRow.parts` — parcela ZERO fora),
  a conta do
  payout (`factorPayoutFormula`) no cabeçalho e a escada — que com
  `tierBy:"attainment"` declara a META do gatilho (`detailTargetNote` + o
  absoluto por degrau em `detailTierLabel`, vindos do breakdown do fator-gatilho
  via `commissionDetail`; sem alvo apurado segue só o percentual, nunca um
  absoluto inventado); a comissão aparece
  UMA vez, no fator que a DISPARA (`role.isTrigger`) — o fator que é só BASE não
  repete a escada, e o bloco de nível de plano virou FALLBACK (só o que nenhum
  fator exibiu): saía 3× quando gatilho e base eram fatores distintos. Saíram
  `detailReconcileNote`/`DETAIL_COMBINED_NOTE` (a conferência virou
  realizado × somado lado a lado + `DETAIL_DIVERGE_MARK`); frases novas seguem
  SÓ em `commission-label.ts`. O **agrupamento dos blocos** é config POR PLANO
  (`config.detailGrouping.byFactor[factorId] = { into, folded }`: `into` é o
  bloco PRINCIPAL que RECEBE, `folded` são as basis keys somadas nele, o resto
  mantém bloco próprio; ausente = cada operando separado, o padrão), aplicada em
  `groupOperands`/`mergeOperandBlocks` DEPOIS da consulta — é APRESENTAÇÃO: o
  recorte de cada operando segue consultado igual, e bloco fundido perde o
  confronto (`listedForCompare` null). O bloco fundido herda rótulo/coluna do
  PRINCIPAL e marca `mergedFrom` (consumidor NUNCA detecta fusão comparando o
  rótulo); Σ só vira número único com as partes na MESMA unidade — soma com
  contagem expõe `sumParts` em vez de um total sem significado. As linhas
  COLAPSAM por registro (`collapseRowsByRecord`): os operandos consultam os
  MESMOS registros mudando só o campo, então concatenar repetia a empresa uma
  vez por operando — valor/contribuição viram a SOMA das partes, `total` conta
  DISTINTOS (exceto truncado, onde o distinto do recorte é desconhecido) e a
  coluna "Operando" deu lugar a "Descrição" (a composição da linha, já que a
  coluna de valor mostra o rótulo do PRINCIPAL e o dinheiro pode vir de outro
  campo). Operando
  SEM registros não vira bloco: `loadFactorRecords` o descarta e sobe os
  `warnings` dele para o fator; com todos vazios, `operands` fica `[]` e os
  consumidores declaram o vazio UMA vez (nada de "· 0 registros" por soma). Entrada com
  `folded` vazio é DESCARTADA no parse e no save: foi a lista vazia lida como
  "sem config" que deixou a 1ª versão (`separateByFactor`, só-leitura hoje —
  convertida em `resolveFactorGrouping`, que tem a lista de operandos) INERTE
  num fator de 2 operandos. A cláusula do parse é LENIENTE (sujeira/
  fator órfão somem, o config vive) e o `save()` do plan-editor RE-EMITE a
  chave — sem isso a config sumiria no 1º save (regra do presetKey). A UI é a
  engrenagem do `CompPlanCard` (prop OPCIONAL `onOpenGrouping` — ausente na
  visão do vendedor) → `comp-grouping-dialog.tsx` (rádio do principal +
  checkbox "somar no principal"), com as chaves vindas do
  servidor pelo MESMO `factorOperands` (`loadPlanOperands`), nunca adivinhadas. NUNCA gerar fórmula a
  partir das faixas;
  com `totalFormula` a comissão só entra via ref `comp:comissao` (sem soma
  automática; operando existe SÓ com blocos presentes). Todo call site de
  `computeEntry` passa `responsible_id` como `memberId`; espelho ganha
  `rem_comissao` (vazio sem comissão). **Condições do recorte por fator
  (01/08/2026):** `factor.filters` (WidgetFilter[]) tem UI no plan-editor
  ("Condições do recorte") e entra ANTES do filtro de membro na MESMA
  consulta (pipeline completo — nome→id/canon/tokens de data); parse
  restrito aos 10 ops de `FILTER_OPS` (nunca lista paralela; internos
  `eq_ci`/`*_num` rejeitados), `in` vira array, `sources` por-filtro é
  descartado (o universo é `factor.sources`), teto `MAX_FACTOR_FILTERS` e
  `operation_id` proibido no savePlan (coluna derivada — fora da tradução
  viva de operação); o save RE-EMITE os filtros (regra do presetKey — sem
  isso o round-trip os destruiria) e fator de peso 0 com recorte próprio
  serve de gatilho dedicado de comissão. **Validação por fator no save
  (02/08/2026):** o `save()` do plan-editor valida nome/peso/fórmula de CADA
  fator com mensagem própria ANTES de montar o config (peso 0 é válido e o
  texto diz isso; o sentinel -1 saiu) — o parse fail-closed do servidor segue
  como muralha, nunca como UX; e o savePlan rejeita campo de membro que não
  existe em NENHUMA fonte EFETIVA do fator (sources ∪ fontes dos operandos da
  fórmula) via `memberFieldSourceError` (`lib/comp/member-field.ts` — helper
  puro sobre `formulaSourceKeys` de `lib/widgets/fields.ts`, o MESMO coletor
  do `source` efetivo; campo de OUTRA fonte salvava e computava 0 em
  silêncio; presente em ALGUMA fonte passa — perna sem o campo não credita,
  design aceito). **Match de membro por campo, alvo
  padrão e alvo em moeda (31/07/2026):** `factor.memberField`
  (ex. `custom:sdr_reuniao`) troca o filtro injetado por
  `<campo> in (display_names do grupo canônico)` via `memberFilterFor`
  (engine — expansão por CONJUNTO DE NOMES, apelidos/inativos inclusos;
  `expandResponsibleFilters` segue SÓ p/ responsible_id, intocado; membro sem
  nome ⇒ `errors[fid]`, nunca consulta sem filtro). **CRÉDITO DE EQUIPE (28/08/2026):**
  `factor.memberTeams` (id CANÔNICO do líder → ids dos liderados) faz o
  `memberFilterFor` somar a equipe ao próprio membro — com `memberField` o
  CONJUNTO DE NOMES cresce, sem ele o filtro vira `responsible_id in [...]`
  (o choke point já expande `in` pelo canon). SEM equipe o ramo clássico
  devolve o MESMO `eq` de antes, BYTE-IDÊNTICO — nenhum plano existente
  muda; é a invariante que o teste pina. Serve à remuneração de LÍDER,
  cujas oportunidades ficam em nome do time; sobreposição entre líderes é
  INTENCIONAL (cada um é medido pela própria equipe). O detalhamento avisa
  de quem são os registros de terceiros (`detailTeamNote`), e o save do
  plan-editor RE-EMITE `memberTeams` (regra do presetKey — sem isso o
  round-trip apagaria a equipe no 1º save). `factor.defaultTarget` é
  alvo FALLBACK de leitura (meta "por sub-operação"): linha de `goals` vence;
  limpar a célula segue DELETANDO a linha (restaura o padrão); nunca vira
  linha de goals. `factor.targetCurrency` = moeda em que o alvo é DIGITADO —
  convertido a BRL NA LEITURA pelos `targetRates` resolvidos nos CALLERS
  (`resolveTargetRates`/`loadTargetRatesForConfig`, trimestre do fim do mês;
  computeEntry segue puro); taxa ausente ⇒ atingimento null +
  `targetRateMissing`, NUNCA 1:1. `config.presetKey` (identidade de plano
  criado por preset) é parseado explicitamente e o SAVE do plan-editor o
  RE-EMITE — sem isso o re-apply do preset duplicaria o plano. O espelho
  "Publicar"
  (`lib/comp/mirror.ts`) escreve SÓ por `createRecord`/`updateRecord` com o
  client RLS do admin (invariante 25), base manual `remuneracao` (ponteiro em
  `sync_config` 'remuneracao_mirror'), `closed_at` = último dia do mês
  `YYYY-MM-DD` (coerceCore ancora — invariante 11), dedup por
  `comp_entries.mirror_record_id` (NUNCA `source_id`). RLS: `comp_entries`
  select = admin OU `auth_responsible_ids()` (vendedor vê só o próprio grupo)
  — NUNCA afrouxar para org-wide; escrita admin-only; `comp_plans` select
  org-wide (só o desenho). Área `remuneracao` SEM gate de papel (a page
  ramifica admin/vendedor) — mas é RECURSO SOB DEMANDA por org
  (`org_features` 0114, feature "remuneracao"; parse fail-closed em
  `lib/config/org-features.ts`): feature-off vence TUDO — inclusive override
  allow — em `requireSettingsArea`/`checkSettingsArea`/`isSettingsAreaDenied`
  (`AREA_FEATURES`, lib/auth/access.ts), esconde o card/sub-aba de Operação e
  a linha da matriz de Acessos e
  barra/pula o preset (`PresetDashboard.requiresFeature` na lista, no
  `applyPreset` e no `generatePresets`). Habilitação SÓ pelo console `/owner`
  (escrita de org_features é service-role-only — org_admin NUNCA se
  auto-habilita); desligar nunca apaga/esconde DADOS (RLS da 0112 intocada).
  **Desde 05/08/2026 a página vive em `/operacao/remuneracao`** (ex-aba de
  Configurações; chave de área histórica intocada): sub-aba da área Operação
  e CARD DE OPERAÇÃO do hub Workspace (aba "Operação" de `/`, `?aba=`) —
  cards de Operação são catálogo em CÓDIGO (`lib/operacao/cards.ts`), nunca
  linhas de `dashboards`, sem menu "⋮"/UI de exclusão (só o banco remove);
  Agenda/Tarefas são os cards PADRÃO (ex-itens do nav lateral; páginas em
  `/operacao/agenda|tarefas`, rotas antigas = stubs de redirect); card
  org-específico novo = entrada no catálogo + chave em
  `ORG_FEATURES`/`AREA_GATES`/`AREA_FEATURES`, habilitado só via `/owner`.
  Fiscalizado por `lib/comp/*.test.ts` (incl. `detail.test.ts` e
  `payout-math.test.ts`) +
  `lib/export/comp-detail-sheet.test.ts` + `tests/apps-script-sheets.test.ts`
  (o `.gs` avaliado num `vm` com stubs do SpreadsheetApp — abas, hiperlinks
  por `gid`, limpeza de órfãs e as duas degradações) +
  `lib/metas/upsert.test.ts` + `lib/config/org-features.test.ts`. **Validação
  do save EXTRAÍDA (08/09/2026):** as checagens do `savePlan` (rótulos únicos,
  bounds de peso/faixa, `sources`, `memberField`, `operation_id` proibido nos
  `filters`, fórmula, moeda, sentinela `metricKey: "__auto__"`) vivem em
  `lib/comp/plan-validate.ts` (`validateCompPlanSave`) — o `savePlan` o chama
  e segue sendo a MURALHA. Consumidor novo (prévia de IA) usa o MESMO módulo:
  repetir as checagens é a régua paralela que a invariante 25 proíbe, e o
  parse cru só sabe dizer "Configuração do plano inválida". Bounds são
  constantes EXPORTADAS de lá (o SPEC da IA os deriva). Ver
  `docs/arquitetura.md` §4.18 e invariante 26.
- **Alocação do kanban como campo é ESPELHO derivado (28/07/2026):** o toggle
  "Expor a fase como campo do registro" (só Personalizar) cria um
  `field_definitions` local ("Fase — <nome>", `selecao`) e guarda a chave em
  `settings.kanban.allocationFieldKey`; o valor (RÓTULO da coluna atual; sem
  posição = 1ª coluna) vira `custom:<key>` filtrável em todo lugar SEM tocar
  nas RPCs. `kanban_placements` segue sendo a VERDADE — escrita só pelos choke
  points (`lib/kanban/allocation-field.ts`/`allocation-reconcile.ts`:
  dual-write nos 3 escritores de placement + reconcile no enable/saves/
  pós-sync/tick), sempre service-role com org EXPLÍCITA, carimbos
  `field_modified_at`+`locally_modified_at`, SEM audit/webhook; mock nunca
  recebe escrita. A chave pode viver em `settings.kanban` (diferente das
  automações) SÓ porque o widget-builder a RE-EMITE no branch `isCustomCols` —
  mantenha isso ao mexer no builder — e `createWidget`/`duplicateBoard`/troca
  de base fazem STRIP (`normalizeKanbanAllocationOnSave`): cópia com a chave
  escreveria no campo do quadro ORIGINAL. Campo excluído em /campos
  auto-desliga o vínculo; desligar/excluir mantém campo e valores. Fiscalizado
  por `lib/kanban/allocation-field.test.ts`. Ver `docs/arquitetura.md` §4.16 e
  invariante 24.
- **Mapeamentos de valores (de-para 0117) são ESPELHO derivado, escritos SÓ
  pela rotina única (07/08/2026):** `value_mappings` guarda o de-para (lookup
  por `raw_norm = lower(trim())`; unicidade org+domínio+raw_norm) e os
  DOMÍNIOS vivem em código (`lib/mappings/domains.ts` — cargo →
  `cargo_area`/`cargo_nivel`; segmento → `segmento_classificado`; base
  Meetime). A aplicação é SÓ por `applyValueMappings` (`lib/mappings/apply.ts`
  — service role com org EXPLÍCITA, só DIFERENÇAS, carimbos
  `field_modified_at`+`locally_modified_at`, SEM audit/webhook, mock fora, UM
  `recalcFormulaFieldsForRecords`); NUNCA resolva o de-para em RPC/SQL de
  consulta (widgets leem o campo materializado) nem edite os campos alvo à
  mão. Valor sem entrada = fallback "Não Classificado" + pendência; pendências
  viram UMA tarefa aberta por domínio em nome do org_admin
  (`lib/mappings/notify.ts` — atualizada in-place, auto-completa em zero,
  webhooks `task.*` manuais). Hooks: caudas do import CSV
  (`finalizeCsvImport(recordType)`) e de `/api/ingest` via
  `maybeApplyMappingsAfterImport` (best-effort, nunca lança). UI = card de
  Operação org-específico `/operacao/mapeamentos` (feature `mapeamentos` +
  área `mapeamentos`, gate admin). Seed dos CSVs legados em
  `supabase/apply/seed-value-mappings.sql` (`on conflict do nothing`). O
  preset "Outbound — Pré-Vendas" (`lib/presets/outbound.ts`) consome os
  campos derivados (aba Perfil) e porta as regras jul/2026+ do dashboard
  legado (subs `ob_rr`/`ob_rq`/`ob_noshow` sobre leads `custom:fonte="Outro"`
  por Data Reunião ≥ 2026-07-01; esforço sobre `meetime_outbound`; meta
  `rq_outbound`). **Classificação automática + IA (07/08/2026):** o registry
  tem `options` (categorias canônicas por target) e `suggest` por domínio
  (port FIEL do classificador V5 do Apps Script —
  `lib/mappings/classify/{cargo,segmento}.ts`; paridade pinada em
  `classify.test.ts`) COMPOSTO com o motor APRENDIDO genérico
  (`classify/learned.ts` — banco de palavras das próprias entradas, votos
  por pureza com thresholds conservadores; `composeSuggester` = específico
  primeiro, aprendido como fallback e ÚNICO motor de domínio novo sem
  código — retroalimentação pinada em `learned.test.ts`): na aplicação,
  valor sem entrada classificável vira entrada `origin='auto'` (0118 —
  upsert `ignoreDuplicates`, NUNCA sobrescreve manual/seed/IA) e a
  pendência fica só com o resto. Resposta de IA externa COLADA aceita
  também CSV (`lib/import/mappings/csv.ts` — converte ao MESMO contrato
  antes do validador; nunca duplique regra lá). O assistente
  "Classificar com IA" segue o padrão §4.17 (contrato `mapeamentos-classify`
  v1 em `lib/import/mappings/*` — valor restrito aos PENDENTES, categoria
  restrita às aceitas do registry, SPEC derivado + `instructions.test.ts`;
  core `lib/ai/classify-mappings.ts` com apply que RE-VALIDA e grava
  `origin='ai'` pelos mesmos upserts; prévia EDITÁVEL + copiar-prompt/
  colar-JSON sem IA configurada). Categorias canônicas SÓ no registry
  (`domain.options`) — nunca lista paralela em validador/UI.
  **Domínios DINÂMICOS (0119, 07/08/2026):** a tabela `mapping_domains`
  guarda domínios criados pela aba **Campos → Reclassificações** (CRUD em
  `app/(app)/campos/reclassificacoes-actions.ts` — gate admin + área
  `mapeamentos`; key IMUTÁVEL na edição e = `value_mappings.domain`, passa no
  MESMO check de slug da 0117; excluir remove as entradas mas PRESERVA campos
  alvo e valores gravados). O registry EFETIVO é SEMPRE
  `loadMappingDomains(db, orgId)` (`lib/mappings/registry.ts` — código ∪
  banco, parse FAIL-CLOSED por linha, colisão de key: código VENCE; org
  explícita mesmo com service role) — consumidor novo NUNCA itera
  `MAPPING_DOMAINS` direto p/ resolver domínios de uma org
  (`messages.ts`/`notify.ts` recebem rótulos/domínios por parâmetro).
  Domínio dinâmico não tem classificador codificado — o motor aprendido é o
  único sugestor. Export por domínio em `lib/mappings/export.ts` (CSV =
  template das pendências byte-compatível com `csvToClassifyJson`; JSON =
  dump de trabalho). Fiscalizado por
  `lib/mappings/domains.test.ts` + `lib/mappings/registry.test.ts` +
  `lib/mappings/export.test.ts` + `lib/mappings/classify/classify.test.ts` +
  `lib/import/mappings/instructions.test.ts` + `lib/presets/outbound.test.ts`.
  Ver `docs/arquitetura.md` §4.19 e invariante 28.
- **Dimensão condicional (`Dimension.caseFormula`) se resolve no ENGINE,
  nunca no RPC (07/08/2026):** expressão SE/E/OU (avaliador único de
  `lib/records/formulas`) que reclassifica os valores da dim em rótulos e
  agrupa por eles — versão ad-hoc/de exibição do de-para (nada é gravado em
  registro). Gates/avaliação/plano SÓ em `lib/widgets/case-dim.ts` (engine,
  bucket-merge, UI do builder e validador de import derivam de lá): refs SÓ
  do próprio campo ⇒ fold valor→rótulo no `mergeRowsByBucket` (caseIdx);
  refs de MAIS campos ⇒ `planCaseExpansion` troca o payload de dims de TODOS
  os RPCs da rodada pelas dims CRUAS expandidas e `contractCaseRows` contrai
  client-side ANTES do merge — os laços de tupla (bdMap/pernas/
  condValueByKey) iteram por `rpcDims.length`, não pelas dims da config.
  Mutuamente exclusiva com transform/dateAgg (presentes ⇒ INERTE, nunca
  meio-aplicada); proibida em campo/refs de data/relação; SE sem "senão"
  preserva o cru; fora do escopo: modo lista, kanban. Import da IA:
  `case_formula_text` (texto) OU tokens (round-trip do export);
  incompatibilidade remove com AVISO (padrão closedWeek; ponto MANUAL do
  SPEC — chave de DIMENSÃO, fora de settings-docs). A UI (DimensionRow)
  limpa a expressão ao trocar campo/formato e só persiste fórmula válida.
  NÃO recrie `run_widget_query`/`_snapshot` p/ agrupamento condicional.
  Fiscalizado por `lib/widgets/case-dim.test.ts` + blocos em
  `engine.test.ts`/`validate.test.ts`. Ver `docs/arquitetura.md` §4.20 e
  invariante 29.
- **Save fora de formulário é OTIMISTA em background — nunca no transition
  global nem com revalidate dentro do await (07/08/2026):** o padrão único é
  `useBackgroundSave` (`lib/feedback/use-background-save.ts`): estado otimista
  ANTES do await → action com `{ revalidate: false }` (opt-out por parâmetro,
  padrão `createWidget`) → erro = toast (`notifyOnError`) + `revert()` granular
  → sucesso agenda UM `router.refresh()` debounced, o reconciliador ÚNICO
  (realtime NÃO cobre `dashboard_table_cells`/`widgets`/`entity_custom_values`/
  remuneração). Pending GRANULAR por controle (`pendingKeys`/`busyKey` por
  linha), nunca por tela. O `useNavPending().run()` do dashboard é EXCLUSIVO
  de navegação real (período/URL; overlay agora `pointer-events-none`) — NÃO
  reintroduza save de widget nele (`__qf__`/`__ff__`/`__pw__`/Nota/Aparência
  já migraram). Guard anti-eco no padrão seedKey: com save em voo
  (`hasPending`) o reseed ADOTA a key sem aplicar (eco stale nunca clobbera o
  otimista; espelho do `skipNextData` do kanban); mudança de ESCOPO (mês/plano
  no comp-grid) re-semeia SEMPRE. **O refresh de reconciliação é de MÓDULO e
  SOBREVIVE ao desmonte de quem o agendou (04/09/2026)** — a troca de aba do
  dashboard desmonta os widgets da aba anterior, e o timer por controle fazia a
  gravação acontecer sem a página nunca reconciliar; só o PATHNAME cancela (a
  aba mexe na query). Consequência OBRIGATÓRIA: todo controle com debounce
  PRÓPRIO dentro de um card FLUSHA o payload pendente no desmonte (`pendingRef`
  + effect mount-only) — sem isso a gravação morre com o timer —, o flush
  dispara só o que o USUÁRIO causou e é idempotente (o StrictMode do dev roda
  esse cleanup na montagem), a URL do flush sai de `window.location` (nunca de
  um `useSearchParams` capturado — apagaria o `?tab=` recém-escrito) e o valor
  otimista que o servidor ainda não ecoou vive em cache de MÓDULO com
  `baseline`, descartado assim que o servidor passa dele. Seguem o padrão:
  `quick-filters-bar`, `field-filter-controls`, `table-filter-bar`,
  `period-range-inputs`, `appearance-editing`, `calculator-widget`.
  CRUDs de Bases não fazem mais
  `revalidatePath("/", "layout")` — os managers disparam o refresh pós-sucesso
  via `useRefreshOnActionOk` (`lib/use-debounced-refresh.ts`), que re-renderiza
  rota + layout como transition não-urgente. Fiscalizado por
  `lib/feedback/use-background-save.test.ts` + `lib/use-debounced-refresh.test.ts`
  + blocos em `comp-grid.test.tsx`/`quick-filters-bar.test.tsx`/
  `field-filter-controls.test.tsx`. Ver `docs/arquitetura.md`
  §4.10 ("Feedback de carregamento").
- **A ORIGEM do refetch decide o feedback — refetch do event bus é SILENCIOSO
  (08/09/2026):** widget deferido re-busca por dois gatilhos que exigem
  feedback OPOSTO: o USUÁRIO mexeu (1ª carga, período, filtro,
  `__qf__`/`__ff__`/`__pw__`, config — o fingerprint de escopo muda) ⇒ dim +
  "Atualizando…" + spinner; o EVENT BUS avisou que um registro mudou
  (`useDataChanged`, alimentado pelo `realtime-refresher`) ⇒ re-busca com os
  dados antigos em tela e **zero feedback visual**. O sync do Bitrix roda a
  cada MINUTO (`pg-cron-tick.sql`), então overlay no gatilho do bus fazia
  TODOS os gráficos piscarem sozinhos para quem só apresentava/analisava — lia
  como defeito do sistema. A distinção sai SEMPRE de
  `useRefetchOrigin(scopeKey)` (`lib/feedback/use-refetch-origin.ts`, chamado
  UMA vez por rodada DENTRO do efeito), nunca de um `useRef` paralelo por
  componente. Consumidor novo deve também: atrasar o disparo de fundo em
  `BUS_REFETCH_DELAY_MS` (o do usuário fica curto), NÃO chamar `setState`
  quando o payload de fundo é idêntico ao que está em tela (ref com o último
  JSON aplicado) e manter VISÍVEL uma rodada do usuário cancelada por um tick
  do bus (`visibleRef` — senão o overlay nunca apaga). Consumidores: lote de
  engine (`dashboard-client`), Tabela Livre, kanban de widget e a agenda (só
  o coalescing). Fiscalizado por `lib/feedback/use-refetch-origin.test.ts` +
  blocos em `kanban-widget.test.tsx`/`quick-table-widget.test.tsx`. Ver
  `docs/arquitetura.md` §4.10 ("Feedback de carregamento").
- **Workflow: clicar leva a uma TELA, e o editor de regra tem dono único
  (09/09/2026):** cada linha da lista leva a `/operacao/workflow/[item]`,
  endereçada pelo id que `buildWorkflowCatalog` JÁ emite com namespace
  (`schema:<uuid>`/`rule:<uuid>`) — não invente chave nova. O editor de regra
  vive em `components/kanban/automation-rule-editor.tsx` e é renderizado pelo
  sheet do quadro E pela tela; ele NÃO sabe onde está (o host passa
  `onSave`/`onCancel` e as listas que dependem de haver quadro), e nunca chama
  `saveAutomation` por conta própria — duas cópias seriam a régua paralela da
  invariante 25. Regra com jsonb inválido NÃO abre o construtor (salvar um
  formulário em branco sobrescreveria o que está gravado). A fileira de filtros
  por tipo virou SEÇÕES da mesma lista (classificação sempre por
  `catalogItemFilter`) e "Nova automação"+"Novo fluxo" viraram um **"Novo
  esquema"** com três respostas; criar NAVEGA para a tela. Isso fechou um furo
  real: automação de BASE (0127) não tem quadro, e "abrir o quadro" era o único
  caminho de edição que existia.
- **Tree: o payload carrega o ESCOPO dele (09/09/2026):** o widget guarda
  `{ scope, data }` e o render só serve o payload cujo escopo
  (`registro|forma|ordem|janela`) é o corrente — é isso que faz a árvore do lead
  anterior sumir no MESMO frame do clique, sem `setState` dentro de efeito (que
  a regra do projeto proíbe). O nome exibido enquanto carrega vem de
  `focus.title`, publicado pela tabela no clique — não espere o payload para
  dizer de quem é a árvore. O carimbo do event bus NÃO entra na chave de
  escopo: é isso que mantém o tick do sync silencioso (§4.10).
- **Workflow: a lista é UMA e o construtor não tem régua própria (09/09/2026):**
  `/operacao/workflow` tem DUAS abas (Esquemas, Execuções); automações e fluxos
  do sistema são LINHAS da lista de Esquemas, com filtro por tipo — unificação
  de TELA, montada por `buildWorkflowCatalog` (`lib/workflow/catalog.ts`, puro,
  quebrado primeiro). NADA foi convertido em `workflow_schemas`: regra segue em
  `automation_rules` (editável dentro do quadro também) e fluxo do sistema segue
  em código. O construtor (`workflow-schema-card` + `workflow-field-editor` +
  `workflow-step-editor`) monta campos e passos, mas NÃO valida: roda o MESMO
  `parseWorkflowDefinition` (puro/client-safe) e só grava quando a definição
  fecha — passo em branco que precisa de alvo (`record.create` sem base,
  `bitrix.entity.update` sem id) fica como RASCUNHO na tela, nunca vai ao
  servidor. `createWorkflowSchema` deriva a `key` do rótulo
  (`workflowKeyFromLabel` + sufixo) e o fluxo nasce DESLIGADO; excluir exigiu
  que `ensureDefaultWorkflowSchemas` semeasse UMA vez por org (marcador
  `workflow_seeded` em `sync_config`) — ensure-if-absent ressuscitaria o
  esquema excluído na visita seguinte. A porta de automação SEM QUADRO (0127)
  vive aqui: escolhe a Base e abre o MESMO `AutomationsSheet` (`owner` agora é
  `AutomationOwner`), com as opções que exigem quadro DESABILITADAS com motivo;
  automação de quadro NÃO ganha segunda porta. Ver `docs/arquitetura.md` §4.23.
- **Workflow (0126): o GATILHO decide a SUPERFÍCIE, e a fábrica não hospeda o
  que produz (08/09/2026):** `workflow_schemas.trigger_kind` (`form` |
  `automacao`) + `show_card`. Gatilho `form` ⇒ página PRÓPRIA em
  `/operacao/f/<chave>` (magra: só o runner — é a URL que se copia e manda ao
  time) + card em Operação; gatilho `automacao` ⇒ NENHUMA tela (é mecanismo).
  `/operacao/workflow` é SÓ a fábrica: não renderiza runner, redireciona
  não-admin e `runWorkflow` RECUSA esquema que não seja `form`. A rota fica sob
  `/operacao/f/` porque a chave é do USUÁRIO e `/operacao/<chave>` deixaria um
  formulário chamado "agenda" sequestrar a Agenda. `allowedOperacaoCards()`
  funde DUAS fontes (módulos em código ∪ formulários com `show_card`) — isso
  amenda a regra antiga "cards de Operação são catálogo em CÓDIGO", mas o
  espírito fica: NENHUM card do hub tem "⋮"/UI de exclusão (criar e excluir é
  só no Workflow), card de formulário herda a área `workflow` (feature-off some
  com os dois) e a key ganha o namespace `form:`. `lib/operacao/form-routes.ts`
  é PURO e client-safe — `cards.ts` importa `checkSettingsArea` e é
  server-only, o manager é client, e a 1ª versão quebrou o build por importar
  de lá (precedente literal de `lib/ai/operacao/scopes.ts`); teste pina a
  ausência de importações. Ver `docs/arquitetura.md` §4.23 e invariante 31.
- **Workflow (0125): esquema é DADO fail-closed e segredo só entra por CHAVE DE
  REGISTRY (08/09/2026):** um esquema (`workflow_schemas.definition`, jsonb
  versionado) é um FORMULÁRIO PLANO + PASSOS que consomem as respostas por
  referência (`{{form.<key>}}`, `{{steps.<id>.id}}`, `{{ctx.<key>}}`). O
  formulário NÃO tem `entity`/`group` no campo — quem preenche vê uma lista
  única, e o destrinchar em entidades (empresa → contato → lead) é dos passos;
  é isso que permite trocar os passos sem tocar no formulário (teste pina a
  ausência das chaves). Refs resolvem em `lib/workflow/refs.ts` por escopo
  FECHADO (form/steps/ctx), SEM `eval`/`Function`; ref desconhecida vira VAZIO
  + warning, NUNCA o template cru dentro do payload externo; passo PULADO
  resolve vazio SEM aviso (é o que faz desligar um passo funcionar). O passo
  guarda a CHAVE de `WORKFLOW_CONNECTIONS` (`lib/workflow/connections.ts`),
  jamais o nome de uma variável de ambiente — nome vindo do jsonb viraria
  `process.env[<dado gravável>]` e vazaria `SUPABASE_SERVICE_ROLE_KEY` para
  quem edita um esquema; a UI expõe `envName` + presença, nunca o valor.
  `parseWorkflowDefinition` é FAIL-CLOSED (conexão fora do registry, tipo de
  passo desconhecido, id duplicado, `linkSourceIdFrom` órfão — que gravaria a
  linha local sem `source_id` e faria o sync DUPLICAR o lead) e o
  `saveWorkflowSchema` REPARSEIA antes de gravar. O executor
  (`lib/workflow/execute.ts`) NÃO faz gate: sessão/área/permissão/responsável
  saem da action (sem `view_all_records` o responsável é FORÇADO ao vínculo do
  próprio usuário, espelhando `records_insert`; o dropdown grava NOME, id nunca
  viaja no form). Sem transação ⇒ resultado POR PASSO em `workflow_runs`,
  gravado inclusive no erro; `partial` é dito a QUALQUER usuário (reenviar às
  cegas duplicaria). O passo `record.create` escreve com o client RLS do
  USUÁRIO pelo ramo 2 de `records_insert` (`source_system='bitrix'` +
  `source_id` + `last_synced_at=null` ⇒ o sync ADOTA, não duplica) e os campos
  calculados saem do choke point único `recalcFormulaFieldsForRecords` — nunca
  uma cópia de `applyCalcFields`. Options de `selecao` vêm do que o sistema JÁ
  computou (`fonte`/`stage` no catálogo, responsáveis ativos principais) — zero
  chamada ao CRM para desenhar dropdown; lista vazia = sync não rodou, e a tela
  diz isso. `SYSTEM_FLOWS` (`lib/workflow/system-schemas.ts`) é DESCRIÇÃO dos
  fluxos existentes (sync, write-back, automações do kanban, de-para,
  auto-match, webhooks, ingestão, snapshots): o motor NUNCA os executa; teste
  pina que rota e caminho de código citados existem. Área `workflow` SEM gate
  de papel (a page ramifica: todos executam, só admin configura) + feature
  `workflow` em `org_features` (só o `/owner` liga). **Correção acoplada:**
  `toBitrixValue` ganhou `case "crm_status"` com mapa rótulo→código OPCIONAL
  (3º parâmetro) — `SOURCE_ID`/`STATUS_ID` caíam no `default:` e mandavam
  RÓTULO onde o Bitrix quer CÓDIGO, afetando o write-back JÁ em produção; o
  mapa sai de `BitrixLookups.statusCodes()` e é materializado por
  `syncFieldCatalog` em `sync_config.bitrix_status_codes` (mapa VAZIO nunca
  sobrescreve um cache bom), que também passou a refrescar as `options` da
  linha core `stage`. Sem o mapa, byte-idêntico ao anterior. RPCs de widget
  INTOCADOS. Fiscalizado por `lib/workflow/*.test.ts` +
  `lib/workflow/{steps,seeds}/*.test.ts`. Ver `docs/arquitetura.md` §4.23 e
  invariante 32.
- **Lixeira de registros (0121): `deleted_at` só muda por ADMIN e toda leitura
  nova de `records` decide EXPLICITAMENTE sobre a lixeira (07/08/2026):**
  soft delete de 30 dias — enviar/restaurar/purgar SÓ pelas actions de
  `lib/records/trash-actions.ts` (gate admin + trigger
  `enforce_records_trash_guard`: trash é UPDATE e cairia na `records_update`
  de qualquer editor; relaxar exige mudar os DOIS juntos). Consulta nova
  filtra `deleted_at is null` (o funil `buildRecordListQuery` e os RPCs 0121
  cobrem os caminhos canônicos) — EXCETO upserts do sync/import, SEM filtro
  de propósito (linha trashed atualiza in-place e SEGUE na lixeira; é o que
  impede ressurreição no reconcile). O predicado dos RPCs é ESPELHADO
  byte a byte: `snapshot_records.deleted_at` é espelho MORTO sempre-null (a
  captura exclui a lixeira) — não remova a coluna nem o predicado do
  snapshot. `record.deleted` no envio à lixeira, `record.restored` no
  restore, purga silenciosa (`pg-cron-purge-records-trash.sql`, 30d); nenhum
  caminho do app faz hard delete fora de `purgeRecordsPermanently`
  (predicado `deleted_at not null`). Ações em massa de /registros
  (checkboxes + `RecordsBulkBar`): edição manual e IA sobre selecionados
  usam o MODO SELEÇÃO do contrato registros-update
  (`validateRecordsUpdate(..., { selection: true })` — `filtros` proibido;
  ids viajam como ARGUMENTO das actions, nunca no JSON; `resolveSelection`
  + `updateRecordValuesBulk`, nunca caminho paralelo). Fiscalizado por
  `lib/records/trash.test.ts` + `records-table.selection.test.tsx` + blocos
  de seleção em `update-validate.test.ts`/`update-instructions.test.ts`.
  Ver `docs/arquitetura.md` §4.21 e invariante 30.
