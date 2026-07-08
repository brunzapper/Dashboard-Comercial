// Versão: 1.0 | Data: 05/07/2026
// Página de um dashboard: computa os dados de cada widget (server, via RLS) e
// entrega ao shell client (grid + charts). Fase 6A.
import { notFound } from "next/navigation";

import { getSessionInfo } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import type { FieldDefinition } from "@/lib/records/types";
import { buildAvailableFields } from "@/lib/widgets/fields";
import { runWidget } from "@/lib/widgets/engine";
import type { Widget, WidgetData } from "@/lib/widgets/types";
import { DashboardClient } from "@/components/dashboards/dashboard-client";

export default async function DashboardPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await getSessionInfo();
  const supabase = await createClient();

  const { data: dash } = await supabase
    .from("dashboards")
    .select("id, name, owner_user_id")
    .eq("id", id)
    .maybeSingle();
  if (!dash) notFound();

  const isOwner = dash.owner_user_id === session?.user.id;
  const isAdmin = session?.roles.includes("admin") ?? false;
  const canEdit = isOwner || isAdmin;

  const [{ data: widgetsData }, { data: fieldsData }] = await Promise.all([
    supabase
      .from("widgets")
      .select(
        "id, dashboard_id, title, visual_type, source, dimensions, metrics, filters, grid_position, sort_order"
      )
      .eq("dashboard_id", id)
      .order("sort_order", { ascending: true }),
    supabase
      .from("field_definitions")
      .select(
        "id, field_key, label, data_type, options, visible_to_roles, editable_by_roles, is_local, sort_order"
      )
      .order("sort_order", { ascending: true }),
  ]);

  const widgets = (widgetsData ?? []) as Widget[];
  const available = buildAvailableFields((fieldsData ?? []) as FieldDefinition[]);

  const dataById: Record<string, WidgetData> = {};
  await Promise.all(
    widgets.map(async (w) => {
      try {
        dataById[w.id] = await runWidget(
          supabase,
          {
            source: "records",
            dimensions: w.dimensions ?? [],
            metrics: w.metrics ?? [],
            filters: w.filters ?? [],
            visual_type: w.visual_type,
          },
          available
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
    />
  );
}
