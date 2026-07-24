<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Regras do projeto

> Rede de segurança: `npm run lint` + `npm run typecheck` + `npm test` (Vitest —
> unidades dos módulos puros e a guarda de paridade das RPCs; sem banco). Rode
> os três antes de entregar; o CI (`.github/workflows/ci.yml`) repete em todo
> push/PR. Como operar/estender: `docs/manual-de-manutencao.md` §2.1.

> Documentação para humanos: [`docs/arquitetura.md`](./docs/arquitetura.md)
> (fluxos + todas as invariantes, incl. as abaixo),
> [`docs/banco-de-dados.md`](./docs/banco-de-dados.md) (schema consolidado) e
> [`docs/manual-de-manutencao.md`](./docs/manual-de-manutencao.md) (runbook) e
> [`docs/manual-de-construcao-de-dashboards.md`](./docs/manual-de-construcao-de-dashboards.md)
> (manual de construção de dashboards pela UI, para usuários/IAs).
> Ao alterar schema ou invariantes, atualize esses docs na mesma entrega —
> mudanças de UI/semântica do construtor incluem o manual de construção.

- **RPC de widgets duplicado (Snapshots):** `run_widget_query_snapshot`
  (versão vigente na 0085; introduzido na 0056) é uma cópia de
  `run_widget_query` (vigente na 0085; base 0054) apontada para
  `snapshot_records`, acrescida das
  restrições do snapshot aplicadas internamente (mock-aware). Toda mudança em
  `run_widget_query` (nova migração que o recrie) DEVE ser espelhada em
  `run_widget_query_snapshot` na mesma migração — inclusive o helper
  `_widget_match_expr` ↔ `_widget_match_expr_snap`. O espelhamento é
  FISCALIZADO em CI por `tests/rpc-parity.test.ts` (`npm test` — compara o SQL
  das últimas definições, sem banco); divergência snapshot-only INTENCIONAL
  nova entra na allowlist do teste com comentário justificando.
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
  `at time zone` a valor texto (naive de CSV recuaria um dia). Ver
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
  subs da mesma pai) é que ela vira PERNA extra (série própria por fonte, no
  caminho agregado); nesse caso o usuário garante que os conjuntos são
  disjuntos. Ver `docs/arquitetura.md` §4.8 e invariante 10.
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
- **Escopo de widget em server action sai SEMPRE do widget-scope
  (21/07/2026):** toda action que consulta dados de um widget (paginação,
  export, `runQuickTable`, `runKanbanWidget` e futuras) monta o recorte por
  `loadWidgetScope`/`resolveWidgetViewScope` (`lib/widgets/widget-scope.ts`) —
  nunca remonte `__qf__`/`ff_`/`tf_`/operação/`__pw__` à mão (cópias parciais
  = widget deferido ignorando filtro até F5). No cliente, o fetch deferido
  re-dispara pelo fingerprint `scopeKey` (`deferredScopeById` da page), nunca
  por `useSearchParams` (filtro persistido no banco não muda a URL); com dado
  antigo em tela exibe "Atualizando…" (dim + spinner). Período personalizado
  é RASCUNHO + commit (`PeriodRangeDraft` — completo auto / aberto via
  "Aplicar"); não reintroduza navegação por tecla nos inputs de data. Agenda
  ignora filtros do dashboard POR DESIGN. Ver `docs/arquitetura.md` §4.10 e
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
  não recompute na UI. NÃO recrie as RPCs para
  nada disso; snapshots leem metas/feriados AO VIVO pelo adapter
  (`PASSTHROUGH_TABLES`). Presets são DADOS aplicados idempotentemente por
  `applyPreset` (identidade `settings.preset.key`/`settings.presetKey` — nunca
  duplicar nem tocar widgets sem presetKey). Ver `docs/arquitetura.md` §4.9.
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
  não as edite à mão esperando que sobrevivam. Terminologia de UI: fonte de
  dados do sistema = "Base"/"Sub-base"; "Fonte" ficou só para o campo CRM
  (`custom:fonte`). Ver `docs/arquitetura.md` invariante 13.
- **Editor/validação/catálogo de fórmulas são ÚNICOS (20/07/2026):** o catálogo
  AGREGADO sai SEMPRE de `buildAggOperandCatalog`
  (`lib/widgets/agg-catalog.ts`, inputs `availableAggCatalogInput`/
  `defsAggCatalogInput`) — não recrie as montagens chamando
  `aggOperandRefs`/`sourceScopedAggOperandRefs`/… na mão. Os DOIS inputs
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
  linha p/ a Zapper). `data_sources.key`/`record_type` seguem GLOBAIS
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
  `requireSettingsArea` (page) / `isSettingsAreaDenied` (escrita)
  (`lib/auth/access.ts`; deny vence tudo — barra page E escrita das actions;
  allow vence o papel só p/ VER a page, nunca concede escrita, que segue o
  papel). Bases negadas → RLS de
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
  estado não referenciado NÃO entra no JSON (o sem-GC preserva a linha). **Modo
  Criar a partir de (`applyFromReference`, 24/07/2026):** cópia FIEL via
  `duplicateBoard` + o delta ADITIVO da IA aplicado como Edição na cópia
  (reusa o merge); NÃO usa mais `importDashboardJson` (que recriava tudo). Só o
  `new` segue no `importDashboardJson`. Duplica só no APPLY (sem cópias órfãs).
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
