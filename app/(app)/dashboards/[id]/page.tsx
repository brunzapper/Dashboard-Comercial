// Versão: 2.0 | Data: 09/07/2026
// Página de um dashboard: computa os dados de cada widget (server, via RLS) e
// entrega ao shell client (grid + charts). Fase 6A.
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
import { runRecordList } from "@/lib/widgets/record-list";
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
  DEFAULT_PERIOD_FIELD,
  applyPeriodToFilters,
  hasSelection,
  periodKeys,
  resolvePeriodSelection,
  resolveUnifiedPeriodField,
  type DashboardPeriod,
  type PeriodScope,
  type PeriodSelection,
  type SavedPeriod,
} from "@/lib/widgets/period";
import {
  QF_ROW_KEY,
  bucketKeyFromRpcValue,
  hasQuickValue,
  isBucketEntry,
  isPeriodEntry,
  parseQuickFilterValue,
  quickOptionsFilter,
  staticBucketOptions,
  type QuickFilterValue,
  type WidgetQuickFilters,
} from "@/lib/widgets/quick-filters";
import { formatBucketLabel } from "@/lib/widgets/date-buckets";
import type {
  CalcWidgetResult,
  DashboardSettings,
  FieldFilterOptions,
  Transform,
  Widget,
  WidgetData,
  WidgetFilter,
} from "@/lib/widgets/types";
import {
  DEFAULT_PERIOD_FIELD_BY_SOURCE,
  isSourceKey,
  SOURCE_KEYS,
  SOURCE_RECORD_TYPE,
  type SourceKey,
} from "@/lib/sources";
import { parseViewFilter, viewStateToFilters } from "@/lib/widgets/view-filters";
import { buildDashboardSnapshot } from "@/lib/widgets/history";
import { DashboardClient } from "@/components/dashboards/dashboard-client";
import type { ResponsibleOption } from "@/components/dashboards/charts/record-list-table";

function str(v: string | string[] | undefined): string {
  return Array.isArray(v) ? (v[0] ?? "") : (v ?? "");
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
  const session = await getSessionInfo();
  const supabase = await createClient();

  const { data: dash } = await supabase
    .from("dashboards")
    .select("id, name, owner_user_id, visible_to_roles, settings")
    .eq("id", id)
    .maybeSingle();
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
  ] = await Promise.all([
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
  ]);
  const currencyOptions = currencyOptionsFrom(enabledCurrencies);

  // Último período consultado pelo usuário neste dashboard (se houver). No modo
  // "por aba", cada aba guarda o seu em `lastPeriodByTab` (chave = id da aba).
  const prefSettings = (prefData?.settings ?? {}) as {
    lastPeriod?: SavedPeriod;
    lastPeriodByTab?: Record<string, SavedPeriod>;
  };
  const savedPeriod = prefSettings.lastPeriod ?? {};
  const lastPeriodByTab = prefSettings.lastPeriodByTab ?? {};

  const widgets = (widgetsData ?? []) as Widget[];
  const allFields = (fieldsData ?? []) as FieldDefinition[];
  // Renderização usa TODOS os campos: os metadados são legíveis por qualquer
  // autenticado (RLS afrouxada em 0043), então widgets compartilhados resolvem
  // rótulos/tipos corretamente para qualquer papel.
  const available = buildAvailableFields(allFields, correspondences);
  // Construtor de widgets respeita o ACL por papel (visible_to_roles): quem edita
  // só escolhe colunas visíveis ao seu papel (admin vê tudo). Assim a RLS
  // afrouxada não deixa um dono não-admin montar widgets com colunas restritas.
  const builderFields = isAdmin
    ? allFields
    : allFields.filter((f) => hasAnyRole(userRoles, f.visible_to_roles as RoleKey[]));
  const availableForBuilder = isAdmin
    ? available
    : buildAvailableFields(builderFields, correspondences);
  const correspondencesMap = buildCorrespondenceMap(correspondences);
  const dashSettings = (dash.settings ?? {}) as DashboardSettings;
  const periodBar = dashSettings.periodBar;

  // Campo aceitável como coluna de período: data real, não sintético ("today"
  // não existe no banco) e não `match:` (subconsulta escalar — o RPC e o modo
  // lista não a aceitam como coluna do `@period`). `unified:` É aceito porque
  // resolveFieldBySource o desdobra no membro concreto de cada fonte.
  const isPeriodDateField = (f: string) =>
    available.some((a) => a.field === f && a.isDate && !a.displayOnly) &&
    !f.startsWith("match:");

  // Mapa "campo de data por fonte" resolvido: defaults por fonte
  // (DEFAULT_PERIOD_FIELD_BY_SOURCE) sobrescritos pelo campo primário (quando
  // unificado) e pela config (só campos de data válidos). É o que faz uma
  // seleção de calendário filtrar cada fonte pela sua coluna — ex.: negócios
  // por assinatura e Estudo por Created At. Campos `unified:` são resolvidos no
  // membro da fonte (coluna do núcleo ou custom:<k>) — o RPC/modo lista só
  // entendem refs concretos no `@period`; fonte sem membro na correspondência
  // mantém o default dela.
  const resolveFieldBySource = (
    primary?: string,
    cfg?: Partial<Record<SourceKey, string>>
  ): Partial<Record<SourceKey, string>> => {
    const out: Partial<Record<SourceKey, string>> = {
      ...DEFAULT_PERIOD_FIELD_BY_SOURCE,
    };
    const put = (k: SourceKey, raw: string) => {
      const resolved = resolveUnifiedPeriodField(raw, k, correspondences);
      if (resolved && isPeriodDateField(resolved)) out[k] = resolved;
    };
    if (primary?.startsWith("unified:")) {
      for (const s of SOURCE_KEYS) put(s, primary);
    }
    for (const [k, v] of Object.entries(cfg ?? {})) {
      if (isSourceKey(k) && typeof v === "string") put(k, v);
    }
    return out;
  };

  // Widgets de dados (excluem os controles: filtro de período e filtro por campo).
  const dataWidgets = widgets.filter(
    (w) => w.visual_type !== "filtro" && w.visual_type !== "filtro_campo"
  );
  const filterWidgets = widgets.filter((w) => w.visual_type === "filtro");
  const fieldFilterWidgets = widgets.filter(
    (w) => w.visual_type === "filtro_campo"
  );

  // Escopo do filtro de período: "global" (um período p/ todo o dashboard) ou
  // "tab" (cada aba com sua seleção). As abas e a "aba efetiva" de um widget
  // espelham components/dashboards/dashboard-client.tsx.
  const scope: PeriodScope = periodBar?.scope === "tab" ? "tab" : "global";
  const tabs = dashSettings.tabs ?? [];
  const tabIds = new Set(tabs.map((t) => t.id));
  const firstTabId = tabs[0]?.id ?? "";
  const widgetTab = (w: Widget) => {
    const t = w.settings?.tab;
    return t && tabIds.has(t) ? t : firstTabId;
  };

  // Defaults (campo + período) de um "bucket" quando a URL está vazia:
  // preferência do usuário (último consultado no bucket) > config do dashboard >
  // default. Bucket = "" no modo global; id da aba no modo por aba.
  function resolveDefaults(saved: SavedPeriod): {
    defaultField: string;
    periodDefaults: PeriodSelection;
  } {
    const defaultField =
      saved.campo && isPeriodDateField(saved.campo)
        ? saved.campo
        : periodBar?.field && isPeriodDateField(periodBar.field)
          ? periodBar.field
          : DEFAULT_PERIOD_FIELD;
    const hasContent = Boolean(saved.periodo || saved.de || saved.ate);
    const periodDefaults: PeriodSelection = hasContent
      ? { preset: saved.periodo ?? "", de: saved.de ?? "", ate: saved.ate ?? "" }
      : { preset: periodBar?.defaultPreset ?? "" };
    return { defaultField, periodDefaults };
  }

  const savedFor = (bucket: string): SavedPeriod =>
    scope === "tab" ? (lastPeriodByTab[bucket] ?? {}) : savedPeriod;

  // Resolve o período de um bucket lendo suas próprias chaves de URL (namespadas
  // por aba no modo "tab"; chaves fixas no modo global).
  function resolvePeriodForBucket(bucket: string): DashboardPeriod | null {
    const { defaultField, periodDefaults } = resolveDefaults(savedFor(bucket));
    const keys = periodKeys(scope, bucket);
    const campoRaw = str(sp[keys.campo]);
    const userPickedField = isPeriodDateField(campoRaw);
    const field = userPickedField ? campoRaw : defaultField;
    const p = resolvePeriodSelection(
      { preset: str(sp[keys.preset]), de: str(sp[keys.de]), ate: str(sp[keys.ate]) },
      field,
      periodDefaults
    );
    if (!p) return null;
    // Sem escolha explícita de campo na barra, cada fonte filtra pela sua coluna
    // de data (mapa por fonte). Quando o usuário troca o campo direto na barra,
    // esse campo único vale p/ todas as fontes (retrocompatível) — exceto
    // `unified:`, que sempre precisa do mapa p/ virar o membro de cada fonte.
    if (userPickedField) {
      return campoRaw.startsWith("unified:")
        ? { ...p, fieldBySource: resolveFieldBySource(campoRaw) }
        : p;
    }
    return {
      ...p,
      fieldBySource: resolveFieldBySource(field, periodBar?.fieldBySource),
    };
  }

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

  // 1) Período de cada widget (só se a barra estiver visível). No modo global,
  //    todos compartilham o bucket ""; no modo por aba, cada widget usa o
  //    período da sua aba efetiva (resolvido e cacheado por bucket).
  // 2) Precedência: um widget de filtro sobrescreve o período dos seus alvos
  //    (ou de todos, se sem alvos) — aplicado logo abaixo.
  const periodByWidget: Record<string, DashboardPeriod | null> = {};
  // Origem do período efetivo de cada widget: barra global ("bar") ou widget de
  // filtro ("filter"). Usada pelos filtros rápidos de período (espelho da barra
  // só faz sentido quando é a barra que rege o widget).
  const periodSourceByWidget: Record<string, "bar" | "filter"> = {};
  const widgetBucket = (w: Widget) => (scope === "tab" ? widgetTab(w) : "");
  if (periodBar?.enabled !== false) {
    const cache = new Map<string, DashboardPeriod | null>();
    const periodOf = (bucket: string) => {
      if (!cache.has(bucket)) cache.set(bucket, resolvePeriodForBucket(bucket));
      return cache.get(bucket) ?? null;
    };
    for (const w of dataWidgets) {
      periodByWidget[w.id] = periodOf(widgetBucket(w));
      periodSourceByWidget[w.id] = "bar";
    }
  } else {
    for (const w of dataWidgets) periodByWidget[w.id] = null;
  }

  for (const fw of filterWidgets) {
    const s = fw.settings ?? {};
    const field =
      s.field && isPeriodDateField(s.field) ? s.field : DEFAULT_PERIOD_FIELD;
    const p = resolvePeriodSelection(
      {
        preset: str(sp[`pf_${fw.id}`]),
        de: str(sp[`pfd_${fw.id}`]),
        ate: str(sp[`pfa_${fw.id}`]),
      },
      field,
      { preset: s.defaultPreset ?? "" }
    );
    // O widget de filtro tem campo fixo; mesmo assim aplica o mapa por fonte
    // (defaults + config), p/ cada fonte filtrar pela sua coluna de data.
    const pWithMap: DashboardPeriod | null = p
      ? { ...p, fieldBySource: resolveFieldBySource(field, s.fieldBySource) }
      : p;
    const targets =
      s.targets && s.targets.length > 0
        ? s.targets
        : dataWidgets.map((w) => w.id);
    for (const t of targets) {
      if (t in periodByWidget) {
        periodByWidget[t] = pWithMap;
        periodSourceByWidget[t] = "filter";
      }
    }
  }

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

  if (qfWidgets.length > 0) {
    // 1) Valores persistidos (chave widget:entry).
    const qfValues = new Map<string, QuickFilterValue>();
    const { data: qfCells } = await supabase
      .from("dashboard_table_cells")
      .select("widget_id, col_key, value")
      .in(
        "widget_id",
        qfWidgets.map((w) => w.id)
      )
      .eq("row_key", QF_ROW_KEY);
    for (const c of qfCells ?? []) {
      const v = parseQuickFilterValue(c.value);
      if (v) qfValues.set(`${c.widget_id}:${c.col_key}`, v);
    }

    const allEntries = qfWidgets.flatMap((w) => w.settings?.quickFilters ?? []);

    // 2) Exceção do vendedor: usuário sem view_all_records tem os próprios
    //    responsáveis resolvidos (vínculo vivo responsibles.user_id).
    const canViewAll =
      session?.permissions.includes("view_all_records") ?? false;
    let ownResponsibleIds: string[] = [];
    if (
      !canViewAll &&
      session &&
      allEntries.some((e) => e.field === "responsible_id")
    ) {
      const { data: ownResp } = await supabase
        .from("responsibles")
        .select("id")
        .eq("user_id", session.user.id);
      ownResponsibleIds = (ownResp ?? []).map((r) => r.id as string);
    }

    // 3) Opções dos dropdowns: responsáveis/operações ativos e, p/ datas com
    //    formato, os buckets DISTINTOS existentes nos dados (via RPC, mesma
    //    expressão das dimensões). month_name/weekday têm listas fixas.
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
    const bucketsPromise = Promise.all(
      [...bucketCombos.entries()].map(async ([key, c]) => {
        try {
          const { data, error } = await supabase.rpc("run_widget_query", {
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
    );
    const [qfRespRes, qfOpsRes] = await Promise.all([
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
    ]);
    await bucketsPromise;
    const qfRespOptions = (qfRespRes.data ?? []).map((r) => ({
      value: r.id as string,
      label: (r.display_name as string) ?? "—",
    }));
    const qfOpsOptions = (qfOpsRes.data ?? []).map((o) => ({
      value: o.id as string,
      label: (o.name as string) ?? "—",
    }));

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
              filters = applyPeriodToFilters(
                filters,
                pMap,
                (w.sources ?? []) as SourceKey[]
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
        if (entry.field === "responsible_id") {
          options[entry.id] = qfRespOptions;
        } else if (entry.field === "operation_id") {
          options[entry.id] = qfOpsOptions;
        } else if (isBucketEntry(entry, available)) {
          options[entry.id] =
            staticBucketOptions(entry.transform!) ??
            bucketOptionsByCombo[
              `${entry.field}|${entry.transform}|${entry.weekMode ?? "restricted"}`
            ] ??
            [];
        }
      }

      quickFiltersById[w.id] = { entries, values, options };
      if (filters.length > 0) qfFiltersByWidget[w.id] = filters;
    }
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

  // Barra embutida: só nos widgets de Tabela (agregada ou registros).
  for (const w of dataWidgets) {
    if (w.visual_type !== "tabela") continue;
    const raw = str(sp[`tf_${w.id}`]);
    if (!raw) continue;
    addViewFilters(
      w.id,
      viewStateToFilters(parseViewFilter(raw), w.settings?.searchFields)
    );
  }

  // Sobreposição de fontes (vazio = todas as fontes).
  const sourcesOverlap = (a: string[], b: string[]) => {
    if (a.length === 0 || b.length === 0) return true;
    return a.some((s) => b.includes(s));
  };

  for (const fw of fieldFilterWidgets) {
    const raw = str(sp[`ff_${fw.id}`]);
    if (!raw) continue;
    const fs = viewStateToFilters(parseViewFilter(raw), fw.settings?.searchFields);
    if (fs.length === 0) continue;
    const excluded = new Set(fw.settings?.excludedTargets ?? []);
    const fwSources = (fw.sources ?? []) as string[];
    // Filtro sobre campo unificado (multi-fonte) atinge todas as fontes.
    const unified = fs.some((f) =>
      f.field.split("|").some((p) => p.startsWith("unified:"))
    );
    for (const w of dataWidgets) {
      if (excluded.has(w.id)) continue;
      if (!unified && !sourcesOverlap(fwSources, (w.sources ?? []) as string[]))
        continue;
      addViewFilters(w.id, fs);
    }
  }

  // Widget de Tabela em modo "registros individuais" (Fase 1): lista 1 linha por
  // registro em vez de agregar.
  const isListWidget = (w: Widget) =>
    w.visual_type === "tabela" && w.settings?.rowMode === "records";
  // Widget "Métrica calculada" (Fase 3): valor vem da fórmula (contexto do dash).
  const isCalcWidget = (w: Widget) => w.visual_type === "calculado";

  // 3) Computa cada widget de dados. Filtros, tabela editável e calculado não
  //    passam pelo engine de agregação padrão.
  const dataById: Record<string, WidgetData> = {};
  const recordListById: Record<string, RecordRow[]> = {};
  const entityListById: Record<string, EntityListRow[]> = {};
  await Promise.all(
    dataWidgets.map(async (w) => {
      if (isCalcWidget(w)) return; // computado abaixo
      const config = {
        source: "records" as const,
        sources: w.sources ?? [],
        splitBySource: w.split_by_source ?? false,
        dimensions: w.dimensions ?? [],
        metrics: w.metrics ?? [],
        filters: [...(w.filters ?? []), ...(viewFiltersByWidget[w.id] ?? [])],
        visual_type: w.visual_type,
        settings: w.settings,
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
          recordListById[w.id] = await runRecordList(
            supabase,
            config,
            periodByWidget[w.id],
            available
          );
        } catch (e) {
          recordListById[w.id] = [];
          fail(e);
        }
        return;
      }
      try {
        dataById[w.id] = await runWidget(
          supabase,
          config,
          available,
          periodByWidget[w.id],
          correspondencesMap,
          (fieldsData ?? []) as FieldDefinition[],
          currencyRates,
          conversionPeriodById[w.id]
        );
      } catch (e) {
        fail(e);
      }
    })
  );

  // Rótulos das colunas FK presentes nas tabelas de registros (id→nome).
  const fkLabels: Record<string, string> = {};
  const listRows = Object.values(recordListById).flat();
  if (listRows.length > 0) {
    const respIds = new Set<string>();
    const opIds = new Set<string>();
    const leadIds = new Set<string>();
    for (const r of listRows) {
      if (r.responsible_id) respIds.add(r.responsible_id);
      if (r.operation_id) opIds.add(r.operation_id);
      if (r.related_lead_id) leadIds.add(r.related_lead_id);
    }
    const [resp, ops, leads] = await Promise.all([
      respIds.size
        ? supabase.from("responsibles").select("id, display_name").in("id", [...respIds])
        : Promise.resolve({ data: [] }),
      opIds.size
        ? supabase.from("operations").select("id, name").in("id", [...opIds])
        : Promise.resolve({ data: [] }),
      leadIds.size
        ? supabase.from("records").select("id, title").in("id", [...leadIds])
        : Promise.resolve({ data: [] }),
    ]);
    for (const r of resp.data ?? [])
      fkLabels[r.id as string] = (r.display_name as string) ?? "—";
    for (const o of ops.data ?? [])
      fkLabels[o.id as string] = (o.name as string) ?? "—";
    for (const l of leads.data ?? [])
      fkLabels[l.id as string] = (l.title as string) ?? "—";
  }

  // Opções do SELECT de responsável editável nas tabelas de registros individuais:
  // só carrega se algum widget-lista expõe a coluna responsible_id como editável.
  let responsibleOptions: ResponsibleOption[] = [];
  const needsResponsibleSelect = dataWidgets.some(
    (w) =>
      isListWidget(w) &&
      (w.settings?.rowSource ?? "records") === "records" &&
      (w.settings?.columns ?? []).some(
        (c) => c.field === "responsible_id" && c.editable
      )
  );
  if (needsResponsibleSelect) {
    const { data: respRows } = await supabase
      .from("responsibles")
      .select("id, display_name, bitrix_user_id")
      .eq("active", true)
      .order("display_name");
    responsibleOptions = (respRows ?? []).map((r) => ({
      value: r.id as string,
      label: (r.display_name as string) ?? "—",
      // Marca os responsáveis com vínculo no Bitrix: são os únicos oferecidos
      // quando a coluna grava de volta (ASSIGNED_BY_ID).
      bitrixLinked: Boolean(r.bitrix_user_id),
    }));
  }

  // Opções de dropdown dos controles "Filtro por campo": responsáveis/operações
  // ativos (value = id, corrige o filtro que não casava com texto livre) e as
  // etapas distintas da(s) fonte(s) de cada widget (value = texto da etapa).
  const filterOptionsById: Record<string, FieldFilterOptions> = {};
  if (fieldFilterWidgets.length > 0) {
    const exposed = new Set<string>();
    for (const fw of fieldFilterWidgets)
      for (const f of fw.settings?.fields ?? []) exposed.add(f.field);
    const needResp = exposed.has("responsible_id");
    const needOps = exposed.has("operation_id");
    const needStage = exposed.has("stage");

    const [respRes, opsRes, stageRes] = await Promise.all([
      needResp
        ? supabase
            .from("responsibles")
            .select("id, display_name")
            .eq("active", true)
            .order("display_name")
        : Promise.resolve({ data: [] as { id: string; display_name: string }[] }),
      needOps
        ? supabase
            .from("operations")
            .select("id, name")
            .eq("active", true)
            .order("name")
        : Promise.resolve({ data: [] as { id: string; name: string }[] }),
      needStage
        ? supabase.rpc("run_widget_query", {
            p_source: "records",
            p_dimensions: [{ field: "record_type" }, { field: "stage" }],
            p_metrics: [],
            p_filters: [],
            p_correspondences: {},
          })
        : Promise.resolve({ data: [] }),
    ]);

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
            ? srcs.map((s) => SOURCE_RECORD_TYPE[s] as string)
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

  // Métricas calculadas: resolve a fórmula com o contexto do dashboard
  // (agregações de registros). `settings.calcField` aponta p/ um campo
  // "Calculado (totais)" salvo em /campos — a fórmula/moeda vêm da definição
  // (campo deletado → fórmula null → valor null → "—"). Moeda: automática
  // ('inherit') preserva a moeda dos operandos (misturou → BRL); fixa converte.
  const calcById: Record<string, CalcWidgetResult> = {};
  const calcWidgets = dataWidgets.filter(isCalcWidget);
  if (calcWidgets.length > 0) {
    await Promise.all(
      calcWidgets.map(async (w) => {
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
          calcById[w.id] = await runCalculatedWidget(supabase, {
            formula,
            sources: w.sources ?? [],
            filters: [...(w.filters ?? []), ...(viewFiltersByWidget[w.id] ?? [])],
            period: periodByWidget[w.id],
            correspondencesMap,
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
      })
    );
  }

  // Seed do histórico de Desfazer/Refazer: snapshot determinístico do estado
  // atual (nome + settings + widgets + células das tabelas editáveis). Recomputado
  // a cada render do RSC, é o que o provider observa para registrar mudanças.
  const { data: cellsData } = widgets.length
    ? await supabase
        .from("dashboard_table_cells")
        .select("widget_id, row_key, col_key, value")
        .in(
          "widget_id",
          widgets.map((w) => w.id)
        )
    : { data: [] as { widget_id: string; row_key: string; col_key: string; value: number | string | null }[] };
  const historySeed = buildDashboardSnapshot(
    dash.name as string,
    dashSettings,
    widgets,
    // Valores de filtros rápidos ('__qf__') ficam fora do histórico de
    // Desfazer/Refazer (não são edição de dashboard).
    (cellsData ?? []).filter((c) => c.row_key !== QF_ROW_KEY)
  );

  return (
    <DashboardClient
      dashboardId={dash.id as string}
      dashboardName={dash.name as string}
      historySeed={historySeed}
      widgets={widgets}
      dataById={dataById}
      recordListById={recordListById}
      entityListById={entityListById}
      calcById={calcById}
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
      quickFiltersById={quickFiltersById}
    />
  );
}
