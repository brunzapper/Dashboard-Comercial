<!-- Versão: 1.16 | Data: 22/07/2026 -->
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
| Deploy | Vercel (plano Hobby — rotas com teto de 60s, `maxDuration = 60`) | push → deploy automático; não há CI versionado |
| Agendamento | `pg_cron` + `pg_net` **dentro do Postgres**, chamando rotas da Vercel | `supabase/apply/pg-cron-*.sql` |

Pontos não-óbvios (conhecimento tribal — não descubra do jeito difícil):

- **No Next 16 o "middleware" chama-se `proxy`** — o arquivo é `proxy.ts` na raiz,
  não `middleware.ts`.
- **Não existe `.env.local`.** As variáveis vivem nas Environment Variables da
  Vercel e no painel do Supabase. `.env.example` é o checklist comentado;
  `lib/env.ts` falha com erro claro em runtime se faltar variável.
- **O código nunca conecta ao banco em build/deploy.** Toda migração é SQL aplicado
  manualmente no SQL Editor do Supabase (ver `supabase/README.md`).
- **Não há testes automatizados nem CI.** As redes de segurança são
  `npm run typecheck`, `npm run lint` e as queries de conferência do
  `supabase/README.md` (ver a seção "Lacunas conhecidas" do manual de manutenção).

## 3. Mapa de pastas

```
app/
  (auth)/login/          Login email/senha (não há signup público)
  (app)/                 Área autenticada
    page.tsx             Home = lista de dashboards
    dashboards/[id]/     Página do dashboard (orquestra a leitura dos widgets)
    kanbans/[id]/        Kanbans dedicados (reusam dashboards com kind='kanban')
    registros/           Grid de dados por fonte + importação CSV + painel de sync
    tarefas/             Tarefas standalone
    campos/              Colunas dinâmicas + correspondências (admin)
    configuracoes/       conta, fontes, integracoes, log, metas, moedas,
                         operacoes, responsaveis, snapshots, usuarios
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

### 4.2 Filtros de período

`lib/widgets/period.ts` + `lib/widgets/period-resolve.ts`. O período efetivo de cada
widget combina: **barra global** (URL > preferência do usuário > config do dashboard),
escopo por aba e **widgets de filtro de período** que sobrescrevem alvos vinculados.
A mesma lógica roda na página do dashboard, na action da Tabela Rápida e no viewer de
snapshot — foi extraída para um módulo puro justamente para não divergir. O escopo
do widget é **reconstruído no servidor** (`lib/widgets/widget-scope.ts`) — nunca se
confia em config vinda do client.

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
  editável em Configurações → Fontes) declara o fuso em que a ORIGEM expressa
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

### 4.6 Papéis, permissões e RLS

Três papéis (`roles` + `user_roles`): **admin** (tudo), **gestor** (vê tudo, edita),
**vendedor** (só os próprios registros). Permissões-chave: `view_all_records`,
`edit_record_values`, `manage_field_definitions`, `view_forecast`.

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
  campo é preferência INDIVIDUAL, como o último período (`lastPeriod`).
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
  série própria (fonte como dimensão líder), calculada por recursão em
  `runWidget` (filtro + data + membro próprios). O usuário assume que os
  conjuntos são disjuntos. **Para restringir a PAI sem esvaziar a sub** (ex.:
  pai só "Desqualificado" × sub "Clientes Lite"), o filtro do widget precisa
  ter a PAI como fonte-alvo (`WidgetFilter.sources = [pai]`): filtros globais
  (sem alvo) valem para TODAS as pernas e cairiam também sobre a sub. KPI/card/
  "Agrupar período" e o modo lista ficam no **absorver** (a perna extra não vira
  série nesses tipos) — limitação v1.
- **Arquivos:** `lib/sources.ts` (resolvers + `planSourceLegs`),
  `lib/widgets/engine.ts` (fonte efetiva + série por fonte), `record-list.ts`
  (mesmo no modo lista), `lib/correspondences.ts` (`correspondenceMapForSources`),
  UI em `components/configuracoes/sub-sources-manager.tsx` e o toggle no
  `widget-builder.tsx`.
- **Ordem do coalesce dos unificados (20/07/2026):**
  `correspondenceMapForSources` ordena os refs com os `custom:` (ESPARSOS —
  só existem nas linhas do próprio record_type) ANTES das colunas do núcleo
  (DENSAS — preenchidas em todo record_type). Sem isso, `source_created_at`
  (membro do lead) sombreava `custom:data_assinatura` (membro do deal) na
  MESMA perna e o deal bucketizava pelo mês de criação. Limitação restante:
  dois membros de coluna de NÚCLEO distintos ainda se sombreiam (correção
  definitiva = CASE por record_type no RPC, migração espelhada futura).
- **Campo de período `custom:` (0082):** `sub_sources.default_period_field`
  aceita também um campo personalizado de DATA (`custom:<field_key>` — ex.: sub
  "SQLs" da pai Leads datada pela *Data Reunião*). O read side já suportava
  (`@period.byType` aceita `custom:` e a regra dos mocks 0052 inspeciona o
  byType serializado); a validação semântica (campo existe e é `data`) fica na
  server action de fontes.

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
- **Banco** (`__qf__` filtros rápidos do card — inclusive operação — e
  `__pw__` janela de períodos, em `dashboard_table_cells`): server action +
  `revalidatePath` → re-render RSC **sem** mudança de URL.

Os widgets computados no RSC (KPI/gráficos/tabelas/listas/calculados) cobrem
os dois transportes por construção (props novas a cada render). Os widgets
**DEFERIDOS** (Tabela Livre e kanban, fetch client-side via server action)
precisam de duas garantias, ambas desta entrega:

- **Escopo ÚNICO:** as actions deferidas (`runQuickTable`,
  `runKanbanWidget`) montam os filtros de visualização pela MESMA assembly da
  page — `resolveWidgetViewScope`/`loadWidgetScope`
  (`lib/widgets/widget-scope.ts`): filtros rápidos `__qf__` (com exceção do
  vendedor), `?tf_`, `?ff_` com fallback `lastFieldFilters`, tradução de
  OPERAÇÃO (`operation-scope.ts`) e `__pw__` nos settings efetivos. A
  cobertura do `@period` (invariante 9) usa as métricas EFETIVAS (Tabela
  Livre: colunas BI de `settings.quickTable`; kanban: a fonte do quadro).
  O kanban aplica o MESMO recorte dos demais widgets (colunas continuam
  derivadas das opções do campo — filtro só reduz cards); a **Agenda ignora
  os filtros do dashboard POR DESIGN** (range próprio mês/semana).
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
    (por `record_type`) é RAIZ-primeiro pelo mesmo motivo. Ver §4.8.

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

12. **Escopo de widget em server action sai SEMPRE do widget-scope.** Toda
    server action que consulta dados de um widget do dashboard (paginação,
    export, Tabela Livre, kanban — e qualquer action deferida futura) monta o
    recorte por `loadWidgetScope`/`resolveWidgetViewScope`
    (`lib/widgets/widget-scope.ts`) — nunca remonte `__qf__`/`ff_`/`tf_`/
    tradução de operação/`__pw__` à mão: cópias parciais foram exatamente o
    bug de widgets deferidos ignorando o filtro de operação até F5. No
    cliente, o fetch deferido re-dispara pelo fingerprint `scopeKey`
    (`deferredScopeById` da page), nunca por `useSearchParams` (filtro
    persistido no banco não muda a URL). Ver §4.10.

13. **Linhas core de `field_definitions` são OVERRIDES, nunca campos custom.**
    A migração 0086 seeda as colunas do núcleo de `records` como linhas
    `source_system='core'` (`field_key` = nome da coluna) para a aba Campos
    exibi-las/geri-las (rótulo, olho, ordem; texto↔selecao na whitelist
    `CORE_SELECT_CAPABLE` — pipeline/etapa/tipo de venda/canal). O ref de
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
    curado `fonte`).

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
