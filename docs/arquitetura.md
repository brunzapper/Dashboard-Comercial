<!-- Versão: 1.1 | Data: 18/07/2026 -->
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
pós-processa). A função foi **recriada 17 vezes** ao longo das migrações — a versão
vigente é a da migração `0072_widget_rpc_min_max.sql`.

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
  `parent_operation_id` + `operation_subtree`.
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
- **Kanban/Tarefas/Agenda/Feed**: kanbans reusam `dashboards` (`kind='kanban'`);
  posições em `kanban_placements`; tarefas em `tasks` (RLS espelha registros; trava
  `locked` via trigger); comentários/subtarefas em `comments` + colunas de 0066.
- **Realtime** (0071): `records`/`tasks`/`comments` publicam em
  `supabase_realtime`; o app usa os eventos só como sinal de "algo mudou"
  (`components/realtime-refresher.tsx`).
- **Edição inline sem re-render global** (18/07/2026): a edição de célula
  (`updateRecordField`) NÃO chama `revalidatePath` — a célula é otimista
  (`components/registros/use-cell-commit.ts`) e a página reconcilia no cliente
  via realtime + `router.refresh()` debounced FORA da transition da célula
  (`lib/use-debounced-refresh.ts`). Só o form lateral (`RecordEditSheet`) e
  `createRecord` revalidam no servidor. Não reintroduza `revalidatePath` (nem
  `router.refresh()` síncrono no `onSaved`) no caminho de célula: Server Actions
  serializam por cliente e o re-render RSC da rota inteira a cada blur é o que
  travava a navegação.

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
   filtros rápidos.
8. **Autorização pelo vínculo vivo.** Use `records.responsible_id →
   responsibles.user_id` para visibilidade; `owner_user_id` é legado (0037).

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
