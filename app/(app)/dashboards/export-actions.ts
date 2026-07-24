// Versão: 1.1 | Data: 17/07/2026
// "Exportar registros (CSV)" de um widget: server action que recarrega o
// widget do banco (não confia em config do client) e resolve período/filtros
// de visualização com o loadWidgetScope (lib/widgets/widget-scope.ts —
// compartilhado com a action de paginação do modo lista, para export e página
// enxergarem o MESMO recorte). Depois roda runRecordList (RLS) e devolve
// headers+rows na convenção reimportável (lib/export/record-cells.ts). O
// client baixa via lib/export/csv.ts.
// v1.1 (17/07/2026): miolo de resolução extraído para lib/widgets/widget-scope.
"use server";

import { getSessionInfo } from "@/lib/auth/session";
import { hasAnyRole, type RoleKey } from "@/lib/auth/roles";
import { createClient } from "@/lib/supabase/server";
import type { FieldDefinition, RecordRow } from "@/lib/records/types";
import { fieldAppliesToSource, isKnownSource, toSourceKey, type SourceKey } from "@/lib/sources";
import { loadWidgetScope } from "@/lib/widgets/widget-scope";
import { runRecordList } from "@/lib/widgets/record-list";
import {
  recordCellValue,
  recordRefLabel,
  type RecordLabels,
} from "@/lib/export/record-cells";

const EXPORT_MAX_ROWS = 20000;
const BATCH = 1000;

const CORE_EXPORT_REFS = [
  "title",
  "pipeline",
  "stage",
  "value",
  "mrr",
  "currency",
  "sale_type",
  "channel",
  "closed",
  "closed_at",
  "opened_at",
  "source_created_at",
  "responsible_id",
  "operation_id",
  "related_lead_id",
  "lead_time_days",
] as const;

export type WidgetExportResult =
  | { ok: true; headers: string[]; rows: string[][] }
  | { ok: false; message: string };

export async function exportWidgetRecordsCsv(
  dashboardId: string,
  widgetId: string,
  // window.location.search do cliente — período/aba/filtros são parâmetros de
  // URL, e a action os resolve exatamente como a page (resolver único).
  search: string
): Promise<WidgetExportResult> {
  const session = await getSessionInfo();
  if (!session) return { ok: false, message: "Sessão expirada." };
  const supabase = await createClient();

  const scoped = await loadWidgetScope(
    supabase,
    session,
    dashboardId,
    widgetId,
    search
  );
  if (!scoped.ok) return scoped;
  const { widget, config, period, available, allFields, sources } = scoped.scope;

  const isAdmin = session.roles.includes("admin");
  const roles = session.roles;

  // ---- registros por trás do widget (mesma config da page) ----
  let records: RecordRow[];
  try {
    // `sources` (catálogo) é OBRIGATÓRIO p/ widget de sub-base: sem ele o
    // resolver não reconhece a sub (predicado nunca aplicado e record_type
    // resolvido pela própria key — a consulta voltava vazia).
    records = await runRecordList(supabase, config, period, available, sources);
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
  if (records.length === 0) {
    return { ok: false, message: "Nenhum registro para exportar." };
  }
  if (records.length > EXPORT_MAX_ROWS) {
    return {
      ok: false,
      message: `${records.length} registros excedem o teto de ${EXPORT_MAX_ROWS}. Refine o período/filtros e tente de novo.`,
    };
  }

  // Colunas: core + custom visíveis das fontes do widget (união; applies_to
  // vazio = todas). Multi-fonte ganha a coluna "Base" na frente.
  const widgetSources = ((widget.sources ?? []) as string[]).filter((s) =>
    isKnownSource(s, sources)
  ) as SourceKey[];
  const appliesToWidget = (f: FieldDefinition): boolean =>
    widgetSources.length === 0
      ? true
      : widgetSources.some((s) => fieldAppliesToSource(f.applies_to, s));
  const fields = allFields.filter(
    (f) =>
      f.data_type !== "calculado_agg" &&
      appliesToWidget(f) &&
      (isAdmin || hasAnyRole(roles, f.visible_to_roles as RoleKey[]))
  );

  // Rótulos de FKs presentes no recorte.
  const [{ data: respData }, { data: opsData }] = await Promise.all([
    supabase.from("responsibles").select("id, display_name"),
    supabase.from("operations").select("id, name"),
  ]);
  const leadIds = Array.from(
    new Set(records.map((r) => r.related_lead_id).filter(Boolean) as string[])
  );
  const leadLabels: Record<string, string> = {};
  for (let i = 0; i < leadIds.length; i += BATCH) {
    const { data: leads } = await supabase
      .from("records")
      .select("id, title")
      .in("id", leadIds.slice(i, i + BATCH));
    for (const l of leads ?? []) {
      leadLabels[l.id as string] = (l.title as string) ?? "";
    }
  }
  const labels: RecordLabels = {
    responsibles: Object.fromEntries(
      (respData ?? []).map((r) => [r.id as string, r.display_name as string])
    ),
    operations: Object.fromEntries(
      (opsData ?? []).map((o) => [o.id as string, o.name as string])
    ),
    leads: leadLabels,
  };

  const multiSource = widgetSources.length !== 1;
  const sourceLabelOf = (r: RecordRow): string => {
    const key = toSourceKey(r.record_type);
    return sources.find((s) => s.key === key)?.label ?? r.record_type;
  };

  const headers = [
    ...(multiSource ? ["Base"] : []),
    ...CORE_EXPORT_REFS.map((ref) => recordRefLabel(ref, fields)),
    ...fields.map((f) => f.label),
  ];
  const rows = records.map((r) => [
    ...(multiSource ? [sourceLabelOf(r)] : []),
    ...CORE_EXPORT_REFS.map((ref) =>
      recordCellValue(r, ref, fields, labels, { csv: true })
    ),
    ...fields.map((f) =>
      recordCellValue(r, `custom:${f.field_key}`, fields, labels, { csv: true })
    ),
  ]);

  return { ok: true, headers, rows };
}
