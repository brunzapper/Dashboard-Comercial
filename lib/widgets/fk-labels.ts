// Versão: 1.1 | Data: 26/07/2026
// v1.1 (26/07/2026): agrupamento de responsáveis (0101) — o rótulo de um
// apelido é o display_name do PRINCIPAL ("nome usado"): canonicaliza antes do
// lookup, com fallback pro próprio nome (grupo intacto quando o principal não
// resolve). Cobre listas, kanban, exports CSV e o SOMASE client-side.
// Rótulos das colunas FK presentes em linhas do modo lista (id→nome):
// responsáveis, operações e leads relacionados. Extraído da page do dashboard
// para ser reusado pela action de paginação (fetchWidgetRecordsPage) — a
// página seguinte pode referenciar ids que o mapa inicial não tem.
import type { SupabaseClient } from "@supabase/supabase-js";

import type { RecordRow } from "@/lib/records/types";
import {
  EMPTY_CANON,
  canonicalOf,
  loadResponsibleCanon,
} from "@/lib/config/responsible-canon";

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
  const canon = respIds.size
    ? await loadResponsibleCanon(supabase)
    : EMPTY_CANON;
  const respLookup = new Set<string>();
  for (const id of respIds) {
    respLookup.add(id);
    respLookup.add(canonicalOf(id, canon));
  }
  const [resp, ops, leads] = await Promise.all([
    respLookup.size
      ? supabase
          .from("responsibles")
          .select("id, display_name")
          .in("id", [...respLookup])
      : Promise.resolve({ data: [] }),
    opIds.size
      ? supabase.from("operations").select("id, name").in("id", [...opIds])
      : Promise.resolve({ data: [] }),
    leadIds.size
      ? supabase.from("records").select("id, title").in("id", [...leadIds])
      : Promise.resolve({ data: [] }),
  ]);
  const respName: Record<string, string> = {};
  for (const r of resp.data ?? [])
    respName[r.id as string] = (r.display_name as string) ?? "—";
  for (const id of respIds) {
    const name = respName[canonicalOf(id, canon)] ?? respName[id];
    if (name != null) fkLabels[id] = name;
  }
  for (const o of ops.data ?? [])
    fkLabels[o.id as string] = (o.name as string) ?? "—";
  for (const l of leads.data ?? [])
    fkLabels[l.id as string] = (l.title as string) ?? "—";
  return fkLabels;
}
