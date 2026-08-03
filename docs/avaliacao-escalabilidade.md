<!-- Versão: 1.1 | Data: 03/08/2026 -->
<!-- v1.1 (03/08/2026): item 7 — rotas de push (sheets/ingest) sem o recalc
     global por push (cauda incremental de lib/sync/post-ingest.ts); o O(N)
     ficou restrito ao recalc-daily. -->

# Avaliação de escalabilidade

> Avaliação realizada em 26/07/2026 sobre o código em `main`. Escopo: camada de
> dados (Postgres/Supabase — RPCs, índices, RLS), engine de widgets e render da
> página do dashboard, pipeline de sync/ingestão e infraestrutura de deploy.
> Método: leitura do código e das migrações (sem medições em produção — use
> `[dashboard:timing]` e `supabase/apply/diagnostico-perf.sql` para números
> reais do seu ambiente).

## Veredito

**O sistema é escalável dentro do seu nicho atual** — algumas organizações,
bases de CRM na casa de centenas de milhares de registros e dezenas de usuários
simultâneos — e várias decisões de arquitetura já foram tomadas pensando nisso
(agregação no SQL, índices dedicados, dedup de consultas, sync incremental).
**Não é, na configuração atual, um sistema para milhões de registros nem para
centenas de espectadores simultâneos**: os tetos vêm menos do design e mais de
três fatores — ausência de cache de resultados entre requisições, plano Hobby
da Vercel (60s por rota) e alguns caminhos O(N) conhecidos (listas sem limite,
`match:`, recalc diário).

Estimativas de ordem de grandeza na configuração atual:

| Eixo | Confortável hoje | Degrada a partir de | O que degrada primeiro |
|---|---|---|---|
| Registros (`records`) | ~100–500 mil | ~1 milhão | Widgets "todo período", colunas `match:`, filtros de período em campo custom (JSONB) |
| Usuários vendo dashboards ao mesmo tempo | ~10–30 renders simultâneos | dezenas | Pico de RPCs no Postgres (8 por render em paralelo), teto de 60s da Vercel |
| Organizações (multi-tenant) | dezenas | centenas ativas | Faixa única de sync (45s/minuto globais para todas as orgs) |
| Snapshots | dezenas–centenas | milhares sem expiração | Storage (cópia integral da base filtrada por snapshot) |

Com as ações de curto/médio prazo da §4 (cache de resultados, índices de
expressão, paginação universal de listas, upgrade de plano), o mesmo design
alcança **baixos milhões de registros e centenas de usuários** sem
reescrever nada estrutural.

## 1. O que já escala bem (pontos fortes)

- **Agregação empurrada para o SQL.** `run_widget_query` (vigente na 0085)
  monta um único SELECT agregado com GROUP BY sobre `records` e devolve só as
  linhas agrupadas — o payload não cresce com o número de registros, só com a
  cardinalidade das dimensões.
- **Bounds de período sargáveis por design.** A 0085 ancora os limites de dia
  com offset explícito `-03:00` comparado direto contra a coluna timestamptz
  ("sargável — índices 0069 preservados", comentário da própria migração), e a
  0069 criou os compostos `(record_type, source_created_at)` e
  `(record_type, closed_at)` exatamente para o shape quase universal
  "`record_type in (...) and data between ...`" dos widgets.
- **RLS na forma initplan.** Toda policy multi-org usa
  `organization_id in (select public.auth_org_ids())` (0091) — a subconsulta é
  avaliada uma vez por statement, não por linha. É o padrão recomendado para
  RLS em tabelas grandes.
- **Dedup e amortecimento de consultas no render.** `lib/widgets/rpc-memo.ts`
  compartilha uma única chamada entre widgets/notas/calculadoras de escopo
  idêntico dentro do mesmo render, e a página limita a 8 widget-tasks em voo
  (`WIDGET_TASK_CONCURRENCY`, `app/(app)/dashboards/[id]/page.tsx`) para não
  saturar o Postgres com o pico simultâneo.
- **Sync incremental, resumível e com orçamento.** O tick por minuto
  (`app/api/sync/tick/route.ts`) trabalha dentro de 45s, retoma o job ativo de
  onde parou (cursor em `sync_jobs`) e cria reconcile automático horário com
  janela de 1 dia — desenhado para nunca estourar o teto serverless e nunca
  bloquear a navegação.
- **Cargas pesadas já deferidas.** Tabela Livre, Kanban e Agenda não entram no
  render inicial — buscam dados via server action depois do mount, re-disparadas
  pelo fingerprint `deferredScopeById` (padrão pronto para ser estendido a
  outros tipos).
- **Observabilidade de performance embutida.** `[dashboard:timing]`
  (`lib/widgets/load-timing.ts`) loga total, seções e top 5 widgets por render;
  `supabase/apply/diagnostico-perf.sql` + manual §5 formam o runbook de
  diagnóstico.
- **Snapshots copiam em bulk.** A captura é `insert ... select` dentro de uma
  função SQL (0056), não linha a linha pela aplicação; snapshots têm expiração
  opcional (0097).

## 2. Tetos de escala (o que quebra primeiro, em ordem)

1. **Nenhum cache de resultados entre requisições.** Cada visualização da
   página do dashboard recomputa TODOS os widgets (RSC dinâmico, sem
   `revalidate`/cache). N espectadores do mesmo dashboard = N × dezenas de
   scans agregados idênticos. O modo de falha já está documentado no manual §5
   ("statement timeout em cascata" após reescritas em massa) — a carga
   simultânea dos widgets realimenta o problema.
2. **Teto de 60s do plano Hobby da Vercel** (`docs/arquitetura.md` §2). O
   render da página computa todos os widgets no servidor antes de responder; o
   `maxDuration = 300` declarado é clampado ao teto do plano. Dashboard grande
   + base grande + banco frio = risco de 504 no render inteiro, não só num
   widget.
3. **Listas sem limite fazem full fetch.** `runRecordList`
   (`lib/widgets/record-list.ts`) pagina de 1000 em 1000 até esgotar o
   conjunto quando o widget não define `settings.limit` (decisão de produto:
   "sem limite por padrão"). O tempo de render E o payload RSC crescem
   linearmente com a base. Existe `runRecordListPage` (página + count no
   servidor), mas só para widgets elegíveis.
4. **`match:` roda subconsulta correlacionada por linha.**
   `_widget_match_expr` executa uma subconsulta sobre `record_matches` para
   cada linha do agregado (manual §5); a 0077 indexou o caminho, mas o custo
   segue por linha × por widget que usa o campo — "todo o período" agrava.
5. **Filtros de período/dimensões em campos custom não usam índice.** Datas
   custom são texto em `custom_fields` (JSONB); o GIN de 0004 serve
   containment, não range — `custom_fields->>'x' >= '...'` vira seq scan
   dentro do subconjunto do `record_type`. Hoje é o caso de fontes cujo
   `default_period_field` é um campo custom (ex.: Data Reunião).
6. **Sync de faixa única global.** Um job ativo por vez, 45s por minuto para
   TODAS as orgs/fontes. Com poucas organizações Bitrix ativas o frescor dos
   dados começa a degradar (fila de reconciles); não há paralelismo por org.
7. **Recalc diário é O(N).** `recalcAllFormulaFields`
   (`lib/records/recalc.ts`, lotes de 500) relê e reescreve todo registro com
   campo de fórmula — churn de tuplas mortas (a causa nº 1 do runbook de
   perf) e duração linear na base. Desde 03/08/2026 ele roda SÓ no
   recalc-daily: as rotas de push (sheets/ingest) migraram para a cauda
   incremental de `lib/sync/post-ingest.ts` (antes rodavam o global a cada
   push e estouravam o teto de 60s).
8. **Snapshot = cópia integral.** Cada captura duplica o conjunto filtrado em
   `snapshot_records`; storage cresce com snapshots × registros. Mitigado por
   `expires_at` (0097) quando usado.

## 3. Quanto dá para crescer sem mexer em nada

- **Verticalmente**: subir o compute do Supabase (mais RAM/CPU = mais
  shared_buffers e paralelismo de scan) e o plano da Vercel (Pro: 300s de
  `maxDuration`) empurra os tetos 1–2 ordens de grandeza sem tocar código —
  é a alavanca mais barata e deve vir antes de qualquer refatoração.
- **Horizontalmente (usuários)**: o app é stateless (RSC + Supabase), então a
  Vercel escala instâncias à vontade; o gargalo é sempre o Postgres único.
  Sem cache de resultados, cada viewer adicional custa o mesmo que o primeiro.
- **Horizontalmente (orgs)**: RLS e índices por org aguentam centenas de
  organizações; o limite prático é o sync (item 6 acima) e o namespace global
  de `data_sources.key`/`record_type` (design consciente, com sufixo na
  colisão).

## 4. Roadmap recomendado

Todas as ações abaixo respeitam as invariantes do projeto (`AGENTS.md`):
nenhuma exige recriar `run_widget_query`/`_snapshot` nem mexer na semântica do
engine.

### Curto prazo (sem migração, maior retorno)

1. **Cache de resultado de widget com TTL curto** (30–60s), keyed pelo
   fingerprint de escopo que já existe (`deferredScopeById`/`scopeKey`) +
   org + usuário (o escopo de operação é por usuário — a chave PRECISA
   incluí-lo para não vazar recorte). Um `Map` por instância já corta o caso
   "vários viewers do mesmo dashboard"; uma tabela `widget_results_cache` ou
   KV cobre multi-instância. É a única mudança que muda a curva de custo por
   viewer de O(widgets) para O(1) amortizado.
2. **Paginação server-side universal nas listas**: estender a elegibilidade
   de `runRecordListPage` (ou aplicar um teto alto com aviso na UI) para
   eliminar o full fetch de `runRecordList` em bases grandes.
3. **`ANALYZE` automático pós-sync em massa**: o runner já sabe quando um
   backfill/reconcile reescreveu muita linha — disparar a Parte A do
   `diagnostico-perf.sql` ao final do job elimina a causa nº 1 do runbook.
4. **Upgrade de planos** (Vercel Pro + compute do Supabase) quando os
   primeiros timeouts aparecerem em uso normal — antes de otimizar código.

### Médio prazo (migrações aditivas; RPCs intocados)

5. **Índices de expressão nos campos custom de data quentes**: para cada
   fonte cujo `default_period_field` é custom, um btree parcial
   `create index on records ((custom_fields->>'<chave>')) where record_type = '<tipo>'`
   torna o filtro de período sargável (a comparação textual ISO já é
   lexicográfica — mesmo precedente do RPC).
6. **Composto `(organization_id, record_type, <data>)`** quando houver 2+
   orgs com volume relevante — hoje os compostos de 0069 não incluem org.
7. **Deferir widgets pesados de gráfico** no padrão já existente (Tabela
   Livre/Kanban): render inicial entrega o shell + widgets leves; os pesados
   chegam via server action. Corta o pior caso do teto de 60s.
8. **Recalc incremental**: watermark de `updated_at` para recalcular só o
   que mudou desde o último recalc, com varredura completa semanal de
   segurança.

### Longo prazo (só com crescimento ~10×)

9. **Faixas de sync paralelas por organização** (um job ativo POR org, com
   orçamento próprio) ou mover o sync para fila/worker fora do ciclo
   request-response.
10. **Rollups materializados** (por dia × fonte × dimensões quentes) para
    widgets "todo período", atualizados pelo próprio tick.
11. **Particionamento de `records` por `organization_id`** — só se alguma org
    individual passar de alguns milhões de linhas; antes disso os índices
    compostos resolvem.

## 5. Como medir (antes e depois de cada ação)

- `[dashboard:timing]` nos logs da Vercel: total do render, seções e top 5
  widgets — identifica o widget dominante.
- `supabase/apply/diagnostico-perf.sql`: estatísticas do planejador (Parte A),
  vacuum (Parte B), `EXPLAIN` dos widgets dominantes (Parte C).
- Logs do Supabase: `57014 statement timeout` é o sintoma-sentinela de
  saturação do banco.
