// Versão: 1.0 | Data: 09/07/2026
// Recalcula os campos calculados (Fase 7) de TODOS os registros — usado quando
// uma fórmula é criada/editada. Roda com o service client (bypassa RLS) e em
// lotes. NÃO grava field_modified_at (campos calculados são sempre recomputados,
// nunca "protegidos" contra sync).
import { createServiceClient } from "@/lib/supabase/service";
import { computeFormulaFields, loadFormulaDefs } from "./formulas";

const BATCH = 500;

function numOrNull(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Recomputa os campos calculados de todos os registros. Retorna nº atualizado. */
export async function recalcAllFormulaFields(): Promise<number> {
  const db = createServiceClient();
  const defs = await loadFormulaDefs(db);
  if (defs.length === 0) return 0;

  let from = 0;
  let updated = 0;
  for (;;) {
    const { data } = await db
      .from("records")
      .select("id, value, mrr, lead_time_days, custom_fields")
      .order("id", { ascending: true })
      .range(from, from + BATCH - 1);
    const rows = data ?? [];
    if (rows.length === 0) break;

    for (const r of rows) {
      const custom: Record<string, unknown> = { ...((r.custom_fields as Record<string, unknown>) ?? {}) };
      const calc = computeFormulaFields(
        {
          value: numOrNull(r.value),
          mrr: numOrNull(r.mrr),
          lead_time_days: numOrNull(r.lead_time_days),
        },
        custom,
        defs
      );
      let changed = false;
      for (const [k, v] of Object.entries(calc)) {
        if (String(custom[k] ?? "") !== String(v ?? "")) {
          custom[k] = v;
          changed = true;
        }
      }
      if (changed) {
        await db.from("records").update({ custom_fields: custom }).eq("id", r.id as string);
        updated += 1;
      }
    }

    if (rows.length < BATCH) break;
    from += BATCH;
  }
  return updated;
}
