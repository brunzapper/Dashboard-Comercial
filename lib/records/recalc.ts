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
  CORE_DATE_REFS,
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

// Valores dos operandos match:<fonte>:<ref> a partir do registro casado,
// separados em DATAS (→ dateCtx, epoch ms) e demais valores brutos (→ contexto
// de valores; texto/seleção/booleano/número para condicionais e aritmética).
// `isDateRef` decide pela mesma regra do catálogo de operandos: colunas de data
// do núcleo ou campo personalizado do tipo `data`.
function matchEntries(
  neededRefs: string[],
  matched: MatchedBySource,
  customDateKeys: Set<string>
): { dates: Record<string, number | null>; values: Record<string, unknown> } {
  const dates: Record<string, number | null> = {};
  const values: Record<string, unknown> = {};
  const isDateRef = (inner: string): boolean =>
    inner.startsWith("custom:")
      ? customDateKeys.has(inner.slice(7))
      : CORE_DATE_REFS.includes(inner as (typeof CORE_DATE_REFS)[number]);
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
    if (isDateRef(inner)) dates[ref] = toMs(raw);
    else values[ref] = raw;
  }
  return { dates, values };
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
  const customDateKeySet = new Set(customDateKeys);

  // Relações em fórmulas (19/07/2026): [Responsável]/[Operação] comparam por
  // NOME — o contexto recebe o display_name no lugar do UUID. Os mapas id→nome
  // só são carregados quando alguma fórmula referencia a relação.
  const allRefs = new Set(
    defs.flatMap((d) => (d.formula ? formulaRefs(d.formula) : []))
  );
  const respNameById = new Map<string, string>();
  const opNameById = new Map<string, string>();
  if (allRefs.has("responsible_id")) {
    const { data: resp } = await db
      .from("responsibles")
      .select("id, display_name");
    for (const x of resp ?? []) {
      respNameById.set(x.id as string, (x.display_name as string) ?? "");
    }
  }
  if (allRefs.has("operation_id")) {
    const { data: ops } = await db.from("operations").select("id, name");
    for (const x of ops ?? []) {
      opNameById.set(x.id as string, (x.name as string) ?? "");
    }
  }
  const fkName = (map: Map<string, string>, id: unknown): string | null =>
    id == null ? null : (map.get(String(id)) ?? null);

  // Só carrega o aparato de câmbio se algum calc-field for monetário.
  const needsCurrency = anyMoneyDef(defs);
  const materials: CurrencyMaterials = needsCurrency
    ? await loadCurrencyMaterials(db)
    : { rates: {}, moedaCurrency: {}, inheritMoedaRefs: [] };

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
      .select(
        "id, record_type, source_system, related_lead_id, responsible_id, operation_id, title, pipeline, stage, stage_semantic, sale_type, channel, closed, value, mrr, lead_time_days, custom_fields, currency, closed_at, opened_at, source_created_at"
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

    const batchUpdates: BatchUpdate[] = [];
    for (const r of rows) {
      const custom: Record<string, unknown> = {
        ...((r.custom_fields as Record<string, unknown>) ?? {}),
      };
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
        const matchVals = matchEntries(neededMatchRefs, matched, customDateKeySet);
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
          ...matchVals.dates,
        };
        const calc = computeFormulaFields(
          {
            value: numOrNull(r.value),
            mrr: numOrNull(r.mrr),
            lead_time_days: effLeadTime,
            // Colunas textuais/booleanas do núcleo (condicionais SE/E/OU) +
            // valores brutos do registro casado (match:<fonte>:<ref> não-data).
            title: r.title,
            record_type: r.record_type,
            source_system: r.source_system,
            pipeline: r.pipeline,
            stage: r.stage,
            stage_semantic: r.stage_semantic,
            sale_type: r.sale_type,
            channel: r.channel,
            currency: r.currency,
            closed: r.closed,
            // Relações por NOME (ver acima): condição compara com o rótulo.
            responsible_id: fkName(respNameById, r.responsible_id),
            operation_id: fkName(opNameById, r.operation_id),
            ...matchVals.values,
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
