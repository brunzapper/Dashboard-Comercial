// Versão: 1.0 | Data: 31/07/2026
// Loader dos NOMES p/ o export de filtros de relação (export.ts segue puro):
// varre os filtros dos widgets, coleta os UUIDs de responsible_id/operation_id
// (por elemento em arrays) e resolve os rótulos via fetchFkLabels — canon-aware
// (0101): o id de um apelido sai com o display_name do PRINCIPAL, então o
// round-trip export→import→engine reconverge no MESMO grupo canônico. Ids
// desconhecidos (linha excluída) ficam fora do mapa e o export os mantém crus.
import type { SupabaseClient } from "@supabase/supabase-js";

import { fetchFkLabels, isFkUuid } from "@/lib/widgets/engine";
import type { WidgetFilter } from "@/lib/widgets/types";
import type { ExportFkNames } from "./export";

export async function loadExportFkNames(
  supabase: SupabaseClient,
  widgets: { filters?: WidgetFilter[] | null }[]
): Promise<ExportFkNames> {
  const respIds = new Set<string>();
  const opIds = new Set<string>();
  for (const w of widgets) {
    for (const f of w.filters ?? []) {
      const bucket =
        f.field === "responsible_id"
          ? respIds
          : f.field === "operation_id"
            ? opIds
            : null;
      if (!bucket) continue;
      for (const v of Array.isArray(f.value) ? f.value : [f.value]) {
        if (typeof v === "string" && isFkUuid(v.trim())) bucket.add(v.trim());
      }
    }
  }
  const [responsible, operation] = await Promise.all([
    fetchFkLabels(supabase, "responsible", [...respIds]),
    fetchFkLabels(supabase, "operation", [...opIds]),
  ]);
  return { responsible, operation };
}
