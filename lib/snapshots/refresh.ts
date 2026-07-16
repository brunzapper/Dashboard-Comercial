// Versão: 1.0 | Data: 15/07/2026
// Refresh de um snapshot: congela o DATASET (via RPC snapshot_refresh_copy,
// cópia atômica e set-based no banco) e o CONFIG (widgets da aba, settings
// saneado, campos, correspondências, moedas e as opções de filtros — sempre
// restritas às permissões do snapshot). Usado pelo botão "Atualizar agora"
// (server action) e pelo tick agendado (app/api/snapshots/tick).
// SÓ NO SERVIDOR: recebe o client de service role; quem chama é responsável
// por autorizar (dono/admin na action; SYNC_SECRET no tick).
import type { SupabaseClient } from "@supabase/supabase-js";

import type { FieldDefinition } from "@/lib/records/types";
import {
  buildCorrespondenceMap,
  loadCorrespondences,
} from "@/lib/correspondences";
import { buildAvailableFields } from "@/lib/widgets/fields";
import {
  loadCurrencyRates,
  loadEnabledCurrencies,
} from "@/lib/widgets/currency";
import {
  isBucketEntry,
  staticBucketOptions,
  bucketKeyFromRpcValue,
} from "@/lib/widgets/quick-filters";
import { formatBucketLabel } from "@/lib/widgets/date-buckets";
import { CALC_COL_KEY, CALC_ROW_KEY } from "@/lib/widgets/calculator";
import type {
  DashboardSettings,
  FieldFilterOptions,
  Transform,
  Widget,
} from "@/lib/widgets/types";
import { toRecordType, type SourceKey } from "@/lib/sources";

import { snapshotClient } from "./db-adapter";
import { computeNextRefreshAt } from "./schedule";
import {
  SNAPSHOT_LIST_COLS,
  type SelectOption,
  type SnapshotConfig,
  type SnapshotListItem,
} from "./types";

export interface RefreshResult {
  ok: boolean;
  rows?: number;
  error?: string;
}

// Teto de opções por dropdown congelado (mantém o config jsonb pequeno).
const MAX_OPTIONS = 500;

/**
 * Executa o refresh completo de um snapshot. Em erro, grava
 * last_refresh_error e MESMO ASSIM avança next_refresh_at (o tick não pode
 * entrar em hot-loop num snapshot quebrado).
 */
export async function refreshSnapshot(
  service: SupabaseClient,
  snapshotId: string
): Promise<RefreshResult> {
  const { data: snapData, error: snapError } = await service
    .from("snapshots")
    .select(SNAPSHOT_LIST_COLS)
    .eq("id", snapshotId)
    .maybeSingle();
  if (snapError) return { ok: false, error: snapError.message };
  if (!snapData) return { ok: false, error: "Snapshot não encontrado." };
  const snap = snapData as unknown as SnapshotListItem;

  const nextRefreshAt =
    computeNextRefreshAt(
      snap.refresh_mode,
      snap.refresh_time,
      snap.refresh_weekday
    )?.toISOString() ?? null;

  try {
    const { config, rows } = await doRefresh(service, snap);
    const { error: upError } = await service
      .from("snapshots")
      .update({
        config,
        last_refreshed_at: new Date().toISOString(),
        last_refresh_error: null,
        next_refresh_at: nextRefreshAt,
      })
      .eq("id", snapshotId);
    if (upError) return { ok: false, error: upError.message };
    return { ok: true, rows };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[snapshots] refresh ${snapshotId} falhou:`, msg);
    await service
      .from("snapshots")
      .update({ last_refresh_error: msg, next_refresh_at: nextRefreshAt })
      .eq("id", snapshotId);
    return { ok: false, error: msg };
  }
}

async function doRefresh(
  service: SupabaseClient,
  snap: SnapshotListItem
): Promise<{ config: SnapshotConfig; rows: number }> {
  // 1) Insumos vivos (nomes/estrutura) — mesmo select da page do dashboard.
  const [{ data: dashData }, { data: widgetsData }, { data: fieldsData }, correspondences, currencies, currencyRates] =
    await Promise.all([
      service
        .from("dashboards")
        .select("id, name, settings")
        .eq("id", snap.dashboard_id)
        .maybeSingle(),
      service
        .from("widgets")
        .select(
          "id, dashboard_id, title, visual_type, source, sources, split_by_source, dimensions, metrics, filters, settings, grid_position, sort_order"
        )
        .eq("dashboard_id", snap.dashboard_id)
        .order("sort_order", { ascending: true }),
      service
        .from("field_definitions")
        .select(
          "id, field_key, label, data_type, options, visible_to_roles, editable_by_roles, is_local, show_in_builder, formula, allow_negative, currency_code, currency_mode, show_as_percent, sort_order, applies_to, source_system, source_field_id, write_back"
        )
        .eq("show_in_builder", true)
        .order("sort_order", { ascending: true }),
      loadCorrespondences(service),
      loadEnabledCurrencies(service),
      loadCurrencyRates(service),
    ]);
  if (!dashData) throw new Error("Dashboard do snapshot não existe mais.");

  const widgets = (widgetsData ?? []) as Widget[];
  const fields = (fieldsData ?? []) as FieldDefinition[];
  const dashSettings = (dashData.settings ?? {}) as DashboardSettings;
  const available = buildAvailableFields(fields, correspondences);
  const correspondencesMap = buildCorrespondenceMap(correspondences);

  // 2) Aba efetiva e widgets da aba (mesma semântica de widgetTab da page).
  const tabs = dashSettings.tabs ?? [];
  const tabIds = new Set(tabs.map((t) => t.id));
  const firstTabId = tabs[0]?.id ?? "";
  const widgetTab = (w: Widget) => {
    const t = w.settings?.tab;
    return t && tabIds.has(t) ? t : firstTabId;
  };
  const effTab = snap.tab_id && tabIds.has(snap.tab_id) ? snap.tab_id : firstTabId;
  const tabWidgets = widgets.filter((w) => widgetTab(w) === effTab);
  const tabMeta = tabs.find((t) => t.id === effTab);

  // 3) Congela o dataset (delete + insert…select numa transação, no banco).
  const { data: copied, error: copyError } = await service.rpc(
    "snapshot_refresh_copy",
    { p_snapshot_id: snap.id }
  );
  if (copyError) throw new Error(copyError.message);
  const rows = typeof copied === "number" ? copied : 0;

  // 4) Opções de filtros — computadas APÓS a cópia, sobre o dataset congelado
  //    e sempre restritas (nunca vazam nomes/valores além do permitido).
  const db = snapshotClient(service, snap.id);

  const dataWidgets = tabWidgets.filter(
    (w) =>
      w.visual_type !== "filtro" &&
      w.visual_type !== "filtro_campo" &&
      w.visual_type !== "forma"
  );
  const fieldFilterWidgets = tabWidgets.filter(
    (w) => w.visual_type === "filtro_campo"
  );
  const qfWidgets = dataWidgets.filter((w) =>
    (w.settings?.quickFilters ?? []).some((e) => e.field)
  );
  const allEntries = qfWidgets.flatMap((w) => w.settings?.quickFilters ?? []);
  const exposedFilterFields = new Set<string>();
  for (const fw of fieldFilterWidgets)
    for (const f of fw.settings?.fields ?? []) exposedFilterFields.add(f.field);

  const needsResp =
    allEntries.some((e) => e.field === "responsible_id") ||
    exposedFilterFields.has("responsible_id");
  const needsOps =
    allEntries.some((e) => e.field === "operation_id") ||
    exposedFilterFields.has("operation_id");
  const needsStage = exposedFilterFields.has("stage");

  const [respOptions, opsOptions] = await Promise.all([
    needsResp
      ? restrictedEntityOptions(service, "responsibles", snap.allowed_responsible_ids)
      : Promise.resolve([] as SelectOption[]),
    needsOps
      ? restrictedEntityOptions(service, "operations", snap.allowed_operation_ids)
      : Promise.resolve([] as SelectOption[]),
  ]);

  // Buckets de data distintos EXISTENTES no dataset congelado (via RPC do
  // snapshot — mesma expressão das dimensões; espelho da page).
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
  const bucketOptionsByCombo: Record<string, SelectOption[]> = {};
  await Promise.all(
    [...bucketCombos.entries()].map(async ([key, c]) => {
      try {
        const { data, error } = await db.rpc("run_widget_query", {
          p_source: "records",
          p_dimensions: [
            { field: c.field, transform: c.transform, weekMode: c.weekMode },
          ],
          p_metrics: [],
          p_filters: [],
          p_correspondences: correspondencesMap,
        });
        if (error) throw new Error(error.message);
        const rowsData = (Array.isArray(data) ? data : []) as Record<
          string,
          unknown
        >[];
        const seen = new Map<string, { raw: unknown; label: string }>();
        for (const row of rowsData) {
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
          .slice(0, MAX_OPTIONS)
          .map(([value, v]) => ({ value, label: v.label }));
      } catch {
        bucketOptionsByCombo[key] = [];
      }
    })
  );

  const quickFilterOptions: Record<string, Record<string, SelectOption[]>> = {};
  for (const w of qfWidgets) {
    const perEntry: Record<string, SelectOption[]> = {};
    for (const entry of (w.settings?.quickFilters ?? []).filter((e) => e.field)) {
      if (entry.field === "responsible_id") {
        perEntry[entry.id] = respOptions;
      } else if (entry.field === "operation_id") {
        perEntry[entry.id] = opsOptions;
      } else if (isBucketEntry(entry, available)) {
        perEntry[entry.id] =
          staticBucketOptions(entry.transform!) ??
          bucketOptionsByCombo[
            `${entry.field}|${entry.transform}|${entry.weekMode ?? "restricted"}`
          ] ??
          [];
      }
      // Entradas de período (data no formato padrão) não usam opções.
    }
    if (Object.keys(perEntry).length > 0) quickFilterOptions[w.id] = perEntry;
  }

  // Opções dos widgets "Filtro por campo": entidades restritas + etapas
  // distintas do dataset congelado (pares record_type × stage via RPC).
  const fieldFilterOptions: Record<string, FieldFilterOptions> = {};
  if (fieldFilterWidgets.length > 0) {
    const stagesByRt: Record<string, Set<string>> = {};
    if (needsStage) {
      try {
        const { data, error } = await db.rpc("run_widget_query", {
          p_source: "records",
          p_dimensions: [{ field: "record_type" }, { field: "stage" }],
          p_metrics: [],
          p_filters: [],
          p_correspondences: {},
        });
        if (error) throw new Error(error.message);
        for (const row of (Array.isArray(data) ? data : []) as Record<
          string,
          unknown
        >[]) {
          const rt = String(row.dim_1 ?? "");
          const st = row.dim_2 == null ? "" : String(row.dim_2);
          if (!rt || !st) continue;
          (stagesByRt[rt] ??= new Set()).add(st);
        }
      } catch {
        // sem etapas — dropdown fica vazio
      }
    }
    for (const fw of fieldFilterWidgets) {
      const map: FieldFilterOptions = {};
      const fwFields = fw.settings?.fields ?? [];
      const has = (f: string) => fwFields.some((e) => e.field === f);
      if (has("responsible_id")) map.responsible_id = respOptions;
      if (has("operation_id")) map.operation_id = opsOptions;
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
          .slice(0, MAX_OPTIONS)
          .map((s) => ({ value: s, label: s }));
      }
      if (Object.keys(map).length > 0) fieldFilterOptions[fw.id] = map;
    }
  }

  // 5) Células persistidas da aba: expressão da calculadora (__calc__) e
  //    células digitadas das Tabelas Livres (read-only no viewer).
  const calcExprById: Record<string, string> = {};
  const tableCellsById: SnapshotConfig["tableCellsById"] = {};
  const calcIds = new Set(
    tabWidgets.filter((w) => w.visual_type === "calculadora").map((w) => w.id)
  );
  const quickTableIds = new Set(
    tabWidgets.filter((w) => w.visual_type === "tabela_editavel").map((w) => w.id)
  );
  const cellWidgetIds = [...calcIds, ...quickTableIds];
  if (cellWidgetIds.length > 0) {
    const { data: cellsData } = await service
      .from("dashboard_table_cells")
      .select("widget_id, row_key, col_key, value")
      .in("widget_id", cellWidgetIds);
    for (const c of cellsData ?? []) {
      if (
        calcIds.has(c.widget_id) &&
        c.row_key === CALC_ROW_KEY &&
        c.col_key === CALC_COL_KEY
      ) {
        calcExprById[c.widget_id] = String(c.value ?? "");
      }
      if (quickTableIds.has(c.widget_id) && !c.row_key.startsWith("__")) {
        (tableCellsById[c.widget_id] ??= []).push({
          row_key: c.row_key,
          col_key: c.col_key,
          value: c.value,
        });
      }
    }
  }

  // 6) Settings saneado para o viewer: só a aba do snapshot (não vaza nomes
  //    das demais), conectores restritos aos widgets da aba e barra de
  //    período desabilitada (snapshot não tem filtro de período geral).
  const tabWidgetIds = new Set(tabWidgets.map((w) => w.id));
  const connectors = (dashSettings.connectors ?? []).filter((c) => {
    const cTab = c.tab && tabIds.has(c.tab) ? c.tab : firstTabId;
    return (
      cTab === effTab &&
      tabWidgetIds.has(c.from.widgetId) &&
      tabWidgetIds.has(c.to.widgetId)
    );
  });
  const frozenSettings: DashboardSettings = {
    ...dashSettings,
    periodBar: { enabled: false },
    tabs: tabMeta ? [tabMeta] : [],
    connectors,
  };

  const config: SnapshotConfig = {
    dashboard: { name: (dashData.name as string) ?? "", settings: frozenSettings },
    tabName: tabMeta?.name ?? "",
    widgets: tabWidgets,
    fields,
    correspondences,
    currencies,
    currencyRates,
    quickFilterOptions,
    fieldFilterOptions,
    calcExprById,
    tableCellsById,
  };

  return { config, rows };
}

async function restrictedEntityOptions(
  service: SupabaseClient,
  table: "responsibles" | "operations",
  allowed: string[] | null
): Promise<SelectOption[]> {
  // Restrição vazia não deveria existir (as actions normalizam [] → null),
  // mas se aparecer, falha fechado: nenhuma opção.
  if (allowed && allowed.length === 0) return [];
  const labelCol = table === "responsibles" ? "display_name" : "name";
  let q = service
    .from(table)
    .select(`id, ${labelCol}`)
    .eq("active", true)
    .order(labelCol);
  if (allowed) q = q.in("id", allowed);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return ((data ?? []) as unknown as Record<string, string>[])
    .slice(0, MAX_OPTIONS)
    .map((r) => ({ value: r.id, label: r[labelCol] ?? "—" }));
}
