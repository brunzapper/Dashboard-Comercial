// Versão: 1.0 | Data: 17/07/2026
// Rótulos das colunas FK presentes em linhas do modo lista (id→nome):
// responsáveis, operações e leads relacionados. Extraído da page do dashboard
// para ser reusado pela action de paginação (fetchWidgetRecordsPage) — a
// página seguinte pode referenciar ids que o mapa inicial não tem.
import type { SupabaseClient } from "@supabase/supabase-js";

import type { RecordRow } from "@/lib/records/types";

export async function collectRecordFkLabels(
  supabase: SupabaseClient,
  rows: RecordRow[]
): Promise<Record<string, string>> {
  const fkLabels: Record<string, string> = {};
  if (rows.length === 0) return fkLabels;
  const respIds = new Set<string>();
  const opIds = new Set<string>();
  const leadIds = new Set<string>();
  for (const r of rows) {
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
  return fkLabels;
}
