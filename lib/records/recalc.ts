// Versão: 2.2 | Data: 26/07/2026
// v2.2 (26/07/2026): miolo do lote extraído (recalcRows + loadRecalcContext) e
//   novo recalcFormulaFieldsForRecords(ids) — recalc DIRECIONADO usado pelo
//   auto-match pós-sync do Bitrix (A2 de Parcerias): só os registros recém-
//   casados, mesmo pipeline byte-idêntico do recalc geral.
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
import { computeFormulaFields, loadFormulaDefsByOrg } from "./formulas";
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

type ServiceDb = ReturnType<typeof createServiceClient>;

interface RecalcContext {
  db: ServiceDb;
  defsByOrg: Awaited<ReturnType<typeof loadFormulaDefsByOrg>>;
  materials: Awaited<ReturnType<typeof loadRecordEvalMaterials>>;
}

async function loadRecalcContext(): Promise<RecalcContext> {
  const db = createServiceClient();
  // ISOLAMENTO multi-org (0090): as fórmulas são agrupadas por organização e
  // cada registro recebe SÓ as da sua org (field_key é único por-org). Os
  // insumos globais usam a UNIÃO das defs — é um superconjunto inócuo do que
  // qualquer org precisa (refs match:/datas/câmbio a materializar).
  const defsByOrg = await loadFormulaDefsByOrg(db);
  const allDefs = [...defsByOrg.values()].flat();

  // Insumos globais (refs match:, chaves de data custom, relações por nome,
  // câmbio) — módulo COMPARTILHADO com a prévia do FormulaEditor
  // (lib/records/record-eval-context.ts): prévia e materialização idênticas.
  const materials = await loadRecordEvalMaterials(db, allDefs);
  return { db, defsByOrg, materials };
}

// Recomputa um LOTE de linhas já carregadas (match resolvido aqui) e aplica os
// updates num único UPDATE set-based via recalc_apply_updates (0070).
async function recalcRows(
  ctx: RecalcContext,
  rows: RecordEvalRow[]
): Promise<number> {
  const { db, defsByOrg, materials } = ctx;
  if (rows.length === 0) return 0;

  // Registro casado por fonte de todo o lote (p/ match:<fonte> e lead time).
  const matchedByRecord = await resolveMatchedRecords(
    db,
    rows.map((r) => ({
      id: r.id as string,
      related_lead_id: r.related_lead_id as string | null,
    }))
  );

  type BatchUpdate = {
    id: string;
    custom_fields: Record<string, unknown> | null;
    set_lead_time: boolean;
    lead_time_days: number | null;
  };
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

    // Só as fórmulas da org DESTE registro (isolamento multi-org).
    const orgDefs = defsByOrg.get((r.organization_id as string) ?? "") ?? [];
    if (orgDefs.length > 0) {
      const inputs = buildRecordEvalInputs(r, matched, materials, effLeadTime);
      const calc = computeFormulaFields(
        inputs.values,
        inputs.custom,
        orgDefs,
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

  let updated = 0;
  if (batchUpdates.length > 0) {
    const { data: count, error } = await db.rpc("recalc_apply_updates", {
      p_updates: batchUpdates,
    });
    // Como no per-row anterior, erro não aborta o recalc (lotes seguintes
    // ainda rodam); só não conta como atualizado.
    if (!error) updated += (count as number | null) ?? batchUpdates.length;
  }
  return updated;
}

/**
 * Recomputa os campos calculados de todos os registros e o lead_time_days a
 * partir do match resolvido. Retorna nº de registros atualizados.
 */
export async function recalcAllFormulaFields(): Promise<number> {
  const ctx = await loadRecalcContext();
  let from = 0;
  let updated = 0;
  for (;;) {
    const { data } = await ctx.db
      .from("records")
      .select(RECORD_EVAL_COLUMNS)
      .order("id", { ascending: true })
      .range(from, from + BATCH - 1);
    const rows = (data ?? []) as RecordEvalRow[];
    if (rows.length === 0) break;
    updated += await recalcRows(ctx, rows);
    if (rows.length < BATCH) break;
    from += BATCH;
  }
  return updated;
}

/**
 * Recalc DIRECIONADO: mesmo pipeline do geral, restrito aos ids pedidos.
 * Idempotente (superset de ids é inócuo). Usado pelo auto-match incremental
 * pós-sync do Bitrix — recalcAllFormulaFields a cada tick seria proibitivo.
 */
export async function recalcFormulaFieldsForRecords(
  ids: string[]
): Promise<number> {
  const unique = [...new Set(ids)].filter(Boolean);
  if (unique.length === 0) return 0;
  const ctx = await loadRecalcContext();
  let updated = 0;
  for (let i = 0; i < unique.length; i += BATCH) {
    const slice = unique.slice(i, i + BATCH);
    const { data } = await ctx.db
      .from("records")
      .select(RECORD_EVAL_COLUMNS)
      .in("id", slice);
    updated += await recalcRows(ctx, (data ?? []) as RecordEvalRow[]);
  }
  return updated;
}
