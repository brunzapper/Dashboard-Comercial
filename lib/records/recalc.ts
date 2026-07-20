// Versão: 2.1 | Data: 20/07/2026
// v2.1 (20/07/2026): montagem de contexto extraída p/ record-eval-context.ts
//   (buildRecordEvalInputs/loadRecordEvalMaterials) — compartilhada com a
//   prévia do FormulaEditor; materialização byte-idêntica à anterior.
// Recalcula os campos calculados de TODOS os registros — usado quando uma fórmula
// é criada/editada, quando as taxas de câmbio mudam OU após o auto-match (para
// campos com match:<fonte> e o lead time). Roda com o service client (bypassa
// RLS) e em lotes. NÃO grava field_modified_at (campos calculados são sempre
// recomputados, nunca "protegidos" contra sync).
// v1.1 (12/07/2026): calc-fields monetários convertem operandos p/ a moeda de
//   destino usando as taxas por ano/trimestre.
// v2.0 (12/07/2026): Fase 3 — injeta contexto de DATAS (próprias + custom + do
//   registro casado) para fórmulas de aritmética de datas, e recalcula
//   lead_time_days a partir do match resolvido (base consistente por fonte).
import { createServiceClient } from "@/lib/supabase/service";
import { leadTimeDays } from "@/lib/sync/shared";
import { resolveMatchedRecords } from "@/lib/records/matching-engine";
import { computeFormulaFields, loadFormulaDefs } from "./formulas";
import {
  buildRecordEvalInputs,
  loadRecordEvalMaterials,
  RECORD_EVAL_COLUMNS,
  type RecordEvalRow,
} from "./record-eval-context";

const BATCH = 500;

function numOrNull(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Recomputa os campos calculados de todos os registros e o lead_time_days a
 * partir do match resolvido. Retorna nº de registros atualizados.
 */
export async function recalcAllFormulaFields(): Promise<number> {
  const db = createServiceClient();
  const defs = await loadFormulaDefs(db);

  // Insumos globais (refs match:, chaves de data custom, relações por nome,
  // câmbio) — módulo COMPARTILHADO com a prévia do FormulaEditor
  // (lib/records/record-eval-context.ts): prévia e materialização idênticas.
  const materials = await loadRecordEvalMaterials(db, defs);

  let from = 0;
  let updated = 0;
  // Updates do lote acumulados e aplicados num único UPDATE set-based via
  // recalc_apply_updates (0070) — antes era 1 round trip por linha alterada.
  type BatchUpdate = {
    id: string;
    custom_fields: Record<string, unknown> | null;
    set_lead_time: boolean;
    lead_time_days: number | null;
  };
  for (;;) {
    const { data } = await db
      .from("records")
      .select(RECORD_EVAL_COLUMNS)
      .order("id", { ascending: true })
      .range(from, from + BATCH - 1);
    const rows = (data ?? []) as RecordEvalRow[];
    if (rows.length === 0) break;

    // Registro casado por fonte de todo o lote (p/ match:<fonte> e lead time).
    const matchedByRecord = await resolveMatchedRecords(
      db,
      rows.map((r) => ({
        id: r.id as string,
        related_lead_id: r.related_lead_id as string | null,
      }))
    );

    const batchUpdates: BatchUpdate[] = [];
    for (const r of rows) {
      const matched = matchedByRecord.get(r.id as string) ?? {};

      const updates: Record<string, unknown> = {};
      let changed = false;

      // Lead time confiável: a partir do lead casado (genérico > related_lead_id),
      // base por fonte (venda_site → criação; negócio → fechamento).
      const rt = r.record_type as string;
      if (rt === "negocio" || rt === "venda_site") {
        const lead = matched.leads;
        if (lead) {
          const refDate =
            rt === "venda_site"
              ? (r.source_created_at as string | null)
              : (r.closed_at as string | null);
          const lt = leadTimeDays(refDate, (lead.source_created_at as string) ?? null);
          if (lt !== (r.lead_time_days as number | null)) {
            updates.lead_time_days = lt;
            changed = true;
          }
        }
      }
      const effLeadTime =
        "lead_time_days" in updates
          ? (updates.lead_time_days as number | null)
          : numOrNull(r.lead_time_days);

      if (defs.length > 0) {
        const inputs = buildRecordEvalInputs(r, matched, materials, effLeadTime);
        const calc = computeFormulaFields(
          inputs.values,
          inputs.custom,
          defs,
          inputs.conv,
          inputs.dateCtx
        );
        for (const [k, v] of Object.entries(calc)) {
          if (String(inputs.custom[k] ?? "") !== String(v ?? "")) {
            inputs.custom[k] = v;
            changed = true;
          }
        }
        if (changed) updates.custom_fields = inputs.custom;
      }

      if (changed) {
        batchUpdates.push({
          id: r.id as string,
          custom_fields:
            "custom_fields" in updates
              ? (updates.custom_fields as Record<string, unknown>)
              : null,
          set_lead_time: "lead_time_days" in updates,
          lead_time_days:
            "lead_time_days" in updates
              ? (updates.lead_time_days as number | null)
              : null,
        });
      }
    }

    if (batchUpdates.length > 0) {
      const { data: count, error } = await db.rpc("recalc_apply_updates", {
        p_updates: batchUpdates,
      });
      // Como no per-row anterior, erro não aborta o recalc (lotes seguintes
      // ainda rodam); só não conta como atualizado.
      if (!error) updated += (count as number | null) ?? batchUpdates.length;
    }

    if (rows.length < BATCH) break;
    from += BATCH;
  }
  return updated;
}
