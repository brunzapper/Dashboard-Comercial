// Versão: 1.0 | Data: 23/07/2026
// EXPORTADOR: dashboard existente (linhas de dashboards + widgets) → JSON no
// formato "dashboard-import" (o inverso de validate.ts). Puro, sem I/O —
// testável via npx tsx. Usado pelo botão "Exportar JSON" (⋮ do card) e pelos
// modos "Criar a partir de"/"Editar" da conversa com IA (o JSON exportado é o
// "ESTADO ATUAL" injetado no prompt e a base da identidade de edição).
// Regras de fidelidade (espelham o validador):
// - dashboard.settings/widget.settings são passthrough no validador → emitimos
//   quase verbatim; removemos `preset`/`presetKey` (identidade — derivada, não
//   reemitida), `connectors` e `kanban` (carregam uuids de widget que não
//   sobrevivem a um import-como-novo).
// - dimensions/filters: só os campos do REBUILD ({field,label,transform,
//   weekMode,dateAgg} / {field,op,value,sources}).
// - metrics: caminho A (normal) e B (calc ad-hoc com `formula` em TOKENS —
//   aceitos pelo validador e revalidados); métrica `custom:`+calc é emitida
//   como A simples (caminho C do validador é lossy — perda documentada).
// - IDENTIDADE ESTÁVEL: chave = sufixo de settings.preset.key quando o board
//   já nasceu de import; senão `board_<8hex do id>`. Key de widget = sufixo do
//   presetKey quando pertence a `import:<chave>.`; senão `w_<8hex do id>`.
//   Determinístico ⇒ export/adoção/reaplicação convergem sem duplicar.
// NÃO valida (snapshot fiel; refs mortos aparecem e o laço de correção da IA
// os conserta no import).

import type {
  DashboardSettings,
  Dimension,
  GridPosition,
  Metric,
  WidgetFilter,
  WidgetSettings,
} from "@/lib/widgets/types";
import type { SourceDef } from "@/lib/sources";
import { CALC_METRIC_FIELD } from "@/lib/widgets/calc-metrics";
import {
  DASHBOARD_IMPORT_FORMAT,
  DASHBOARD_IMPORT_VERSION,
  IMPORT_PRESET_PREFIX,
  type DashboardImportJson,
  type ImportMetricSpec,
  type ImportWidgetSpec,
} from "./types";

export interface ExportDashRow {
  id: string;
  name: string;
  visible_to_roles: string[] | null;
  settings: DashboardSettings | null;
}

export interface ExportWidgetRow {
  id: string;
  title: string | null;
  visual_type: string;
  sources: string[] | null;
  split_by_source: boolean | null;
  dimensions: Dimension[] | null;
  metrics: Metric[] | null;
  filters: WidgetFilter[] | null;
  settings: WidgetSettings | null;
  grid_position: GridPosition | Record<string, never> | null;
  sort_order: number | null;
}

export interface ExportResult {
  json: DashboardImportJson;
  chave: string;
  /** widget.id → key emitida (a adoção do modo Editar usa o MESMO mapa). */
  widgetKeyById: Map<string, string>;
}

function shortHex(uuid: string): string {
  return uuid.replace(/-/g, "").slice(0, 8);
}

/** Chave de import canônica do dashboard (estável entre export/edição). */
export function importChaveForDashboard(dash: {
  id: string;
  settings: DashboardSettings | null;
}): string {
  const pk = dash.settings?.preset?.key;
  if (pk && pk.startsWith(IMPORT_PRESET_PREFIX)) {
    const suffix = pk.slice(IMPORT_PRESET_PREFIX.length);
    if (suffix) return suffix;
  }
  return `board_${shortHex(dash.id)}`;
}

/** Key estável de UM widget dentro da chave dada (reusa o sufixo do presetKey
 * quando o widget já pertence a `import:<chave>.`; senão deriva do uuid). */
export function widgetKeyFor(
  w: { id: string; settings?: WidgetSettings | null },
  chave: string
): string {
  const pk = w.settings?.presetKey;
  const prefix = `${IMPORT_PRESET_PREFIX}${chave}.`;
  if (pk && pk.startsWith(prefix)) {
    const suffix = pk.slice(prefix.length);
    if (suffix) return suffix;
  }
  return `w_${shortHex(w.id)}`;
}

/** Atribui keys ÚNICAS aos widgets (ordem por sort_order; dedupe `_2`). É o
 * MESMO mapeamento do export — a adoção do modo Editar usa esta função para
 * carimbar `settings.presetKey` de forma que as keys do JSON exportado casem
 * 1:1 com os widgets reais. */
export function assignWidgetKeys(
  widgets: {
    id: string;
    settings?: WidgetSettings | null;
    sort_order?: number | null;
  }[],
  chave: string
): Map<string, string> {
  const ordered = [...widgets].sort(
    (a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)
  );
  const used = new Set<string>();
  const byId = new Map<string, string>();
  for (const w of ordered) {
    let key = widgetKeyFor(w, chave);
    if (used.has(key)) {
      let n = 2;
      while (used.has(`${key}_${n}`)) n++;
      key = `${key}_${n}`;
    }
    used.add(key);
    byId.set(w.id, key);
  }
  return byId;
}

/** Remove chaves undefined (JSON compacto — menos tokens para a IA). */
function compact<T extends Record<string, unknown>>(obj: T): T {
  const out = {} as T;
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) (out as Record<string, unknown>)[k] = v;
  }
  return out;
}

function exportDimension(d: Dimension): Dimension {
  return compact({
    field: d.field,
    label: d.label,
    transform: d.transform,
    weekMode: d.weekMode,
    dateAgg: d.dateAgg,
  }) as Dimension;
}

function exportMetric(m: Metric): ImportMetricSpec {
  const isCalc = m.calc === true || m.field === CALC_METRIC_FIELD;
  if (isCalc && typeof m.field === "string" && m.field.startsWith("custom:")) {
    // Reuso de campo calculado_agg salvo (caminho C do validador): só
    // field/agg/label sobrevivem — emitimos exatamente isso (perda documentada).
    return compact({ field: m.field, agg: "sum" as const, label: m.label });
  }
  if (isCalc) {
    // Calc ad-hoc (caminho B): `formula` em TOKENS passa direto no validador.
    return compact({
      field: CALC_METRIC_FIELD,
      calc: true,
      formula: m.formula,
      label: m.label,
      resultPercent: m.resultPercent === true ? true : undefined,
      resultCurrency:
        typeof m.resultCurrency === "string" ? m.resultCurrency : undefined,
      percent: m.percent === true ? true : undefined,
      sources: m.sources && m.sources.length > 0 ? m.sources : undefined,
    });
  }
  // Caminho A (normal).
  return compact({
    field: m.field,
    agg: m.agg,
    label: m.label,
    percent: m.percent === true ? true : undefined,
    sources: m.sources && m.sources.length > 0 ? m.sources : undefined,
    conversionBasis: m.conversionBasis,
    currencyDisplay: m.currencyDisplay,
    currencyMultiMode: m.currencyMultiMode,
    grandTotalMode: m.grandTotalMode,
  });
}

function exportFilter(f: WidgetFilter): WidgetFilter {
  return compact({
    field: f.field,
    op: f.op,
    value: f.value,
    sources: f.sources && f.sources.length > 0 ? f.sources : undefined,
  }) as WidgetFilter;
}

function validGrid(
  gp: GridPosition | Record<string, never> | null
): GridPosition | undefined {
  if (!gp || typeof gp !== "object") return undefined;
  const g = gp as Partial<GridPosition>;
  const nums = [g.x, g.y, g.w, g.h];
  if (nums.some((n) => typeof n !== "number" || !Number.isFinite(n)))
    return undefined;
  const x = Math.floor(g.x as number);
  const y = Math.floor(g.y as number);
  const w = Math.floor(g.w as number);
  const h = Math.floor(g.h as number);
  if (x < 0 || y < 0 || w < 1 || h < 1) return undefined;
  return { x, y, w, h };
}

/** Raiz de uma source key (sub-base → pai); null se desconhecida no catálogo. */
function rootOf(key: string, sources: SourceDef[]): string | null {
  const def = sources.find((s) => s.key === key);
  if (!def) return null;
  return def.parentKey ?? def.key;
}

export function exportDashboardJson(input: {
  dash: ExportDashRow;
  widgets: ExportWidgetRow[];
  sources: SourceDef[];
}): ExportResult {
  const { dash, sources } = input;
  const chave = importChaveForDashboard(dash);
  const rootKeys = sources.filter((s) => !s.parentKey).map((s) => s.key);

  // ---- Bases: raízes referenciadas por widgets/métricas/filtros +
  // periodBar.fieldBySource + sourceScope; widget "todas as fontes" sem
  // sourceScope ⇒ todas as raízes. Vazio ⇒ todas as raízes.
  const settings = (dash.settings ?? {}) as DashboardSettings;
  const based = new Set<string>();
  let anyOpenWidget = false;
  const widgets = [...input.widgets].sort(
    (a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)
  );
  for (const w of widgets) {
    const wSources = (w.sources ?? []).filter(Boolean);
    if (wSources.length === 0) anyOpenWidget = true;
    for (const k of wSources) {
      const root = rootOf(k, sources);
      if (root) based.add(root);
    }
    for (const m of w.metrics ?? []) {
      for (const k of m.sources ?? []) {
        const root = rootOf(k, sources);
        if (root) based.add(root);
      }
    }
    for (const f of w.filters ?? []) {
      for (const k of f.sources ?? []) {
        const root = rootOf(k, sources);
        if (root) based.add(root);
      }
    }
  }
  for (const k of Object.keys(settings.periodBar?.fieldBySource ?? {})) {
    const root = rootOf(k, sources);
    if (root) based.add(root);
  }
  const scopeKeys = settings.sourceScope?.keys ?? [];
  for (const k of scopeKeys) {
    const root = rootOf(k, sources);
    if (root) based.add(root);
  }
  const bases =
    based.size === 0 || (anyOpenWidget && scopeKeys.length === 0)
      ? rootKeys
      : [...based].sort();

  // ---- dashboard.settings: verbatim menos identidade e chaves com uuids.
  const dashSettings: DashboardSettings = { ...settings };
  delete dashSettings.preset;
  delete (dashSettings as Record<string, unknown>).connectors;
  delete (dashSettings as Record<string, unknown>).kanban;

  // ---- Widgets (ordenados por sort_order; keys estáveis via assignWidgetKeys
  // — o MESMO mapeamento que a adoção do modo Editar usa).
  const widgetKeyById = assignWidgetKeys(widgets, chave);
  const specs: ImportWidgetSpec[] = widgets.map((w) => {
    const key = widgetKeyById.get(w.id) as string;

    const wSettings = { ...(w.settings ?? {}) } as WidgetSettings;
    delete wSettings.presetKey;
    const grid = validGrid(w.grid_position);
    const sourcesOut = (w.sources ?? []).filter(Boolean);
    return compact({
      key,
      title: w.title ?? "",
      visual_type: w.visual_type,
      sources: sourcesOut.length > 0 ? sourcesOut : undefined,
      split_by_source: w.split_by_source === true ? true : undefined,
      dimensions: (w.dimensions ?? []).map(exportDimension),
      metrics: (w.metrics ?? []).map(exportMetric),
      filters: (w.filters ?? []).map(exportFilter),
      settings: Object.keys(wSettings).length > 0 ? wSettings : undefined,
      grid_position: grid,
    }) as ImportWidgetSpec;
  });

  const json: DashboardImportJson = {
    formato: DASHBOARD_IMPORT_FORMAT,
    versao: DASHBOARD_IMPORT_VERSION,
    chave,
    bases,
    dashboard: compact({
      name: dash.name,
      visible_to_roles: dash.visible_to_roles ?? [],
      settings: dashSettings,
    }) as DashboardImportJson["dashboard"],
    widgets: specs,
  };

  return { json, chave, widgetKeyById };
}
