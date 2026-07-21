// Versão: 2.8 | Data: 21/07/2026
// Página de um dashboard: computa os dados de cada widget (server, via RLS) e
// entrega ao shell client (grid + charts). Fase 6A.
// v2.8 (21/07/2026): deferredScopeById — fingerprint (período + filtros de
//   visualização + __pw__) por widget DEFERIDO (Tabela Livre/kanban): o effect
//   do cliente re-busca quando o escopo efetivo muda, cobrindo também os
//   filtros persistidos no banco (__qf__), que não passam pela URL.
// v2.7 (19/07/2026): performance do load — (a) widget tasks rodam sob limitador
//   de concorrência (WIDGET_TASK_CONCURRENCY; antes todos disparavam juntos e o
//   pico saturava o Postgres em dashboards grandes — statement timeouts em
//   cascata, runbook §5); (b) resumo de timing por render ([dashboard:timing]:
//   total, buscas base, widgets com top 5 mais lentos, fkLabels, filtros
//   rápidos) sempre logado no servidor — 1ª coisa a olhar quando "ficou lento".
// v2.6 (18/07/2026): fontes por métrica (Metric.sources) — full fetch do modo
//   lista via runRecordListWithExtras (recordListExtraById → basis dos
//   subtotais no cliente, fora do export/FK) e cobertura do @period dos
//   filtros rápidos ampliada p/ as fontes das métricas (widgetQuerySources).
// v2.5 (17/07/2026): <TrackLastView /> — grava a rota (com ?tab=) em
//   user_settings.lastView p/ a Home restaurar ao reabrir o app.
// v2.4 (17/07/2026): busca client-side — o q do tf_ é PULADO nos widgets em
//   que searchHandledOnClient(settings) (lista de registros sem limit, barra
//   visível): o cliente recebe o dataset completo e filtra em memória
//   (WidgetCard/RecordListTable). Filtros estruturados do tf_ seguem aqui.
// v2.3 (15/07/2026): Tabela Livre (tabela_editavel) — widget fica FORA do
//   loop de computação (dados BI deferidos via runQuickTable no cliente);
//   células digitadas entregues em tableCellsById (carona no cellsData).
// v2.2 (15/07/2026): widgets calculadora/nota/forma — computa as variáveis da
//   calculadora (calcVarsById) e as expressões da nota (noteById) via
//   runCalculatedWidget; carrega a expressão compartilhada (calcExprById,
//   row __calc__); consome ?focus=<widgetId> (atalho vindo de outro dashboard).
//   'forma' fica fora de dataWidgets (não tem dados nem período).
// v2.1 (15/07/2026): filtros do "Filtro por campo" carregam as fontes do
//   widget-filtro como alvo (pass-through) — exceto filtros unificados.
// v2.0 (09/07/2026): período resolvido POR widget. Uma barra global
// (?periodo/de/ate/campo + dashboards.settings.periodBar) atinge os widgets não
// cobertos; cada widget de filtro (visual_type 'filtro') controla seus alvos
// (?pf_<id>/pfd_<id>/pfa_<id>) e tem prioridade sobre a barra global.
import { notFound } from "next/navigation";

import { getSessionInfo } from "@/lib/auth/session";
import { hasAnyRole, type RoleKey } from "@/lib/auth/roles";
import { createClient } from "@/lib/supabase/server";
import type { FieldDefinition, RecordRow } from "@/lib/records/types";
import { buildAvailableFields } from "@/lib/widgets/fields";
import {
  currencyOptionsFrom,
  loadCurrencyRates,
  loadEnabledCurrencies,
  resolveCurrencyCode,
  yearQuarterOf,
} from "@/lib/widgets/currency";
import { runWidget } from "@/lib/widgets/engine";
import { isCardModeWidget, runCardWidget } from "@/lib/widgets/card";
import {
  runRecordListPage,
  runRecordListWithExtras,
} from "@/lib/widgets/record-list";
import { collectRecordFkLabels } from "@/lib/widgets/fk-labels";
import {
  runEntityList,
  type EntityListRow,
  type EntityRowSource,
} from "@/lib/widgets/entity-list";
import { runCalculatedWidget } from "@/lib/widgets/formula-metric";
import {
  buildCorrespondenceMap,
  loadCorrespondences,
} from "@/lib/correspondences";
import {
  applyPeriodToFilters,
  hasSelection,
  periodKeys,
  resolvePeriodSelection,
  type PeriodSelection,
  type SavedPeriod,
} from "@/lib/widgets/period";
import { widgetQuerySources } from "@/lib/widgets/metric-sources";
import { createPeriodResolver } from "@/lib/widgets/period-resolve";
import {
  applyPeriodWindowChoice,
  parsePeriodWindowChoice,
  PW_COL_KEY,
  PW_ROW_KEY,
  QF_ROW_KEY,
  bucketKeyFromRpcValue,
  hasQuickValue,
  isBucketEntry,
  isPeriodEntry,
  parseQuickFilterValue,
  quickOptionsFilter,
  staticBucketOptions,
  type PeriodWindowChoice,
  type QuickFilterValue,
  type WidgetQuickFilters,
} from "@/lib/widgets/quick-filters";
import { formatBucketLabel } from "@/lib/widgets/date-buckets";
import { CALC_COL_KEY, CALC_ROW_KEY } from "@/lib/widgets/calculator";
import { NOTE_MAX_EXPRS } from "@/lib/widgets/note-template";
import type {
  CalcWidgetResult,
  DashboardSettings,
  FieldFilterOptions,
  PeriodWindowKey,
  Transform,
  Widget,
  WidgetData,
  WidgetFilter,
  WidgetSettings,
} from "@/lib/widgets/types";
import {
  isKnownSource,
  toRecordType,
  type SourceKey,
} from "@/lib/sources";
import { loadSources } from "@/lib/config/sources";
import {
  collectOperationFilterIds,
  loadOperationScopes,
  translateOperationFilters,
} from "@/lib/config/operation-scope";
import {
  RECORD_LIST_PAGE_SIZE,
  parseViewFilter,
  searchHandledOnClient,
  serverPaginatedList,
  viewStateToFilters,
} from "@/lib/widgets/view-filters";
import { buildDashboardSnapshot } from "@/lib/widgets/history";
import { withRpcMemo } from "@/lib/widgets/rpc-memo";
import { startDashboardLoadTiming } from "@/lib/widgets/load-timing";
import { DashboardClient } from "@/components/dashboards/dashboard-client";
import { TrackLastView } from "@/components/layout/track-last-view";
import type { ResponsibleOption } from "@/components/dashboards/charts/record-list-table";

function str(v: string | string[] | undefined): string {
  return Array.isArray(v) ? (v[0] ?? "") : (v ?? "");
}

// Máximo de widget tasks em voo por render. Todos os widgets disparavam ao
// mesmo tempo; num dashboard grande o pico de consultas simultâneas satura o
// Postgres (statement timeouts em cascata) e TODOS pioram. O teto mantém o
// paralelismo útil e suaviza o pico; os Promise.all internos de um task
// (pernas de métrica, variáveis de calculadora, exprs de nota) não contam.
const WIDGET_TASK_CONCURRENCY = 8;

// Limitador simples (sem dependência): até `max` execuções simultâneas, demais
// aguardam em fila (FIFO). O wrapper devolve a promise do próprio task.
function createTaskLimiter(max: number) {
  let active = 0;
  const queue: (() => void)[] = [];
  return async function run<T>(fn: () => Promise<T>): Promise<T> {
    while (active >= max) {
      await new Promise<void>((resolve) => queue.push(resolve));
    }
    active += 1;
    try {
      return await fn();
    } finally {
      active -= 1;
      queue.shift()?.();
    }
  };
}

export default async function DashboardPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  // Instrumentação: início do render (o resumo [dashboard:timing] sai no fim).
  const timing = startDashboardLoadTiming();
  const supabase = await createClient();
  // Client com dedup de run_widget_query por render: widgets/notas/calculadoras
  // com o mesmo escopo compartilham a mesma chamada (ver lib/widgets/rpc-memo).
  const rpcClient = withRpcMemo(supabase);

  // Sessão (getUser é ida de rede) e dashboard em paralelo — a RLS do select de
  // dashboards não depende do objeto session daqui.
  const [session, { data: dash }] = await Promise.all([
    getSessionInfo(),
    supabase
      .from("dashboards")
      .select("id, name, owner_user_id, visible_to_roles, settings")
      .eq("id", id)
      .maybeSingle(),
  ]);
  if (!dash) notFound();

  const isOwner = dash.owner_user_id === session?.user.id;
  const isAdmin = session?.roles.includes("admin") ?? false;
  const canEdit = isOwner || isAdmin;
  const canManageFields =
    session?.permissions.includes("manage_field_definitions") ?? false;
  // Para as tabelas em modo "registros individuais" (Fase 1): quem pode editar
  // valores e com quais papéis (o servidor reforça por campo em updateRecordField).
  const canEditValues =
    session?.permissions.includes("edit_record_values") ?? false;
  const userRoles = session?.roles ?? [];

  const [
    { data: widgetsData },
    { data: fieldsData },
    correspondences,
    { data: prefData },
    enabledCurrencies,
    currencyRates,
    sources,
  ] = await timing.measure("base", () => Promise.all([
    supabase
      .from("widgets")
      .select(
        "id, dashboard_id, title, visual_type, source, sources, split_by_source, dimensions, metrics, filters, settings, grid_position, sort_order"
      )
      .eq("dashboard_id", id)
      .order("sort_order", { ascending: true }),
    supabase
      .from("field_definitions")
      .select(
        "id, field_key, label, data_type, options, visible_to_roles, editable_by_roles, is_local, show_in_builder, formula, allow_negative, currency_code, currency_mode, show_as_percent, sort_order, applies_to, source_system, source_field_id, write_back"
      )
      .eq("show_in_builder", true)
      .order("sort_order", { ascending: true }),
    loadCorrespondences(supabase),
    session
      ? supabase
          .from("user_preferences")
          .select("settings")
          .eq("user_id", session.user.id)
          .eq("dashboard_id", id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    loadEnabledCurrencies(supabase),
    loadCurrencyRates(supabase),
    loadSources(supabase),
  ]));
  const currencyOptions = currencyOptionsFrom(enabledCurrencies);

  // Último período consultado pelo usuário neste dashboard (se houver). No modo
  // "por aba", cada aba guarda o seu em `lastPeriodByTab` (chave = id da aba).
  const prefSettings = (prefData?.settings ?? {}) as {
    lastPeriod?: SavedPeriod;
    lastPeriodByTab?: Record<string, SavedPeriod>;
    // Último estado dos widgets "Filtro por campo" (por widget id, encoded
    // ff_). Reidratado quando a URL não traz o parâmetro; URL sempre vence.
    lastFieldFilters?: Record<string, string>;
  };

  const widgets = (widgetsData ?? []) as Widget[];
  const allFields = (fieldsData ?? []) as FieldDefinition[];
  // Mapa chave→def p/ resolver operandos com escopo de fonte em fórmulas de
  // 'calculado_agg' salvas (widgetQuerySources / metricScopedSources).
  const fieldByKeyAll = new Map(allFields.map((f) => [f.field_key, f]));
  // Renderização usa TODOS os campos: os metadados são legíveis por qualquer
  // autenticado (RLS afrouxada em 0043), então widgets compartilhados resolvem
  // rótulos/tipos corretamente para qualquer papel.
  const available = buildAvailableFields(allFields, correspondences, sources);
  // Construtor de widgets respeita o ACL por papel (visible_to_roles): quem edita
  // só escolhe colunas visíveis ao seu papel (admin vê tudo). Assim a RLS
  // afrouxada não deixa um dono não-admin montar widgets com colunas restritas.
  const builderFields = isAdmin
    ? allFields
    : allFields.filter((f) => hasAnyRole(userRoles, f.visible_to_roles as RoleKey[]));
  const availableForBuilder = isAdmin
    ? available
    : buildAvailableFields(builderFields, correspondences, sources);
  // SÓ para as opções de bucket dos filtros rápidos (display) — consultas de
  // widget montam o mapa POR PERNA (correspondenceMapForSources) no engine.
  const correspondencesMap = buildCorrespondenceMap(correspondences);
  const dashSettings = (dash.settings ?? {}) as DashboardSettings;
  const periodBar = dashSettings.periodBar;

  // Resolução de período por widget: lógica compartilhada com o runQuickTable
  // da Tabela Livre (lib/widgets/period-resolve.ts) — uma única implementação
  // p/ página e action deferida não divergirem.
  const resolver = createPeriodResolver({
    sp,
    available,
    correspondences,
    dashSettings,
    prefSettings,
    sources,
  });
  const { resolveFieldBySource, resolveDefaults, savedFor } = resolver;

  // Widgets de dados (excluem os controles — filtro de período e filtro por
  // campo — e a forma, que não tem dados nem período). Calculadora e nota
  // FICAM aqui: precisam de período/filtros por widget (variáveis/expressões),
  // mas são pulados no engine e computados em blocos próprios (como calculado).
  const dataWidgets = widgets.filter(
    (w) =>
      w.visual_type !== "filtro" &&
      w.visual_type !== "filtro_campo" &&
      w.visual_type !== "forma" &&
      w.visual_type !== "imagem"
  );
  const filterWidgets = widgets.filter((w) => w.visual_type === "filtro");
  const fieldFilterWidgets = widgets.filter(
    (w) => w.visual_type === "filtro_campo"
  );

  // Escopo do filtro de período e abas: resolvidos no resolver (espelham
  // components/dashboards/dashboard-client.tsx).
  const scope = resolver.scope;
  const tabs = resolver.tabs;
  const tabIds = new Set(tabs.map((t) => t.id));
  const firstTabId = resolver.firstTabId;
  const widgetTab = resolver.widgetTab;
  const widgetBucket = resolver.widgetBucket;

  // Defaults por bucket, entregues ao cliente para exibir a seleção efetiva de
  // cada aba (deve bater com o que o servidor resolveu). Bucket "" cobre o modo
  // global e dashboards sem abas / widgets sem aba.
  const buckets = scope === "tab" ? [...tabIds, firstTabId] : [""];
  const periodDefaultsByTab: Record<string, PeriodSelection> = {};
  const periodDefaultFieldByTab: Record<string, string> = {};
  for (const b of new Set(buckets)) {
    const d = resolveDefaults(savedFor(b));
    periodDefaultsByTab[b] = d.periodDefaults;
    periodDefaultFieldByTab[b] = d.defaultField;
  }

  // Período efetivo por widget: barra global (por bucket) + overrides dos
  // widgets de filtro (precedência). Os filtros rápidos de período abaixo
  // podem ainda anular o geral (quando assumem o mesmo campo).
  const { periodByWidget, periodSourceByWidget } =
    resolver.computeWidgetPeriods(dataWidgets, filterWidgets);

  // ===================== Filtros rápidos (dropdowns do card) =================
  // Config em settings.quickFilters; valores persistidos em dashboard_table_cells
  // (row_key '__qf__'), compartilhados entre usuários/reloads. Viram filtros de
  // visualização (AND) e, no caso do período padrão, interagem com o período
  // geral (espelho unidirecional). Ver lib/widgets/quick-filters.ts.
  const qfWidgets = dataWidgets.filter(
    (w) => (w.settings?.quickFilters ?? []).some((e) => e.field)
  );
  const quickFiltersById: Record<string, WidgetQuickFilters> = {};
  const qfFiltersByWidget: Record<string, WidgetFilter[]> = {};

  // ===================== Janela de períodos do widget (__pw__) ===============
  // Seleção do dropdown de meses do card (settings.periodWindow) — persistida
  // compartilhada em dashboard_table_cells (row __pw__), como os quick
  // filters. Mesclada nos settings EFETIVOS antes do engine
  // (applyPeriodWindowChoice); o payload periodWindowById alimenta o controle
  // no card.
  const pwWidgets = dataWidgets.filter((w) => w.settings?.periodWindow);
  const pwChoiceById = new Map<string, PeriodWindowChoice>();
  if (pwWidgets.length > 0) {
    const { data: pwCells } = await supabase
      .from("dashboard_table_cells")
      .select("widget_id, value")
      .in(
        "widget_id",
        pwWidgets.map((w) => w.id)
      )
      .eq("row_key", PW_ROW_KEY)
      .eq("col_key", PW_COL_KEY);
    for (const c of pwCells ?? []) {
      const v = parsePeriodWindowChoice(c.value);
      if (v) pwChoiceById.set(c.widget_id as string, v);
    }
  }
  const effSettingsFor = (w: Widget): WidgetSettings | undefined =>
    applyPeriodWindowChoice(w.settings, pwChoiceById.get(w.id));
  const periodWindowById: Record<
    string,
    {
      options: PeriodWindowKey[];
      value: PeriodWindowKey | null;
      bd: boolean;
      showAlignToggle: boolean;
    }
  > = {};
  for (const w of pwWidgets) {
    const pw = w.settings?.periodWindow;
    if (!pw?.options || pw.options.length === 0) continue;
    const eff = effSettingsFor(w);
    periodWindowById[w.id] = {
      options: pw.options,
      value: eff?.periodWindow?.active ?? null,
      bd: Boolean(eff?.businessDayAlign?.enabled),
      showAlignToggle: Boolean(pw.showAlignToggle),
    };
  }
  // Preenchimento adiado das OPÇÕES dos dropdowns (só exibição): definido no
  // bloco abaixo e chamado depois da onda de widgets, fora do caminho crítico.
  let fillQuickFilterOptions: (() => Promise<void>) | null = null;

  if (qfWidgets.length > 0) {
    const allEntries = qfWidgets.flatMap((w) => w.settings?.quickFilters ?? []);

    // Exceção do vendedor: usuário sem view_all_records tem os próprios
    // responsáveis resolvidos (vínculo vivo responsibles.user_id).
    const canViewAll =
      session?.permissions.includes("view_all_records") ?? false;
    const needsOwnResp =
      !canViewAll &&
      !!session &&
      allEntries.some((e) => e.field === "responsible_id");

    // Opções dos dropdowns: responsáveis/operações ativos e, p/ datas com
    // formato, os buckets DISTINTOS existentes nos dados (via RPC, mesma
    // expressão das dimensões). month_name/weekday têm listas fixas.
    const needsQfResp = allEntries.some((e) => e.field === "responsible_id");
    const needsQfOps = allEntries.some((e) => e.field === "operation_id");
    const bucketCombos = new Map<
      string,
      { field: string; transform: Transform; weekMode?: "full" | "restricted" }
    >();
    for (const e of allEntries) {
      if (!isBucketEntry(e, available)) continue;
      if (staticBucketOptions(e.transform!)) continue;
      bucketCombos.set(`${e.field}|${e.transform}|${e.weekMode ?? "restricted"}`, {
        field: e.field,
        transform: e.transform!,
        weekMode: e.weekMode,
      });
    }
    const bucketOptionsByCombo: Record<string, { value: string; label: string }[]> =
      {};
    // Opções dos dropdowns (entidades e buckets) são SÓ exibição — não entram
    // nos filtros da computação dos widgets. Disparam AGORA (o Promise.all
    // subscreve os builders) e são aguardadas apenas depois da onda de widgets
    // (fillQuickFilterOptions): os RPCs de bucket, varreduras agregadas, saem
    // do caminho crítico. Nenhuma perna rejeita (buckets têm catch próprio e
    // builders resolvem { data, error }), então a promise pode flutuar.
    const qfOptionsPromise = Promise.all([
      needsQfResp
        ? supabase
            .from("responsibles")
            .select("id, display_name")
            .eq("active", true)
            .order("display_name")
        : Promise.resolve({ data: [] as { id: string; display_name: string }[] }),
      needsQfOps
        ? supabase
            .from("operations")
            .select("id, name")
            .eq("active", true)
            .order("name")
        : Promise.resolve({ data: [] as { id: string; name: string }[] }),
      Promise.all(
        [...bucketCombos.entries()].map(async ([key, c]) => {
          try {
            const { data, error } = await rpcClient.rpc("run_widget_query", {
              p_source: "records",
              p_dimensions: [
                { field: c.field, transform: c.transform, weekMode: c.weekMode },
              ],
              p_metrics: [],
              p_filters: [],
              p_correspondences: correspondencesMap,
            });
            if (error) throw new Error(error.message);
            const rows = (Array.isArray(data) ? data : []) as Record<
              string,
              unknown
            >[];
            const seen = new Map<string, { raw: unknown; label: string }>();
            for (const row of rows) {
              const raw = row.dim_1;
              const k = bucketKeyFromRpcValue(raw, c.transform);
              if (!k || seen.has(k)) continue;
              seen.set(k, {
                raw,
                label: formatBucketLabel(c.transform, raw, c.weekMode),
              });
            }
            bucketOptionsByCombo[key] = [...seen.entries()]
              .sort((a, b) => String(a[1].raw).localeCompare(String(b[1].raw)))
              .map(([value, v]) => ({ value, label: v.label }));
          } catch {
            bucketOptionsByCombo[key] = []; // RPC sem 0048/transform inválido
          }
        })
      ),
    ]);
    // Valores persistidos + exceção do vendedor: estes SIM viram filtros da
    // computação dos widgets e seguem aguardados antes dela.
    const [{ data: qfCells }, ownRespRes] = await Promise.all([
      supabase
        .from("dashboard_table_cells")
        .select("widget_id, col_key, value")
        .in(
          "widget_id",
          qfWidgets.map((w) => w.id)
        )
        .eq("row_key", QF_ROW_KEY),
      needsOwnResp && session
        ? supabase
            .from("responsibles")
            .select("id")
            .eq("user_id", session.user.id)
        : Promise.resolve({ data: [] as { id: string }[] }),
    ]);
    const qfValues = new Map<string, QuickFilterValue>();
    for (const c of qfCells ?? []) {
      const v = parseQuickFilterValue(c.value);
      if (v) qfValues.set(`${c.widget_id}:${c.col_key}`, v);
    }
    const ownResponsibleIds = (ownRespRes.data ?? []).map(
      (r) => r.id as string
    );

    // Seleção CRUA efetiva da barra de período de um bucket (URL > default),
    // p/ o filtro rápido de período sem valor espelhar o que a barra mostra.
    const rawSelectionForBucket = (bucket: string): PeriodSelection => {
      const { periodDefaults } = resolveDefaults(savedFor(bucket));
      const keys = periodKeys(scope, bucket);
      const urlSel: PeriodSelection = {
        preset: str(sp[keys.preset]),
        de: str(sp[keys.de]),
        ate: str(sp[keys.ate]),
      };
      return hasSelection(urlSel) ? urlSel : periodDefaults;
    };

    // 4) Por widget: valores efetivos + filtros + interação com o período geral.
    for (const w of qfWidgets) {
      const entries = (w.settings?.quickFilters ?? []).filter((e) => e.field);
      const values: Record<string, QuickFilterValue> = {};
      const options: Record<string, { value: string; label: string }[]> = {};
      let filters: WidgetFilter[] = [];

      for (const entry of entries) {
        const stored = qfValues.get(`${w.id}:${entry.id}`) ?? null;

        // --- Data no formato padrão: dropdown de período -------------------
        if (isPeriodEntry(entry, available)) {
          let val: QuickFilterValue | null =
            stored?.kind === "period" ? stored : null;
          const wPeriod = periodByWidget[w.id];
          if (val && hasQuickValue(val)) {
            // Com valor persistido o filtro rápido ASSUME o campo: se é o
            // mesmo campo do período efetivo do widget, o geral deixa de
            // aplicar (senão o applyPeriodToFilters do engine sobrescreveria a
            // divergência local). Campos diferentes convivem (cruzamento).
            if (wPeriod && wPeriod.field === entry.field) {
              periodByWidget[w.id] = null;
            }
            const p = resolvePeriodSelection(
              { preset: val.preset ?? "", de: val.de ?? "", ate: val.ate ?? "" },
              entry.field
            );
            if (p) {
              const pMap = entry.field.startsWith("unified:")
                ? { ...p, fieldBySource: resolveFieldBySource(entry.field) }
                : p;
              // Cobertura = fontes do widget ∪ fontes das métricas: o @period
              // byType EXCLUI record_types fora do mapa, e as pernas por
              // métrica (Metric.sources) reusam este filtro pré-sintetizado.
              filters = applyPeriodToFilters(
                filters,
                pMap,
                widgetQuerySources(
                  (w.sources ?? []) as SourceKey[],
                  w.metrics,
                  fieldByKeyAll
                )
              );
            }
          } else if (
            periodSourceByWidget[w.id] === "bar" &&
            wPeriod?.field === entry.field
          ) {
            // Sem valor persistido e a barra rege o widget no MESMO campo:
            // exibe a seleção da barra (o geral continua filtrando por si).
            const sel = rawSelectionForBucket(widgetBucket(w));
            val = {
              kind: "period",
              preset: sel.preset ?? "",
              de: sel.de ?? "",
              ate: sel.ate ?? "",
            };
          }
          if (val) values[entry.id] = val;
          continue;
        }

        // --- Multi-seleção: responsável / operação / bucket de data --------
        let vals = stored?.kind === "options" ? stored.values : [];
        // Exceção do vendedor: seleção que exclui os responsáveis dele →
        // o valor EFETIVO (filtragem e exibição) vira os dele. O valor
        // persistido não muda (admin/gestor seguem vendo a seleção deles).
        if (
          entry.field === "responsible_id" &&
          vals.length > 0 &&
          ownResponsibleIds.length > 0 &&
          !vals.some((v) => ownResponsibleIds.includes(v))
        ) {
          vals = ownResponsibleIds;
        }
        if (vals.length > 0) {
          values[entry.id] = { kind: "options", values: vals };
          filters.push(...quickOptionsFilter(entry, vals, available));
        }
      }

      quickFiltersById[w.id] = { entries, values, options };
      if (filters.length > 0) qfFiltersByWidget[w.id] = filters;
    }

    // Preenche `options` (por referência, já dentro de quickFiltersById) quando
    // a promise disparada acima resolver — chamado depois da onda de widgets,
    // antes de entregar quickFiltersById ao cliente.
    fillQuickFilterOptions = async () => {
      const [qfRespRes, qfOpsRes] = await qfOptionsPromise;
      const qfRespOptions = (qfRespRes.data ?? []).map((r) => ({
        value: r.id as string,
        label: (r.display_name as string) ?? "—",
      }));
      const qfOpsOptions = (qfOpsRes.data ?? []).map((o) => ({
        value: o.id as string,
        label: (o.name as string) ?? "—",
      }));
      for (const w of qfWidgets) {
        const qf = quickFiltersById[w.id];
        if (!qf) continue;
        for (const entry of qf.entries) {
          if (entry.field === "responsible_id") {
            qf.options[entry.id] = qfRespOptions;
          } else if (entry.field === "operation_id") {
            qf.options[entry.id] = qfOpsOptions;
          } else if (isBucketEntry(entry, available)) {
            qf.options[entry.id] =
              staticBucketOptions(entry.transform!) ??
              bucketOptionsByCombo[
                `${entry.field}|${entry.transform}|${entry.weekMode ?? "restricted"}`
              ] ??
              [];
          }
        }
      }
    };
  }

  // Ano/trimestre do período de cada widget (p/ métricas monetárias com base =
  // "período"). Sem período ativo, cai no ano/trimestre atual.
  const conversionPeriodById: Record<string, { year: number; quarter: number }> = {};
  for (const w of dataWidgets) {
    const p = periodByWidget[w.id];
    conversionPeriodById[w.id] = yearQuarterOf(p?.to ?? p?.from ?? null);
  }

  // 2b) Filtros de VISUALIZAÇÃO (aplicados no dashboard já renderizado):
  //   - barra embutida de cada tabela (?tf_<id>): filtra o próprio widget;
  //   - widget "Filtro por campo" (?ff_<id>): filtra todos os widgets de dados
  //     cujas fontes se sobrepõem às do filtro (campo unificado = todas as
  //     fontes), menos os alvos desmarcados (settings.excludedTargets).
  // Cada conjunto vira WidgetFilter[] mesclado em config.filters (semântica AND).
  const viewFiltersByWidget: Record<string, WidgetFilter[]> = {};
  const addViewFilters = (id: string, fs: WidgetFilter[]) => {
    if (fs.length === 0) return;
    viewFiltersByWidget[id] = [...(viewFiltersByWidget[id] ?? []), ...fs];
  };

  // Filtros rápidos do card: mesclados como filtros de visualização (AND) —
  // valem para o engine/RPC, modo lista, KPI e métrica calculada.
  for (const [id, fs] of Object.entries(qfFiltersByWidget)) addViewFilters(id, fs);

  // Barra embutida: só nos widgets de Tabela (agregada ou registros). Na lista
  // de registros sem limit (searchHandledOnClient) o q é pulado — a busca
  // textual roda no CLIENTE sobre o dataset completo; sem isso o servidor
  // pré-filtraria e apagar letras nunca ampliaria os resultados.
  for (const w of dataWidgets) {
    if (w.visual_type !== "tabela") continue;
    const raw = str(sp[`tf_${w.id}`]);
    if (!raw) continue;
    addViewFilters(
      w.id,
      viewStateToFilters(parseViewFilter(raw), w.settings?.searchFields, {
        skipSearch: searchHandledOnClient(w.settings),
      })
    );
  }

  // Sobreposição de fontes (vazio = todas as fontes).
  const sourcesOverlap = (a: string[], b: string[]) => {
    if (a.length === 0 || b.length === 0) return true;
    return a.some((s) => b.includes(s));
  };

  // Seed por widget dos controles "Filtro por campo" quando a URL não traz o
  // ff_: o valor salvo do usuário (lastFieldFilters). Vai ao cliente para o
  // controle montar já preenchido (e sincronizar a URL no primeiro debounce).
  const fieldFilterSeedById: Record<string, string> = {};
  for (const fw of fieldFilterWidgets) {
    // URL vence; sem parâmetro na URL, reidrata da preferência do usuário
    // (lastFieldFilters — gravada pelo debounce do FieldFilterControls).
    const fromUrl = str(sp[`ff_${fw.id}`]);
    const saved = prefSettings.lastFieldFilters?.[fw.id] ?? "";
    if (!fromUrl && saved) fieldFilterSeedById[fw.id] = saved;
    const raw = fromUrl || saved;
    if (!raw) continue;
    const fs = viewStateToFilters(parseViewFilter(raw), fw.settings?.searchFields);
    if (fs.length === 0) continue;
    const excluded = new Set(fw.settings?.excludedTargets ?? []);
    const fwSources = (fw.sources ?? []) as string[];
    // Filtro sobre campo unificado (multi-fonte) atinge todas as fontes.
    const unified = fs.some((f) =>
      f.field.split("|").some((p) => p.startsWith("unified:"))
    );
    // Segmentação por fonte (pass-through): os filtros emitidos carregam as
    // fontes do filtro_campo como alvo — num widget-alvo com outras fontes,
    // só as linhas das fontes-alvo são restringidas; as demais passam. Filtro
    // unificado fica SEM alvo (o coalesce já resolve por fonte; segmentá-lo
    // mudaria comportamento correto existente).
    const fwSourceKeys = fwSources.filter((s) => isKnownSource(s, sources));
    const isUnifiedFilter = (f: WidgetFilter) =>
      f.field.split("|").some((p) => p.startsWith("unified:"));
    const targeted =
      fwSourceKeys.length > 0
        ? fs.map((f) => (isUnifiedFilter(f) ? f : { ...f, sources: fwSourceKeys }))
        : fs;
    for (const w of dataWidgets) {
      if (excluded.has(w.id)) continue;
      if (!unified && !sourcesOverlap(fwSources, (w.sources ?? []) as string[]))
        continue;
      addViewFilters(w.id, targeted);
    }
  }

  // Filtro de OPERAÇÃO (20/07/2026): NUNCA compara a coluna derivada
  // records.operation_id (pode estar NULL/defasada — zeraria o dashboard).
  // Resolve para o VÍNCULO vivo (responsáveis da subárvore) + filtros de
  // PERFIL da operação (operations.filter, 0083). Ver
  // lib/config/operation-scope.ts; espelho em widget-scope.
  {
    const opIds = [
      ...new Set(
        Object.values(viewFiltersByWidget).flatMap(collectOperationFilterIds)
      ),
    ];
    if (opIds.length > 0) {
      const scopes = await loadOperationScopes(supabase, opIds);
      for (const [id, fs] of Object.entries(viewFiltersByWidget)) {
        viewFiltersByWidget[id] = translateOperationFilters(fs, scopes);
      }
    }
  }

  // Widget de Tabela em modo "registros individuais" (Fase 1): lista 1 linha por
  // registro em vez de agregar.
  const isListWidget = (w: Widget) =>
    w.visual_type === "tabela" && w.settings?.rowMode === "records";
  // Widget "Métrica calculada" (Fase 3): valor vem da fórmula (contexto do dash).
  const isCalcWidget = (w: Widget) => w.visual_type === "calculado";
  // Calculadora e Nota: fórmulas próprias (variáveis/expressões), fora do engine.
  const isCalculatorWidget = (w: Widget) => w.visual_type === "calculadora";
  const isNoteWidget = (w: Widget) => w.visual_type === "nota";
  // Tabela Livre: NADA é computado aqui de propósito — o widget busca os dados
  // BI e as expressões {=…} via runQuickTable (server action) DEPOIS do mount,
  // para não pesar o carregamento inicial da página (carrega por último). As
  // células digitadas pegam carona no cellsData do seed do histórico (abaixo).
  const isQuickTableWidget = (w: Widget) =>
    w.visual_type === "tabela_editavel";
  // Kanban e Agenda: também DEFERIDOS (fetch no cliente, padrão Tabela Livre).
  const isKanbanWidget = (w: Widget) => w.visual_type === "kanban";
  const isAgendaWidget = (w: Widget) => w.visual_type === "agenda";

  // Fingerprint de ESCOPO dos widgets deferidos (Tabela Livre/kanban): o
  // effect do cliente re-busca quando período/filtros EFETIVOS mudam —
  // inclusive os persistidos no banco (__qf__/__pw__), que não passam pela
  // URL (a action revalida, o RSC re-renderiza e a prop nova re-dispara o
  // effect). Agenda fica FORA (ignora os filtros do dashboard por design).
  const deferredScopeById: Record<string, string> = {};
  for (const w of dataWidgets) {
    if (!isQuickTableWidget(w) && !isKanbanWidget(w)) continue;
    deferredScopeById[w.id] = JSON.stringify({
      p: periodByWidget[w.id] ?? null,
      f: viewFiltersByWidget[w.id] ?? [],
      pw: pwChoiceById.get(w.id) ?? null,
    });
  }

  // Buscas que NÃO dependem do resultado dos widgets: disparadas AGORA para
  // correrem em paralelo com a computação (antes eram ondas seriais depois
  // dela). Cada uma é aguardada no ponto onde o resultado é consumido.
  // 1) Células (seed do histórico + Tabela Livre + expressão da calculadora).
  const cellsDataPromise = widgets.length
    ? supabase
        .from("dashboard_table_cells")
        .select("widget_id, row_key, col_key, value")
        .in(
          "widget_id",
          widgets.map((w) => w.id)
        )
    : Promise.resolve({
        data: [] as {
          widget_id: string;
          row_key: string;
          col_key: string;
          value: number | string | null;
        }[],
      });
  // 2) Opções do SELECT de responsável editável nas tabelas de registros:
  // só carrega se algum widget-lista expõe responsible_id como editável.
  const needsResponsibleSelect = dataWidgets.some(
    (w) =>
      isListWidget(w) &&
      (w.settings?.rowSource ?? "records") === "records" &&
      (w.settings?.columns ?? []).some(
        (c) => c.field === "responsible_id" && c.editable
      )
  );
  const responsibleOptionsPromise = needsResponsibleSelect
    ? supabase
        .from("responsibles")
        .select("id, display_name, bitrix_user_id")
        .eq("active", true)
        .order("display_name")
    : Promise.resolve({
        data: [] as {
          id: string;
          display_name: string;
          bitrix_user_id: number | null;
        }[],
      });
  // 3) Opções dos controles "Filtro por campo" (responsáveis/operações/etapas).
  const exposedFilterFields = new Set<string>();
  for (const fw of fieldFilterWidgets)
    for (const f of fw.settings?.fields ?? []) exposedFilterFields.add(f.field);
  const filterOptionsFetchPromise =
    fieldFilterWidgets.length > 0
      ? Promise.all([
          exposedFilterFields.has("responsible_id")
            ? supabase
                .from("responsibles")
                .select("id, display_name")
                .eq("active", true)
                .order("display_name")
            : Promise.resolve({
                data: [] as { id: string; display_name: string }[],
              }),
          exposedFilterFields.has("operation_id")
            ? supabase
                .from("operations")
                .select("id, name")
                .eq("active", true)
                .order("name")
            : Promise.resolve({ data: [] as { id: string; name: string }[] }),
          exposedFilterFields.has("stage")
            ? rpcClient.rpc("run_widget_query", {
                p_source: "records",
                p_dimensions: [{ field: "record_type" }, { field: "stage" }],
                p_metrics: [],
                p_filters: [],
                p_correspondences: {},
              })
            : Promise.resolve({ data: [] }),
        ])
      : null;

  // 3) Computa cada widget de dados. Filtros, tabela editável e os deferidos
  //    não passam pelo engine; calculado/calculadora/nota são computados AQUI
  //    dentro do mesmo Promise.all (antes eram 3 ondas seriais próprias).
  const dataById: Record<string, WidgetData> = {};
  const recordListById: Record<string, RecordRow[]> = {};
  // Registros EXTRAS por widget (fontes de Metric.sources fora das do widget):
  // alimentam só a basis dos subtotais no cliente — fora do export e dos
  // rótulos FK (nunca viram linha).
  const recordListExtraById: Record<string, RecordRow[]> = {};
  // Total de registros dos widgets-lista PAGINADOS no servidor (o cliente usa
  // p/ montar o pager; ausente = widget de full fetch, paginação client-side).
  const recordListTotalById: Record<string, number> = {};
  const entityListById: Record<string, EntityListRow[]> = {};
  const calcById: Record<string, CalcWidgetResult> = {};
  const calcVarsById: Record<string, Record<string, CalcWidgetResult>> = {};
  const noteById: Record<string, CalcWidgetResult[]> = {};
  const runLimited = createTaskLimiter(WIDGET_TASK_CONCURRENCY);
  const computeWidget = async (w: Widget) => {
      // Métricas calculadas: resolve a fórmula com o contexto do dashboard.
      // `settings.calcField` aponta p/ um campo "Calculado (totais)" salvo em
      // /campos (campo deletado → fórmula null → valor null → "—"). Moeda:
      // automática ('inherit') preserva a moeda dos operandos; fixa converte.
      if (isCalcWidget(w)) {
        try {
          const calcKey = w.settings?.calcField;
          const def = calcKey?.startsWith("custom:")
            ? allFields.find(
                (f) =>
                  f.field_key === calcKey.slice(7) &&
                  f.data_type === "calculado_agg"
              )
            : undefined;
          const formula = calcKey ? (def?.formula ?? null) : w.settings?.formula;
          calcById[w.id] = await runCalculatedWidget(rpcClient, {
            formula,
            sources: w.sources ?? [],
            sourceDefs: sources,
            filters: [...(w.filters ?? []), ...(viewFiltersByWidget[w.id] ?? [])],
            period: periodByWidget[w.id],
            correspondences,
            currencyMode:
              def?.currency_mode === "fixed"
                ? "fixed"
                : def?.currency_mode === "inherit"
                  ? "auto"
                  : "none",
            currencyCode:
              def?.currency_mode === "fixed"
                ? resolveCurrencyCode(def.currency_code)
                : null,
            allowNegative: def?.allow_negative !== false,
            fields: allFields,
            rates: currencyRates,
            conversionPeriod: conversionPeriodById[w.id],
          });
        } catch {
          calcById[w.id] = { value: null, currency: null };
        }
        return;
      }
      // Calculadora: valor de cada variável nomeada; a expressão digitada é
      // avaliada no CLIENTE contra esses valores.
      if (isCalculatorWidget(w)) {
        const vars = w.settings?.calculator?.variables ?? [];
        const out: Record<string, CalcWidgetResult> = {};
        await Promise.all(
          vars.map(async (v) => {
            try {
              out[v.id] = await runCalculatedWidget(rpcClient, {
                formula: v.formula ?? null,
                sources: w.sources ?? [],
                sourceDefs: sources,
                filters: [
                  ...(w.filters ?? []),
                  ...(viewFiltersByWidget[w.id] ?? []),
                ],
                period: periodByWidget[w.id],
                correspondences,
                currencyMode: "auto",
                fields: allFields,
                rates: currencyRates,
                conversionPeriod: conversionPeriodById[w.id],
              });
            } catch {
              out[v.id] = { value: null, currency: null };
            }
          })
        );
        calcVarsById[w.id] = out;
        return;
      }
      // Nota (post-it): avalia as expressões {=…} salvas (settings.note.exprs,
      // na ordem do texto; teto NOTE_MAX_EXPRS). Resultado alinhado por índice
      // com as {=…} do texto (parseNoteTemplate).
      if (isNoteWidget(w)) {
        const exprs = (w.settings?.note?.exprs ?? []).slice(0, NOTE_MAX_EXPRS);
        noteById[w.id] = await Promise.all(
          exprs.map(async (formula) => {
            try {
              return await runCalculatedWidget(rpcClient, {
                formula,
                sources: w.sources ?? [],
                sourceDefs: sources,
                filters: [
                  ...(w.filters ?? []),
                  ...(viewFiltersByWidget[w.id] ?? []),
                ],
                period: periodByWidget[w.id],
                correspondences,
                currencyMode: "auto",
                fields: allFields,
                rates: currencyRates,
                conversionPeriod: conversionPeriodById[w.id],
              });
            } catch {
              return { value: null, currency: null };
            }
          })
        );
        return;
      }
      if (isQuickTableWidget(w)) return; // deferido (runQuickTable no cliente)
      if (isKanbanWidget(w)) return; // deferido (runKanbanWidget no cliente)
      if (isAgendaWidget(w)) return; // deferido (fetchAgendaWidget no cliente)
      const config = {
        source: "records" as const,
        sources: w.sources ?? [],
        splitBySource: w.split_by_source ?? false,
        dimensions: w.dimensions ?? [],
        metrics: w.metrics ?? [],
        filters: [...(w.filters ?? []), ...(viewFiltersByWidget[w.id] ?? [])],
        visual_type: w.visual_type,
        // Settings EFETIVOS: janela de períodos/dia útil selecionados no card
        // mesclados (periodWindow.active + businessDayAlign.enabled).
        settings: effSettingsFor(w),
      };
      // Erro ao computar o widget: loga no servidor e propaga a mensagem no
      // `data` do card (WidgetData.error) — o card exibe o estado de erro em
      // vez de tabela/gráfico silenciosamente em branco.
      const fail = (e: unknown) => {
        const msg = e instanceof Error ? e.message : String(e);
        console.error(
          `[dashboard] widget ${w.id} (${w.title ?? w.visual_type}) falhou:`,
          msg
        );
        dataById[w.id] = { rows: [], dimensions: [], metrics: [], error: msg };
      };
      // Card em modo novo (record/topn/list/formula): motor próprio
      // (lib/widgets/card.ts), compartilhado com o viewer de snapshot.
      if (isCardModeWidget(w)) {
        try {
          dataById[w.id] = await runCardWidget(
            rpcClient,
            config,
            periodByWidget[w.id],
            available,
            allFields,
            currencyRates,
            conversionPeriodById[w.id],
            {},
            sources,
            correspondences
          );
        } catch (e) {
          fail(e);
        }
        return;
      }
      if (isListWidget(w)) {
        const rowSource = w.settings?.rowSource ?? "records";
        // Fonte das linhas: entidade (responsáveis/operações) x registros.
        if (rowSource === "responsibles" || rowSource === "operations") {
          try {
            entityListById[w.id] = await runEntityList(
              supabase,
              rowSource as EntityRowSource,
              w.settings?.limit
            );
          } catch (e) {
            entityListById[w.id] = [];
            fail(e);
          }
          return;
        }
        try {
          // Elegível: só a página 1 + count exato (serverPaginatedList — o
          // WidgetCard busca as demais páginas via fetchWidgetRecordsPage).
          // Inelegível (agrupado/ordem manual/sort exótico): full fetch atual.
          if (serverPaginatedList(w.settings)) {
            const { rows, total } = await runRecordListPage(
              supabase,
              config,
              periodByWidget[w.id],
              available,
              { pageIndex: 0, pageSize: RECORD_LIST_PAGE_SIZE },
              sources
            );
            recordListById[w.id] = rows;
            recordListTotalById[w.id] = total;
          } else {
            const { records, extra } = await runRecordListWithExtras(
              supabase,
              config,
              periodByWidget[w.id],
              available,
              sources,
              allFields
            );
            recordListById[w.id] = records;
            if (extra.length > 0) recordListExtraById[w.id] = extra;
          }
        } catch (e) {
          recordListById[w.id] = [];
          fail(e);
        }
        return;
      }
      try {
        dataById[w.id] = await runWidget(
          rpcClient,
          config,
          available,
          periodByWidget[w.id],
          (fieldsData ?? []) as FieldDefinition[],
          currencyRates,
          conversionPeriodById[w.id],
          sources,
          correspondences
        );
      } catch (e) {
        fail(e);
      }
    };
  // Cada task roda sob o limitador; o cronômetro fica por DENTRO dele (mede a
  // execução, não a espera na fila) e marca `error` para o resumo de timing.
  const widgetTasks = dataWidgets.map((w) =>
    runLimited(() =>
      timing.widgetTask(
        { id: w.id, title: w.title ?? w.visual_type },
        () => computeWidget(w),
        () => Boolean(dataById[w.id]?.error)
      )
    )
  );

  // Rótulos das colunas FK presentes nas tabelas de registros (id→nome).
  // Helper compartilhado com a action de paginação (lib/widgets/fk-labels.ts).
  // Só os widgets-lista de registros alimentam recordListById, então a busca
  // dos rótulos dispara assim que ELES terminam e corre em paralelo com os
  // widgets restantes (antes: barreira serial depois de todos).
  const listTasks = widgetTasks.filter((_, i) => {
    const w = dataWidgets[i];
    return isListWidget(w) && (w.settings?.rowSource ?? "records") === "records";
  });
  const fkLabelsPromise = Promise.all(listTasks).then(() =>
    timing.measure("fkLabels", () =>
      collectRecordFkLabels(supabase, Object.values(recordListById).flat())
    )
  );
  const [fkLabels] = await timing.measure("widgets", () =>
    Promise.all([fkLabelsPromise, ...widgetTasks])
  );

  // Opções de dropdown dos filtros rápidos (promise disparada antes da
  // computação; ver fillQuickFilterOptions acima).
  if (fillQuickFilterOptions) {
    await timing.measure("quickFilters", () => fillQuickFilterOptions());
  }

  // Resumo de timing do load — SEMPRE logado (1 linha por render; Vercel/dev).
  // Primeira coisa a olhar quando o dashboard "ficou lento" (runbook §5): o
  // top aponta o widget dominante; erro = widget que falhou (ex.: timeout).
  timing.log(dash.name);

  // Opções do SELECT de responsável editável (promise disparada antes da
  // computação dos widgets). Marca os responsáveis com vínculo no Bitrix: são
  // os únicos oferecidos quando a coluna grava de volta (ASSIGNED_BY_ID).
  const { data: respRows } = await responsibleOptionsPromise;
  const responsibleOptions: ResponsibleOption[] = (respRows ?? []).map((r) => ({
    value: r.id as string,
    label: (r.display_name as string) ?? "—",
    bitrixLinked: Boolean(r.bitrix_user_id),
  }));

  // Opções de dropdown dos controles "Filtro por campo": responsáveis/operações
  // ativos (value = id, corrige o filtro que não casava com texto livre) e as
  // etapas distintas da(s) fonte(s) de cada widget (value = texto da etapa).
  const filterOptionsById: Record<string, FieldFilterOptions> = {};
  if (filterOptionsFetchPromise) {
    // Promise disparada antes da computação dos widgets — aqui só consome.
    const [respRes, opsRes, stageRes] = await filterOptionsFetchPromise;

    const responsibleOptions = (respRes.data ?? []).map((r) => ({
      value: r.id as string,
      label: (r.display_name as string) ?? "—",
    }));
    const operationOptions = (opsRes.data ?? []).map((o) => ({
      value: o.id as string,
      label: (o.name as string) ?? "—",
    }));
    // Etapas por record_type (a partir dos pares distintos do RPC).
    const stagesByRt: Record<string, Set<string>> = {};
    for (const row of (Array.isArray(stageRes.data)
      ? stageRes.data
      : []) as Record<string, unknown>[]) {
      const rt = String(row.dim_1 ?? "");
      const st = row.dim_2 == null ? "" : String(row.dim_2);
      if (!rt || !st) continue;
      (stagesByRt[rt] ??= new Set()).add(st);
    }

    for (const fw of fieldFilterWidgets) {
      const map: FieldFilterOptions = {};
      const fwFields = fw.settings?.fields ?? [];
      const has = (f: string) => fwFields.some((e) => e.field === f);
      if (has("responsible_id")) map.responsible_id = responsibleOptions;
      if (has("operation_id")) map.operation_id = operationOptions;
      if (has("stage")) {
        const srcs = (fw.sources ?? []) as SourceKey[];
        const rts =
          srcs.length > 0
            ? srcs.map((s) => toRecordType(s))
            : Object.keys(stagesByRt);
        const set = new Set<string>();
        for (const rt of rts) for (const s of stagesByRt[rt] ?? []) set.add(s);
        map.stage = [...set]
          .sort((a, b) => a.localeCompare(b, "pt-BR"))
          .map((s) => ({ value: s, label: s }));
      }
      if (Object.keys(map).length > 0) filterOptionsById[fw.id] = map;
    }
  }

  // Seed do histórico de Desfazer/Refazer: snapshot determinístico do estado
  // atual (nome + settings + widgets + células das tabelas editáveis). Recomputado
  // a cada render do RSC, é o que o provider observa para registrar mudanças.
  // (Fetch disparado antes da computação dos widgets — aqui só consome.)
  const { data: cellsData } = await cellsDataPromise;
  const historySeed = buildDashboardSnapshot(
    dash.name as string,
    dashSettings,
    widgets,
    // Valores de filtros rápidos ('__qf__') e a expressão da calculadora
    // ('__calc__') ficam fora do histórico de Desfazer/Refazer (não são
    // edição de dashboard).
    (cellsData ?? []).filter(
      (c) =>
        c.row_key !== QF_ROW_KEY &&
        c.row_key !== CALC_ROW_KEY &&
        c.row_key !== PW_ROW_KEY
    )
  );

  // Expressão compartilhada corrente de cada calculadora (row __calc__).
  const calcExprById: Record<string, string> = {};
  for (const c of cellsData ?? []) {
    if (c.row_key === CALC_ROW_KEY && c.col_key === CALC_COL_KEY) {
      calcExprById[c.widget_id] = String(c.value ?? "");
    }
  }

  // Células digitadas de cada Tabela Livre (payload inicial do widget; os
  // dados BI chegam deferidos). Reusa o cellsData do seed — custo zero.
  const quickTableIds = new Set(
    widgets.filter(isQuickTableWidget).map((w) => w.id)
  );
  const tableCellsById: Record<
    string,
    { row_key: string; col_key: string; value: number | string | null }[]
  > = {};
  for (const c of cellsData ?? []) {
    if (!quickTableIds.has(c.widget_id) || c.row_key.startsWith("__")) continue;
    (tableCellsById[c.widget_id] ??= []).push({
      row_key: c.row_key,
      col_key: c.col_key,
      value: c.value,
    });
  }

  // Atalho vindo de outro dashboard (?focus=<widgetId>): abre já na aba do
  // widget-alvo e o cliente centraliza/destaca ao montar.
  const focusId = str(sp.focus);
  const focusWidget = focusId
    ? widgets.find((w) => w.id === focusId)
    : undefined;

  return (
    <>
      {/* Grava a view (com ?tab=) p/ restauração ao reabrir o app. */}
      <TrackLastView />
      <DashboardClient
        dashboardId={dash.id as string}
        dashboardName={dash.name as string}
        historySeed={historySeed}
        widgets={widgets}
        dataById={dataById}
        recordListById={recordListById}
        recordListExtraById={recordListExtraById}
        recordListTotalById={recordListTotalById}
        entityListById={entityListById}
        calcById={calcById}
        calcVarsById={calcVarsById}
        noteById={noteById}
        calcExprById={calcExprById}
        tableCellsById={tableCellsById}
        fields={(fieldsData ?? []) as FieldDefinition[]}
        fkLabels={fkLabels}
        responsibleOptions={responsibleOptions}
        userRoles={userRoles}
        canEditValues={canEditValues}
        available={available}
        availableForBuilder={availableForBuilder}
        canEdit={canEdit}
        canManageFields={canManageFields}
        currencyOptions={currencyOptions}
        currencyRates={currencyRates}
        conversionPeriodById={conversionPeriodById}
        settings={dashSettings}
        visibleToRoles={(dash.visible_to_roles ?? []) as string[]}
        dateFormat={dashSettings.dateFormat}
        periodBar={periodBar}
        periodScope={scope}
        periodDefaultsByTab={periodDefaultsByTab}
        periodDefaultFieldByTab={periodDefaultFieldByTab}
        filterOptionsById={filterOptionsById}
        fieldFilterSeedById={fieldFilterSeedById}
        quickFiltersById={quickFiltersById}
        periodWindowById={periodWindowById}
        deferredScopeById={deferredScopeById}
        initialTabId={str(sp.tab) || (focusWidget ? widgetTab(focusWidget) : "")}
        focusWidgetId={focusWidget ? focusId : undefined}
      />
    </>
  );
}
