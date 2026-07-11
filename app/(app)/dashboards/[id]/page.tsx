// Versão: 2.0 | Data: 09/07/2026
// Página de um dashboard: computa os dados de cada widget (server, via RLS) e
// entrega ao shell client (grid + charts). Fase 6A.
// v2.0 (09/07/2026): período resolvido POR widget. Uma barra global
// (?periodo/de/ate/campo + dashboards.settings.periodBar) atinge os widgets não
// cobertos; cada widget de filtro (visual_type 'filtro') controla seus alvos
// (?pf_<id>/pfd_<id>/pfa_<id>) e tem prioridade sobre a barra global.
import { notFound } from "next/navigation";

import { getSessionInfo } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import type { FieldDefinition, RecordRow } from "@/lib/records/types";
import { buildAvailableFields } from "@/lib/widgets/fields";
import { runWidget } from "@/lib/widgets/engine";
import { runRecordList } from "@/lib/widgets/record-list";
import { loadMatrixCells } from "@/lib/widgets/matrix";
import {
  runCalculatedWidget,
  type MatrixWidgetInfo,
} from "@/lib/widgets/formula-metric";
import {
  buildCorrespondenceMap,
  loadCorrespondences,
} from "@/lib/correspondences";
import {
  DEFAULT_PERIOD_FIELD,
  resolvePeriodSelection,
  type DashboardPeriod,
  type PeriodSelection,
  type SavedPeriod,
} from "@/lib/widgets/period";
import type {
  DashboardSettings,
  Widget,
  WidgetData,
  WidgetFilter,
} from "@/lib/widgets/types";
import { parseViewFilter, viewStateToFilters } from "@/lib/widgets/view-filters";
import { DashboardClient } from "@/components/dashboards/dashboard-client";

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
    .select("id, name, owner_user_id, settings")
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
        "id, field_key, label, data_type, options, visible_to_roles, editable_by_roles, is_local, show_in_builder, formula, sort_order, applies_to"
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
  ]);

  // Último período consultado pelo usuário neste dashboard (se houver).
  const savedPeriod =
    ((prefData?.settings as { lastPeriod?: SavedPeriod } | null)?.lastPeriod ??
      {}) as SavedPeriod;

  const widgets = (widgetsData ?? []) as Widget[];
  const available = buildAvailableFields(
    (fieldsData ?? []) as FieldDefinition[],
    correspondences
  );
  const correspondencesMap = buildCorrespondenceMap(correspondences);
  const dashSettings = (dash.settings ?? {}) as DashboardSettings;
  const periodBar = dashSettings.periodBar;

  const isDateField = (f: string) =>
    available.some((a) => a.field === f && a.isDate);

  // Widgets de dados (excluem os controles: filtro de período e filtro por campo).
  const dataWidgets = widgets.filter(
    (w) => w.visual_type !== "filtro" && w.visual_type !== "filtro_campo"
  );
  const filterWidgets = widgets.filter((w) => w.visual_type === "filtro");
  const fieldFilterWidgets = widgets.filter(
    (w) => w.visual_type === "filtro_campo"
  );

  // Campo de data padrão quando a URL não traz `campo`: preferência do usuário
  // (último consultado) > config do dashboard > default.
  const defaultPeriodField =
    savedPeriod.campo && isDateField(savedPeriod.campo)
      ? savedPeriod.campo
      : periodBar?.field && isDateField(periodBar.field)
        ? periodBar.field
        : DEFAULT_PERIOD_FIELD;

  // Defaults do período quando a URL está vazia: usa o último período salvo do
  // usuário se houver; senão o preset padrão do dashboard.
  const savedHasContent = Boolean(
    savedPeriod.periodo || savedPeriod.de || savedPeriod.ate
  );
  const periodDefaults: PeriodSelection = savedHasContent
    ? {
        preset: savedPeriod.periodo ?? "",
        de: savedPeriod.de ?? "",
        ate: savedPeriod.ate ?? "",
      }
    : { preset: periodBar?.defaultPreset ?? "" };

  // 1) Período da barra global (só se a barra estiver visível).
  let globalPeriod: DashboardPeriod | null = null;
  if (periodBar?.enabled !== false) {
    const campoRaw = str(sp.campo);
    const field = isDateField(campoRaw) ? campoRaw : defaultPeriodField;
    globalPeriod = resolvePeriodSelection(
      { preset: str(sp.periodo), de: str(sp.de), ate: str(sp.ate) },
      field,
      periodDefaults
    );
  }

  // 2) Precedência: cada widget começa com o período global; um widget de
  //    filtro sobrescreve o período dos seus alvos (ou de todos, se sem alvos).
  const periodByWidget: Record<string, DashboardPeriod | null> = {};
  for (const w of dataWidgets) periodByWidget[w.id] = globalPeriod;

  for (const fw of filterWidgets) {
    const s = fw.settings ?? {};
    const field = s.field && isDateField(s.field) ? s.field : DEFAULT_PERIOD_FIELD;
    const p = resolvePeriodSelection(
      {
        preset: str(sp[`pf_${fw.id}`]),
        de: str(sp[`pfd_${fw.id}`]),
        ate: str(sp[`pfa_${fw.id}`]),
      },
      field,
      { preset: s.defaultPreset ?? "" }
    );
    const targets =
      s.targets && s.targets.length > 0
        ? s.targets
        : dataWidgets.map((w) => w.id);
    for (const t of targets) {
      if (t in periodByWidget) periodByWidget[t] = p;
    }
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
  // Widget "Tabela editável" (Fase 2): dados vêm de dashboard_table_cells.
  const isMatrixWidget = (w: Widget) => w.visual_type === "tabela_editavel";
  // Widget "Métrica calculada" (Fase 3): valor vem da fórmula (contexto do dash).
  const isCalcWidget = (w: Widget) => w.visual_type === "calculado";

  // 3) Computa cada widget de dados. Filtros, tabela editável e calculado não
  //    passam pelo engine de agregação padrão.
  const dataById: Record<string, WidgetData> = {};
  const recordListById: Record<string, RecordRow[]> = {};
  await Promise.all(
    dataWidgets.map(async (w) => {
      if (isMatrixWidget(w) || isCalcWidget(w)) return; // computados abaixo
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
      if (isListWidget(w)) {
        try {
          recordListById[w.id] = await runRecordList(
            supabase,
            config,
            periodByWidget[w.id]
          );
        } catch {
          recordListById[w.id] = [];
        }
        return;
      }
      try {
        dataById[w.id] = await runWidget(
          supabase,
          config,
          available,
          periodByWidget[w.id],
          correspondencesMap
        );
      } catch {
        dataById[w.id] = { rows: [], dimensions: [], metrics: [] };
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

  // Valores das células dos widgets "Tabela editável".
  const matrixWidgetIds = dataWidgets.filter(isMatrixWidget).map((w) => w.id);
  const matrixCellsById = await loadMatrixCells(supabase, matrixWidgetIds);

  // Métricas calculadas: resolve a fórmula com o contexto do dashboard (tabelas
  // editáveis + agregações de registros).
  const calcById: Record<string, number | null> = {};
  const calcWidgets = dataWidgets.filter(isCalcWidget);
  if (calcWidgets.length > 0) {
    const matrices: Record<string, MatrixWidgetInfo> = {};
    for (const w of widgets) {
      if (w.visual_type !== "tabela_editavel" || !w.settings?.matrix) continue;
      matrices[w.id] = {
        rows: w.settings.matrix.rows,
        cols: w.settings.matrix.cols,
        cells: matrixCellsById[w.id] ?? {},
      };
    }
    await Promise.all(
      calcWidgets.map(async (w) => {
        try {
          calcById[w.id] = await runCalculatedWidget(supabase, {
            formula: w.settings?.formula,
            sources: w.sources ?? [],
            filters: [...(w.filters ?? []), ...(viewFiltersByWidget[w.id] ?? [])],
            period: periodByWidget[w.id],
            correspondencesMap,
            matrices,
          });
        } catch {
          calcById[w.id] = null;
        }
      })
    );
  }

  return (
    <DashboardClient
      dashboardId={dash.id as string}
      dashboardName={dash.name as string}
      widgets={widgets}
      dataById={dataById}
      recordListById={recordListById}
      matrixCellsById={matrixCellsById}
      calcById={calcById}
      fields={(fieldsData ?? []) as FieldDefinition[]}
      fkLabels={fkLabels}
      userRoles={userRoles}
      canEditValues={canEditValues}
      available={available}
      canEdit={canEdit}
      canManageFields={canManageFields}
      settings={dashSettings}
      periodBar={periodBar}
      periodDefaults={periodDefaults}
      periodDefaultField={defaultPeriodField}
    />
  );
}
