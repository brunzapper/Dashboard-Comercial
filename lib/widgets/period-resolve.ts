// Versão: 1.0 | Data: 15/07/2026
// Resolução do PERÍODO EFETIVO por widget, extraída da page do dashboard para
// ser compartilhada com o runQuickTable (server action deferida da Tabela
// rápida) — uma única implementação evita divergência entre o que a página
// computa e o que a action recomputa. Lógica idêntica à da page:
//  1) barra global (URL > preferência do usuário > config do dashboard),
//     por bucket ("" no escopo global; id da aba no escopo por aba);
//  2) widgets de filtro de período (?pf_<id>/pfd/pfa) sobrescrevem o período
//     dos seus alvos (ou de todos os widgets de dados, sem alvos).
// Puro (sem IO): o chamador carrega dashboard/widgets/prefs e entrega tudo.
import type { AvailableField } from "@/lib/widgets/fields";
import type { Correspondence } from "@/lib/correspondences";
import {
  DEFAULT_PERIOD_FIELD,
  periodKeys,
  resolvePeriodSelection,
  resolveUnifiedPeriodField,
  type DashboardPeriod,
  type PeriodScope,
  type PeriodSelection,
  type SavedPeriod,
} from "@/lib/widgets/period";
import {
  BUILTIN_SOURCES,
  defaultPeriodFieldBySource,
  isKnownSource,
  type SourceDef,
  type SourceKey,
} from "@/lib/sources";
import type { DashboardSettings, Widget } from "@/lib/widgets/types";

function str(v: string | string[] | undefined): string {
  return Array.isArray(v) ? (v[0] ?? "") : (v ?? "");
}

export interface PeriodPrefs {
  lastPeriod?: SavedPeriod;
  lastPeriodByTab?: Record<string, SavedPeriod>;
}

export interface WidgetPeriods {
  periodByWidget: Record<string, DashboardPeriod | null>;
  // Origem do período efetivo: barra global ("bar") ou widget de filtro
  // ("filter") — os filtros rápidos de período só espelham a barra.
  periodSourceByWidget: Record<string, "bar" | "filter">;
}

export function createPeriodResolver(input: {
  sp: Record<string, string | string[] | undefined>;
  available: AvailableField[];
  correspondences: Correspondence[];
  dashSettings: DashboardSettings;
  prefSettings: PeriodPrefs;
  // Catálogo de fontes (data_sources); ausente = builtins. É por aqui que as
  // fontes dinâmicas entram no fieldBySource do período — o @period do RPC
  // EXCLUI record_types fora do byType, então o mapa precisa cobrir todas.
  sources?: SourceDef[];
}) {
  const { sp, available, correspondences, dashSettings, prefSettings } = input;
  const catalog = input.sources ?? BUILTIN_SOURCES;
  const periodBar = dashSettings.periodBar;
  const savedPeriod = prefSettings.lastPeriod ?? {};
  const lastPeriodByTab = prefSettings.lastPeriodByTab ?? {};

  // Campo aceitável como coluna de período: data real, não sintético ("today"
  // não existe no banco) e não `match:` (subconsulta escalar — o RPC e o modo
  // lista não a aceitam como coluna do `@period`). `unified:` É aceito porque
  // resolveFieldBySource o desdobra no membro concreto de cada fonte.
  const isPeriodDateField = (f: string) =>
    available.some((a) => a.field === f && a.isDate && !a.displayOnly) &&
    !f.startsWith("match:");

  // Mapa "campo de data por fonte" resolvido: defaults por fonte sobrescritos
  // pelo campo primário (quando unificado) e pela config (só datas válidas).
  const resolveFieldBySource = (
    primary?: string,
    cfg?: Partial<Record<SourceKey, string>>
  ): Partial<Record<SourceKey, string>> => {
    const out: Partial<Record<SourceKey, string>> = {
      ...defaultPeriodFieldBySource(catalog),
    };
    const put = (k: SourceKey, raw: string) => {
      const resolved = resolveUnifiedPeriodField(raw, k, correspondences);
      if (resolved && isPeriodDateField(resolved)) out[k] = resolved;
    };
    if (primary?.startsWith("unified:")) {
      for (const s of catalog) put(s.key, primary);
    }
    for (const [k, v] of Object.entries(cfg ?? {})) {
      if (isKnownSource(k, catalog) && typeof v === "string") put(k, v);
    }
    return out;
  };

  // Escopo e abas (a "aba efetiva" de um widget espelha o dashboard-client).
  const scope: PeriodScope = periodBar?.scope === "tab" ? "tab" : "global";
  const tabs = dashSettings.tabs ?? [];
  const tabIds = new Set(tabs.map((t) => t.id));
  const firstTabId = tabs[0]?.id ?? "";
  const widgetTab = (w: Widget) => {
    const t = w.settings?.tab;
    return t && tabIds.has(t) ? t : firstTabId;
  };
  const widgetBucket = (w: Widget) => (scope === "tab" ? widgetTab(w) : "");

  // Defaults (campo + período) de um bucket quando a URL está vazia:
  // preferência do usuário > config do dashboard > default.
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

  // Resolve o período de um bucket lendo suas próprias chaves de URL.
  function resolvePeriodForBucket(bucket: string): DashboardPeriod | null {
    const { defaultField, periodDefaults } = resolveDefaults(savedFor(bucket));
    const keys = periodKeys(scope, bucket);
    const campoRaw = str(sp[keys.campo]);
    const userPickedField = isPeriodDateField(campoRaw);
    const field = userPickedField ? campoRaw : defaultField;
    const p = resolvePeriodSelection(
      {
        preset: str(sp[keys.preset]),
        de: str(sp[keys.de]),
        ate: str(sp[keys.ate]),
      },
      field,
      periodDefaults
    );
    if (!p) return null;
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

  // Período efetivo por widget: barra global + overrides dos widgets de filtro.
  function computeWidgetPeriods(
    dataWidgets: Widget[],
    filterWidgets: Widget[]
  ): WidgetPeriods {
    const periodByWidget: Record<string, DashboardPeriod | null> = {};
    const periodSourceByWidget: Record<string, "bar" | "filter"> = {};

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
      // O widget de filtro tem campo fixo; mesmo assim aplica o mapa por fonte.
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

    return { periodByWidget, periodSourceByWidget };
  }

  return {
    scope,
    tabs,
    firstTabId,
    isPeriodDateField,
    resolveFieldBySource,
    resolveDefaults,
    savedFor,
    resolvePeriodForBucket,
    widgetTab,
    widgetBucket,
    computeWidgetPeriods,
  };
}
