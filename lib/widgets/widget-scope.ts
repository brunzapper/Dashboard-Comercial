// Versão: 1.0 | Data: 17/07/2026
// Reconstrói, no servidor, o ESCOPO efetivo de um widget de dashboard a partir
// do banco + URL (não confia em config vinda do client): widget/campos/fontes,
// período efetivo (resolver único da page, lib/widgets/period-resolve.ts) e os
// filtros de visualização espelhados da page ([id]/page.tsx): filtros rápidos
// do card, barra embutida da tabela (?tf_<id>) e widgets "Filtro por campo"
// (?ff_<id>). Extraído de app/(app)/dashboards/export-actions.ts para ser
// compartilhado com a action de paginação do modo lista
// (fetchWidgetRecordsPage) — os dois DEVEM enxergar o mesmo recorte.
import type { SupabaseClient } from "@supabase/supabase-js";

import type { SessionInfo } from "@/lib/auth/session";
import type { FieldDefinition } from "@/lib/records/types";
import { loadSources } from "@/lib/config/sources";
import { isKnownSource, type SourceKey } from "@/lib/sources";
import type { SourceDef } from "@/lib/sources";
import { buildAvailableFields, type AvailableField } from "@/lib/widgets/fields";
import { loadCorrespondences } from "@/lib/correspondences";
import {
  createPeriodResolver,
  type PeriodPrefs,
} from "@/lib/widgets/period-resolve";
import {
  applyPeriodToFilters,
  resolvePeriodSelection,
  type DashboardPeriod,
} from "@/lib/widgets/period";
import {
  QF_ROW_KEY,
  hasQuickValue,
  isPeriodEntry,
  parseQuickFilterValue,
  quickOptionsFilter,
  type QuickFilterValue,
} from "@/lib/widgets/quick-filters";
import { parseViewFilter, viewStateToFilters } from "@/lib/widgets/view-filters";
import type {
  DashboardSettings,
  Widget,
  WidgetConfig,
  WidgetFilter,
} from "@/lib/widgets/types";

const FIELD_DEF_COLS =
  "id, field_key, label, data_type, options, visible_to_roles, editable_by_roles, is_local, show_in_builder, formula, allow_negative, currency_code, currency_mode, show_as_percent, sort_order, applies_to, source_system, source_field_id, write_back";

export interface WidgetScope {
  widget: Widget;
  config: WidgetConfig;
  period: DashboardPeriod | null;
  available: AvailableField[];
  allFields: FieldDefinition[];
  sources: SourceDef[];
}

export type WidgetScopeResult =
  | { ok: true; scope: WidgetScope }
  | { ok: false; message: string };

export async function loadWidgetScope(
  supabase: SupabaseClient,
  session: SessionInfo,
  dashboardId: string,
  widgetId: string,
  // window.location.search do cliente — período/aba/filtros são parâmetros de
  // URL, e o escopo os resolve exatamente como a page (resolver único).
  search: string
): Promise<WidgetScopeResult> {
  const sp: Record<string, string | string[] | undefined> = {};
  for (const [k, v] of new URLSearchParams(search ?? "")) {
    const cur = sp[k];
    sp[k] = cur === undefined ? v : Array.isArray(cur) ? [...cur, v] : [cur, v];
  }
  const str = (v: string | string[] | undefined): string =>
    Array.isArray(v) ? (v[0] ?? "") : (v ?? "");

  const [
    { data: dash },
    { data: widgetsData },
    { data: fieldsData },
    correspondences,
    { data: prefData },
    sources,
  ] = await Promise.all([
    supabase
      .from("dashboards")
      .select("id, settings")
      .eq("id", dashboardId)
      .maybeSingle(),
    supabase
      .from("widgets")
      .select(
        "id, dashboard_id, title, visual_type, source, sources, split_by_source, dimensions, metrics, filters, settings, grid_position, sort_order"
      )
      .eq("dashboard_id", dashboardId),
    supabase
      .from("field_definitions")
      .select(FIELD_DEF_COLS)
      .eq("show_in_builder", true)
      .order("sort_order", { ascending: true }),
    loadCorrespondences(supabase),
    supabase
      .from("user_preferences")
      .select("settings")
      .eq("user_id", session.user.id)
      .eq("dashboard_id", dashboardId)
      .maybeSingle(),
    loadSources(supabase),
  ]);
  if (!dash) return { ok: false, message: "Dashboard não encontrado." };

  const widgets = (widgetsData ?? []) as Widget[];
  const widget = widgets.find((w) => w.id === widgetId);
  if (!widget) return { ok: false, message: "Widget não encontrado." };

  const allFields = (fieldsData ?? []) as FieldDefinition[];
  const available = buildAvailableFields(allFields, correspondences, sources);

  // ---- período efetivo do widget (resolver único da page) ----
  const dashSettings = (dash.settings ?? {}) as DashboardSettings;
  const prefSettings = (prefData?.settings ?? {}) as PeriodPrefs;
  const resolver = createPeriodResolver({
    sp,
    available,
    correspondences,
    dashSettings,
    prefSettings,
    sources,
  });
  const dataWidgets = widgets.filter(
    (w) =>
      w.visual_type !== "filtro" &&
      w.visual_type !== "filtro_campo" &&
      w.visual_type !== "forma"
  );
  const filterWidgets = widgets.filter((w) => w.visual_type === "filtro");
  const fieldFilterWidgets = widgets.filter(
    (w) => w.visual_type === "filtro_campo"
  );
  const { periodByWidget } = resolver.computeWidgetPeriods(
    dataWidgets,
    filterWidgets
  );
  let period = periodByWidget[widgetId] ?? null;

  // ---- filtros de visualização (espelho do bloco da page) ----
  const viewFilters: WidgetFilter[] = [];

  // Filtros rápidos do card (valores persistidos em dashboard_table_cells).
  const qfEntries = (widget.settings?.quickFilters ?? []).filter((e) => e.field);
  if (qfEntries.length > 0) {
    const { data: qfCells } = await supabase
      .from("dashboard_table_cells")
      .select("col_key, value")
      .eq("widget_id", widget.id)
      .eq("row_key", QF_ROW_KEY);
    const qfValues = new Map<string, QuickFilterValue>();
    for (const c of qfCells ?? []) {
      const v = parseQuickFilterValue(c.value);
      if (v) qfValues.set(c.col_key as string, v);
    }

    // Exceção do vendedor (mesma da page): seleção de responsáveis que exclui
    // os dele vira os dele.
    const canViewAll = session.permissions.includes("view_all_records");
    let ownResponsibleIds: string[] = [];
    if (!canViewAll && qfEntries.some((e) => e.field === "responsible_id")) {
      const { data: ownResp } = await supabase
        .from("responsibles")
        .select("id")
        .eq("user_id", session.user.id);
      ownResponsibleIds = (ownResp ?? []).map((r) => r.id as string);
    }

    for (const entry of qfEntries) {
      const stored = qfValues.get(entry.id) ?? null;
      if (isPeriodEntry(entry, available)) {
        const val = stored?.kind === "period" ? stored : null;
        if (val && hasQuickValue(val)) {
          if (period && period.field === entry.field) period = null;
          const p = resolvePeriodSelection(
            { preset: val.preset ?? "", de: val.de ?? "", ate: val.ate ?? "" },
            entry.field
          );
          if (p) {
            const pMap = entry.field.startsWith("unified:")
              ? { ...p, fieldBySource: resolver.resolveFieldBySource(entry.field) }
              : p;
            const applied = applyPeriodToFilters(
              viewFilters.splice(0),
              pMap,
              (widget.sources ?? []) as SourceKey[]
            );
            viewFilters.push(...applied);
          }
        }
        continue;
      }
      let vals = stored?.kind === "options" ? stored.values : [];
      if (
        entry.field === "responsible_id" &&
        vals.length > 0 &&
        ownResponsibleIds.length > 0 &&
        !vals.some((v) => ownResponsibleIds.includes(v))
      ) {
        vals = ownResponsibleIds;
      }
      if (vals.length > 0) {
        viewFilters.push(...quickOptionsFilter(entry, vals, available));
      }
    }
  }

  // Barra embutida da tabela (?tf_<id>) — só existe em widgets de Tabela.
  // O `q` entra SEMPRE aqui (mesmo nos widgets de busca client-side): o export
  // e a paginação devem refletir o que o usuário vê filtrado.
  if (widget.visual_type === "tabela") {
    const raw = str(sp[`tf_${widget.id}`]);
    if (raw) {
      viewFilters.push(
        ...viewStateToFilters(parseViewFilter(raw), widget.settings?.searchFields)
      );
    }
  }

  // Widgets "Filtro por campo" (?ff_<id>) que atingem este widget.
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
    if (excluded.has(widget.id)) continue;
    const fwSources = (fw.sources ?? []) as string[];
    const isUnifiedFilter = (f: WidgetFilter) =>
      f.field.split("|").some((p) => p.startsWith("unified:"));
    const unified = fs.some(isUnifiedFilter);
    if (
      !unified &&
      !sourcesOverlap(fwSources, (widget.sources ?? []) as string[])
    )
      continue;
    const fwSourceKeys = fwSources.filter((s) =>
      isKnownSource(s, sources)
    ) as SourceKey[];
    const targeted =
      fwSourceKeys.length > 0
        ? fs.map((f) => (isUnifiedFilter(f) ? f : { ...f, sources: fwSourceKeys }))
        : fs;
    viewFilters.push(...targeted);
  }

  // ---- config final (mesma da page) ----
  const config = {
    source: "records" as const,
    sources: widget.sources ?? [],
    splitBySource: widget.split_by_source ?? false,
    dimensions: widget.dimensions ?? [],
    metrics: widget.metrics ?? [],
    filters: [...(widget.filters ?? []), ...viewFilters],
    visual_type: widget.visual_type,
    settings: widget.settings,
  } as unknown as WidgetConfig;

  return {
    ok: true,
    scope: { widget, config, period, available, allFields, sources },
  };
}
