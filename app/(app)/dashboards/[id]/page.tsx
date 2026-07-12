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
import {
  currencyOptionsFrom,
  loadCurrencyRates,
  loadEnabledCurrencies,
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
  resolvePeriodSelection,
  type DashboardPeriod,
  type PeriodSelection,
  type SavedPeriod,
} from "@/lib/widgets/period";
import type {
  DashboardSettings,
  FieldFilterOptions,
  Widget,
  WidgetData,
  WidgetFilter,
} from "@/lib/widgets/types";
import { SOURCE_RECORD_TYPE, type SourceKey } from "@/lib/sources";
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
        "id, field_key, label, data_type, options, visible_to_roles, editable_by_roles, is_local, show_in_builder, formula, currency_code, currency_mode, sort_order, applies_to, source_system, source_field_id, write_back"
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
          } catch {
            entityListById[w.id] = [];
          }
          return;
        }
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

  // Opções do SELECT de responsável editável nas tabelas de registros individuais:
  // só carrega se algum widget-lista expõe a coluna responsible_id como editável.
  let responsibleOptions: { value: string; label: string }[] = [];
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
      .select("id, display_name")
      .eq("active", true)
      .order("display_name");
    responsibleOptions = (respRows ?? []).map((r) => ({
      value: r.id as string,
      label: (r.display_name as string) ?? "—",
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
  // (agregações de registros).
  const calcById: Record<string, number | null> = {};
  const calcWidgets = dataWidgets.filter(isCalcWidget);
  if (calcWidgets.length > 0) {
    await Promise.all(
      calcWidgets.map(async (w) => {
        try {
          calcById[w.id] = await runCalculatedWidget(supabase, {
            formula: w.settings?.formula,
            sources: w.sources ?? [],
            filters: [...(w.filters ?? []), ...(viewFiltersByWidget[w.id] ?? [])],
            period: periodByWidget[w.id],
            correspondencesMap,
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
      entityListById={entityListById}
      calcById={calcById}
      fields={(fieldsData ?? []) as FieldDefinition[]}
      fkLabels={fkLabels}
      responsibleOptions={responsibleOptions}
      userRoles={userRoles}
      canEditValues={canEditValues}
      available={available}
      canEdit={canEdit}
      canManageFields={canManageFields}
      currencyOptions={currencyOptions}
      currencyRates={currencyRates}
      conversionPeriodById={conversionPeriodById}
      settings={dashSettings}
      visibleToRoles={(dash.visible_to_roles ?? []) as string[]}
      dateFormat={dashSettings.dateFormat}
      periodBar={periodBar}
      periodDefaults={periodDefaults}
      periodDefaultField={defaultPeriodField}
      filterOptionsById={filterOptionsById}
    />
  );
}
