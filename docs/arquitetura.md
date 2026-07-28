<!-- Versão: 1.37 | Data: 26/07/2026 -->
<!-- v1.37 (26/07/2026): §4.8 — Pastas de bases (0107): source_folders +
     folder_id/sort_order (exibição pura; groupSourcesByFolder único;
     navegação Pasta → Base → Sub-base em /registros e /campos; headings nos
     pickers; ↑/↓ em Registros → Bases). RPCs intocados. -->
<!-- v1.36 (26/07/2026): §4.11.3 — raciocínio AO VIVO no painel "Editar com
     IA": turno via rota de streaming /api/dashboards/<id>/ai-turn (NDJSON;
     runAiEditTurnCore em lib/ai/edit-session.ts — mesmo gate/persistência das
     actions, que viraram wrappers) + onThought no contrato dos adaptadores
     (Gemini streamGenerateContent + includeThoughts; sem custo extra — nunca
     ligar thinking onde está desligado). Título do painel = MODELO
     configurado (1ª letra maiúscula). -->
<!-- v1.35 (26/07/2026): §4.14 Parcerias (0104–0106) — match de bases
     dinâmicas (helpers com lookup em data_sources), auto-match INCREMENTAL
     pós-sync do Bitrix + recalc direcionado, fusão de perfis de operação
     (in_ci; operation-scope batelado com roll-up do pai) e sub-operações
     automáticas por registro (source_auto_operations +
     operations.auto_source_record_id); invariantes 21/22. -->
<!-- v1.34 (26/07/2026): §4.10 — deferimento AUTOMÁTICO dos widgets de engine
     (runDeferredWidgets em lote via widget-scope em bundle; page entrega só
     fingerprints; env de escape DEFER_ENGINE_WIDGETS=0) e §4.1 — janela
     incremental do modo lista full-fetch (runRecordListWindow +
     fetchWidgetRecordsWindow; env RECORD_LIST_WINDOW, default 1000). -->
<!-- v1.33 (26/07/2026): §4.1 — cache TTL de run_widget_query ENTRE
     requisições (lib/widgets/rpc-cache.ts, sob o withRpcMemo; chave por
     escopo de autorização u:<userId>/s:<snapshotId>; env
     WIDGET_RPC_CACHE_TTL_MS, default 45s, 0 desliga; erro nunca em cache). -->
<!-- v1.32 (26/07/2026): §4.13 — agrupamento de responsáveis por exibição
     (responsibles.canonical_id, 0101): apelido → principal ("nome usado"),
     resolvido 100% no engine/loaders (lib/config/responsible-canon.ts) —
     dropdowns colapsam, filtros expandem p/ o grupo, dimensões fundem no
     merge client-side, restrição de snapshot grava expandida e
     auth_responsible_ids devolve o grupo. Invariante 20. RPCs intocados. -->

<!-- v1.31 (26/07/2026): §4.2 — alvos do "Filtro de período" DINÂMICOS
     (settings.excludedTargets, espelho do filtro_campo; widget novo entra
     sozinho; whitelist legada `targets` honrada sem excludedTargets — ramo
     permanente; runbook backfill-filter-targets.sql) e Aparência ganha
     "Ocultar barra de título" (appearance.title.hidden — só a barra some;
     grip flutuante + ⋮ em hover no modo edição). RPCs intocados. -->

<!-- v1.30 (25/07/2026): §4.12 — espaço de grid v2 (grade FINA: base 120 sem
     margens, linha quadrada default, controle "Largura da coluna"; conversão
     runtime normalizeGridSpace keyed em canvas.gridVersion + migração lazy
     ensureFineGrid no write-path + runbook backfill-grid-v2.sql) e PÁGINAS de
     widget (mescla settings.pages: host renderiza a página ativa, pager acima
     do card, diálogo "Adicionar página?" no drop quase-em-cima, ⋮ Adicionar
     página/Desfazer mescla). Invariantes 18 e 19. RPCs intocados. -->

<!-- v1.29 (25/07/2026): §4.7 — "Linha divisória" vira visual_type próprio
     (linha_divisoria, 0100 — CHECK + backfill; settings.shape inalterado);
     identidade SÓ por isLineShapeWidget (braço legado forma+kind linha é
     permanente: snapshots congelados/clipboard antigos). Rótulos de barra
     horizontal: reserva de margem medida p/ rótulo externo + auto-flip do
     "Dentro" que não cabe; appearance barFillPct/chartInset/filter (aparência
     dos widgets de filtro) — tudo client-side, RPCs intocados. -->
<!-- v1.28 (24/07/2026): §4.8 — pernas de sub-base EXIBÍVEIS: (a) operando
<!-- v1.28 (24/07/2026): §4.8 — pernas de sub-base EXIBÍVEIS: (a) operando
     escopado em fonte-IRMÃ é ZERADO por perna no branch multi-perna
     (zeroSiblingScopedOperands; cada perna mostra a própria contribuição —
     antes toda perna repetia o total global) + backfill 0 na basis p/ o
     re-eval client-side; (b) settings.subSeriesMode (stacked default | total |
     grouped): stacked/grouped mantêm a Base como dim líder e o CHART pivota as
     pernas em séries (lib/widgets/sub-series.ts + WidgetData.subSeries);
     total funde por tupla no ENGINE (foldRowGroup) sem a dim Base; pizza/funil
     com dim e KPI/card fundem SEMPRE (antes: KPI mostrava só a 1ª perna);
     goalLine/businessDayRef propagados pelo branch. limitCategories ganha
     rankKey (top-N pelo total da categoria no pivot). Fix: export/paginação
     de registros passavam sem o catálogo (predicado de sub nunca aplicado).
     RPCs intocados. -->
<!-- v1.27 (24/07/2026): §4.11.2 — a IA LÊ melhor o estado: `copy_of` (cópia de
     widget por delta, resolvida em normalizeImportRaw — key nova + key da
     origem; grid ausente empilha abaixo do fundo da aba), `baseWidgets` também
     no modo from (validação do laço = semântica do apply) e a prévia pendente
     não aplicada entra no system do turno seguinte (a resposta SUBSTITUI a
     prévia inteira). -->
<!-- v1.26 (24/07/2026): §4.11.3 — painel "Editar com IA" DENTRO do dashboard
     (AiEditPanel, não-modal/recolhível) com sessão PERSISTIDA por usuário×board
     (dashboard_ai_sessions, 0098): turnos server-owned (cliente envia só a
     mensagem nova), prévia pendente no banco, snapshot pré-turno persistido
     como "Desfazer edição da IA" (sobrevive a F5), Recomeçar preserva o undo.
     ai-session-actions.ts embrulha generateDashboardWithAi/applyGenerated-
     Dashboard sem tocá-los; fluxo da Home inalterado. -->
<!-- v1.25 (24/07/2026): §4.11.2 — PRESERVAR conteúdo na edição/cópia por IA.
     Modo Editar: merge por widget no estágio bruto (normalizeImportRaw ganha
     baseWidgets do export; deep-merge por key — settings mescla, arrays
     substituem, null limpa) ⇒ a IA manda só o delta do widget e o resto é
     preservado. Modo Criar a partir de: applyFromReference = cópia fiel via
     duplicateBoard + delta aditivo aplicado como Edição (FROM_RULES reescrito),
     no lugar de importDashboardJson que recriava tudo. RPCs de widget
     intocados; sem migração. -->
<!-- v1.24 (23/07/2026): §4.1 — merge por bucket client-side p/ dimensão
     custom:+transform (bucket-merge.ts em computeRows; RPC agrupava pelo
     valor cru; canônico estilo-núcleo; avg simples aproximado). Import (IA):
     validador remove dateAgg fora de lista, remapeia Sub-base de recorte
     idêntico p/ a existente e avisa sobre resultCurrency/escopo≠sources;
     spec ganha as regras 12-14 (valem também p/ a geração direta, que reusa
     o mesmo prompt/validador). -->
<!-- v1.24 (23/07/2026): §4.11.2 — export de estrutura (lib/import/dashboard/
     export.ts + "Exportar JSON" no ⋮) e CONVERSA de IA com 3 modos (novo/a
     partir de/editar): identidade forçada no servidor (rewrite.ts), modo
     Editar sem GC com adoção de presetKey + snapshot p/ Desfazer
     (applyDashboardEditJson; applyPresetDefinition ganha targetDashboardId e
     fontScale gerida), truncamento tipado nos adapters de IA. -->
<!-- v1.23 (23/07/2026): §4.11.1 — geração DIRETA de dashboard por IA via API:
     adaptadores multi-provedor em lib/ai/* (Gemini/Claude/OpenAI, fetch), chave
     cifrada por org (ai_provider_config, 0096), action generateDashboardWithAi
     com laço de autocorreção, reuso de buildImportPrompt + validate +
     importDashboardJson; contexto extraído p/ lib/import/dashboard/context.ts. -->
<!-- v1.22 (23/07/2026): §4.11 — REGRA: nunca `.insert(...).select()` em
     `dashboards` (a policy de SELECT auth_board_visible/0088 é função STABLE
     sobre a própria tabela e não vê a linha do próprio comando → 42501);
     padrão = id gerado no app + insert sem RETURNING (duplicateBoard);
     createBoard/applyPresetDefinition corrigidos; erro real do banco passa a
     ser propagado pelos chamadores do applyPresetDefinition. -->
<!-- v1.21 (23/07/2026): §4.11 — Importar aceita VÁRIAS Bases (modelo/amostra
     por Base + Conexões no prompt; envelope `bases: []`). -->
<!-- v1.20 (23/07/2026): §4.11 — Importar dashboard via JSON gerado por IA
     (botão Importar na Home; validador puro em lib/import/dashboard/*;
     aplicação pelo applyPresetDefinition com identidade import:<chave>;
     prompt com modelo da Base + amostra com cobertura de colunas). -->
<!-- v1.19 (23/07/2026): escopo do VALOR do "Filtro por campo" configurável
     (§4.7/§4.10; invariante 12) — settings.valueScope 'all' compartilha a
     seleção entre todos os usuários via célula __ff__/sel de
     dashboard_table_cells (mesma semântica do __qf__; saveSharedFieldFilter;
     fora do Desfazer/Refazer); no modo shared o cliente NÃO escreve a URL
     (transporte = banco, padrão QuickFiltersBar) e ressincroniza do seed;
     ausente/'user' = por usuário (lastFieldFilters), como antes. -->

<!-- v1.18 (23/07/2026): MULTI-ORGANIZAÇÃO + acessos (0088–0094; §4.6
     reescrito; invariantes 15–17): organizations/members/app_owner com
     triggers de proteção; organization_id nas raízes + RLS org-scoped;
     fluxo Owner (/owner, env OWNER_USER_ID, seed_org_defaults/
     delete_organization); acesso por pessoa aos boards (board_access,
     ⋮ → Acesso); escopo de BASES por board (settings.sourceScope, ⋮ →
     Bases — catálogo efetivo via applySourceScope, page/widget-scope/
     viewer); overrides individuais (user_access_overrides, Configurações →
     Acessos); branding editável (organizations.name/app_name no sidebar). -->

<!-- v1.17 (22/07/2026): ciclo de vida de boards no hub (0087 — §4.7 +
     invariante 14): menu ⋮ com Duplicar/Arquivar/Excluir (soft → Lixeira,
     purga 14d via pg-cron-purge-trash; trashed não abre em rota nenhuma),
     duplicateBoard com remap de ids + strip de preset. Grid: allowOverlap —
     nada se move durante o gesto; resolveDropCollisions abre espaço MÍNIMO só
     no drop (dashboard-grid v2.12). -->
<!-- v1.16 (22/07/2026): (a) comparação nos Cards de FÓRMULA (§4.9) — o
     runCardWidget roda a mesma fórmula no range deslocado (comparisonSpec,
     inclusive previous_period_bd com feriados; bases de janela ficam de fora
     — escalar único) e anexa WidgetData.comparison + card.value/cmpValue p/ o
     VariationBadge; RPCs intocados; snapshot herda (mesmo runCardWidget +
     PASSTHROUGH de feriados). (b) ordenação DINÂMICA por valor
     (categorySort.by/metric — barra/pizza/funil; helper único orderCategories;
     eixo cronológico não oferece; "Outros" fica no fim) e colorByCategory
     (barra de série única colore por índice da paleta; off por padrão).
     (c) Preset Inbound v5: cards de SAL removidos (sub `sals` fica),
     comparação em TODOS os cards, cores da marca como dados de aparência +
     paleta nomeada "inbound" (validada p/ contraste/CVD). -->
<!-- v1.15 (22/07/2026): linhas core de field_definitions (0086 — invariante 13:
     overrides das colunas núcleo, split em lib/records/core-defs.ts) e nota de
     terminologia "Base" (= fonte de dados do sistema, na UI). -->
<!-- v1.14 (21/07/2026): sincronia filtros → widgets deferidos + rascunho do
     período personalizado (§4.10; invariante 12) — (a) intervalo
     personalizado (barra global e filtro rápido do card) vira RASCUNHO com
     commit (completo auto-debounced / aberto via "Aplicar"): digitar não
     dispara mais consulta com período parcial; (b) escopo das actions
     deferidas (runQuickTable/runKanbanWidget) sai da assembly ÚNICA do
     widget-scope (resolveWidgetViewScope) — quick-table e kanban passam a
     aplicar __qf__/ff_ (com lastFieldFilters)/operação traduzida; (c)
     re-fetch dos deferidos por FINGERPRINT de escopo da page
     (deferredScopeById → prop scopeKey), cobrindo filtros persistidos no
     banco que não mudam a URL; (d) feedback: estado "Atualizando…" (dim +
     spinner) nos deferidos, period-window/nota no transition compartilhado;
     (e) guards de resposta obsoleta (agenda, pager server-side). -->
<!-- v1.13 (21/07/2026): dia de BRASÍLIA no read side dos widgets (0085, §4.1/
     §4.2/§4.5; invariantes 7/11) — colunas timestamptz do núcleo comparavam/
     bucketizavam na sessão UTC do banco (limites de dia deslocados 3h; registro
     21h+ BRT caía no dia/mês seguinte). RPCs recriados (par espelhado):
     bounds do @period ancorados com -03:00 SÓ p/ colunas do núcleo, bucketing
     via _widget_local_ts (núcleo = wall time BRT; custom = prefixo de 10
     chars, casando com o parseYmd do client), coalesce de unificados idem;
     client ancora bounds core em period.ts/engine.ts/record-list.ts. Campos
     custom (texto) seguem byte-idênticos. Badge "Nº dia útil" (§4.9):
     WidgetData.businessDayRef expõe o N de corte do businessDayAlign
     (compartilhado entre os meses) e o card exibe ao lado do toggle
     (BusinessDayBadge; funciona também no viewer de snapshot). -->
<!-- v1.12 (20/07/2026): sync inicial do "Filtro por campo" é RASO (§4.7) —
     seed lastFieldFilters sem parâmetro na URL espelha a URL com
     history.replaceState, sem navegação RSC (o servidor já aplicou o seed);
     overlay/persistência só em mudança do usuário. Corrige o dashboard de
     preset preso em "Carregando…" na montagem sob refreshes do realtime. -->
<!-- v1.11 (20/07/2026): mocks × predicados de sub-fonte (§4.4) — a regra 0052
     não isenta os mocks dos predicados (AND puro); 0084 dá custom:fonte aos
     mocks Inbound p/ contarem na sub sqls. Preset Inbound v4: Mês x Mês abre
     em "dia cheio" (reuniões agendadas visíveis; toggle p/ dia útil). -->
<!-- v1.10 (20/07/2026): (a) periodWindow (§4.9) — janela de períodos
     equivalentes com dropdown no card ("3 meses"/"Este trimestre"…), corte
     por dia útil OU dia cheio, seleção compartilhada na célula __pw__;
     windowMonths vira alias legado; (b) persistência por usuário do widget
     "Filtro por campo" (user_preferences.lastFieldFilters, §4.7 — URL vence). -->
<!-- v1.9 (20/07/2026): correções pós-preset — (a) coalesce dos unificados
     ordena refs `custom:` (esparsos) antes das colunas do núcleo (densas;
     §4.8 — coluna densa sombreava o membro custom de outro record_type);
     (b) businessDayAlign.windowMonths = janela própria "últimos N meses" do
     card (§4.9); (c) filtro de OPERAÇÃO da visualização resolve vínculo +
     PERFIL no server (operations.filter, 0083; lib/config/operation-scope.ts)
     — nunca a coluna derivada records.operation_id (§4.7). -->
<!-- v1.8 (20/07/2026): operandos escopados estendidos (§4.7 — predicado de sub
     com in/is_null/*_ci; aux como perna da fonte do escopo: período pela data
     DELA + correspondências DELA; chave aggif com 4º elemento scope) + preset
     Inbound (lib/presets/inbound.ts) e deps novas do aplicador (campos
     calculados com fórmula, correspondências). RPCs intocados. -->
<!-- v1.7 (20/07/2026): dias úteis e metas (§4.9) — non_working_days (0081) +
     utilitários de dia útil; businessDayAlign (pernas por mês no engine);
     base de comparação previous_period_bd; goalLine (meta/ritmo como série);
     metas por métrica arbitrária (registry goal_metrics); preset engine v2
     (§4.7 — aplicação idempotente por presetKey); sub-fonte com campo de
     período custom (0082, §4.8). RPCs intocados em tudo. -->
<!-- v1.6 (20/07/2026): unificados SEMPRE por perna — o mapa p_correspondences
     de TODA consulta sai de correspondenceMapForSources (fallback perna →
     raízes → todos); buildCorrespondenceMap fica só p/ opções de bucket;
     unifiedMembers é raiz-primeiro (§4.8; invariante 10). Corrige o membro de
     sub-fonte vazando no coalesce de widget só-pai. -->
<!-- v1.5 (20/07/2026): top-up de mocks das pernas COBERTAS — fontes da métrica
     dentro das do widget (inclusive "todas as fontes") recebem os mocks de
     Data Reunião via fetch is_mock=true no engine (§4.1; invariante 9). -->
<!-- v1.4 (19/07/2026): fuso da fonte (0079/0080) — data_sources.timezone;
     datetimes ingeridos normalizam p/ Brasília na entrada (§4.5); nova
     invariante 11. -->
<!-- v1.3 (19/07/2026): sub-fontes (0078) — fonte derivada de uma pai, recortada
     por um filtro, com data própria; resolvida no engine (§4.8) sem tocar nas
     RPCs; nova invariante 10. -->
<!-- v1.2 (18/07/2026): fontes por métrica (Metric.sources) — universo de
     cálculo próprio por métrica via "pernas" no engine (§4.1); nova invariante
     em §5 (nunca resolver fonte por métrica no RPC). -->
<!-- v1.1 (18/07/2026): edição inline reconcilia no cliente (célula otimista +
     refresh debounced + realtime) em vez de revalidatePath por edição; badge
     de write-backs pendentes em /registros. -->


# Arquitetura do sistema

Visão geral para quem vai **manter o sistema manualmente** (sem IA). Este documento
explica o que o sistema é, como as peças se encaixam e — mais importante — as
**invariantes que não podem ser quebradas**. Leia junto com:

- [`banco-de-dados.md`](./banco-de-dados.md) — schema consolidado, funções e RLS.
- [`manual-de-manutencao.md`](./manual-de-manutencao.md) — setup do zero, rotina de
  mudanças seguras e troubleshooting.
- [`../supabase/README.md`](../supabase/README.md) — runbook de aplicação das migrações.
- [`webhooks.md`](./webhooks.md) — referência da API de webhooks (entrada e saída).

## 1. O que é o sistema

Um **construtor de dashboards comerciais** (não um dashboard fixo) para gestão de
leads e negócios de vendas. O usuário monta dashboards por configuração
(fonte → dimensões → métricas → filtros → visual); nenhum widget novo exige código.

O núcleo é a tabela genérica **`records`** — a única fonte de verdade da UI. As fontes
externas apenas a alimentam:

- **Bitrix24** (leads e deals) — sync incremental/retomável via API REST;
- **Planilha "Estudo de Fechamentos"** — push horário via Google Apps Script;
- **CSV** — wizard de importação na página Registros;
- **API de ingestão** (`/api/ingest/<fonte>` + chaves de API) — webhooks de entrada.

> **Terminologia (21/07/2026):** na **UI**, o conceito de fonte de dados do
> sistema (`data_sources`/`sub_sources`) chama-se **"Base"** ("Sub-base",
> "todas as bases") — renomeado para desfazer a ambiguidade com o campo CRM
> **"Fonte"** (SOURCE_ID do Bitrix → `custom_fields.fonte`, que mantém o nome).
> No código, no schema e nesta documentação o termo interno segue sendo
> "fonte"/"sub-fonte" — só os rótulos visíveis mudaram.

## 2. Stack e infraestrutura

| Camada | Tecnologia | Onde |
|---|---|---|
| Framework | Next.js 16 (App Router, RSC, TypeScript 5, React 19) | `app/`, `next.config.ts` |
| Banco/Auth | Supabase (Postgres + Auth + RLS) | `lib/supabase/{browser,server,service}.ts` |
| UI | Tailwind CSS v4 + shadcn/ui (Radix) + lucide-react | `components/ui/` |
| Gráficos/Grid | Recharts 3 + react-grid-layout 2 | `components/dashboards/charts/`, `dashboard-grid.tsx` |
| CSV | papaparse | `lib/import/csv.ts` |
| Deploy | Vercel (plano Hobby — rotas com teto de 60s, `maxDuration = 60`) | push → deploy automático; CI versionado em `.github/workflows/ci.yml` (lint + typecheck + testes) |
| Testes | Vitest (unidades puras + componentes jsdom + engine com cliente fake + guarda estática de paridade RPC) · Playwright (`e2e/`) · paridade RPC EXECUTADA (`tests/live/`, stack Supabase local) | `npm test` sem banco; `test:e2e`/`test:live` com o stack local (manual §2.1) |
| Agendamento | `pg_cron` + `pg_net` **dentro do Postgres**, chamando rotas da Vercel | `supabase/apply/pg-cron-*.sql` |

Pontos não-óbvios (conhecimento tribal — não descubra do jeito difícil):

- **No Next 16 o "middleware" chama-se `proxy`** — o arquivo é `proxy.ts` na raiz,
  não `middleware.ts`.
- **Não existe `.env.local`.** As variáveis vivem nas Environment Variables da
  Vercel e no painel do Supabase. `.env.example` é o checklist comentado;
  `lib/env.ts` falha com erro claro em runtime se faltar variável.
- **O código nunca conecta ao banco em build/deploy.** Toda migração é SQL aplicado
  manualmente no SQL Editor do Supabase (ver `supabase/README.md`).
- **Testes e CI (24/07/2026).** `npm test` roda o Vitest SEM banco: unidades
  dos módulos puros (colocated `lib/**/*.test.ts` — datas/fuso, dias úteis,
  período, fórmulas, calc-metrics, sub-fontes, regra 0052, import de IA), a
  **guarda estática de paridade das RPCs** (`tests/rpc-parity.test.ts`,
  espelho executável da invariante 1), **componentes** em jsdom (opt-in por
  arquivo — FormulaEditor/chips/preview, badges, Combobox) e o **engine com
  cliente Supabase FAKE** (`tests/helpers/fake-supabase.ts`, mesmo shape do
  snapshotClient — pernas por métrica, correspondências por perna,
  businessDayAlign, comparação, top-up de mocks, aux de operando @fonte). O CI
  (`.github/workflows/ci.yml`) tem dois jobs: `verify` (lint + typecheck +
  `npm test`) e `e2e` — sobe um **stack Supabase LOCAL** (CLI pinado; as
  migrações dependem só de pgcrypto), semeia dados determinísticos
  (`scripts/e2e-seed.ts`), roda os smokes SSR do Playwright (`e2e/`: login,
  dashboard, viewer público `/s/[token]`) e a **paridade EXECUTADA das RPCs**
  (`tests/live/rpc-parity-live.test.ts`: mesma config nos dois lados, snapshot
  sem restrições → resultados devem ser IDÊNTICOS). Segue SEM cobertura:
  widgets de gráfico/grid (ResizeObserver), kanban/agenda no viewer. As
  queries de conferência do `supabase/README.md` continuam valendo.

## 3. Mapa de pastas

```
app/
  (auth)/login/          Login email/senha (não há signup público)
  (app)/                 Área autenticada
    page.tsx             Home = lista de dashboards
    dashboards/[id]/     Página do dashboard (orquestra a leitura dos widgets)
    kanbans/[id]/        Kanbans dedicados (reusam dashboards com kind='kanban')
    kanbans/w/[widgetId] Página cheia de um WIDGET kanban (mesma config/placements
                         do widget; barra de período própria — ignora o pai)
    registros/           Grid de dados por fonte + importação CSV + painel de sync
                         + bases/ (config das bases, ex-/configuracoes/fontes)
                         + log/ (sincronizações/write-back, ex-/configuracoes/log)
    tarefas/             Tarefas standalone
    campos/              Colunas dinâmicas + correspondências (admin) + aba
                         Moedas (ex-/configuracoes/moedas)
    configuracoes/       acessos, conta, integracoes, metas, operacoes,
                         organizacao, presets, responsaveis, snapshots, tema,
                         usuarios
  s/[token]/             Viewer PÚBLICO de snapshots (única rota sem auth além do login)
  api/
    ingest/[source]/     Webhook de entrada (chaves de API)
    sync/                tick, bitrix-backfill, bitrix-reconcile, recalc-daily, sheets
    snapshots/tick/      Refresh agendado de snapshots
    webhooks/tick/       Drenagem do outbox de webhooks de saída
lib/
  widgets/               O CORAÇÃO: engine.ts, types.ts, period.ts, period-resolve.ts,
                         calc-metrics.ts, currency.ts, mock-reuniao.ts, widget-scope.ts, ...
  records/               formulas.ts (motor de fórmulas), recalc.ts, matching-engine.ts
  sync/bitrix/           Adaptador Bitrix: sync.ts, mapper, catalog, writeback, runner
  snapshots/             db-adapter.ts (client fail-closed), refresh.ts, token.ts, schedule.ts
  import/                ingest.ts (motor único de ingestão), csv.ts
  webhooks/              Eventos de saída, assinatura HMAC, retenção
  auth/, config/, metas/, kanban/, tasks/, agenda/, comments/, export/, crypto/
components/
  dashboards/            widget-builder.tsx, charts/widget-chart.tsx, widget-card.tsx,
                         dashboard-grid.tsx, dashboard-client.tsx, ...
  registros/, kanban/, snapshots/, configuracoes/, campos/, importacao/, ui/ (shadcn)
supabase/
  migrations/            0001–0074 (SQL manual, idempotente)
  apply/                 Blocos consolidados por fase + scripts pg-cron + undo
integrations/apps-script/  push_estudo_fechamentos.gs (setup no cabeçalho do arquivo)
docs/                    Este documento e os demais
```

Server Actions ficam colocalizadas com as páginas (`actions.ts` por pasta).

## 4. Fluxos principais

### 4.1 Widgets e o RPC `run_widget_query`

O subsistema mais crítico. A config do widget (JSONB: `p_source`, `p_dimensions`,
`p_metrics`, `p_filters`, `p_correspondences`) é enviada à função PL/pgSQL
`run_widget_query`, que **monta SQL dinâmico** (SELECT/GROUP BY/WHERE) contra
`records`, com:

- whitelist de colunas (nada de injeção via config);
- campos custom (`custom:<key>` em `records.custom_fields`) e **unificados**
  (`unified:<key>` = coalesce das colunas correspondidas entre fontes);
- buckets de data (dia/semana/mês/`month_name`/`weekday`...) — a chave canônica
  do bucket **DEVE bater com `canonicalBucketKey`** no cliente;
- filtros sintéticos `@period` (barra de período) e `@rate_date`;
- agregações (sum/avg/count/count não-vazio/min/max) e conversão de moeda.

O lado TypeScript é `lib/widgets/engine.ts` (chama o RPC, resolve rótulos de FK,
pós-processa). A função foi **recriada 18 vezes** ao longo das migrações — a versão
vigente é a da migração `0085_widget_rpc_brasilia_day.sql`.

**Duas camadas de client em volta do RPC (26/07/2026):** toda page que computa
widgets envolve o client em `withRpcMemo(withRpcTtlCache(...))`
(`lib/widgets/rpc-memo.ts` + `lib/widgets/rpc-cache.ts`). O memo dedupa args
idênticos dentro de UM render; o cache TTL (default 45s, env
`WIDGET_RPC_CACHE_TTL_MS`, `0` desliga) reusa resultados ENTRE requisições da
mesma instância serverless — F5/navegação/segundo viewer do mesmo dashboard
custam ~0 ao banco dentro da janela. A chave é prefixada pelo ESCOPO DE
AUTORIZAÇÃO (`u:<userId>` na page — o RPC é SECURITY INVOKER e a tradução de
operação é por usuário; `s:<snapshotId>` no viewer público) — entradas nunca
cruzam escopos. Erros não ficam em cache; `structuredClone` na leitura (o
engine muta rows in place). É melhor esforço (instâncias não compartilham o
store) e implica staleness de até o TTL após sync/edição — aceitável, o
reconcile é horário.

**Merge por bucket p/ dimensão `custom:` + transform (23/07/2026):** o ramo
`custom:` da DIMENSÃO no RPC agrupa pelo VALOR CRU de `custom_fields->>key`
(o transform é só rótulo) — valores com hora viravam um grupo POR REGISTRO
(barras/chips duplicados, incl. snapshots). O engine funde as linhas pelo
bucket no retorno de `computeRows` (`lib/widgets/bucket-merge.ts` — choke
point único: principal/comparação/pernas do align/card/quick-table/snapshot),
com a semântica do Total geral: sum/count somam, min/max reduzem, calculadas
reavaliam sobre `foldBasis`, monetárias fundem `__money` e replotam (exato
até p/ média — o breakdown carrega count). A dim fundida grava o valor
CANÔNICO estilo-núcleo (`bucketCanonicalValue`, byte-compatível com o
`date_trunc`/`extract` das colunas core), o que alinha ordenação
cronológica, casamento ordinal da comparação e a regex mensal do goalLine.
ÚNICA aproximação: média SIMPLES não-monetária = média das médias (a linha
do RPC não carrega peso — mesma limitação do Total geral). RPCs INTOCADAS
(não aciona a invariante 1).

**Dia de Brasília no read side (0085):** a sessão do banco é UTC, então colunas
`timestamptz` do núcleo (`source_created_at`…) comparadas a literais naive
deslocavam o limite do dia em 3h, e o `date_trunc` bucketizava registros de
21h+ BRT no dia/mês seguinte — divergindo do cliente (prefix-based). Desde a
0085: bounds do `@period` em coluna do núcleo ganham offset explícito
(`-03:00`) DENTRO do RPC (e no client — ver §4.2); todo transform de data passa
por `_widget_local_ts` (overload timestamptz → wall time de
America/Sao_Paulo; overload text → prefixo de 10 chars, byte-igual ao
`parseYmd`); e o coalesce textual dos unificados serializa coluna de data do
núcleo via o mesmo helper. Comparações de campos **custom seguem textuais e
byte-idênticas** (valores já normalizados p/ `-03:00` na entrada — invariante
11). `transform: none` em coluna crua do núcleo/match ainda serializa em UTC
(agrupamento por instante é bijetivo; só o rótulo cru — follow-up conhecido).

**Fontes por métrica (`Metric.sources`, 18/07/2026):** o universo de LINHAS/
dimensões/registros de um widget é sempre `widgets.sources`; cada métrica pode
opcionalmente declarar as próprias fontes (`sources` no jsonb `widgets.metrics`)
e passa a ser calculada sobre elas — super/subconjunto ou disjunto do widget
(ex.: linhas só de Deals + conversão contando Leads E Deals). Implementação
inteira no engine (`lib/widgets/metric-sources.ts`): a métrica vira uma "perna"
— chamada RPC separada com o pipeline de filtros (segmentação por fonte,
`@period` byType e `record_type in (...)`) reconstruído para as fontes DELA —
mesclada às linhas da principal por tupla de dims. Grupos que só existem nas
fontes extras não viram linha; grupo ausente na perna: contagem 0, demais "—".
A basis das calculadas de perna vai em `WidgetRow.__calcOpsBy` (por métrica;
os renderizadores leem `__calcOpsBy[key] ?? __calcOps`). No modo registros, o
fetch extra (`runRecordListWithExtras`) traz os registros das fontes que
faltam SÓ para a basis dos subtotais (nunca como linha; a regra dos mocks do
fetch extra inspeciona as métricas das pernas). Pernas com fontes JÁ COBERTAS
pelo widget (subconjunto das fontes dele, inclusive widget em "todas as
fontes") reusam os registros de exibição — cuja regra dos mocks nunca vê as
métricas das pernas — e recebem um **top-up de mocks** (20/07/2026,
`runCoveredLegMockTopUp` em `lib/widgets/record-list.ts`): fetch só de
`is_mock = true` com o mesmo pipeline, mesclado ao stream de extras nos dois
caminhos client-side (`runWidgetByPeriod` e `runRecordListWithExtras`), com
gates que exigem que a config das pernas referencie Data Reunião
(`recordListIncludesMocks`) e que a exibição NÃO tenha servido os mocks (senão
duplicaria). Assim "fonte na métrica" = "fonte no widget" também nos caminhos
sem RPC — mocks na basis sem virar linha. Restrições `allowed_sources`
de snapshot podem excluir fontes de uma métrica — ela degrada para "—"
(comportamento documentado, não é bug). KPI razão ignora
`numerator/denominator.sources` no v1.

**Janela incremental do modo lista full-fetch (26/07/2026):** listas
inelegíveis à paginação server-side (`serverPaginatedList` false — agrupadas/
ordem manual/sort exótico) e sem `settings.limit` não buscam mais o conjunto
inteiro: a page carrega a 1ª janela (default 1000, env `RECORD_LIST_WINDOW`,
`0` = teto desligado) via `runRecordListWindow` (`record-list.ts` v2.0 —
offset + count exato, desempate estável por `id`) e o WidgetCard anexa as
próximas com "Carregar mais" (`fetchWidgetRecordsWindow`, mesmo recorte via
widget-scope — invariante 12). Grupos/subtotais/busca client-side valem sobre
o CARREGADO (rodapé avisa "grupos e totais parciais"). Exceções que mantêm o
full fetch: pernas de `Metric.sources` (basis dos subtotais precisa do
conjunto completo), filtro `@bucket` (pós-fetch — offset/count do servidor
não valem) e o viewer de snapshot (dataset congelado + pós-filtro de
`partner_only` quebraria o total; payload já limitado na captura). Export CSV
do widget = janelas carregadas; export server-side segue completo.

### 4.2 Filtros de período

`lib/widgets/period.ts` + `lib/widgets/period-resolve.ts`. O período efetivo de cada
widget combina: **barra global** (URL > preferência do usuário > config do dashboard),
escopo por aba e **widgets de filtro de período** que sobrescrevem alvos vinculados.
A mesma lógica roda na página do dashboard, na action da Tabela Rápida e no viewer de
snapshot — foi extraída para um módulo puro justamente para não divergir. O escopo
do widget é **reconstruído no servidor** (`lib/widgets/widget-scope.ts`) — nunca se
confia em config vinda do client.

**Alvos do filtro de período (26/07/2026):** o vínculo é DINÂMICO, espelho do
filtro_campo — `settings.excludedTargets` guarda os widgets DESMARCADOS na
edição e o alvo efetivo é "todos os widgets de dados menos estes" (widget novo
entra sozinho). A whitelist LEGADA `settings.targets` (ids congelados no save)
segue honrada quando `excludedTargets` está ausente — snapshots congelados a
guardam; ramo permanente em `computeWidgetPeriods`. Re-save no editor migra
(grava `excludedTargets` e apaga `targets`); runbook p/ migrar em massa:
`supabase/apply/backfill-filter-targets.sql` (rodar só APÓS o deploy).

Fontes dinâmicas (`data_sources`, criáveis via UI sem migração) precisam estar
cobertas no mapa `fieldBySource` do resolver — o `@period` do RPC **exclui**
`record_types` fora do mapa.

**Bounds ancorados no dia de Brasília (0085):** quando o campo de período é
coluna do núcleo (`CORE_DATE_COLS`, espelho do `v_date_cols` do RPC), os bounds
saem com offset explícito (`anchorCoreDateBound`: from → `T00:00:00-03:00`,
to → `T23:59:59-03:00`; idempotente) em TRÊS pontos: caminho uniforme do
`applyPeriodToFilters` (period.ts), filtros salvos gt/gte/lt/lte em
`resolveFilters` (engine.ts — choke point do RPC E do modo lista) e o ramo
`@period` do PostgREST (record-list.ts). Campos custom ficam NAIVE de
propósito: a comparação é textual e um offset no lower bound excluiria valores
date-only. O sentinel `@period` (caminho misto) viaja naive — RPC e record-list
ancoram POR COLUNA ao expandir o byType.

### 4.3 Snapshots públicos (`app/s/[token]`)

Congela uma aba de dashboard num link público:

- token de 256 bits vive **só na URL**; o banco guarda apenas o sha256
  (`snapshots.token_hash`);
- `proxy.ts` isola `/s/*` (sem `getUser`, com `Referrer-Policy: no-referrer` e
  `X-Robots-Tag: noindex`);
- a página valida o token via **service role** e lê exclusivamente por
  `lib/snapshots/db-adapter.ts` — client **fail-closed** que bloqueia qualquer
  tabela/RPC fora do conjunto do snapshot;
- os dados congelados vivem em `snapshot_records` (cópia atômica via
  `snapshot_refresh_copy`), consultados pela RPC gêmea `run_widget_query_snapshot`;
- `snapshots.default_period` (0059) reaplica no viewer o período que o dashboard
  tinha na criação — é filtro de **consulta**, não restrição;
- refresh agendado via `POST /api/snapshots/tick` (pg_cron a cada 5min).

### 4.4 Mocks de "Data Reunião"

302 leads fictícios (270 Inbound + 32 Outbound; `records.is_mock`, migrações
0051/0053) com uma regra peculiar: **só contam em consultas que referenciam o campo
Data Reunião** (chaves `bitrix_uf_crm_1743441331` — Lead — e
`bitrix_uf_crm_67eacefcccd98` — Negócio), direto ou via campo unificado. Qualquer
outra consulta os ignora por construção.

A detecção é **textual por substring** e existe em **três lugares que precisam ficar
idênticos**:

1. `run_widget_query` (SQL, 0052+);
2. `run_widget_query_snapshot` (SQL, 0057+);
3. `lib/widgets/mock-reuniao.ts` (TypeScript, client-side).

**A regra só remove o gate `not is_mock`** — ela NÃO isenta os mocks dos
demais predicados do WHERE (filtros do widget, predicado de sub-fonte via
`_widget_wrap_record_types`, tudo em AND puro). Consequência prática: um mock
precisa CARREGAR os campos usados na segmentação das sub-fontes que devem
contá-lo. A 0084 dá `custom:fonte = "Formulário de CRM"` aos 270 mocks
Inbound (lote 0051) para satisfazerem a sub `sqls` do preset
(`custom:fonte in (…)`); os 32 Outbound (0053) ficam SEM fonte de propósito —
não podem vazar no SQL Inbound — e receberão a deles com o preset Outbound.
(As subs mqls/sals não passam a contá-los: consultam por `source_created_at`,
NULL nos mocks, e sem referência a Data Reunião o gate `not is_mock` segue
ativo.)

Um trigger no banco (`enforce_reuniao_freeze`) **congela o campo**: sync, recálculo e
edição não conseguem gravar Data Reunião anterior a 01/06/2026 (tentativas são
descartadas em silêncio; pode gerar ruído inofensivo no `audit_log`). Undo previsto:
`supabase/apply/undo-mock-reuniao.sql`.

### 4.5 Sincronização e ingestão

Todos os caminhos de entrada convergem no motor único `lib/import/ingest.ts`
(`ingestRows`): upsert idempotente por `(source_system, source_id)`, dedup por hash e
**conflito por campo** — `records.field_modified_at` guarda o timestamp de cada edição
manual, e o sync **não sobrescreve** campos editados manualmente (campos calculados são
exceção: sempre recomputados).

- **Bitrix**: backfill/reconcile resumíveis por cursor (`sync_jobs`, uma página por
  requisição — cabe nos 60s da Vercel). O tick por minuto (`/api/sync/tick`, via
  pg_cron) drena a fila de write-back (`bitrix_writeback_queue`), avança o job ativo
  e dispara um reconcile automático a cada ≥1h. IDs viram nomes em
  `lib/sync/bitrix/lookups.ts` (etapas, enums, usuários, empresas e — desde a 0075 —
  origens: `SOURCE_ID` → campo `fonte`, resolvido via `crm.status.list`
  `ENTITY_ID='SOURCE'`). "Implementação" (`implementacao`) é sincronizado de
  `UF_CRM_1778094396888` desde a 0075 (antes era campo local dos presets).
- **Fuso da fonte (0079)**: `data_sources.timezone` (IANA, ex. `Europe/Moscow`;
  editável em Registros → Bases) declara o fuso em que a ORIGEM expressa
  datas/horas. O mapper do Bitrix normaliza valores **datetime** para
  America/Sao_Paulo na entrada (`lib/date/normalize.ts`) — o read side inteiro é
  prefix-based (lê o `YYYY-MM-DD` literal), então sem a conversão uma reunião às
  18h+ BRT cai no dia seguinte (Moscou = BRT+6). Campo Bitrix tipo `date`
  (calendário puro, ex. `data_assinatura`) NUNCA converte — recuaria um dia.
  Date-only e fontes sem `timezone` passam inalterados. Backfill dos valores
  antigos: 0080 (chaves datetime explícitas; o resto normaliza no próximo
  Backfill do sync). CSV/API não carregam offset (`coerceDate` emite naive) —
  não são afetados. Desde a 0085, as colunas `timestamptz` do NÚCLEO também
  leem no dia de Brasília (bounds ancorados + `_widget_local_ts`, §4.1) — os
  dois regimes (texto custom e instante do núcleo) finalmente concordam no
  mesmo dia.
- **Sheets**: o Apps Script (`integrations/apps-script/push_estudo_fechamentos.gs`)
  faz POST horário em `/api/sync/sheets`, protegido por `SYNC_SECRET`.
- **API/webhooks de entrada**: `/api/ingest/<fonte>` com chaves de API
  (`api_keys`, hash sha256) — ver `docs/webhooks.md`.
- **Write-back**: campos com `field_definitions.write_back = true` editados no app
  entram na fila e são gravados de volta no Bitrix pelo tick. A edição nunca
  espera o Bitrix; /registros mostra um badge "N aguardando envio"
  (`components/sync/writeback-pending-badge.tsx`) com link para o Log.

### 4.6 Papéis, permissões, RLS e MULTI-ORGANIZAÇÃO (0088–0094)

**Organizações (tenants):** o sistema atende N empresas isoladas no MESMO
banco/deploy. `organizations` guarda o branding editável (`app_name`/`name`,
exibidos no sidebar/título — Configurações → Organização);
`organization_members` vincula usuários (flag `is_org_admin` = Administrador
de Organização, ÚNICO por org e protegido por trigger); `app_owner` é o Owner
do sistema (1 linha; + env `OWNER_USER_ID`; guard fail-closed em
`lib/auth/owner.ts`). Isolamento: `organization_id` nas tabelas-raiz (default
Zapper; triggers de stamp cobrem sync/CSV/API) + RLS org-gated em TUDO
(`auth_org_ids()` prefixado, inclusive nos ramos admin) — as RPCs de widget
são SECURITY INVOKER e herdam sem serem tocadas (invariante 15). A org ATIVA
é um cookie httpOnly SEMPRE revalidado contra membership (`lib/auth/org.ts`);
pós-login, usuário comum entra direto e Owner/multi-org escolhe em
`/escolher-organizacao`. O console `/owner` (só o Owner) cria org (admin = o
próprio ou conta nova; `seed_org_defaults` — org nasce VAZIA) e exclui
(`delete_organization`; a org inicial só via SQL direto).

Três papéis de APP (`roles` + `user_roles`, POR org desde a 0092): **admin**
(tudo NA org), **gestor** (vê tudo, edita), **vendedor** (só os próprios
registros). Permissões-chave: `view_all_records`, `edit_record_values`,
`manage_field_definitions`, `view_forecast`. Só o org_admin concede/remove o
papel `admin` (`auth_can_grant_admin`). org_admin/Owner NÃO são linhas de
`roles` (`SPECIAL_ROLE_LABELS` é só rótulo).

**Acesso por pessoa aos boards (⋮ → Acesso, 0088):** `board_access` guarda
`view`/`edit`/`blocked` por usuário×board — override vence o papel
(`visible_to_roles` segue como camada por função); dono/admin nunca
bloqueáveis. Resolução ÚNICA nos helpers `auth_board_visible/editable/
manageable` (policies de dashboards/widgets/células/placements); as pages só
refletem (`canEdit`/`canConfig`).

**Overrides individuais (Configurações → Acessos, 0094):**
`user_access_overrides` concede (allow) ou revoga (deny) por usuário — áreas
de Configurações (deny esconde a aba/page E barra a ESCRITA das server actions
via `isSettingsAreaDenied`; allow concede só a VISUALIZAÇÃO além do papel, nunca
a escrita, que segue o papel) e bases (deny some dos pickers via RLS de
`data_sources` e dos DADOS via `records_select`). Fonte única dos gates por
área: `AREA_GATES` (`lib/auth/access.ts`); guard `requireSettingsArea` nas
sub-pages, `isSettingsAreaDenied` nos guards de escrita das actions;
`checkSettingsArea` é a variante sem redirect (condiciona LINKS, ex.:
botões Bases/Log no header de Registros). **As chaves de área são HISTÓRICAS
e desacopladas da rota** (27/07/2026): `fontes` vive em `/registros/bases`,
`log` em `/registros/log` e `moedas` na aba Moedas de `/campos` — NUNCA
renomear uma chave (os overrides gravados a referenciam); a matriz de Acessos
mostra a nova casa no rótulo ("Bases (Registros)" etc.). Estreitamento aceito
em Moedas: as taxas eram visíveis a qualquer autenticado; hoje só quem chega
a `/campos` (`manage_field_definitions`) as vê — o deny de `moedas` esconde a
aba e segue barrando a escrita.

**Escopo de BASES por board (⋮ → Bases, Fase 1 desta entrega):**
`DashboardSettings.sourceScope` define o catálogo EFETIVO do board —
`applySourceScope`/`collectBoardSourceKeys` (`lib/config/source-scope.ts`)
recortam as ofertas dos pickers E o universo dos widgets em "todas as bases",
preservando fontes já referenciadas (config antiga nunca quebra). Aplicado na
page do dashboard (re-provê `<SourcesProvider>` escopado), page do kanban,
`loadWidgetScope` (invariante 12), kanban-actions, snapshot-form e viewer
público. É restrição de OFERTA por board, não autorização (autorização é o
deny por usuário da 0094).

Helpers SQL (`auth_roles`, `auth_has_role`, `auth_has_permission`,
`auth_responsible_ids`) são SECURITY DEFINER e, desde a 0068, **sempre chamados como
`(select ...)`** nas policies (InitPlan — uma avaliação por statement, não por linha).

**A visibilidade de `records` segue o vínculo vivo** `records.responsible_id →
responsibles.user_id` (0037) — não o `owner_user_id` histórico, que é legado e não
deve ser usado para autorização. Reatribuir um registro ou vincular usuário a
responsável muda a visibilidade na hora, sem re-sync.

Tabelas de segredos (`api_keys`, `webhook_endpoints`, `snapshots`, `sync_jobs`) têm
RLS ligado com **zero políticas de escrita** — escrita só via service role.

### 4.7 Outros subsistemas

- **Tema visual (27/07/2026):** modo claro/escuro/sistema + cor de destaque
  (`--brand*`, default `#7431B3`), configurados em Configurações → Tema.
  Precedência: preferência do USUÁRIO (`user_settings.settings.theme/
  accentColor`) ?? padrão da ORG (`organizations.theme`, 0108 — só org_admin
  edita) ?? padrão do app — resolvida SÓ por `resolveTheme` (`lib/theme.ts`,
  também dono das whitelists de sanitização; nada cru de cookie vai a
  style/script). Os cookies `theme_mode`/`theme_accent` guardam os valores
  EFETIVOS: o root layout (`app/layout.tsx`) os lê e aplica `--brand-base` no
  style do `<html>` (portais Radix herdam) + a classe `.dark` via script
  inline pré-paint (sem FOUC); `ThemeSync` (layout autenticado) reconcilia
  cookie × banco (dispositivo novo/padrão da org alterado). O viewer público
  `/s/*` NUNCA escurece (cores congeladas foram escolhidas no claro — o
  script ignora o prefixo). Tokens em `app/globals.css`: `--brand` clareia no
  `.dark` via `color-mix`; `--ring` aponta p/ `--brand`; `bg-brand`/
  `text-brand`/`border-brand` via `@theme inline`. A cor entra SÓ em detalhes
  sutis (abas ativas, chips, foco, seleção, checkbox, barras de progresso,
  affordances de edição do grid) — `--primary` (botões/badges) segue quase
  preto. Cores SALVAS pelo usuário em widgets (seriesColors, notas, paletas
  fixas) ficam literais — limitação documentada, não bug.
- **Metas** (`goals`): escopo global/operação/responsável; comunicam-se por
  **roll-up na leitura** (`lib/metas/`); operações aninham via
  `parent_operation_id` + `operation_subtree`. Métricas de meta são chaves do
  registry (`lib/metas/metrics.ts` + `sync_config` `goal_metrics`) — arbitrárias
  desde 20/07/2026 (ver §4.9).
- **Operações como SEGMENTO (20/07/2026):** `records.operation_id` é uma cópia
  DERIVADA (operação priority=1 do responsável no momento do sync; update só
  preenche quando NULL) — pode estar NULL/defasada. Por isso o **filtro de
  Operação da visualização** (filtro_campo/filtro rápido) NUNCA compara a
  coluna literal: a page e o widget-scope resolvem no server
  (`lib/config/operation-scope.ts`) para `responsible_id in (vínculo vivo da
  subárvore — responsible_operations, qualquer priority)` + os **FILTROS DE
  PERFIL** da operação (`operations.filter`, 0083 — WidgetFilter[] com
  fonte-alvo opcional por condição, editados em Configurações → Operações;
  listas de exclusão serializam como `neq_ci` por valor, null conta). Com 2+
  operações selecionadas aplica-se só a união dos vínculos (perfis de
  operações diferentes não se combinam em AND). Dimensões/agrupamentos "por
  Operação" e restrições de snapshot seguem na coluna derivada — rode
  `supabase/apply/backfill-operation-id.sql` após mexer nos vínculos.
- **Persistência do "Filtro por campo" POR USUÁRIO (20/07/2026):** o estado
  vivo continua na URL (`ff_<widgetId>`), mas o debounce do
  `FieldFilterControls` também grava
  `user_preferences.settings.lastFieldFilters[widgetId]`
  (`saveLastFieldFilter`; valor vazio LIMPA a chave — filtro removido não
  ressuscita). Ao abrir o dashboard SEM o parâmetro na URL, page e
  `widget-scope` reidratam desse mapa (**URL sempre vence**) e a page manda o
  seed ao cliente (`fieldFilterSeedById`) p/ os controles montarem
  preenchidos — o primeiro debounce só ESPELHA a URL com
  `history.replaceState` raso (integrado ao router; sem navegação RSC nem
  persistência: o servidor já aplicou o seed). Navegar na montagem recomputava
  o dashboard à toa e, sob rajadas de `router.refresh()` do realtime (ex.:
  pós-recalc do preset), prendia o overlay "Carregando…" indefinidamente. O
  controle guarda a forma canônica encode∘parse do valor inicial
  (`serverAppliedRef`): `run(router.replace)` + `saveLastFieldFilter` só quando
  `encoded` diverge dela (mudança real do usuário — ou seed que não round-tripa
  numa config antiga dos fields, que precisa mesmo renavegar). Viewer de snapshot:
  URL-only (gate `useSnapshotMode` — visitante não tem sessão e usuário
  autenticado não pode poluir o dashboard vivo). Contraste: filtros rápidos
  do card e a janela de períodos (`__qf__`/`__pw__` em
  `dashboard_table_cells`) são COMPARTILHADOS entre usuários; o filtro por
  campo é preferência INDIVIDUAL por padrão, como o último período
  (`lastPeriod`).
- **Escopo do VALOR do "Filtro por campo" configurável (23/07/2026):**
  `settings.valueScope: "all"` (checkbox "Aplicar filtro para todos os
  usuários" na edição do widget; a chave NÃO pode se chamar `scope` —
  colidiria com `KpiSettings.scope` na interseção `WidgetSettings`) troca a
  persistência per-user pela célula compartilhada `__ff__`/`sel` de
  `dashboard_table_cells` (`saveSharedFieldFilter`; value = a MESMA string
  codificada de `ff_`/`lastFieldFilters`; mesma RLS/semântica do `__qf__` —
  quem muda o filtro muda para todos; propagação eventual, no próximo
  re-render RSC do outro viewer). No modo shared o cliente NÃO escreve a URL
  (transporte = banco, padrão `QuickFiltersBar`; espelhar a URL pinaria cada
  viewer no valor do mount) e ressincroniza do seed do servidor
  (`fieldFilterSeedById`, agora vindo da célula); um `ff_` residual de
  bookmark é honrado naquele render (URL ainda vence no servidor) e removido
  na primeira edição. Alternar para "all" deixa as entradas
  `lastFieldFilters` INERTES (nunca apagadas); voltar a "user" ignora (não
  apaga) a célula. `__ff__` fica fora do Desfazer/Refazer (como `__qf__`) e o
  viewer de snapshot segue URL-only por visitante. Ausente/`"user"` =
  comportamento per-user acima, byte-idêntico.
- **Opções visíveis dos dropdowns de filtro (22/07/2026):** `hiddenOptions`
  (blacklist por entry em `FieldFilterEntry`/`QuickFilterEntry`,
  `widgets.settings` jsonb — sem migração) oculta opções dos dropdowns do
  Filtro por campo (responsável/operação/etapa/campos `selecao`, inclusive a
  lista do op `in`) e dos filtros rápidos de responsável/operação (buckets de
  data ficam de fora — `cleanQuickFilters` descarta a chave p/ outros campos).
  SÓ exibição: nunca entra na consulta ("— todos —" segue sem filtro); valor
  selecionado que ficou oculto SEGUE aplicando e permanece na lista (conjunto
  `keep`) até o usuário trocar; opção nova (novo responsável, options do
  pipeline reescritas no sync) entra visível por padrão. A filtragem é no
  CLIENTE (`lib/widgets/hidden-options.ts`, aplicada em
  `field-filter-controls`/`quick-filters-bar` DEPOIS da decisão dropdown×texto
  pela lista crua — "tudo oculto" nunca degrada p/ input livre) — o viewer de
  snapshot herda de graça (settings congelados em `cfg.widgets`). O picker
  "Opções visíveis" do construtor (`VisibleOptionsPicker`,
  widget-builder-rows) carrega as candidatas lazy: `selecao` sai das defs
  locais; responsável/operação/etapa via `listFilterOptionCandidates`
  (dashboards/actions — espelha as consultas de opções da page, RPC existente;
  nenhum RPC novo); valores da blacklist que sumiram da lista aparecem como
  "(valor antigo)" p/ limpeza; trocar o campo/op zera a blacklist.
- **Presets de dashboard** (`lib/presets/definitions.ts` + `applyPreset`/
  `generatePresets` em `app/(app)/dashboards/actions.ts`, motor v2 20/07/2026):
  `PresetDashboard` declara settings completos (abas, periodBar/fieldBySource,
  canvas, background), widgets com `WidgetSettings` completo e dependências
  (campos — inclusive CALCULADOS com `formula`/`applies_to`, que disparam
  `recalcAllFormulaFields` best-effort ao serem criados —, sub-fontes e
  CORRESPONDÊNCIAS `PresetCorrespondence` — criadas após as subs, com o
  `record_type` dos membros resolvido pelo catálogo; chaves de métrica de meta
  são registradas no registry). Aplicação IDEMPOTENTE: dashboard identificado
  por `settings.preset.key` (adoção por nome p/ legado), widgets por
  `settings.presetKey` com UPDATE in-place (ids preservados →
  conectores/links/células sobrevivem), GC dos presetKeys órfãos do próprio
  preset; widgets sem `presetKey` e sub-fontes/campos/correspondências já
  existentes NUNCA são tocados. UI: **Configurações → Presets**
  (`configuracoes/presets/page.tsx` + `presets-manager.tsx`) — status por
  preset (marcador `settings.preset`) e botões Gerar/Atualizar (por preset e
  global). **Preset "Inbound"** (`lib/presets/inbound.ts`, v5 21/07/2026):
  porta as abas inbound do dashboard legado de pré-vendas — 7 sub-fontes com
  data própria (SQLs por Data Reunião aciona os mocks 0052; a sub `sals`
  segue existindo SEM cards desde a v5), campo calculado `mrr_contrato`,
  correspondências `data_ref`/`fonte_venda`/`mrr_venda` e 20 widgets (TODOS
  os cards com badge `previous_period_bd` — inclusive os de fórmula e o de
  razão, ver §4.9; SQL total/% de conversão via Card fórmula com operandos
  escopados, Mês x Mês com `periodWindow` (dropdown de janela, padrão 6
  meses) + `businessDayAlign` + `goalLine` métrica `sql` em modo pace, coorte
  via dimensão `match:`). Desde a v5 a identidade VISUAL é dado do preset:
  `settings.background` cinza `#E9ECEF`, faixa `appearance.kpi.accent` roxa
  `#A98AC0` nos cards, `seriesColors` roxo/verde/âmbar nos gráficos e paleta
  nomeada `inbound` (`lib/widgets/palettes.ts` — matizes da marca
  aprofundados, validados p/ contraste/CVD) nas barras `colorByCategory` e na
  pizza. ATENÇÃO: o update por `presetKey` sobrescreve o `settings` INTEIRO
  do widget gerido — ajustes manuais de aparência em widgets do preset se
  perdem no re-apply. Pré-requisitos de DADO no runbook (manual §4.7).
- **Moedas** (`currencies`/`currency_rates`, `lib/widgets/currency.ts`): conversão
  BRL/USD por taxas **ano/trimestre** (PTAX), com breakdown por moeda; agregações
  não-lineares (min/max monetário) exibem o valor cru, sem breakdown.
- **Matching entre fontes** (`match_rules`/`record_matches`,
  `lib/records/matching-engine.ts`): casa registros de fontes diferentes (ex.: venda
  do site ↔ lead de origem por e-mail); o RPC expõe campos do registro casado.
- **Campos calculados** (`field_definitions.formula`, `lib/records/formulas.ts`):
  materializados em `records.custom_fields`; recalc diário via
  `/api/sync/recalc-daily` (fórmulas com "Data atual"), em lote via
  `recalc_apply_updates` (0070).
- **Aninhamento de campos calculados** (19/07/2026,
  `lib/records/formula-deps.ts`): um calculado pode referenciar outro, nos dois
  tipos. **Ciclos são rejeitados no salvamento** (`findFormulaCycle`, grafo
  unificado calculado + calculado_agg; os catálogos excluem o campo em edição +
  dependentes transitivos) e a **exclusão de campo referenciado por fórmula é
  bloqueada** (`deleteField`). Por registro: `computeFormulaFields` ordena os
  defs topologicamente e injeta cada resultado no contexto (com a moeda do
  resultado em `operandCurrency` — herança/conversão em cadeia); ciclo residual
  no banco materializa null. Agregados: o ref é o plano `custom:<key>` e o
  engine **expande tokens em runtime** (`expandAggFormula`, aplicada em
  `resolveCalcMetric` e `runCalculatedWidget` — cobre widgets, subtotais/Total,
  snapshots, calculadora/nota/cards/tabela rápida) — nada muda nos RPCs
  `run_widget_query*`. Semântica: referenciar = embutir a FÓRMULA do campo
  entre parênteses; o formato do campo referenciado (moeda fixa,
  `allow_negative`, percentual) NÃO se aplica dentro do campo externo — valem
  os do campo externo. Refs aninhados dentro de SOMASE/CONT.SE/MÉDIASE
  continuam proibidos (argumentos são estruturais). O catálogo do widget-builder
  (`calcRefs` — métrica ad-hoc, variáveis, Card e o FieldForm inline) oferece o
  operando aninhado desde 19/07/2026 (`aggNestedOperandRefs`), como o `/campos`.
- **Operandos com ESCOPO DE FONTE** (19/07/2026, `lib/widgets/calc-metrics.ts`):
  um operando agregado pode mirar UMA fonte: ref `agg:<agg>:<campo>@<fonte>`
  (rótulo `… · <Fonte>`, gerado por `sourceScopedAggOperandRefs` para cada fonte
  RAIZ onde o campo se aplica). Resolve o clássico "Contagem de Data de criação
  de Leads ÷ a de Deals dá 1" — antes as duas escolhas compilavam para a MESMA
  ref agnóstica de fonte e caíam numa única chave de basis. Em runtime o ref é
  ABAIXADO (`lowerSourceScopedOperands`, nos mesmos choke points do
  `expandAggFormula`: `resolveCalcMetric` + `runCalculatedWidget`) para a chave
  condicional `aggif:` com o predicado da fonte (`record_type =` da raiz; sub
  soma o `filter` quando expressável como `[Coluna] op literal` — senão o
  operando resolve null, nunca um recorte mais largo). Reusa TODO o caminho das
  agregações condicionais (consulta auxiliar com filtros anexados, fold aditivo
  exato em subtotais, viewer de snapshot) — **nada muda nos RPCs** (invariantes
  1/9/10). Ref bare (sem `@`) segue = universo em escopo (compat total; sem
  migração de configs). O escopo conta como fonte da métrica no planejamento:
  `formulaScopedSources`/`metricScopedSources` entram em `widgetQuerySources`
  (@period) e `metricLegSources` (perna própria quando a fonte está fora do
  universo do widget). Limitações v1: soma monetária com escopo degrada p/ soma
  crua entre moedas (mesma das condicionais) e `min`/`máx` não têm forma com
  escopo.
  **Extensão 20/07/2026 (base do preset Inbound):** (a) o predicado da sub
  aceita também `in` (lista), `is_null`/`not_null` e `eq_ci`/`neq_ci` — só
  `ilike`/op desconhecido degradam (aviso no validador); (b) a chave `aggif:`
  ganha um 4º elemento OPCIONAL `scope` (source-key — chaves sem escopo
  seguem byte-idênticas); (c) a consulta AUXILIAR de um operando escopado
  roda como perna SÓ da fonte do escopo: período aplicado na coluna de DATA
  dela (`scopedAuxPeriod` reescreve o `fieldBySource`; `patchAuxPeriodByType`
  cobre o `@period` pré-sintetizado) e `p_correspondences` com o membro DELA
  (um `unified:` de data bucketiza pela data da sub, não da pai). Isso permite
  no MESMO widget operandos de duas subs do mesmo `record_type` com datas
  diferentes (ex.: `@sqls` por Data Reunião + `@clientes_lite` por mudança de
  etapa — o "SQL total" e os % de conversão do Inbound). Implementado nos 3
  choke points com o período DA RODADA (atual/perna do businessDayAlign/
  comparação): `computeRows`+pernas por métrica (`engine.ts`) e
  `runCalculatedWidget` (`formula-metric.ts`). O catálogo de operandos
  escopados passa a ofertar sub-fontes (`sourceScopedAggOperandRefs`).
  Caminhos client-side (`dateAgg`/listas) avaliam o predicado estendido mas
  NÃO rejanelam pela data da sub (limitação documentada); a aux do `@sqls`
  referencia a chave de Data Reunião no filtro → regra dos mocks 0052 segue
  valendo.
- **Catálogo por-registro ÚNICO** (19/07/2026, `lib/records/calc-operands.ts`):
  `perRecordCalcOperands` monta os operandos do campo calculado POR-REGISTRO
  para os DOIS editores (página `/campos` e o FieldForm inline do
  widget-builder) e para a validação do servidor (`serverOperandCatalog` em
  `campos/actions.ts` deriva dele; `validateFormula` recebe o MESMO conjunto).
  Inclui números (núcleo + custom + **casados**, `matchNumericOperands` — novo),
  datas (próprias + casadas + hoje) e condicionais no editor de texto. Antes o
  inline era numérico-only e uma fórmula com datas/casados abria como refs cruas
  (`[custom:…] - [match:…]`) irrecriáveis. Não monte listas de operando
  por-registro fora deste módulo.
- **Relações em fórmulas por NOME** (19/07/2026): `[Responsável]`/`[Operação]`
  entram como condição (`CORE_COND_REFS` += `responsible_id`/`operation_id`) e
  comparam pelo NOME, nunca pelo UUID: por-registro, o contexto recebe o
  `display_name` (recalc + `applyCalcFields`); no agregado
  (SOMASE/CONT.SE/CONT.SES), o literal é resolvido nome→id ANTES do RPC
  (`resolveFkCondFilters` no engine; aplicado também no caminho agrupado e nos
  folds client-side via rótulos id→nome). Nome inexistente: recorte vazio em
  runtime e **erro claro no save** do `/campos` (`validateFkCondNames`).
- **Condições agregadas ampliadas** (19/07/2026): `condAggOperandRefs` passou a
  aceitar colunas do registro CASADO (`match:<fonte>:*` — o loop de filtro dos
  RPCs já resolvia via `_widget_match_expr`; custo: subquery por linha, 0077) e
  campos UNIFICADOS (`unified:<key>`, texto/seleção/data) como condição de
  SOMASE/CONT.SE. "Data atual" fica no catálogo mas NUNCA compila em fórmula
  agregada (não é coluna) — `validateCondAggRefs` devolve mensagem dedicada em
  vez de degradar para "—" silencioso.
- **Redesign do editor de fórmulas** (20/07/2026 — UX de campos/métricas
  calculadas; nenhum RPC tocado, formato `Formula {tokens, source}` intacto):
  - **Catálogo AGREGADO com builder único** (`lib/widgets/agg-catalog.ts`):
    `buildAggOperandCatalog` + `availableAggCatalogInput` (sítios de widget) /
    `defsAggCatalogInput` (/campos e servidor) substituem as SEIS montagens
    copiadas (widget-builder, fields-manager, campos/actions,
    quick-table-actions, Nota/widget-card, viewer de snapshot). Paridade
    ref|label|group verificada por script na migração. NÃO monte o catálogo
    agregado chamando as quatro funções de calc-metrics na mão — derive o input
    e chame o builder.
    - **Casados no lado defs** (20/07/2026): `defsAggCatalogInput` inclui os
      campos do registro CASADO (`match:<fonte>:<ref>`) em `numeric`/
      `countable`, derivados do `buildMatchFields` exportado
      (`lib/widgets/fields.ts`) — a MESMA construção dos sítios de widget, para
      ref+rótulo (`↪ <Fonte>: <Campo>`) idênticos byte a byte; nunca remonte
      esses rótulos à mão. Antes o servidor rejeitava ("Coluna inválida na
      fórmula: agg:*:match:…") fórmulas que os editores de widget ofereciam e o
      RPC suporta (count/sum/avg sobre `_widget_match_expr`, 0042). Os casados
      entram de TODAS as defs, não só das não-proibidas: `match:` não cria
      aresta de dependência/ciclo (`refCustomKey` → null), como já valia no
      catálogo por-registro. Lacuna conhecida (deferida): agregado sobre campo
      UNIFICADO (`agg:*:unified:<key>`) segue rejeitado no save de campo
      reutilizável — o lado defs não carrega correspondências.
  - **Validação de contexto única** (`lib/records/formula-validate.ts`):
    `validateFormulaForContext(formula, {kind: "record"|"aggregate", catalog,
    sources?})` concentra estrutura+refs (`validateFormula`), colocação de
    SOMASE/… (`validateCondAggRefs`) e as mensagens dedicadas do por-registro
    (agg:/SOMASE proibidos). O servidor (`resolveAndValidateFormula`) e os
    editores rodam O MESMO módulo — validação AO VIVO com as mensagens do save.
    `warnings` (não bloqueiam) apontam operandos que degradariam para "—"
    (escopo `@fonte` não abaixável).
  - **FormulaEditor unificado** (`components/formula/`): substitui o par
    FormulaBuilder/FormulaTextEditor (removidos) e o toggle Construtor/Texto
    copiado em 6 superfícies (FieldForm calculado/calculado_agg, widget
    "calculado", métrica ad-hoc, variáveis da calculadora, Card-fórmula).
    Views Visual|Texto sobre UM estado (trocar de aba nunca perde conteúdo;
    texto inválido segura a aba); visual com CURSOR de inserção; paleta de
    funções (SE/SOMASE/…/ANTERIOR montáveis por clique — antes só digitando);
    ref não resolvida vira chip "⚠" (ref bruta só em tooltip); operandos
    proibidos (ciclo, "Data atual" no agregado) aparecem DESABILITADOS com o
    motivo (`disabledReason` em OperandRef/ComboboxOption) — política:
    explicar, nunca esconder. O tipo `RefOption` agora é alias de `OperandRef`
    em `lib/records/date-operands.ts` (a lib não importa mais de componente).
    Contrato de form do FieldForm preservado (`formula`/`formula_text`/
    `formula_mode`).
  - **Prévia ao vivo pelos choke points** (nunca caminho paralelo):
    por-registro via `app/(app)/campos/preview-actions.previewRecordFormula`
    — usa `lib/records/record-eval-context.ts` (montagem de contexto EXTRAÍDA
    do recalc; `recalcAllFormulaFields` consome o mesmo módulo, então prévia e
    materialização são idênticas) + `computeFormulaFields` sobre até 30
    registros reais, com nota "sem registro casado de <fonte>"; agregada via
    `app/(app)/dashboards/formula-preview-actions.previewAggregateFormula` —
    `runCalculatedWidget` com fontes/filtros do builder, SEM o período da
    barra (selo avisa), opt-in por clique (custa RPCs como um widget).
  - **Receitas guiadas** (`lib/records/formula-recipes.ts` +
    `components/formula/recipe-strip.tsx`): "Ciclo de vendas" ([data fim] −
    [`match:<fonte>:<data início>`], campo por-registro) e "Taxa de conversão"
    (`agg:count:…@A ÷ agg:count:…@B`, agregado, %). São ATALHOS por cima do
    editor livre — geram fórmula normal, 100% editável; opções derivadas dos
    catálogos vivos (nada de lista paralela). A de ciclo consulta
    `getMatchCoverage` e orienta para Campos → Conexões quando o casamento não
    existe (nunca bloqueia). Entradas: FieldForm (a receita escolhe o TIPO do
    campo), métrica ad-hoc e widget calculado.
  - **Promoção de fórmula ad-hoc a campo**: "Salvar como campo reutilizável…"
    na métrica ad-hoc abre o FieldForm inline pré-preenchido
    (`initialDataType`/`initialFormula`); ao criar, a métrica de origem passa a
    apontar para o campo salvo (rótulo/fontes preservados).
- **Kanban/Tarefas/Agenda/Feed**: kanbans reusam `dashboards` (`kind='kanban'`);
  posições em `kanban_placements`; tarefas em `tasks` (RLS espelha registros; trava
  `locked` via trigger); comentários/subtarefas em `comments` + colunas de 0066.
  **Widgets kanban na seção Kanbans do hub (26/07/2026):** a seção lista TAMBÉM
  os widgets `visual_type='kanban'` de dashboards comuns ATIVOS (query
  `widgets` + `dashboards!inner` na Home; mapeamento puro em
  `lib/kanban/hub.ts`; a RLS de `widgets` — `auth_board_visible` do pai — já
  recorta a visibilidade). O card ("No dashboard X", SEM menu ⋮ — o ciclo de
  vida é do dashboard/widget) abre a página cheia `/kanbans/w/[widgetId]`, que
  renderiza o MESMO kanban do widget: mesma config `widgets.settings.kanban`
  (salvar lá reflete no dashboard e vice-versa, via `saveWidgetSettings`) e
  mesmos `kanban_placements.widget_id` — SEM linha espelho em `dashboards`.
  A página cheia reusa `kanban-page-client.tsx` (prop `widgetCtx`); Agenda e
  Aparência ficam de fora (board-only — aparência do widget se edita no
  builder). Pai arquivado sai do hub mas a URL direta segue abrindo (paridade
  com boards); pai na Lixeira → 404.
- **Ciclo de vida de boards no hub (22/07/2026, 0087):** o card do hub
  (`app/(app)/page.tsx` + `board-card-menu.tsx`) tem menu "⋮" com Duplicar/
  Arquivar/Excluir (dashboards E kanbans). **Excluir é SOFT** (`trashBoard` →
  `status='trashed'` + `trashed_at`): o board cai na seção recolhida "Lixeira",
  não abre (404 em `/dashboards/[id]`, `/kanbans/[id]` e `/s/[token]`; fora de
  `validateLastView`, dos pickers `listWidgetLinkTargets`/`listTaskBoards`, do
  lookup de preset e o refresh de snapshot aborta), pode ser restaurado ou
  excluído em definitivo (`deleteBoardPermanently`, só `status='trashed'`) e é
  purgado após 14 dias (`apply/pg-cron-purge-trash.sql`; o hub esconde vencidos
  mesmo sem o cron). **Arquivar** (`archiveBoard`) só tira da tela principal —
  segue abrindo por tempo indeterminado (seção "Arquivados"). **Duplicar**
  (`duplicateBoard`): qualquer usuário que ENXERGA o board e tem
  `create_dashboards` — a cópia nasce privada/ativa do usuário, com ids NOVOS
  de widgets e settings REMAPEADOS (connectors, `shape.link`, links de nota
  `[..](@id)`, `excludedTargets` — substituição literal de uuids no JSON),
  identidade de preset REMOVIDA (`settings.preset`/`presetKey` — o applyPreset
  nunca adota/sobrescreve a cópia), células (`dashboard_table_cells`) e
  `kanban_placements` copiados; snapshots/user_preferences/tasks NÃO.
- **Realtime** (0071): `records`/`tasks`/`comments` publicam em
  `supabase_realtime`; o app usa os eventos só como sinal de "algo mudou"
  (`components/realtime-refresher.tsx`).
- **Formato do grupo nas tabelas** (18/07/2026):
  `widgets.settings.appearance.table.groupDateFormats` (opcional; chave = field
  do nível nas listas, `dim_<n>` na agregada) funde/rotula o grupo de um nível
  de data do "Agrupar por" por formato próprio (`bucketGroupDate`,
  `lib/widgets/date-buckets.ts`) sem alterar o formato da dimensão nas linhas.
  Na agregada só vale para dimensões SEM transform "por nome" (o engine troca o
  ISO da linha pelo rótulo). Client-side apenas (nada muda nos RPCs) e o viewer
  de snapshot honra por vir congelado no settings.
- **Fonte do dado das colunas unificadas** (18/07/2026):
  `RecordListColumn.unifiedSources` (opcional, modo registros) define uma
  hierarquia de fontes com fallback: por registro, o valor vem da 1ª fonte da
  lista com dado não-vazio — o próprio registro ou o registro CASADO dela
  (`__match`, sempre anexado por `attachMatches`; snapshots usam
  `snapshot_record_matches`). Ausente = membro da fonte de cada registro.
- **Edição inline sem re-render global** (18/07/2026): a edição de célula
  (`updateRecordField`) NÃO chama `revalidatePath` — a célula é otimista
  (`components/registros/use-cell-commit.ts`) e a página reconcilia no cliente
  via realtime + `router.refresh()` debounced FORA da transition da célula
  (`lib/use-debounced-refresh.ts`). Só o form lateral (`RecordEditSheet`) e
  `createRecord` revalidam no servidor. Não reintroduza `revalidatePath` (nem
  `router.refresh()` síncrono no `onSaved`) no caminho de célula: Server Actions
  serializam por cliente e o re-render RSC da rota inteira a cada blur é o que
  travava a navegação.
- **Linha divisória** (25/07/2026): a antiga Forma "linha" virou o
  `visual_type 'linha_divisoria'` (0100 — CHECK + backfill dos widgets vivos);
  os settings seguem `{ shape: { kind: "linha", line } }` e a renderização
  segue na camada livre (`line-layer.tsx` + geometria em `lib/widgets/lines.ts`).
  A identidade é decidida SÓ por `isLineShapeWidget` (chokepoint único —
  partição do grid, estado otimista, paste, aparência, `saveShapeLine`), cujo
  braço legado (forma + `shape.kind 'linha'`) é PERMANENTE: configs congeladas
  de snapshot (`snapshots.config.widgets`) e payloads antigos de clipboard não
  passam pelo backfill. Não teste `visual_type === 'linha_divisoria'` na mão.

### 4.8 Sub-fontes (fonte derivada, filtrada)

Uma **sub-fonte** (`sub_sources`, 0078) é tratada como fonte em todo o app, mas
suas linhas são as da fonte **PAI** recortadas por um `filter` (WidgetFilter[]),
com **campo de data próprio**. Motivação: um campo unificado (`unified:<key>`)
pode então mapear DUAS datas para o mesmo `record_type` — ex.: Leads → *Data
Reunião* e a sub Leads/Clientes Lite → *Data da mudança de etapa*.

- **Modelo:** tabela separada de `data_sources` (a sub compartilha o
  `record_type` da pai — não pode virar linha de `data_sources` sem quebrar o
  `record_type unique`/FK de `records`). `loadSources` une os dois num único
  `SourceDef[]` (`parentKey`/`filter`; `recordType` = o da pai). O membro de
  campo unificado passa a ser identificado por `source_key`
  (`field_correspondence_members`, unicidade `(correspondence_id, source_key)`).
- **Resolução no ENGINE (sem tocar nas RPCs):** `planSourceLegs` decide, por
  widget, a fonte **efetiva** de cada `record_type` na consulta PRINCIPAL — uma
  só. Subs **absorvidas** (a pai também está no widget) somem: a pai já cobre
  suas linhas, sem duplicar (padrão). Sub **avulsa** (pai ausente) recorta as
  linhas da pai: o predicado entra scoped via `_widget_wrap_record_types`, o
  `@period.byType[record_type]` usa a data da sub e o `coalesce` do unificado
  recebe o membro da sub (`correspondenceMapForSources` — um ref por perna,
  senão pai+sub colidiriam num mesmo coalesce). Como cada `record_type` tem UMA
  fonte efetiva, `byType`/coalesce/`record_type in` continuam chaveados por
  `record_type` e o par `run_widget_query`/`_snapshot` fica intocado.
- **Mapa de unificados SEMPRE por perna (v1.6):** TODA consulta (`runWidget`,
  `runCalculatedWidget` — calc/calculadora/nota/card/`{=…}` — e as pernas por
  métrica) monta `p_correspondences` com `correspondenceMapForSources(corrs,
  fontes efetivas, catálogo)` — nunca com o mapa global. Não é só quando há sub
  selecionada: como a sub compartilha o `record_type` da pai, o membro dela num
  campo unificado entraria no `coalesce` de um widget SÓ-PAI (o `record_type
  in` não o exclui — as linhas são as mesmas) e mudaria resultados
  silenciosamente. Fallback perna → membros de fontes RAIZ → todos (o RPC ergue
  "Correspondência sem colunas" p/ chave referenciada ausente; snapshots
  pré-0078 têm membros sem `source_key`). `buildCorrespondenceMap` (união
  global) sobrevive SÓ nos RPCs de opções de bucket (display). O espelho
  client-side `AvailableField.unifiedMembers` (por `record_type`) é
  RAIZ-primeiro: membro de sub só preenche `record_type` sem membro raiz.
- **Conviver (toggle `settings.coexistSubSources`):** marcar uma sub como
  "conviver" (com a pai também selecionada), ou selecionar 2+ subs da mesma pai,
  gera **pernas EXTRAS** — no caminho agregado, cada fonte de linha vira uma
  perna própria, calculada por recursão em `runWidget` (filtro + data + membro
  próprios). O usuário assume que os conjuntos são disjuntos. **Para
  restringir a PAI sem esvaziar a sub** (ex.: pai só "Desqualificado" × sub
  "Clientes Lite"), o filtro do widget precisa ter a PAI como fonte-alvo
  (`WidgetFilter.sources = [pai]`): filtros globais (sem alvo) valem para
  TODAS as pernas e cairiam também sobre a sub. "Agrupar período" e o modo
  lista ficam no **absorver** (a perna extra não vira série nesses tipos) —
  limitação v1.
- **Exibição das pernas (`settings.subSeriesMode`, 24/07/2026):** como o
  branch multi-perna apresenta as pernas — seletor "Exibição das sub-bases" no
  builder (seção Bases), visível só quando há pernas extras num visual que as
  plota (barra/barra_horizontal/linha/tabela).
  - **"stacked"** (ausente = default) e **"grouped"**: o engine mantém a fonte
    como dimensão LÍDER (`dim_1` = "Base", dims reais deslocadas) e carimba
    `WidgetData.subSeries.mode`; o CHART pivota (`buildSubSeriesPivot`,
    `lib/widgets/sub-series.ts`): categorias = `dim_2` (a dimensão real), uma
    série sintética por (sub-base × métrica) — empilhadas (stack POR métrica)
    ou lado a lado — com legenda pelos rótulos das subs, `keyMap` p/ a
    formatação resolver a métrica subjacente e `__cat_total:<metric>` p/ o
    top-N/ordenação ranquearem a CATEGORIA inteira (`limitCategories` ganhou o
    param `rankKey`). Tabela agregada e CSV "dados exibidos" seguem as linhas
    originais (coluna "Base"). Cores por categoria/condicional por coluna não
    se aplicam no pivot (cor é por série).
  - **"total"**: o engine funde as linhas das pernas por tupla de dims — SEM a
    dim "Base" — com a semântica do Total geral (`foldRowGroup`,
    `lib/widgets/bucket-merge.ts`): sum/count somam, min/max reduzem,
    calculadas REAVALIAM a fórmula original sobre a basis fundida (razões
    exatas), monetárias fundem `__money` e replotam; `__cmp` soma os não-nulos
    (aproximação, como o "Outros") e `__goal` NUNCA soma (é a mesma meta
    repetida por perna). Tabela/CSV perdem a coluna "Base" automaticamente.
  - **Forced total:** pizza/funil com ≥1 dim e KPI/card fundem SEMPRE (uma
    fatia/valor por categoria — antes a pizza gerava uma fatia por sub×categoria
    e o KPI simples mostrava só a 1ª perna). Subs não-disjuntas contam em
    dobro no total (mesma ressalva do conviver).
- **Operando escopado em fonte-IRMÃ é ZERADO por perna (24/07/2026):** a
  consulta auxiliar de um operando `agg:…@fonte` roda independente do universo
  da perna (perna SÓ da fonte do escopo — §4.1), então uma fórmula
  `count@subA + count@subB` repetiria o TOTAL global em toda perna (o bug do
  CSV 67/67 do "Fonte SQL"). Antes de recursar, o branch multi-perna zera na
  fórmula (métricas E defs 'calculado_agg' aninhadas —
  `zeroSiblingScopedOperands`/`zeroSiblingScopesInFields`,
  `lib/widgets/calc-metrics.ts`) os operandos cujo escopo é OUTRA perna de
  linha do mesmo widget: sum/count → literal 0 (identidade aditiva); avg →
  `(0/0)` = null (média de irmã ausente nunca vira 0 falso); min/max ficam (já
  avaliam null). O escopo da PRÓPRIA perna permanece. Depois, cada linha da
  perna recebe backfill `0` nas chaves de basis das irmãs
  (`siblingScopedBasisKeys`) — o meta da métrica carrega a fórmula ORIGINAL, e
  o re-eval client-side (células/subtotais) bate com a perna enquanto o fold
  entre pernas soma as contribuições complementares (Total geral exato p/
  fórmulas aditivas). Limitação documentada: RAZÃO entre escopos irmãos numa
  perna avalia null/0 — use o modo "total", que reavalia globalmente.
- **Arquivos:** `lib/sources.ts` (resolvers + `planSourceLegs`),
  `lib/widgets/engine.ts` (fonte efetiva + branch multi-perna + merge "total"),
  `lib/widgets/sub-series.ts` (pivot p/ o chart), `lib/widgets/bucket-merge.ts`
  (`foldRowGroup`), `lib/widgets/calc-metrics.ts` (zeroing de irmãs),
  `record-list.ts` (mesmo no modo lista), `lib/correspondences.ts`
  (`correspondenceMapForSources`), UI em
  `components/configuracoes/sub-sources-manager.tsx` e os controles (conviver +
  "Exibição das sub-bases") no `widget-builder.tsx`.
- **Ordem do coalesce dos unificados (20/07/2026):**
  `correspondenceMapForSources` ordena os refs com os `custom:` (ESPARSOS —
  só existem nas linhas do próprio record_type) ANTES das colunas do núcleo
  (DENSAS — preenchidas em todo record_type). Sem isso, `source_created_at`
  (membro do lead) sombreava `custom:data_assinatura` (membro do deal) na
  MESMA perna e o deal bucketizava pelo mês de criação. Limitação restante:
  dois membros de coluna de NÚCLEO distintos ainda se sombreiam (correção
  definitiva = CASE por record_type no RPC, migração espelhada futura).
- **Campo de período `custom:` (0082/0110):** `sub_sources.default_period_field`
  (0082) e `data_sources.default_period_field` (0110) aceitam também um campo
  personalizado de DATA (`custom:<field_key>` — ex.: sub "SQLs" da pai Leads
  datada pela *Data Reunião*; base de parceria datada por campo próprio). O
  read side já suportava (`@period.byType` aceita `custom:` e a regra dos
  mocks 0052 inspeciona o byType serializado); a validação semântica (campo
  existe, é `data`, não é override core da 0086 e o `applies_to` cobre o
  record_type da base) fica na server action de fontes. O picker de
  Registros → Bases (bases E subs) oferece "só colunas com dados": probe
  PostgREST na page (`lib/config/period-field-probe.ts` — `is_mock = false`
  sempre; NUNCA via RPC, que não filtra `is_mock` e cuja regra 0052 incluiria
  mocks) + montagem pura em `lib/source-date-fields.ts`; base sem linha
  não-mock cai nas 6 colunas core, o valor salvo segue sempre listado e o
  picker da sub usa a lista da PAI (o recorte da sub não é aplicado no probe —
  simplificação documentada).
- **Pastas de bases (0107, 26/07/2026):** `source_folders` agrupa as bases
  RAIZ em **Pastas** — agrupamento de EXIBIÇÃO puro + ordem manual
  (`data_sources.folder_id`/`sort_order`, `sub_sources.sort_order`; botões
  ↑/↓ em Registros → Bases). Navegação Pasta → Base → Sub-base em
  /registros (100% URL-driven pelo `?fonte=` de sempre — a pasta ativa DERIVA
  da base ativa; sem pasta criada, degrada para as abas planas) e /campos;
  headings por pasta nos pickers (widget-builder, diálogo Bases do board — as
  pastas viajam na PRÓPRIA action `getBoardSourcesState`, catálogo completo —,
  matriz de Acessos, import por IA, period-filter, correspondências) e nas
  tabelas de Registros → Bases. TODO agrupamento sai de
  `groupSourcesByFolder` (`lib/source-folders.ts` — implícita "Geral"
  primeiro, pastas por `sortOrder`, **grupos vazios omitidos**: catálogo
  recortado por `applySourceScope`/RLS esconde a pasta esvaziada sozinho);
  pastas chegam ao client pelo `SourceFoldersProvider` (layout; o viewer
  público não o monta). Pasta NUNCA entra em consulta/engine/RPC, no
  `sourceScope` (segue por keys) nem em permissão — excluir pasta devolve as
  bases para "sem pasta" (FK SET NULL). Sub não tem pasta própria (herda a da
  pai na exibição).

### 4.9 Dias úteis, meta ideal e alinhamento por dia útil (20/07/2026)

Peças genéricas para acompanhamento diário (base do futuro preset "Inbound"):
tudo resolvido no **ENGINE** — o par de RPCs fica intocado (mesma família das
invariantes 9/10).

- **Dias não úteis** (`non_working_days`, 0081): calendário único global —
  dia útil = seg–sex fora da tabela. Utilitários PUROS em
  `lib/date/business-days.ts` (`businessDaysInMonth`, `businessDayIndexInMonth`,
  `nthBusinessDayOfMonth`…), loader resiliente em
  `lib/config/non-working-days.ts` (falha → Set vazio = só fim de semana). UI em
  Configurações → Metas (cadastro manual, edição de rótulo e import CSV parseado
  no browser — `Papa.parse` + `coerceDate`). No viewer público, a tabela entra
  em `PASSTHROUGH_TABLES` (leitura AO VIVO, precedente das metas — cadastrar um
  feriado não exige refresh do snapshot).
- **Metas por métrica arbitrária:** `goals.metric` sempre foi texto livre; o
  vocabulário vem do registry (`lib/metas/metrics.ts` — builtins `mrr`
  monetária/`clientes` + custom do `sync_config` `goal_metrics`, criadas na tela
  de Metas). O REALIZADO do KPI modo meta é a métrica configurada no PRÓPRIO
  widget (`config.metrics[0]`; sem ela, legado por chave) — criar a métrica de
  meta "sql" não cria consulta nenhuma.
- **Alinhamento "mesmo dia útil"** (`WidgetSettings.businessDayAlign`): com
  dimensão de data MENSAL e período ativo, cada mês vira uma perna
  `computeRows` com o range recortado no N-ésimo dia útil do mês (N = dia útil
  corrente da referência — hoje limitado ao fim do período, ou o fim do
  período). Meses "encerrados" no alinhamento (N ≥ dias úteis do mês) usam o
  mês CHEIO (não perde registro datado em fim de semana). Como cada rodada só
  devolve linhas do próprio mês, o concat é o resultado — todas as métricas
  (normais/calculadas/moeda/pernas por fonte) funcionam sem código novo. Teto
  de 13 meses (acima disso o align é ignorado). Precedências: KPI/card e
  "Agrupar período" (`dateAgg`) não passam pelo align; pernas de sub-fonte
  "conviver" recursam `runWidget` e o align roda DENTRO de cada perna. Com o
  align ativo, `settings.comparison` é IGNORADA (exclusão mútua — o gráfico já
  é a comparação). **Badge "Nº dia útil" (21/07/2026):** com o align ativo e
  N ≥ 1, o engine expõe `WidgetData.businessDayRef` (`{ n, reference, date }` —
  o MESMO N de corte das pernas e da goalLine "pace", único e compartilhado
  entre os meses comparados) e o card exibe o badge (`BusinessDayBadge`,
  rótulo por `businessDayOrdinalLabel` em `lib/date/business-days.ts`) ao lado
  do toggle do `PeriodWindowControl` — ou sozinho no mesmo slot quando não há
  dropdown (align direto nos settings, viewer de snapshot). Metadado 100%
  engine (RPCs intocados); no snapshot funciona porque o viewer roda o mesmo
  `runWidget` (feriados AO VIVO via `PASSTHROUGH_TABLES`).
- **Janela de períodos equivalentes** (`WidgetSettings.periodWindow`,
  20/07/2026): "traz o equivalente ao período apurado nos meses anteriores"
  como FILTRO RÁPIDO do card. `options` (subconjunto ordenado de `3m |
  trimestre | 6m | semestre | 12m | ano`) define o dropdown no card
  (`PeriodWindowControl`); `default` é a janela sem seleção;
  `showAlignToggle` expõe o seletor "dia útil × dia cheio". Semântica:
  rolling `3m/6m/12m` = N meses terminando no mês do `to` da barra;
  `trimestre/semestre/ano` = calendário do `to`. Cada mês recebe o RECORTE
  equivalente ao período da barra — com align, o corte no N-ésimo dia útil
  (regras acima); em "dia cheio", o span de DIAS equivalente quando a barra
  cabe num único mês (dia(from)–dia(to), clampado; "Este mês" → meses
  cheios), senão meses cheios — e o mês final respeita o `to`. A SELEÇÃO do
  card é COMPARTILHADA entre usuários (célula `__pw__`/`sel` de
  `dashboard_table_cells`, `savePeriodWindowChoice`), como os filtros
  rápidos; page e `widget-scope` mesclam a escolha nos settings EFETIVOS
  antes do engine (`applyPeriodWindowChoice` → `periodWindow.active` +
  `businessDayAlign.enabled`); o engine só lê o resolvido
  (`active ?? default`) — por isso o viewer de snapshot (que congela os
  settings) cai no default. `businessDayAlign.windowMonths` (2–13) segue
  como alias LEGADO (janela fixa rolling), fora do builder. Assimetria
  estrutural documentada: o universo de meses (linhas) vem da consulta
  PRINCIPAL (fontes do widget) — mês com registro só em fonte de perna
  (`Metric.sources`) não vira barra; incluir a fonte no widget resolve.
- **Base de comparação `previous_period_bd`**: período anterior com o `to`
  recortado no N-ésimo dia útil do último mês do range ("vs. mês anterior no
  mesmo dia útil" dos KPIs). `comparisonSpec` segue pura — o contexto
  (feriados + hoje) chega por parâmetro opcional; sem contexto (chamador
  antigo, ex.: widget calculado) degrada para `previous_period`.
- **Cromo dos cards** (26/07/2026, 100% client): o texto do rótulo de
  comparação ("vs. período anterior…") no Card/KPI e o selo "Nº dia útil"
  podem ser ocultados — padrão do dashboard em
  `DashboardSettings.hideComparisonLabels`/`hideBusinessDayBadges` (⋮ ▸
  Aparência do dashboard), propagado por `BoardChromeProvider`
  (`components/dashboards/board-chrome-context.tsx`, molde do
  FontScaleProvider — vale automaticamente no viewer de snapshot); override
  POR WIDGET tri-state (`ausente` herda / `true` oculta / `false` força
  exibir) em `ComparisonSettings.hideLabel` (seção Comparação do builder) e
  `AppearanceSettings.hideBusinessDayBadge` (Aparência ▸ Título e borda).
  Só EXIBIÇÃO: o badge de variação, as tooltips de gráfico com o rótulo, o
  cálculo da comparação e `WidgetData.comparison.label`/`businessDayRef`
  seguem intactos (engine/RPCs não mudam).
- **Comparação nos Cards de FÓRMULA** (21/07/2026, `lib/widgets/card.ts`):
  com `settings.comparison` ativa, o `runCardWidget` roda a MESMA
  `runCalculatedWidget` uma segunda vez com o período deslocado pelo
  `comparisonSpec` (mesmo padrão do `runComparison` do engine — operandos
  escopados rejanelam pela data da própria sub; `previous_period_bd` carrega
  feriados como o engine, com a mesma degradação) e devolve
  `WidgetData.comparison` + `card.value/cmpValue/cmpValueText/currency` p/ o
  `VariationBadge` do chart. Bases de JANELA (`window_avg`/`window_median`)
  ficam DE FORA por design (o card é um escalar único e fórmulas típicas são
  razões — intensivas; o builder as oculta via `excludeWindowBases`); modo
  `record` segue sem comparação (seção oculta no builder); `topn`/`list` já
  herdavam `__cmp` via `runWidget`. RPCs intocados; o viewer de snapshot herda
  (mesmo `runCardWidget`; feriados AO VIVO por `PASSTHROUGH_TABLES`). As
  funções `ANTERIOR`/`VARPCT`/`VARABS` seguem um mecanismo SEPARADO, limitado
  a `previous_period`/`previous_year` (formula-metric.ts).
- **Ordenação dinâmica por valor + cor por categoria** (21/07/2026, client):
  `AppearanceSettings.categorySort` ganha `by: "label" | "value"` (ausente =
  rótulo, compat) e `metric` (chave `metric_<n>`; ausente = 1ª) — aplicado
  pelo helper ÚNICO `orderCategories` (`lib/widgets/appearance.ts`, delega a
  `sortRows`) no pipeline de barra/linha E nas fatias de pizza/funil (após o
  `topWithOther`; o sheet de aparência usa o MESMO helper p/ os índices de
  `sliceColors` baterem; "Outros" fica no fim do sort por valor). Eixo
  CRONOLÓGICO (`isChronoDim` na 1ª dimensão) não oferece as opções na UI
  (chips e sheet) — o default segue cronológico; sort salvo explícito ainda é
  honrado. `colorByCategory` (barra de SÉRIE ÚNICA) colore cada barra pelo
  índice na paleta do widget (`appearance.palette`, mesmo vocabulário
  `PALETTES` da pizza) — `categoryColors` manual e formatação condicional
  vencem; OFF por padrão (gráficos existentes não repintam). Tudo
  client-side em `widget-chart.tsx` — snapshots herdam de graça.
- **Linha de meta** (`WidgetSettings.goalLine`): o engine anexa `row.__goal`
  por bucket mensal ANTES da rotulagem, via `resolveGoal` (mesmo roll-up do
  KPI meta), e `WidgetData.goalLine` leva o metadado de exibição. Modo
  `monthly` = meta cheia; `pace` = meta ÷ dias úteis do mês × N (N do
  businessDayAlign quando ativo — linha ideal no mesmo estágio de todos os
  meses; sem align, só o mês corrente é rateado, passados = cheia, futuros =
  null). Render: linha tracejada no `linha`; em barra, o container troca p/
  `ComposedChart` SÓ com a meta ativa. Falha em qualquer ponto degrada sem a
  linha. Snapshots: meta e feriados AO VIVO pelo adapter (paridade com KPI
  meta).
- **Coorte por registro casado:** "vendas por mês de criação do lead" é uma
  dimensão `match:<fonte>:<campo>` com transform de data — suportada pelo RPC
  desde a 0042 (`_widget_match_expr`, espelhada no `_snap`) e ofertada pelo
  builder. Pré-requisito é DADO (match_rules venda→lead), não código. `match:`
  NÃO serve como campo de PERÍODO (restrição proposital —
  `period-resolve.ts`).

### 4.10 Filtros → widgets deferidos e feedback de carregamento (21/07/2026)

O dashboard tem DOIS transportes de filtro com gatilhos de recompute
diferentes:

- **URL** (`periodo/de/ate/campo`, `ff_`, `tf_`, `pf_*`): `router.replace`
  dentro do transition compartilhado (`pending-context.tsx`) → re-render RSC +
  mudança de `useSearchParams`.
- **Banco** (`__qf__` filtros rápidos do card — inclusive operação —,
  `__pw__` janela de períodos e `__ff__` valor compartilhado do "Filtro por
  campo" com `valueScope: "all"`, em `dashboard_table_cells`): server action +
  `revalidatePath` → re-render RSC **sem** mudança de URL.

Os widgets computados no RSC (hoje: listas de registros/entity lists) cobrem
os dois transportes por construção (props novas a cada render). Os widgets
**DEFERIDOS** (Tabela Livre e kanban, fetch client-side via server action —
e, desde 26/07/2026, TODOS os widgets de engine; ver abaixo) precisam de duas
garantias:

- **Escopo ÚNICO:** as actions deferidas (`runQuickTable`,
  `runKanbanWidget`) montam os filtros de visualização pela MESMA assembly da
  page — `resolveWidgetViewScope`/`loadWidgetScope`
  (`lib/widgets/widget-scope.ts`): filtros rápidos `__qf__` (com exceção do
  vendedor), `?tf_`, `?ff_` com fallback `lastFieldFilters` (ou a célula
  `__ff__` quando `valueScope: "all"`), tradução de OPERAÇÃO
  (`operation-scope.ts`) e `__pw__` nos settings efetivos. A
  cobertura do `@period` (invariante 9) usa as métricas EFETIVAS (Tabela
  Livre: colunas BI de `settings.quickTable`; kanban: a fonte do quadro).
  O kanban aplica o MESMO recorte dos demais widgets (colunas continuam
  derivadas das opções do campo — filtro só reduz cards); a **Agenda ignora
  os filtros do dashboard POR DESIGN** (range próprio mês/semana). A **página
  cheia do kanban de widget** (`/kanbans/w/[widgetId]`, 26/07/2026) é um
  contexto de visualização PRÓPRIO na mesma categoria da Agenda: RSC que chama
  `runKanban` direto (sem `runKanbanWidget`/widget-scope) e IGNORA por inteiro
  os filtros/período do dashboard pai — barra de período própria
  (`?periodo/?de/?ate`, como `/kanbans/[id]`). Não é uma remontagem parcial de
  `__qf__`/`ff_` (o que a invariante 12 proíbe): o widget renderizado NO
  dashboard segue 100% no widget-scope.
- **Gatilho de re-fetch por FINGERPRINT:** a page computa
  `deferredScopeById[widgetId] = JSON.stringify({ p: período efetivo,
  f: filtros de visualização, pw: escolha __pw__ })` e o widget recebe como
  prop `scopeKey`, que é a dep REAL do effect de fetch (a URL é lida em
  call-time, `window.location.search`). Como o RSC re-renderiza em TODOS os
  caminhos (navegação, `revalidatePath`, `router.refresh` do realtime), o
  fingerprint cobre também mudanças feitas por OUTRO usuário. Não volte a
  keyar o fetch deferido em `useSearchParams` — filtro persistido no banco
  não muda a URL e o widget ficava obsoleto até F5. Mudança de DADO (sem
  mudança de filtro) chega pelo event bus (`useDataChanged` → tick), nos dois
  widgets.

**Deferimento automático dos widgets de ENGINE (26/07/2026):** a page NÃO
computa mais gráfico/KPI/card/pizza/funil/tabela agregada/calculado/
calculadora/nota — ela entrega o fingerprint (`deferredScopeById`, o mesmo
acima) + `deferredEngineIds`, e o `DashboardClient` busca TODOS em UMA action
(`runDeferredWidgets`, `app/(app)/dashboards/deferred-widget-actions.ts`) após
o mount, com stale-while-refetch (overlay "Atualizando…" por card via
`deferredPendingIds`). A action reproduz o dispatch do `computeWidget` da page
sobre os MESMOS choke points (`runWidget`/`runCardWidget`/
`runCalculatedWidget`) com escopo do widget-scope em BUNDLE
(`loadDashboardScopeBundle` + `scopeForWidget` — as consultas compartilhadas
de catálogo/prefs/períodos rodam 1× por lote; invariante 12 intacta), o
cliente RPC em duas camadas (memo por lote + cache TTL §4.1) e o limitador
compartilhado (`lib/widgets/task-limiter.ts`). Listas de registros/entity
lists seguem inline no RSC (alimentam FK labels e a janela incremental);
snapshot viewer segue computando tudo inline (link público de leitura). Env
de escape `DEFER_ENGINE_WIDGETS=0` restaura o cômputo inline na page sem
deploy. RPCs de widget INTOCADOS.

**Período personalizado é rascunho + commit** (`PeriodRangeDraft`,
`components/dashboards/period-range-inputs.tsx`, usado por `PeriodControls`,
`PeriodQuickFilter` e pela barra da página dedicada `/kanbans/[id]` —
`kanban-page-client.tsx`): escolher "Personalizado" só abre os inputs (nada navega
ou persiste — os widgets seguem no período anterior) e digitar as datas só
atualiza o rascunho. O commit — navegação/emissão + persist, UMA vez — sai
quando o intervalo está COMPLETO (auto, debounce ~500ms) ou pelo botão
"Aplicar"/Enter (intervalo ABERTO deliberado, "de X em diante"). Commit em
blur foi rejeitado: tabular de "De" para "Até" emitiria o intervalo parcial
que era o bug. Efeito colateral corrigido: abrir "Personalizado" e desistir
não apaga mais o `lastPeriod` salvo do usuário.

**Feedback de carregamento (política):**

- Recompute RSC (qualquer filtro): overlay global "Carregando…" + dim do grid
  (`dashboard-grid.tsx`), via transition compartilhado (`useNavPending().run`
  em TODO caminho que muda filtro/recorte — barra de período, filtros
  rápidos, filtro por campo, barra da tabela, `PeriodWindowControl` e o
  refresh pós-save da Nota).
- Widgets deferidos re-buscando com dados antigos em tela: estado
  `refreshing` próprio (dim `opacity-60` + "Atualizando…" com spinner), sem
  bloquear interação (drag do kanban continua; um resultado que aterrisse
  logo após um move é reconciliado pelo `data-changed` → novo fetch). O
  overlay global pode sumir antes de o fetch deferido terminar — o estado
  local cobre esse rabo.
- Silenciosos POR DECISÃO: `realtime-refresher` (dado de fundo, mesmo
  recorte — overlay a cada rajada de sync seria ruído), reconciliações
  cosméticas (aparência, células da Tabela Livre).
- Respostas obsoletas: fetches concorrentes usam flag `cancelled` no cleanup
  (quick-table/kanban) ou contador de geração (agenda, pager server-side do
  modo lista) — só a ÚLTIMA resposta aterrissa.

Snapshot (`app/s/[token]`): nada disso se aplica — quick filters do visitante
vão à URL (`qf_*`), kanban/Tabela Livre chegam PRECOMPUTADOS pelo RSC público
(`snapshot-mode`) e `deferredScopeById` nem é passado (o fetch é pulado por
`readOnly`).

### 4.11 Importar dashboard via JSON gerado por IA (22/07/2026)

> **REGRA (23/07/2026): nunca use `.insert(...).select(...)` em
> `dashboards`.** A policy de SELECT (`auth_board_visible`, 0088) é uma
> função STABLE que consulta a própria tabela — no RETURNING de um INSERT
> ela roda no snapshot de antes do comando, não vê a linha nova e o insert
> inteiro falha com 42501, mesmo para o dono. Padrão correto (duplicateBoard/
> createBoard/applyPresetDefinition): **id gerado no app
> (`crypto.randomUUID()`) + insert SEM RETURNING**.

Terceiro modo de criação na Home (botão "Importar" ao lado do "Criar",
`components/dashboards/import-dashboard-sheet.tsx`): o usuário copia um prompt
de instruções, uma IA externa devolve um JSON e a importação materializa o
dashboard completo. Peças:

- **Contrato/validação**: `lib/import/dashboard/{types,validate}.ts` —
  validador PURO (erros em pt-BR, pensados para serem devolvidos à IA). Reusa
  os módulos ÚNICOS de fórmula (`tokenizeFormulaText` +
  `validateFormulaForContext` + `findFormulaCycle` sobre
  `perRecordCalcOperands`/`buildAggOperandCatalog`) — uma fórmula aceita no
  import é exatamente a que os editores aceitariam. `formula_text` é a forma
  primária (tokens por compat).
- **Aplicação**: `importDashboardJson` (`app/(app)/dashboards/actions.ts`)
  materializa um `PresetDashboard` e chama o MESMO `applyPresetDefinition`
  dos presets (com `includeSupportFields:false` — não cria
  forecast/potencial/desconto). Identidade no namespace **`import:<chave>`**
  (nunca colide com os presets de fábrica): reimportar a mesma chave ATUALIZA
  (widgets manuais preservados; GC só no prefixo do próprio import). Gates
  granulares: `create_dashboards` sempre; `manage_field_definitions` p/
  fields/correspondences; admin p/ subSources — mesmos das actions de
  cadastro.
- **Prompt**: `buildImportPrompt` (`app/(app)/dashboards/import-prompt-actions.ts`)
  aceita VÁRIAS Bases (checklist no sheet; 23/07/2026) e monta espec
  (`lib/import/dashboard/instructions.ts`) + modelo POR BASE + campos
  unificados + Conexões (`match_rules` habilitadas dos pares tocados) +
  amostra de ~20 registros POR BASE com COBERTURA de colunas
  (`lib/import/dashboard/sample.ts`, guloso + busca complementar por coluna
  descoberta). O envelope do JSON aceita `bases: []` (ou `base` singular). A
  variante "completo" anexa `docs/manual-de-construcao-de-dashboards.md` lido
  do disco — `outputFileTracingIncludes` no `next.config.ts` garante o
  arquivo no bundle da Vercel. **A espec é DERIVADA do código (25/07/2026)**:
  os enums do SPEC são interpolados das constantes de runtime (as mesmas que o
  validador já usava) e as chaves de `WidgetSettings`/`AppearanceSettings`
  (+ `.table`)/`DashboardSettings` são renderizadas dos dicionários exaustivos
  de `lib/import/dashboard/settings-docs.ts` (chave nova sem entrada = erro de
  typecheck; `null` = fora do escopo da IA). Guarda textual + validação do
  exemplo do SPEC pelo validador real em
  `lib/import/dashboard/instructions.test.ts`. Ver invariante no AGENTS.md.

#### 4.11.1 Geração DIRETA por IA via API (23/07/2026)

Elimina o "hop" manual de copiar/colar: o servidor chama a IA por API entre
"montar prompt" e "validar/aplicar", reusando tudo do §4.11. Peças:

- **Provedores**: `lib/ai/*` — adaptadores por `fetch` nativo (sem SDK), um por
  provedor (`gemini.ts`/`claude.ts`/`openai.ts`) atrás de um contrato único
  (`AiTextClient.generateText`, `types.ts`); `index.ts` é a fábrica
  (`getAiClient`). Migrar de provedor = novo arquivo + case + entrada em
  `models.ts`. Gemini autentica por header `x-goog-api-key` (nunca `?key=`);
  Claude sem `temperature` (removida em Opus 4.7+).
- **Config por org**: tabela `ai_provider_config` (0096) — provedor/modelo +
  chave CIFRADA (AES-GCM, `secretbox.ts`). `lib/ai/config.ts` (server-only)
  expõe `loadOrgAiConfigPublic` (provider/model/hasKey — nunca o ciphertext) e
  `loadOrgAiConfig` (chave decifrada, SÓ na action de geração). Cadastro admin
  em Configurações → Integrações (`ai-actions.ts` + `AiProviderForm`).
- **Action**: `generateDashboardWithAi` (`app/(app)/dashboards/ai-generate-actions.ts`)
  — gate `create_dashboards`, monta o system com `buildImportPrompt` (mesmo
  modelo+amostras do manual), roda um **laço de AUTOCORREÇÃO** (máx 3): chama a
  IA → `validateDashboardImport` → se falhar, anexa os erros pt-BR como turno de
  correção e repete. Ao validar, aplica reusando `importDashboardJson` (gates +
  GC + persistência intactos) e o cliente navega ao dashboard (auto-import); se
  esgotar sem JSON válido, devolve os erros + o último rascunho para conserto
  manual no campo de JSON. O contexto de validação saiu para
  `lib/import/dashboard/context.ts` (`loadImportContext`), compartilhado com
  `importDashboardJson`. O par de RPCs de widget NÃO é tocado.

#### 4.11.2 Export de estrutura + CONVERSA de IA (Criar novo / a partir de / Editar) — 23/07/2026

Fecha o ciclo do §4.11.1: dashboards existentes viram JSON (export) e a IA os
lê/edita em conversa multi-turno. Sem migração de banco. Peças:

- **Exportador** (`lib/import/dashboard/export.ts`, puro): dashboard+widgets →
  JSON `dashboard-import` que passa LIMPO no validador (settings de dashboard/
  widget são passthrough lá — o export emite quase verbatim, removendo
  `preset`/`presetKey`/`connectors`/`kanban`). Identidade determinística:
  `importChaveForDashboard` (sufixo do `preset.key` se `import:`; senão
  `board_<8hex do id>`; preset de FÁBRICA não reusa chave) e `assignWidgetKeys`
  (sufixo do presetKey sob a chave, senão `w_<8hex>`; dedupe `_2`) — o MESMO
  mapa serve export e adoção, então keys do JSON casam 1:1 com widgets reais.
  `bases` = raízes referenciadas (sub→`parentKey`) ∪ `periodBar.fieldBySource`
  ∪ `sourceScope`; widget "todas as fontes" sem sourceScope ⇒ todas as raízes.
  Métrica calc ad-hoc exporta `formula` em TOKENS (caminho B do validador);
  `custom:`+calc degrada a field/agg/label (única perda conhecida). UI:
  `exportDashboardStructure` (`export-structure-actions.ts`) + item
  "Exportar JSON" no ⋮ do card (download; `issues` = erros de round-trip como
  aviso).
- **Identidade FORÇADA no servidor** (`lib/import/dashboard/rewrite.ts`,
  `normalizeImportRaw`): a `chave` do JSON da IA é SEMPRE sobrescrita pela
  canônica ANTES da validação (o validador então deriva todos os presetKeys
  dela). Nunca confie a chave à IA — uma chave copiada da referência
  sobrescreveria o board de ORIGEM no modo "a partir de". No modo Editar
  também injeta `visible_to_roles`/`settings.tabs` atuais quando o JSON os
  omite (ausência seria destrutiva: des-compartilhar / apagar o `tab` dos
  widgets retornados).
- **Modo Editar** (`applyDashboardEditJson`, `actions.ts`): gate dono/admin →
  normaliza → valida → gates por seção (`importSectionGateError`) →
  `captureDashboardSnapshot` (Desfazer) → ADOÇÃO (carimba `settings.presetKey`
  canônico nos widgets divergentes, via `assignWidgetKeys`) →
  `applyPresetDefinition` com **`opts.targetDashboardId`** (carrega SÓ essa
  linha — sem busca por identidade/adoção por nome, sem INSERT) e **SEM GC**
  (decisão de produto: a IA nunca exclui widget; omitido permanece ⇒ a
  resposta pode ser PARCIAL, só widgets alterados/novos). `fontScale` virou
  chave GERIDA do UPDATE (presets de fábrica não a definem — zero mudança).
  `connectors`/`sourceScope` ficam fora do alcance da IA (preservados).
  **Merge por widget (24/07/2026):** a resposta pode ser PARCIAL também DENTRO
  do widget — `applyDashboardEditJson` exporta o board e passa `baseWidgets` a
  `normalizeImportRaw`, que faz deep-merge do widget da IA (casado por `key`)
  sobre o do estado exportado: a IA manda a `key` + só os campos que mudam
  (`settings` mescla por chave; arrays substituem; `null` limpa) e o resto é
  preservado no SERVIDOR, sem re-emitir o widget inteiro (antes, campo omitido
  de um widget INCLUÍDO era apagado). Widget de key NOVA passa intacto; widget
  do estado não referenciado NÃO é adicionado (o sem-GC preserva a linha).
  **Cópia por referência — `copy_of` (24/07/2026):** widget da IA de key NOVA
  com `"copy_of": "<key existente>"` usa o widget de origem como BASE do mesmo
  deep-merge (a IA manda só o delta da cópia — "igual ao X mudando Y" sem ecoar
  a definição inteira). Resolvido e REMOVIDO em `normalizeImportRaw` ANTES da
  validação (o validador/export nunca veem o marcador). Sem `grid_position` no
  delta, a cópia empilha ABAIXO do fundo da aba dela (herdar a posição da
  origem sobreporia os dois; o auto-empilhamento do validador começa em y=0 e
  colidiria com widgets reais). `copy_of` em key JÁ existente é ignorado (merge
  normal); origem desconhecida = só remove o marcador (o laço de correção
  reporta os campos faltantes).
- **Modo Criar a partir de** (`applyFromReference`, `ai-generate-actions.ts`,
  24/07/2026): cópia FIEL da referência via `duplicateBoard` (clone por banco —
  widgets/células/placements com ids novos, sem `preset`/`presetKey`; a IA não
  reproduz nada) + o DELTA da IA aplicado como Edição na cópia
  (`applyDashboardEditJson`, reusa o merge + SEM GC). A IA responde só com o
  ADITIVO (widgets/abas NOVOS — `FROM_RULES`); mudar/remover um widget copiado é
  turno de Editar seguinte. Duplica só no APPLY (nunca em turno não aplicado ⇒
  sem cópias órfãs) e o cliente troca a sessão para Editar pelo `id` retornado.
  Substitui o antigo `importDashboardJson` do modo from (que recriava tudo do
  zero e dependia de a IA reproduzir a referência verbatim). O modo `new` segue
  em `importDashboardJson`.
- **Conversa** (`ai-generate-actions.ts` v2): STATELESS por turno — o servidor
  re-exporta o estado FRESCO para o system a cada turno e recebe só os textos
  de usuário anteriores (cap 10); nada de JSON de assistant acumulado. A ÚNICA
  saída de assistant reinjetada (24/07/2026) é a PRÉVIA PENDENTE não aplicada
  (`input.pendingJson` — painel: `row.pending.json`; sheet: estado local), que
  entra como seção própria do system com a semântica "a resposta deste turno
  SUBSTITUI a prévia inteira" — sem ela, "ajusta o card que você propôs" falha
  com auto-aplicar OFF (o estado re-exportado do banco não a contém). Nos modos
  from/edit o laço de geração normaliza com `baseWidgets` (24/07/2026: também
  no from — a validação do turno ganha a MESMA semântica de merge/`copy_of` do
  apply, que no from mescla sobre a cópia via `applyDashboardEditJson`). Após o
  1º apply em new/from o CLIENTE troca a sessão para `edit` +
  `targetDashboardId`. Toggle "Aplicar automaticamente": OFF ⇒ o turno devolve
  `pendingJson`+resumo e `applyGeneratedDashboard` aplica depois
  (re-valida/re-gates/re-deriva tudo — nada confiado do cliente). Truncamento
  é erro TIPADO (`AiTruncatedError`, detectado nos 3 adapters; Gemini subiu a
  32k tokens) e aborta o turno com mensagem acionável. Desfazer =
  `restoreDashboardSnapshot` com o snapshot devolvido pelo turno.
- **Consequência documentada**: editar por IA um dashboard de PRESET DE
  FÁBRICA re-identifica o board como `import:` — ele deixa de ser atualizado
  por "Gerar presets" (que recriará o de fábrica à parte). O picker avisa.

#### 4.11.3 Painel "Editar com IA" dentro do dashboard — sessão persistida (24/07/2026)

A conversa do §4.11.2 também abre DENTRO de um dashboard, sempre em modo
EDITAR (alvo = o próprio board), com a sessão persistida em banco
(`dashboard_ai_sessions`, 0098 — uma linha por usuário×board). Peças:

- **UI** (`components/dashboards/ai-edit-panel.tsx`): botão "Editar com IA" na
  toolbar do board (page passa `canAiEdit` = dono/admin + `create_dashboards`,
  e a config pública do provedor pela org do BOARD). O TÍTULO do painel aberto
  é o MODELO configurado com a 1ª letra maiúscula (ex.: "Gemini-2.5-flash";
  subtítulo mostra o rótulo do provedor; fallback "Editar com IA" sem config —
  botões de gatilho/chip seguem "Editar com IA"/"IA"). O painel é uma div FIXA
  à direita, **não-modal** (sem overlay/portal — o dashboard atrás segue
  interativo; `z-40`, abaixo dos Sheets `z-50`) e **recolhível** para um chip
  flutuante (dá para testar o dashboard com um turno em voo e voltar). O log de
  chat é o `AiChatLog` (`ai-chat-log.tsx`), extraído do sheet da Home e usado
  pelos dois. Estado do painel (aberto/recolhido) é React puro — sobrevive a
  `router.refresh()`, e F5 recarrega o CONTEÚDO do banco (reabrir é 1 clique;
  sem auto-abrir por design).
- **Actions** (`app/(app)/dashboards/ai-session-actions.ts`): o SERVIDOR é a
  fonte de verdade dos turnos — o turno carrega os turnos do banco, chama o
  MESMO núcleo de geração da Home (mode "edit"; cap de 10 turnos ao modelo
  inalterado) e persiste chat + prévia + snapshot num upsert único; o
  cliente envia só a mensagem nova e SUBSTITUI o estado pelo canônico devolvido
  (chat/pendingSummary/hasUndo — sem merge local). Desde 26/07/2026 o corpo
  do gate/linha da sessão/turno vive em `lib/ai/edit-session.ts`
  (`gateAiEdit`/`loadRow`/`saveRow`/`runAiEditTurnCore`) e o da geração em
  `lib/ai/generate-dashboard.ts` (`generateDashboardCore`) — as actions
  (`runAiEditTurn`, `generateDashboardWithAi`, …) são wrappers finos; NÃO
  recrie gate/persistência fora desses módulos. A prévia pendente
  (auto-aplicar OFF) fica no banco: `applyAiEditPending` lê o JSON de lá (nada
  bruto viaja do cliente) e ela sobrevive a F5. Gate em TODA action (antes de
  qualquer leitura): `create_dashboards` + dono/admin do board (espelho da
  geração; RLS own-row + org como muralha — ver banco §3.3). Caps de
  armazenamento: 30 turnos / 100 entradas de chat.
- **Raciocínio ao vivo (26/07/2026)**: o TURNO do painel entra pela rota de
  streaming `POST /api/dashboards/<id>/ai-turn` (server action não faz
  streaming), que roda o MESMO `runAiEditTurnCore` e devolve NDJSON — linhas
  `{type:"thought"}` com o raciocínio do modelo e uma linha final
  `{type:"state"}` com o `AiEditSessionState` canônico (inclusive erros de
  gate; anti-CSRF: cookies SameSite=Lax + checagem de `origin`). O raciocínio
  é EFÊMERO (só exibido durante a geração — `busyDetail` do `AiChatLog`; nunca
  persistido na sessão). Contrato nos adaptadores: `AiGenerateInput.onThought`
  (best-effort) — implementado no Gemini via `:streamGenerateContent` (SSE) +
  `thinkingConfig.includeThoughts` (resumos de pensamento; os modelos atuais
  já pensam por padrão, então NÃO há custo extra de tokens). Regra de custo:
  NUNCA habilitar thinking num modelo em que ele vem desligado (Claude Opus
  4.8/Haiku, gpt-4.1…) — Claude/OpenAI seguem sem raciocínio exibido. Demais
  actions (aplicar/desfazer/recomeçar/carregar) seguem server actions.
- **Desfazer/Recomeçar**: o snapshot pré-turno do último apply
  (`EditDashboardState.snapshot`) é persistido em `undo_snapshot` —
  `undoAiEditSession` restaura via `restoreDashboardSnapshot` e limpa (sempre a
  ÚLTIMA edição inteira da IA; edições manuais posteriores também voltam — o
  tooltip avisa). "Recomeçar" zera turns/chat/pending mas PRESERVA o undo (a
  última edição continua no board; apagar o snapshot deixaria o usuário sem
  como desfazê-la). Independente do Desfazer/Refazer in-memory do board
  (`history-context.tsx`), como já era no sheet da Home.
- **Limitações aceitas (v1)**: duas abas do mesmo usuário no mesmo board fazem
  last-write-wins na linha da sessão; se o upsert da sessão falhar logo após um
  apply ok, a edição fica no board sem snapshot salvo (janela rara). O fluxo da
  Home (`ImportDashboardSheet`) segue 100% client-state, inalterado.
- `app/(app)/dashboards/[id]/page.tsx` exporta `maxDuration = 300` (as actions
  do painel rodam sob o segment config DESTA rota — espelho da Home).

### 4.12 Espaço de grid v2 (grade fina) e Páginas de widget (25/07/2026)

**Grade fina (espaço v2).** A célula do grid deixou de ser ancorada em 12
colunas com margens de 12px e passou a `canvas.baseCols` (default 120) colunas
SEM margens, com linha default QUADRADA (`rowHeight` ausente = largura da
célula). Unidades de `grid_position`/`ShapeLine` ficaram 10× mais finas no X e
4× no Y. Módulo canônico: `lib/widgets/grid-space.ts` (constantes + conversões
+ `normalizeGridSpace`). Como o legado convive:

- **Detecção**: `dashboards.settings.canvas.gridVersion === 2` = espaço fino;
  AUSENTE = legado (base 12). `createDashboard` carimba o gridVersion na
  criação (board novo nasce fino, linha quadrada).
- **Leitura (runtime, obrigatória)**: TODA leitura de `grid_position`/settings
  crus passa por `normalizeGridSpace` antes de usar — page do dashboard,
  `captureDashboardSnapshot`, `exportDashboardJson` (choke dos 3 chamadores),
  refresh de snapshot e o viewer público (`app/s/[token]`). A runtime é
  PERMANENTE no viewer: `snapshots.config` é um jsonb CONGELADO que nenhum
  backfill de `widgets` alcança.
- **Escrita (migração lazy)**: `ensureFineGrid(supabase, dashboardId)`
  (actions.ts) roda no topo de TODO escritor de geometria (`saveLayout`,
  `saveShapeLine`, `createWidget`, `updateDashboardSettings`,
  `applyPresetDefinition`, merge/unmerge de páginas): lê os widgets ANTES do
  carimbo CAS (`update … where gridVersion is null`, count) e converte as
  linhas SÓ se venceu o CAS — a ordem leitura→carimbo→conversão torna a dupla
  conversão impossível (toda escrita fina de terceiro exige um CAS-fail, que
  exige um carimbo commitado, posterior à nossa leitura). Runbook:
  `supabase/apply/backfill-grid-v2.sql` converte tudo de uma vez (e é o reparo
  do caso residual "carimbo sem conversão" — crash no meio).
- **Matemática**: `x·10 | y·4 | w·10−1 | h·4−1` (o −1 preserva o vão visual
  que as margens davam); linha divisória escala fracionária sem o −1 e o bbox
  é DERIVADO do traçado fino; `rowHeight` convertido sai EXPLÍCITO
  (`(R+12)/4`, default 30 → 10.5) — sem ele o board migrado esticaria com a
  viewport (o legado era px fixo). Board novo (sem canvas) fica no quadrado
  responsivo.
- **IA/import**: JSON SEM `canvas.gridVersion` segue validado nas unidades
  legadas (12 colunas, defaults 6×8) e o preset sai CONVERTIDO do validador;
  com carimbo, valida em unidades finas. Nos modos Editar/Criar-a-partir-de o
  `normalizeImportRaw` injeta o canvas do ESTADO exportado sob o da IA
  (`currentCanvas`) — sem o carimbo herdado, o delta fino da IA seria
  re-escalado ×10. `instructions.ts` documenta as duas escalas (regra 8).
  Clipboard de widget idem (`gridVersion` no payload; antigo é convertido na
  leitura).

**Páginas de widget (mescla).** Dois ou mais widgets dividindo o MESMO espaço,
alternados por setinhas acima do card (`WidgetPager`). Vínculo:
`settings.pages: string[]` no HOST (ids dos membros; host = página 1; ordem =
2..N). Módulo puro: `lib/widgets/pages.ts`; UI: `widget-pages.tsx` +
`dashboard-grid.tsx` + itens do ⋮ no `widget-card.tsx`.

- Membros são linhas NORMAIS de `widgets` (grid_position preservado) ocultadas
  de `gridWidgets` no grid (layout/persist/children/conectores/extensão do
  canvas, tudo junto — o viewer de snapshot ganha de graça). A página ativa é
  estado EFÊMERO (`pageIndexByHost`); trocar de página REMONTA o card
  (`key={shown.id}`) e os widgets deferidos disparam o próprio fetch — a page
  computa dados de TODOS os widgets (não filtra por aba/visibilidade), então
  o dado da página oculta já chega nas props.
- **Drop quase-em-cima** (`findMergeTarget` em `persist`): sobreposição ≥65%
  da área do menor + tamanhos com |Δ| ≤ max(folga, 25%) ⇒ diálogo "Adicionar
  página?". Confirmar chama `mergeWidgetPages`; cancelar DESFAZ o arraste
  (patch otimista de volta à base — o banco nunca foi tocado). O arrastado
  não pode já ser host; o alvo pode (vira +1 página).
- **Actions**: `mergeWidgetPages` (valida elegibilidade/duplo-vínculo, força
  `settings.tab` do membro = aba efetiva do host — o refresh de snapshot
  congela POR ABA — e remove conectores com ponta no membro) e
  `unmergeWidgetPages` (devolve membros via `findFreePosition` na aba do
  host). `deleteWidget` lê settings ANTES do delete: host excluído devolve os
  membros ao canvas; membro excluído sai do `pages` de quem o referencia.
- **Serialização**: `pages` NUNCA sai no export/JSON de IA nem no clipboard
  (ids não sobrevivem — mesma razão de connectors/kanban) e é PRESERVADA pelo
  apply de edição (`applyPresetDefinition` re-injeta do settings existente).
  `duplicateBoard` não precisa de nada (o `remapJsonIds` já troca os uuids).
  `validate.ts` remove `pages` vindo por JSON com warning.

### 4.13 Agrupamento de responsáveis por exibição (canonical_id, 26/07/2026)

O mesmo responsável pode existir DUPLICADO em `responsibles` porque as chaves
de matching divergem por fonte: o Bitrix casa por `bitrix_user_id`, planilha e
CSV casam por nome normalizado (`normalizeName` — grafia um pouco diferente
cria uma segunda entidade). A unificação é por **exibição, reversível**:
`responsibles.canonical_id` (0101) marca a linha como **apelido** de um
principal ("nome usado") — `records.responsible_id` **nunca é repontado** e
limpar a coluna desfaz tudo. O grupo é sempre **plano** (apelido aponta direto
ao principal; a action `setResponsibleCanonical` de Configurações →
Responsáveis repontea filhos ao mesclar um principal e resolve alvo-apelido
para o principal dele).

Resolução 100% engine/loaders (`lib/config/responsible-canon.ts` —
`loadResponsibleCanon` cacheado + helpers puros), com gate barato: sem
referência a `responsible_id` na config, nenhuma consulta extra e caminho
byte-idêntico. Superfícies:

- **Filtros** (`runWidget`/`runCalculatedWidget`/`runRecordList*`):
  `expandResponsibleFilters` reescreve `eq`/`eq_ci`/`in` de `responsible_id`
  para `in` no GRUPO — inclusive o `responsible_id in` produzido pela tradução
  de operação (que roda antes, na page/widget-scope) e as condições de SOMASE
  (pós `resolveFkCondFilters`). Expansão idempotente; uuid fora de grupo (ex.:
  o filtro impossível) passa intacto.
- **Dimensões**: `mergeRowsByBucket` (bucket-merge v1.2) funde as linhas do
  RPC apelido→principal no choke point único de `computeRows`; o caminho por
  registros canonicaliza em `dimValue`. Rótulo id→nome sai do PRINCIPAL
  (`fetchFkLabels`/`collectRecordFkLabels` canonicalizam antes do lookup).
- **Dropdowns**: `collapseResponsibleOptions` remove o apelido SÓ quando o
  principal está presente na lista (quick filters, filtro_campo, picker do
  construtor, /registros, form e refresh de snapshot). Selects de
  **write-back** (atribuir responsável) NÃO colapsam — gravam o responsável
  real.
- **Snapshots**: `responsibles` é PASSTHROUGH no adapter — o viewer lê o
  agrupamento AO VIVO (desfazer vale retroativamente); a restrição
  `allowed_responsible_ids` é gravada JÁ EXPANDIDA (create/updateSnapshot) e o
  RPC segue lendo a coluna como está.
- **RLS do vendedor** (invariante 8): `auth_responsible_ids()` (redefinida na
  0101) devolve o grupo inteiro — sem isso, registros no id do apelido
  sumiriam do vendedor. A exceção do vendedor da page/widget-scope expande o
  mesmo conjunto.
- **Kanban/tabelas**: `recordGroupKey` canonicaliza o agrupamento por
  responsável; o "Agrupar por" da tabela de registros recebe o mapa via prop
  `respCanon` (o keyOf chaveia FK por id cru de propósito — proteção contra
  homônimos preservada nas demais FKs).

Limitações documentadas: `appearance.categoryColors`/`categoryOrder` chaveiam
pelo nome exibido (cores salvas com o nome antigo deixam de casar — cosmético);
metas (`goals`) por responsável não se fundem; snapshots com restrição gravada
ANTES de mudar um grupo precisam ser re-salvos para incluir apelidos novos;
entity-list (`rowSource: responsibles`) segue exibindo apelidos como linhas.

### 4.14 Parcerias: match dinâmico, conexão reativa e sub-operações automáticas (26/07/2026)

Caso de uso: uma base "Parceiros" (CSV/API) e leads do Bitrix que carregam o
identificador do parceiro num campo (ex.: `custom:bitrix_uf_crm_1784828550`,
"Email parceiro"). Três peças, todas reutilizando a infra existente:

- **Match para bases dinâmicas (0104).** Os helpers `_widget_match_expr` /
  `_widget_match_expr_snap` resolvem a fonte do ref `match:<fonte>:<ref>` por
  lookup `data_sources.key → record_type` (fallback no mapeamento histórico
  `leads/deals/estudo`; `immutable` → `stable`). Antes, o `case` hardcoded
  erguia exceção para qualquer base nova — o construtor oferecia
  `↪ Parceiros: …` e o widget agregado explodia. Sub-fontes NUNCA casam
  (compartilham o `record_type` da pai): `buildMatchFields` itera só raízes,
  o matches-manager só oferece raízes como Base A/B e o validador de import
  da IA rejeita `match:<sub>:*`. A regra de conexão em si é a de sempre
  (`match_rules` + `record_matches`, aba Conexões em `/campos` — ex.: campo
  "Email parceiro" do lead ↔ `custom:email` da base Parceiros).
- **Conexão reativa pós-sync (A2).** O sync do Bitrix agora dispara, ao
  CONCLUIR um job que escreveu algo, `maybeAutoMatchAfterJob` (runner):
  `runAutoMatchIncremental` roda só as regras cujos `record_types` foram
  tocados — lado A restrito a `last_synced_at >= started_at` do job (índice
  `idx_records_type_synced`), lado B indexado inteiro (base de referência
  pequena); regra com só o lado B tocado roda cheia. Pares inseridos
  alimentam `recalcFormulaFieldsForRecords` (recalc DIRECIONADO — mesmo
  pipeline do geral com `.in("id", …)`). Tudo best-effort, padrão
  `maybeAnalyzeAfterJob`. Declare a regra de parcerias com `source_a = lead`
  para o custo ficar O(tocados no tick).
- **Fusão de perfis de operação (0105 + operation-scope v2).**
  `loadOperationScopes` ficou BATELADO (1 query de `operations` + 1 de
  `responsible_operations`; subárvore em JS ciclo-safe) e devolve também
  `subtreeProfiles` (filhas ATIVAS com perfil + flag de vínculo). Quando a
  seleção é 100% "profile-only" (nenhum responsável nas subárvores),
  `fuseOperationProfiles` funde perfis de condição ÚNICA sobre o MESMO campo
  (`eq`/`eq_ci`/`in`, mesmas `sources`) num único filtro: `in` quando todos
  exatos, `in_ci` (op interno novo do par de RPCs, 0105 — pertencimento com a
  normalização do `eq_ci`) quando qualquer `_ci` está presente. Cobre a
  multi-seleção de parcerias no filtro rápido (antes: perfis descartados →
  IMPOSSIBLE → dashboard zerado) e a seleção do PAI "Parceiro" (roll-up das
  filhas). Caso misto (vínculo + perfil) ou não-fundível degrada EXATAMENTE
  como antes. `updateOperation` ganhou detecção de ciclo indireto de pai.
- **Sub-operações automáticas (0106).** Config 1-por-base em
  `source_auto_operations` (`parent_operation_id`, `name_field`/`value_field`
  — refs no registro da base, `target_field`/`target_sources` — ref/alvo no
  lead, `profile_op` `eq_ci`|`eq`; RLS espelha `operations_write`; UI em
  Registros → Bases, seção "Sub-operações automáticas" + botão "Gerar
  agora"). A rotina (`lib/operations/auto-operations.ts`, service role com
  carimbo EXPLÍCITO de `organization_id` da config) materializa uma
  sub-operação por registro válido: identidade por
  `operations.auto_source_record_id` (unique parcial) — rename do parceiro
  renomeia a MESMA operação; homônima sem vínculo é ADOTADA (normalizeName,
  como o seed 0053); registro sumido/sem identificador INATIVA (nunca
  exclui); perfil gerado é PROPRIEDADE do gerador (edição manual do perfil é
  sobrescrita). Ganchos: `finalizeCsvImport`, `POST /api/ingest/<source>`,
  criação/edição manual de registros (`ensureAutoOperationsForRecordType`,
  gate barato) — todos best-effort.

Limitações documentadas: `records.operation_id` (derivada de
`responsible_operations.priority=1`) fica NULL para registros recortados só
por parcerias — a DIMENSÃO "por Operação" e a restrição
`snapshots.allowed_operation_ids` não enxergam parcerias (um lead pode
pertencer à operação do responsável E a uma parceria; a coluna é
single-valued — use filtro fixo de dashboard para snapshot restrito a
parceria). `in_ci`, como o `eq_ci`, não tem tradução no modo LISTA (widget de
lista com filtro de parceria não recorta pelo perfil). Dropdowns de operação
seguem planos (centenas de parcerias = dropdown grande). O e2e não tem
fixture de base dinâmica com match (cobertura live do caminho novo é
follow-up conhecido).

### 4.15 Automações do kanban e ações em massa (27/07/2026)

**Automações** (`kanban_automations`, 0109): regras condicionais por quadro
(widget kanban OU kanban dedicado — XOR de dono, padrão 0067) que MOVEM cards
automaticamente. Uma regra = `{ v:1, conditions[], action }` (jsonb versionado,
parse fail-closed em `lib/kanban/automations/types.ts`): as condições valem em
E e MESCLAM 4 famílias — campo do registro (`WidgetFilter` inteiro, incl. refs
`match:`), contagem de registros CONECTADOS (`record_matches`, qualquer
direção, com filtros sobre o conectado — "parceiro com ≥ N leads ganhos"),
tarefas do card (abertas/atrasadas) e tempo em dias de calendário (desde
criação / última alteração de campo via `field_modified_at` / entrada na
coluna Personalizar via `kanban_placements.updated_at`). Regras em ordem
(`position`): a PRIMEIRA que casa vence por card; ação v1 =
`move_to_column` (união extensível).

Execução 100% no ENGINE (RPCs de widget intocados), com SERVICE ROLE e escopo
EXPLÍCITO de org em toda consulta (`opts.orgId` do `runRecordList` — v2.1 do
record-list): `runBoardAutomations` (`lib/kanban/automations/engine.ts`) reusa
`runKanban` (period null — a barra de período é filtro de VISÃO; resolução de
colunas/placements/`__match` de graça), monta os fatos que as regras pedem
(gates — tasks/fmod/placements/`countRelatedBySource` só quando usados),
decide no avaliador PURO (`evaluate.ts` — decisões sobre o snapshot original:
sem ping-pong intra-rodada; mock nunca move; alvo overflow/coluna sumida =
erro da regra, nunca silêncio) e executa em `move.ts`: Personalizar = upsert
de `kanban_placements` (dado da visão); coluna por VALOR = escrita do campo
com carimbo `field_modified_at` + `locally_modified_at` (protege da Sync),
efeitos em LOTE (um `recalcFormulaFieldsForRecords`, um insert de `audit_log`
origin `'automation'`/user null, write-back opcional espelhando o gating do
`updateRecord`, webhook `record.updated` por registro). Teto
`MAX_MOVES_PER_RUN` (200)/quadro/rodada. Fora do escopo v1 (falham ALTO no
`last_error`): modo tarefas e colunas por BUCKET DE DATA (mover reescreveria
uma data real relativa a "hoje" a cada tick — não idempotente).

Gatilhos: tick por minuto (`/api/kanban-automations/tick`, pg_cron via
`supabase/apply/pg-cron-kanban-automations.sql`, SYNC_SECRET + orçamento de
45s; round-robin pelos donos mais antigos — `min(last_run_at)`), hook
pós-sync (`maybeRunKanbanAutomationsAfterJob`, deadline curto, DEPOIS do
auto-match p/ contagens verem vínculos frescos) e "Executar agora" na UI.
Autoria = gate de EDITOR do board (RLS de `kanban_automations` via
`auth_board_editable` nos dois braços + org); execução tem autoridade de
sistema (como o sync) — documentado, não bug. Bookkeeping por regra
(`last_run_at`/`last_error`/`last_moved_count`) em vez de tabela de runs. UI:
`components/kanban/automations-sheet.tsx` (página dedicada, página cheia do
widget e widget no dashboard; campos via `buildAvailableFields` +
`toFieldOptions` — nunca listas paralelas). Regras NÃO viajam no
export/IA/duplicação de board (tabela própria, fora de `settings.kanban` — o
widget-builder reconstrói o objeto `kanban` no save e derrubaria chaves
novas).

**Ações em massa** (`lib/kanban/bulk-actions.ts` + seleção no
`kanban-board.tsx`): seleção por checkbox (hover/Ctrl+clique; select-all por
coluna; Esc limpa; mock nunca selecionável) + barra flutuante — Mover para,
Gerar tarefa (uma por card), Concluir tarefas (abertas dos cards; no modo
tarefas, as selecionadas) e Excluir (registros: EXCLUSÃO REAL, gate de ADMIN
na action espelhando a RLS `records_delete` + confirmação na UI + webhook
`record.deleted`; tarefas: RLS/cadeado decidem por item). Contrato: resultado
POR ITEM (`{ id, ok, message }[]`, teto 200/chamada, cliente fatia) — é o que
permite o revert parcial. TODO movimento (card único incluso, e multi-drag
via `KanbanDragPayload.items` — retrocompatível) passa pela fila otimista
`use-kanban-bulk-queue.ts`: aplica local NA HORA, despacha em background
(chunks de 50, sequencial), reverte SÓ os itens que falharam e os acumula num
painel persistente com "Tentar novamente"; ao drenar, emite `emitDataChanged`
+ um refresh debounced. O resync `data` → estado local do board é GUARDADO
enquanto a fila está em voo (dado que chegou durante a fila é descartado como
stale — o refresh do settle traz o fresco); sem a guarda, um
`router.refresh()` no meio da fila clobraria o estado otimista.

**Métricas de card/coluna do kanban (28/07/2026)** — 100% no ENGINE (RPCs
intocados, sem migração). Config em `settings.kanban`:
`columnMetric { spec, agg }` (cabeçalho da coluna, agregação escolhível) e
`card.badges: KanbanMetricSpec[]` (até 3 indicadores por card). Um
`KanbanMetricSpec` é `field:<ref>` | `linked:<base raiz>` ("Leads
vinculados") | `tasks:open|overdue` | `age`. A leitura é normalizada em UM
lugar (`normalizeKanbanMetrics`, `lib/kanban/metrics.ts`): `columnMetric`
vence o `metric` legado (string = campo somado); `card.badges` AUSENTE =
comportamento legado (pill de tarefas abertas — o pipeline nem emite
`card.badges`, então lista/CSV/render de quadros antigos seguem
byte-idênticos); `[]` explícito = sem badges. No `runKanban`
(`lib/kanban/data.ts`) os fatos são GATEADOS pela config: sem métrica nova,
zero consulta extra. **Conectados**: `countRelatedBySource` foi movido de
`lib/kanban/automations/` para `lib/kanban/related-count.ts` (compartilhado
entre automações e métricas) e ganhou `opts.extraPairs` — pares extras
OPT-IN do gêmeo `records.related_lead_id` quando a base contada resolve p/
`record_type='lead'` (espelha o coalesce do `_widget_match_expr`, 0104; o
dedupe de par cobre gêmeo × match real). As automações (`related_count`)
seguem chamando SEM `extraPairs` — a condição mantém a semântica antiga
(divergência DOCUMENTADA: convergir é passar o opt-in lá). **Atrasadas**: a
query de tarefas do quadro passou a selecionar `due_date` e conta
abertas+atrasadas na mesma passada (régua canônica: aberta com prefixo de
`due_date` < hoje de Brasília — a mesma do engine de automações). **Idade**:
`opened_at ?? source_created_at` em dias de calendário (prefixo YYYY-MM-DD).
Falha de consulta é FAIL-SOFT: o valor vira `null` e o renderer OCULTA
(nunca 0 enganoso) — é o que acontece com `tasks` no viewer de snapshot
(adapter fail-closed); `record_matches` funciona no snapshot via
`snapshot_record_matches` (adapter de 0056). O tick de automações chama
`runKanban` com `opts.lean` (pula badges/conectados — os fatos das regras
têm gates próprios). UI: builder do widget (save path grava
`columnMetric`/`badges` explicitamente — o rebuild derrubaria chaves não
copiadas) e popover "Métricas" na página dedicada/cheia
(`components/kanban/metrics-popover.tsx`, spread completo via
`persistKanban`). Formatação única em `components/kanban/format.ts`
(dinheiro / "N d" / número pt-BR).

## 5. Invariantes críticas (NÃO QUEBRAR)

Estas regras já causaram ou causariam bugs graves e silenciosos. Elas também estão
em [`AGENTS.md`](../AGENTS.md) (instruções para agentes de IA), mas valem — e
principalmente — para mantenedores humanos.

1. **RPC de widgets duplicado.** `run_widget_query_snapshot` é uma cópia de
   `run_widget_query` apontada para `snapshot_records`, com as restrições do snapshot
   aplicadas internamente (mock-aware). **Toda mudança em `run_widget_query` (nova
   migração que o recrie) DEVE ser espelhada em `run_widget_query_snapshot` na mesma
   migração** — inclusive o helper `_widget_match_expr` ↔ `_widget_match_expr_snap`.
   Divergência = snapshot público mostrando números diferentes do dashboard, sem
   nenhum erro visível.
2. **Regra dos mocks triplicada.** A detecção "consulta referencia Data Reunião"
   existe em `run_widget_query`, `run_widget_query_snapshot` e
   `lib/widgets/mock-reuniao.ts`, toda por substring das duas chaves
   `bitrix_uf_crm_*`. Alterar um lado sem os outros quebra a paridade.
3. **Mocks em snapshots.** Mocks (`records.is_mock`) entram SEMPRE no dataset
   congelado, ignorando as restrições do snapshot (0057). As restrições são aplicadas
   dentro da RPC como `(is_mock OR restrições)`. **Não reintroduza filtros de
   restrição injetados pelo viewer** — um AND puro derrubaria os mocks.
4. **Período congelado ≠ restrição.** `snapshots.default_period` (0059) é filtro de
   **consulta** (mesma semântica da barra do dashboard), aplicado pelo resolver
   padrão no viewer. Sem ele, consultas em "todo período" deixam de referenciar Data
   Reunião e a regra dos mocks os derruba.
5. **Snapshots são acesso público controlado.** Nunca crie política RLS `to anon` nem
   conceda EXECUTE a `anon`/`authenticated` nas funções de snapshot. O caminho
   público é exclusivamente `app/s/[token]` + service role após validar o token.
6. **SQL antes do deploy.** Migrações que criam colunas selecionadas pelo app (ex.:
   0051, 0059, fase-14) devem ser aplicadas **antes** do deploy do código — sem a
   coluna, as telas quebram. Confira o aviso no cabeçalho de cada migração.
7. **Bucket canônico.** A chave de bucket de data gerada no SQL deve bater com
   `canonicalBucketKey` no cliente (`lib/widgets/`) — divergência quebra rótulos e
   filtros rápidos. Desde a 0085 a ATRIBUIÇÃO de dia é a de Brasília nos dois
   lados (`_widget_local_ts` no SQL ↔ prefixo `parseYmd` no cliente); os
   FORMATOS de chave seguem os mesmos — mudar um formato ou a âncora de fuso de
   um lado só quebra a paridade em silêncio.
8. **Autorização pelo vínculo vivo.** Use `records.responsible_id →
   responsibles.user_id` para visibilidade; `owner_user_id` é legado (0037).
9. **Fonte por métrica se resolve no ENGINE, nunca no RPC.** `Metric.sources`
   vira filtro `record_type in (...)` de uma chamada RPC separada
   (lib/widgets/metric-sources.ts + engine.ts); o par
   `run_widget_query`/`run_widget_query_snapshot` não conhece o conceito. Não
   introduza parâmetro de fonte-por-métrica no RPC — obrigaria nova migração
   espelhada (invariante 1) sem necessidade. O universo de linhas é sempre
   `widgets.sources`; o `@period` pré-sintetizado dos filtros rápidos deve
   cobrir fontes do widget ∪ fontes das métricas ∪ fontes dos operandos com
   ESCOPO (`agg:…@<fonte>`, 19/07/2026) — `widgetQuerySources` com o
   `fieldByKey` (3 pontos: page, viewer de snapshot e widget-scope), senão as
   pernas perdem registros em silêncio. O mesmo vale para as pernas:
   `metricLegSources`/`partitionMetricLegs` unem `formulaScopedSources` ao
   conjunto da métrica. A regra dos mocks das pernas COBERTAS (fontes dentro
   das do widget) também se resolve no engine: top-up `is_mock = true`
   (`recordListIncludesMocks`/`runCoveredLegMockTopUp`, 20/07/2026) mesclado
   ao stream de extras — não a resolva via RPC nem re-inspecione a regra fora
   de `resolveListFilters` (record-list.ts).

10. **Sub-fontes se resolvem no ENGINE, nunca no RPC.** Uma sub-fonte
    (`sub_sources`, 0078) compartilha o `record_type` da pai; a resolução (fonte
    efetiva por `record_type`, predicado da sub, data e membro de unificado
    próprios) mora no engine (`lib/sources.ts` `planSourceLegs` +
    `lib/widgets/engine.ts`/`record-list.ts`). O par
    `run_widget_query`/`run_widget_query_snapshot` **não conhece o conceito** —
    não recrie as RPCs para isso (não acione a invariante 1). O membro de
    unificado é por `source_key`; o `p_correspondences` de TODA consulta sai de
    `correspondenceMapForSources` (um ref por perna, fallback perna → raízes →
    todos; v1.6) — misturar o membro da pai e o da sub no mesmo `coalesce` pega
    o 1º não-nulo (uma linha com as duas colunas preenchidas erra), e isso vale
    TAMBÉM para widget que nem selecionou a sub (mesmas linhas, mesmo
    `record_type`). Nunca passe `buildCorrespondenceMap` (união global) a uma
    consulta — ele é só das opções de bucket. `AvailableField.unifiedMembers`
    (por `record_type`) é RAIZ-primeiro pelo mesmo motivo. Os MODOS de exibição
    das pernas (`settings.subSeriesMode` — empilhado/total/lado a lado) e o
    zeroing de operandos escopados em fonte-irmã também se resolvem no
    ENGINE/chart (`zeroSiblingScopedOperands`, `foldRowGroup`,
    `lib/widgets/sub-series.ts`) — nunca nos RPCs. Ver §4.8.

11. **Datas são strings no fuso de Brasília.** Valores **datetime** ingeridos de
    fonte com `data_sources.timezone` configurado (0079) são convertidos para
    America/Sao_Paulo na ENTRADA (`lib/date/normalize.ts`, aplicado no mapper do
    sync); o read side inteiro é prefix-based (display, buckets, comparação
    textual do período) e depende do dia certo estar no prefixo. Campo Bitrix
    tipo `date` é calendário puro — **nunca converter** (recuaria um dia);
    date-only é sempre passthrough. O formato emitido
    (`YYYY-MM-DDTHH:mm:ss-03:00`) deve seguir byte-idêntico ao do backfill 0080,
    senão o reconcile reescreve tudo (churn de audit). Desde a 0085 o read side
    dos RPCs também é dia de Brasília para as colunas `timestamptz` do NÚCLEO:
    bounds de período/filtro em coluna do núcleo levam offset explícito
    `-03:00` (`anchorCoreDateBound` no client + ancoragem por coluna no ramo
    `@period` do RPC) e o bucketing passa por `_widget_local_ts` (núcleo =
    `at time zone 'America/Sao_Paulo'`; texto = prefixo de 10 chars). NUNCA
    ancore bounds de campo custom (texto): a comparação é lexicográfica e o
    offset no lower bound excluiria valores date-only. NUNCA aplique
    `at time zone` a valor texto: um naive (CSV) recuaria um dia.
    **Write side das colunas core `timestamptz` (26/07/2026):** valor NAIVE de
    fonte sem fuso (planilha do Estudo, CSV do wizard/API) é hora de parede de
    BRASÍLIA e deve ser ANCORADO na gravação com `anchorNaiveToBrasilia`
    (`lib/date/normalize.ts` — date-only → `T00:00:00-03:00`; naive → sufixo
    `-03:00`; com offset/lixo → passthrough). Sem a âncora o Postgres assume
    UTC e o registro recua 3h — os de 00:00–02:59 mudam de dia e os do dia 1
    caem no mês anterior (bug das "15 vs 17 vendas do site", corrigido pelo
    backfill `supabase/apply/backfill-naive-tz.sql`). Isso vale SÓ para coluna
    core `timestamptz` — campo custom (texto) segue naive/passthrough, como
    acima. E o reconcile compara as colunas core de data por INSTANTE
    (`timestampValuesDiffer`, `lib/sync/shared.ts`): o PostgREST devolve
    `+00:00` e os mappers emitem `-03:00` — byte-compare (`valuesDiffer`)
    churnaria update+audit de toda linha a cada sync (aconteceu até
    26/07/2026: ~126k entradas de audit por coluna). Campos custom (texto)
    seguem no byte-compare: lá o formato É o dado.

12. **Escopo de widget em server action sai SEMPRE do widget-scope.** Toda
    server action que consulta dados de um widget do dashboard (paginação,
    export, Tabela Livre, kanban — e qualquer action deferida futura) monta o
    recorte por `loadWidgetScope`/`resolveWidgetViewScope`
    (`lib/widgets/widget-scope.ts`) — nunca remonte `__qf__`/`ff_`/`__ff__`/
    `tf_`/tradução de operação/`__pw__` à mão: cópias parciais foram exatamente o
    bug de widgets deferidos ignorando o filtro de operação até F5. No
    cliente, o fetch deferido re-dispara pelo fingerprint `scopeKey`
    (`deferredScopeById` da page), nunca por `useSearchParams` (filtro
    persistido no banco não muda a URL). A página cheia do kanban de widget
    (`/kanbans/w/[widgetId]`) NÃO é uma action de widget-no-dashboard: é um
    contexto de visualização próprio (como a Agenda) que ignora os filtros do
    pai POR INTEIRO e POR DESIGN — RSC → `runKanban` direto, barra de período
    própria. Ver §4.10.

13. **Linhas core de `field_definitions` são OVERRIDES, nunca campos custom.**
    A migração 0086 seeda as colunas do núcleo de `records` como linhas
    `source_system='core'` (`field_key` = nome da coluna) para a aba Campos
    exibi-las/geri-las (rótulo, olho, ordem; texto↔selecao na whitelist
    `CORE_SELECT_CAPABLE` — pipeline/etapa/tipo de venda/canal/Base
    `source_system`). O ref de
    widget segue sendo o nome CRU da coluna (`pipeline`) — uma linha core
    JAMAIS pode virar `custom:<key>` em catálogo, operando, coluna ou mapa
    `fieldByKey`. O split é feito por `lib/records/core-defs.ts`
    (`isCoreDef`/`splitCoreDefs`): `buildAvailableFields` particiona e aplica
    rótulo/olho; todos os consumidores de defs-como-custom filtram com
    `isCoreDef` (nunca com `.neq("source_system",'core')` — campos locais/app
    têm `source_system` NULL e o `<>` os derrubaria). Os loaders de builder
    usam `show_in_builder OR source_system='core'` — a linha core precisa
    chegar ao merge mesmo oculta, senão o hardcoded de `CORE_FIELDS`
    reapareceria. As options do `pipeline` (selecao) são reescritas a cada
    sync com os funis vivos (`lookups.categoryNames()` em `syncFieldCatalog`);
    edição manual das options não sobrevive ao sync (mesmo trato do campo
    curado `fonte`). A Base (`source_system`) nasce selecao desde a 0099 com
    as origens de ingestão como options (distintos da org ∪
    bitrix/sheet_site/manual/csv) — ao contrário do pipeline, NADA as
    reescreve depois: origem nova entra pelo /campos.

14. **Board na Lixeira não abre; duplicação sempre remapeia.** `dashboards.status
    = 'trashed'` (0087) significa 404 em `/dashboards/[id]`, `/kanbans/[id]` E
    `/s/[token]` (a RLS `dashboards_select` NÃO filtra por status — o "não
    abre" vive nas pages/actions; não afrouxe esses guards), fora dos pickers
    (`listWidgetLinkTargets`/`listTaskBoards`), do lookup de preset e do
    refresh de snapshots. Exclusão definitiva SÓ de dentro da Lixeira
    (`deleteBoardPermanently` exige `status='trashed'` no predicado); a purga
    física é o cron `apply/pg-cron-purge-trash.sql` (14 dias) e o hub esconde
    vencidos por conta própria. `duplicateBoard` SEMPRE remapeia os uuids de
    widget/dashboard dentro dos settings copiados e REMOVE
    `settings.preset`/`settings.presetKey` — sem isso, conectores/links da
    cópia apontariam para os widgets do original e o `applyPreset` adotaria/
    sobrescreveria a cópia.

15. **Isolamento de organização vive em RLS + loaders, NUNCA no RPC.** As
    tabelas-raiz carregam `organization_id` (0090) e TODA policy é prefixada
    pelo gate `auth_org_ids()` (0091) — inclusive os ramos admin/permission.
    O par `run_widget_query`/`_snapshot` é SECURITY INVOKER e herda o
    isolamento do chamador: NÃO introduza parâmetro de org nos RPCs (não
    acione a invariante 1). Caminhos service-role (sync/ingest/viewer/refresh
    de snapshots) BYPASSAM a RLS — eles escopam explicitamente (org do
    dashboard no viewer/refresh; triggers de stamp da 0090 nos inserts).
    NUNCA carregue catálogo/campos/correspondências com service role sem
    filtrar por org — vazaria nomes de outras empresas.

16. **org_admin e Owner são protegidos por TRIGGER + GUC, não por UI.** Um
    org_admin por org (índice parcial), indeletável/indemovível; `app_owner`
    imutável e com FK sem cascade; `organizations` só deleta via
    `delete_organization`. Os triggers valem até para service role — o único
    desbloqueio é `set_config('app.allow_protected_change','on',true)` em SQL
    direto. Nenhuma action/tela pode ganhar esse poder; o modo Owner exige
    ainda env `OWNER_USER_ID` == uid (fail-closed: env ausente nega sempre) e
    `requireOwner()` em TODA page/action de `/owner`.

17. **Acesso efetivo = papel × overrides, resolvido em UM lugar por família.**
    Boards: helpers `auth_board_visible/editable/manageable` (blocked vence
    papel; view/edit concede; dono/admin imunes) — não reimplemente a regra
    em policy/page nova. Áreas de Configurações: `AREA_GATES` +
    `canAccessSettingsArea` (`lib/auth/access.ts`) — deny vence tudo, allow
    vence o papel; sub-page nova usa `requireSettingsArea` (link condicionado
    usa `checkSettingsArea`, a variante sem redirect). A CHAVE de área é
    HISTÓRICA e desacoplada da rota (27/07/2026: `fontes` →
    `/registros/bases`, `log` → `/registros/log`, `moedas` → aba de
    `/campos`) — NUNCA renomear (overrides gravados). Bases negadas:
    RLS de `data_sources`/`sub_sources` (pickers somem via loadSources) +
    `records_select` (dados) — não filtre "na mão" em componente. Escopo de
    bases do board (`sourceScope`) é OFERTA, nunca autorização — não os
    confunda.

18. **Espaço de grid v2: leitura normaliza, escrita converte antes (§4.12).**
    Unidades de `grid_position`/`ShapeLine`/`canvas` dependem de
    `settings.canvas.gridVersion` (2 = fino base-120; ausente = legado
    base-12). TODA leitura de linha crua passa por `normalizeGridSpace`
    (`lib/widgets/grid-space.ts`) e TODO escritor de geometria chama
    `ensureFineGrid` ANTES de gravar (a ordem leitura→carimbo CAS→conversão é
    o que impede a dupla conversão — não a mude). Um caminho novo que grave
    posição sem o ensureFineGrid pode MISTURAR escalas no banco; um que leia
    sem normalizar renderiza um board legado 10× menor. Snapshots congelados
    (`snapshots.config`) NUNCA são migrados por backfill — a conversão
    runtime do viewer é permanente. RPCs de widget intocados.

19. **`settings.pages` (mescla) nunca viaja por JSON e é preservada no apply
    (§4.12).** `pages` referencia widget IDS do banco: o export/clipboard a
    REMOVEM, o `validate.ts` a rejeita com warning e `applyPresetDefinition`
    a RE-INJETA do settings existente no update in-place — sem isso, qualquer
    edição por IA desfaria mesclas em silêncio (ou pior: adotaria ids de outro
    board). `deleteWidget` mantém a integridade (host excluído devolve membros
    ao canvas; membro excluído sai do `pages` do host). A ocultação dos
    membros é SÓ de renderização (`collectPageMembers` no grid) — nunca
    filtre membros da computação de dados da page (a página oculta precisa do
    dado ao virar visível).

20. **Agrupamento de responsáveis se resolve no ENGINE/loaders, nunca no RPC
    nem repontando `records.responsible_id` (§4.13).** `canonical_id` (0101)
    é exibição reversível: filtros por responsável DEVEM expandir para o
    grupo (`expandResponsibleFilters` nos choke points de
    `runWidget`/`runCalculatedWidget`/`runRecordList*`), a dimensão funde no
    merge client-side e o rótulo sai do principal. Caminho novo que filtre ou
    agrupe por `responsible_id` sem passar por esses choke points mostra o
    grupo rachado em silêncio. Restrição de snapshot grava o conjunto JÁ
    EXPANDIDO (o RPC lê a coluna como está — não o recrie);
    `auth_responsible_ids()` devolve o grupo (visibilidade do vendedor cobre
    registros no id do apelido). Grupo sempre PLANO — só a action
    `setResponsibleCanonical` escreve a coluna.
21. **Match de bases dinâmicas resolve no helper, fusão de operações resolve
    no ENGINE (§4.14).** `_widget_match_expr(_snap)` resolvem a fonte por
    `data_sources` (são `stable`; recriação segue a invariante 1 — os dois na
    mesma migração, linha do lookup idêntica). Refs `match:` de SUB-fontes não
    existem em nenhum catálogo (buildMatchFields/matches-manager/validador de
    import) — não os reintroduza. A fusão de perfis de operação
    (`fuseOperationProfiles` + op interno `in_ci`) vive em
    `lib/config/operation-scope.ts`: NÃO recrie os RPCs para variações novas
    de fusão, e mantenha o degrade byte-idêntico dos casos não-fundíveis
    (fiscalizado por `lib/config/operation-scope.test.ts`).
22. **Sub-operações automáticas: identidade por `auto_source_record_id`,
    perfil do gerador, nunca delete (§4.14).** A rotina
    (`lib/operations/auto-operations.ts`) roda com service role e carimbo
    EXPLÍCITO de org; rename atualiza a MESMA operação, registro sumido
    INATIVA (goals/vínculos/snapshots podem referenciar a operação) e o
    perfil gerado é reescrito a cada rodada (customize a CONFIG em
    `source_auto_operations`, não o perfil). `records.operation_id` derivado
    fica NULL nessas operações — dimensão "por Operação" e
    `allowed_operation_ids` de snapshot não as enxergam (limitação
    documentada; não "conserte" repontando a coluna).
23. **Automações do kanban e ações em massa se resolvem no ENGINE/actions,
    nunca no RPC (§4.15).** O caminho service-role das automações carrega
    escopo EXPLÍCITO de org em TODA consulta (`opts.orgId` do
    `runRecordList`, `.eq("organization_id")` nos fetches auxiliares) — um
    fetch novo sem o escopo vaza registro entre orgs em silêncio. Colunas por
    bucket de DATA nunca são alvo de automação (não idempotente); mocks nunca
    movem/selecionam; `KANBAN_OVERFLOW_KEY` nunca recebe card. Exclusão de
    registro é admin-only (action espelha a RLS `records_delete`) e SEMPRE
    emite `record.deleted`. As ações em massa devolvem resultado POR ITEM e o
    board só reconcilia `data` → estado local com a fila DRENADA (guarda de
    resync) — remover a guarda faz o refresh clobrar o movimento otimista.
    Regras vivem em `kanban_automations` (tabela própria): NÃO as mova para
    `settings.kanban` (o widget-builder reconstrói o objeto no save e as
    derrubaria; o tick perderia a enumeração indexada).

## 6. Convenções do projeto

- **Cabeçalho de versão em todo arquivo**: `Versão: X.Y | Data: DD/MM/AAAA`,
  mudanças comentadas inline (`// vX.Y (data): ...`). É o único changelog que existe —
  mantenha-o ao editar.
- Comentários em português, explicando o **porquê** e as invariantes cross-file.
- Migrações SQL numeradas, **idempotentes** (`if not exists` / `create or replace` /
  `drop ... if exists`), com cabeçalho explicando o que fazem. Blocos consolidados
  por fase em `supabase/apply/`.
- Sem JSDoc formal — a documentação de código é prosa nos cabeçalhos + tipos de
  `lib/widgets/types.ts` e afins.
