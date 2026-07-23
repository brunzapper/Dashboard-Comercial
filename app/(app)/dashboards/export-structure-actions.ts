// Versão: 1.0 | Data: 23/07/2026
// Server action do "Exportar JSON" (estrutura do dashboard → formato
// "dashboard-import"). NÃO confundir com export-actions.ts (CSV de REGISTROS).
// Leitura pura via client do usuário (RLS decide quem enxerga o board); o
// exporter (lib/import/dashboard/export.ts) faz a serialização. `issues` são
// os erros que o VALIDADOR apontaria no round-trip (ex.: widget referenciando
// campo excluído) — aviso, não bloqueio: o export continua fiel ao estado.
"use server";

import { getSessionInfo } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { loadSources } from "@/lib/config/sources";
import { slugify } from "@/lib/records/slug";
import {
  exportDashboardJson,
  type ExportDashRow,
  type ExportWidgetRow,
} from "@/lib/import/dashboard/export";
import { loadImportContext } from "@/lib/import/dashboard/context";
import { validateDashboardImport } from "@/lib/import/dashboard/validate";

export interface ExportStructureResult {
  ok?: boolean;
  message?: string;
  json?: string; // pretty (2 espaços)
  filename?: string;
  chave?: string;
  issues?: string[]; // erros de round-trip (não bloqueiam o download)
}

const WIDGET_COLS =
  "id, title, visual_type, sources, split_by_source, dimensions, metrics, filters, settings, grid_position, sort_order";

export async function exportDashboardStructure(
  dashboardId: string
): Promise<ExportStructureResult> {
  const session = await getSessionInfo();
  if (!session) return { ok: false, message: "Sessão expirada." };
  if (!dashboardId) return { ok: false, message: "Board inválido." };

  const supabase = await createClient();
  const { data: dash } = await supabase
    .from("dashboards")
    .select("id, name, visible_to_roles, settings, kind, status")
    .eq("id", dashboardId)
    .maybeSingle();
  if (!dash) return { ok: false, message: "Board não encontrado." };
  if ((dash.kind as string) === "kanban") {
    return { ok: false, message: "Exportação de estrutura é só para dashboards." };
  }
  if ((dash.status as string) === "trashed") {
    return { ok: false, message: "Restaure o board antes de exportar." };
  }

  const [{ data: widgetsData }, sources] = await Promise.all([
    supabase
      .from("widgets")
      .select(WIDGET_COLS)
      .eq("dashboard_id", dashboardId)
      .order("sort_order", { ascending: true }),
    loadSources(supabase),
  ]);

  const result = exportDashboardJson({
    dash: dash as unknown as ExportDashRow,
    widgets: (widgetsData ?? []) as unknown as ExportWidgetRow[],
    sources,
  });

  // Round-trip check (aviso): o que o validador rejeitaria neste JSON hoje —
  // tipicamente refs para campos/bases excluídos que o board ainda carrega.
  let issues: string[] | undefined;
  try {
    const ctx = await loadImportContext(supabase);
    const validation = validateDashboardImport(
      JSON.stringify(result.json),
      ctx
    );
    if (!validation.ok) issues = validation.errors;
  } catch {
    // Check é best-effort; o export em si não depende dele.
  }

  return {
    ok: true,
    json: JSON.stringify(result.json, null, 2),
    filename: `dashboard-${slugify(String(dash.name ?? "board")) || "board"}.json`,
    chave: result.chave,
    issues,
  };
}
