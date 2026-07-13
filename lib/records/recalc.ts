// Versão: 2.0 | Data: 12/07/2026
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
import { RECORD_TYPE_SOURCE } from "@/lib/sources";
import { leadTimeDays } from "@/lib/sync/shared";
import {
  resolveMatchedRecords,
  type MatchedBySource,
} from "@/lib/records/matching-engine";
import {
  anyMoneyDef,
  buildDateContext,
  buildRecordCurrencyContext,
  computeFormulaFields,
  formulaRefs,
  loadCurrencyMaterials,
  loadCustomDateKeys,
  loadFormulaDefs,
  type CurrencyMaterials,
} from "./formulas";

const BATCH = 500;

function numOrNull(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function toMs(v: unknown): number | null {
  if (v == null || v === "") return null;
  const t = Date.parse(String(v));
  return Number.isNaN(t) ? null : t;
}

// Valores de data dos operandos match:<fonte>:<ref> a partir do registro casado.
function matchDateEntries(
  neededRefs: string[],
  matched: MatchedBySource
): Record<string, number | null> {
  const out: Record<string, number | null> = {};
  for (const ref of neededRefs) {
    const rest = ref.slice("match:".length);
    const i = rest.indexOf(":");
    if (i < 0) continue;
    const src = rest.slice(0, i);
    const inner = rest.slice(i + 1);
    const rec = matched[src];
    let raw: unknown = null;
    if (rec) {
      raw = inner.startsWith("custom:")
        ? rec.custom_fields?.[inner.slice(7)]
        : (rec as Record<string, unknown>)[inner];
    }
    out[ref] = toMs(raw);
  }
  return out;
}

/**
 * Recomputa os campos calculados de todos os registros e o lead_time_days a
 * partir do match resolvido. Retorna nº de registros atualizados.
 */
export async function recalcAllFormulaFields(): Promise<number> {
  const db = createServiceClient();
  const defs = await loadFormulaDefs(db);

  // Refs match: usados nas fórmulas (materializados pelo registro casado) e
  // chaves de campos custom do tipo `data` (para o contexto de datas próprio).
  const neededMatchRefs = Array.from(
    new Set(
      defs
        .flatMap((d) => (d.formula ? formulaRefs(d.formula) : []))
        .filter((r) => r.startsWith("match:"))
    )
  );
  const customDateKeys = await loadCustomDateKeys(db);

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
        "id, record_type, related_lead_id, value, mrr, lead_time_days, custom_fields, currency, closed_at, opened_at, source_created_at"
      )
      .order("id", { ascending: true })
      .range(from, from + BATCH - 1);
    const rows = data ?? [];
    if (rows.length === 0) break;

    // Registro casado por fonte de todo o lote (p/ match:<fonte> e lead time).
    const matchedByRecord = await resolveMatchedRecords(
      db,
      rows.map((r) => ({
        id: r.id as string,
        related_lead_id: r.related_lead_id as string | null,
      }))
    );

    for (const r of rows) {
      const custom: Record<string, unknown> = {
        ...((r.custom_fields as Record<string, unknown>) ?? {}),
      };
      const matched = matchedByRecord.get(r.id as string) ?? {};
      // Auto-fonte: `match:<própria fonte>` resolve para o PRÓPRIO registro (um
      // registro nunca casa com outro da mesma fonte). Assim `↪ <própria fonte>`
      // num campo calculado vale o dado deste registro, e não um null perpétuo.
      const ownSrc = RECORD_TYPE_SOURCE[r.record_type as string];
      if (ownSrc && !matched[ownSrc]) {
        matched[ownSrc] = r as unknown as MatchedBySource[string];
      }

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
        const dateCtx = {
          ...buildDateContext(
            {
              closed_at: r.closed_at as string | null,
              opened_at: r.opened_at as string | null,
              source_created_at: r.source_created_at as string | null,
            },
            custom,
            customDateKeys
          ),
          ...matchDateEntries(neededMatchRefs, matched),
        };
        const calc = computeFormulaFields(
          {
            value: numOrNull(r.value),
            mrr: numOrNull(r.mrr),
            lead_time_days: effLeadTime,
          },
          custom,
          defs,
          conv,
          dateCtx
        );
        for (const [k, v] of Object.entries(calc)) {
          if (String(custom[k] ?? "") !== String(v ?? "")) {
            custom[k] = v;
            changed = true;
          }
        }
        if (changed) updates.custom_fields = custom;
      }

      if (changed) {
        await db.from("records").update(updates).eq("id", r.id as string);
        updated += 1;
      }
    }

    if (rows.length < BATCH) break;
    from += BATCH;
  }
  return updated;
}
