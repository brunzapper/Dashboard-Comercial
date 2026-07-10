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
} from "@/lib/widgets/types";
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

  const dataWidgets = widgets.filter((w) => w.visual_type !== "filtro");
  const filterWidgets = widgets.filter((w) => w.visual_type === "filtro");

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

  // Widget de Tabela em modo "registros individuais" (Fase 1): lista 1 linha por
  // registro em vez de agregar.
  const isListWidget = (w: Widget) =>
    w.visual_type === "tabela" && w.settings?.rowMode === "records";

  // 3) Computa cada widget de dados. Filtros não geram dados.
  const dataById: Record<string, WidgetData> = {};
  const recordListById: Record<string, RecordRow[]> = {};
  await Promise.all(
    dataWidgets.map(async (w) => {
      const config = {
        source: "records" as const,
        sources: w.sources ?? [],
        splitBySource: w.split_by_source ?? false,
        dimensions: w.dimensions ?? [],
        metrics: w.metrics ?? [],
        filters: w.filters ?? [],
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

  return (
    <DashboardClient
      dashboardId={dash.id as string}
      dashboardName={dash.name as string}
      widgets={widgets}
      dataById={dataById}
      recordListById={recordListById}
      fields={(fieldsData ?? []) as FieldDefinition[]}
      fkLabels={fkLabels}
      userRoles={userRoles}
      canEditValues={canEditValues}
      available={available}
      canEdit={canEdit}
      canManageFields={canManageFields}
      periodBar={periodBar}
      periodDefaults={periodDefaults}
      periodDefaultField={defaultPeriodField}
    />
  );
}
