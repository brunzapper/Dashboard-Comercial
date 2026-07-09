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
import type { FieldDefinition } from "@/lib/records/types";
import { buildAvailableFields } from "@/lib/widgets/fields";
import { runWidget } from "@/lib/widgets/engine";
import {
  buildCorrespondenceMap,
  loadCorrespondences,
} from "@/lib/correspondences";
import {
  DEFAULT_PERIOD_FIELD,
  resolvePeriodSelection,
  type DashboardPeriod,
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

  const [{ data: widgetsData }, { data: fieldsData }, correspondences] =
    await Promise.all([
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
    ]);

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

  // 1) Período da barra global (só se a barra estiver visível).
  let globalPeriod: DashboardPeriod | null = null;
  if (periodBar?.enabled !== false) {
    const campoRaw = str(sp.campo);
    const field = isDateField(campoRaw)
      ? campoRaw
      : periodBar?.field && isDateField(periodBar.field)
        ? periodBar.field
        : DEFAULT_PERIOD_FIELD;
    globalPeriod = resolvePeriodSelection(
      { preset: str(sp.periodo), de: str(sp.de), ate: str(sp.ate) },
      field,
      { preset: periodBar?.defaultPreset ?? "" }
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

  // 3) Computa cada widget de dados. Filtros não geram dados.
  const dataById: Record<string, WidgetData> = {};
  await Promise.all(
    dataWidgets.map(async (w) => {
      try {
        dataById[w.id] = await runWidget(
          supabase,
          {
            source: "records",
            sources: w.sources ?? [],
            splitBySource: w.split_by_source ?? false,
            dimensions: w.dimensions ?? [],
            metrics: w.metrics ?? [],
            filters: w.filters ?? [],
            visual_type: w.visual_type,
            settings: w.settings,
          },
          available,
          periodByWidget[w.id],
          correspondencesMap
        );
      } catch {
        dataById[w.id] = { rows: [], dimensions: [], metrics: [] };
      }
    })
  );

  return (
    <DashboardClient
      dashboardId={dash.id as string}
      dashboardName={dash.name as string}
      widgets={widgets}
      dataById={dataById}
      available={available}
      canEdit={canEdit}
      periodBar={periodBar}
    />
  );
}
