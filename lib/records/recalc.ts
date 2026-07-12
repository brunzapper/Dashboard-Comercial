// Versão: 1.1 | Data: 12/07/2026
// Recalcula os campos calculados (Fase 7) de TODOS os registros — usado quando
// uma fórmula é criada/editada OU quando as taxas de câmbio mudam. Roda com o
// service client (bypassa RLS) e em lotes. NÃO grava field_modified_at (campos
// calculados são sempre recomputados, nunca "protegidos" contra sync).
// v1.1 (12/07/2026): campos calculados monetários convertem os operandos p/ a
//   moeda de destino (do registro ou fixa) usando as taxas por ano/trimestre.
import { createServiceClient } from "@/lib/supabase/service";
import {
  anyMoneyDef,
  buildRecordCurrencyContext,
  computeFormulaFields,
  loadCurrencyMaterials,
  loadFormulaDefs,
  type CurrencyMaterials,
} from "./formulas";

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

  // Só carrega o aparato de câmbio se algum calc-field for monetário.
  const needsCurrency = anyMoneyDef(defs);
  const materials: CurrencyMaterials = needsCurrency
    ? await loadCurrencyMaterials(db)
    : { rates: {}, moedaCurrency: {} };

  let from = 0;
  let updated = 0;
  for (;;) {
    const { data } = await db
      .from("records")
      .select(
        "id, value, mrr, lead_time_days, custom_fields, currency, closed_at, opened_at, source_created_at"
      )
      .order("id", { ascending: true })
      .range(from, from + BATCH - 1);
    const rows = data ?? [];
    if (rows.length === 0) break;

    for (const r of rows) {
      const custom: Record<string, unknown> = { ...((r.custom_fields as Record<string, unknown>) ?? {}) };
      const conv = needsCurrency
        ? buildRecordCurrencyContext(
            {
              currency: r.currency as string | null,
              closed_at: r.closed_at as string | null,
              opened_at: r.opened_at as string | null,
              source_created_at: r.source_created_at as string | null,
            },
            materials
          )
        : undefined;
      const calc = computeFormulaFields(
        {
          value: numOrNull(r.value),
          mrr: numOrNull(r.mrr),
          lead_time_days: numOrNull(r.lead_time_days),
        },
        custom,
        defs,
        conv
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
