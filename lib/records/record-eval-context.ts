// Versão: 1.0 | Data: 20/07/2026
// Montagem dos INSUMOS de avaliação POR-REGISTRO (contexto de valores, custom,
// datas e moeda) a partir de uma linha de `records` + registro casado resolvido.
// Extraído de recalc.ts para a MATERIALIZAÇÃO (recalcAllFormulaFields) e a
// PRÉVIA do FormulaEditor (campos/preview-actions) usarem exatamente a mesma
// montagem — prévia e valor gravado idênticos por construção.
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  anyMoneyDef,
  buildDateContext,
  buildRecordCurrencyContext,
  CORE_DATE_REFS,
  formulaRefs,
  loadCurrencyMaterials,
  loadCustomDateKeys,
  type CurrencyMaterials,
  type FormulaFieldDef,
} from "./formulas";
import type { MatchedBySource } from "./matching-engine";

// Colunas de `records` de que a avaliação precisa — o SELECT do recalc e o da
// prévia derivam daqui para nunca divergirem.
export const RECORD_EVAL_COLUMNS =
  "id, organization_id, record_type, source_system, related_lead_id, responsible_id, operation_id, title, pipeline, stage, stage_semantic, sale_type, channel, closed, value, mrr, lead_time_days, custom_fields, currency, closed_at, opened_at, source_created_at";

// Linha crua do SELECT acima (tipagem frouxa de propósito — vem do supabase-js).
export type RecordEvalRow = Record<string, unknown> & {
  id: string;
  custom_fields?: Record<string, unknown> | null;
};

// Insumos GLOBAIS (iguais para todas as linhas): refs match: usados, chaves de
// data custom, mapas de relação id→nome e o aparato de câmbio (se necessário).
export interface RecordEvalMaterials {
  neededMatchRefs: string[];
  customDateKeys: string[];
  respNameById: Map<string, string>;
  opNameById: Map<string, string>;
  // Presente só quando algum calc-field é monetário (anyMoneyDef).
  currencyMaterials?: CurrencyMaterials;
}

export interface RecordEvalInputs {
  // 1º argumento de computeFormulaFields (núcleo + relações por nome + valores
  // brutos do casado); custom = 2º (clone mutável de custom_fields).
  values: Record<string, unknown>;
  custom: Record<string, unknown>;
  conv?: ReturnType<typeof buildRecordCurrencyContext>;
  dateCtx: Record<string, number | null>;
}

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
export function matchEntries(
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

/** Carrega os insumos globais a partir das defs de fórmula (mesmas consultas
 *  que o recalc fazia inline): refs match: usados, chaves de data custom,
 *  mapas de relação (só se alguma fórmula referencia) e câmbio (só se alguma
 *  def é monetária). */
export async function loadRecordEvalMaterials(
  db: SupabaseClient,
  defs: FormulaFieldDef[]
): Promise<RecordEvalMaterials> {
  const allRefs = new Set(
    defs.flatMap((d) => (d.formula ? formulaRefs(d.formula) : []))
  );
  const neededMatchRefs = [...allRefs].filter((r) => r.startsWith("match:"));
  const customDateKeys = await loadCustomDateKeys(db);

  // Relações em fórmulas (19/07/2026): [Responsável]/[Operação] comparam por
  // NOME — o contexto recebe o display_name no lugar do UUID. Os mapas id→nome
  // só são carregados quando alguma fórmula referencia a relação.
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

  // Só carrega o aparato de câmbio se algum calc-field for monetário.
  const currencyMaterials = anyMoneyDef(defs)
    ? await loadCurrencyMaterials(db)
    : undefined;

  return {
    neededMatchRefs,
    customDateKeys,
    respNameById,
    opNameById,
    currencyMaterials,
  };
}

/**
 * Monta os insumos de avaliação de UMA linha. `effLeadTime` permite ao recalc
 * injetar o lead time recém-recomputado (a prévia usa o da linha — omitir).
 */
export function buildRecordEvalInputs(
  r: RecordEvalRow,
  matched: MatchedBySource,
  m: RecordEvalMaterials,
  effLeadTime?: number | null
): RecordEvalInputs {
  const custom: Record<string, unknown> = {
    ...((r.custom_fields as Record<string, unknown>) ?? {}),
  };
  const conv = m.currencyMaterials
    ? buildRecordCurrencyContext(
        {
          currency: r.currency as string | null,
          closed_at: r.closed_at as string | null,
          opened_at: r.opened_at as string | null,
          source_created_at: r.source_created_at as string | null,
        },
        m.currencyMaterials
      )
    : undefined;
  const matchVals = matchEntries(
    m.neededMatchRefs,
    matched,
    new Set(m.customDateKeys)
  );
  const dateCtx = {
    ...buildDateContext(
      {
        closed_at: r.closed_at as string | null,
        opened_at: r.opened_at as string | null,
        source_created_at: r.source_created_at as string | null,
      },
      custom,
      m.customDateKeys
    ),
    ...matchVals.dates,
  };
  const fkName = (map: Map<string, string>, id: unknown): string | null =>
    id == null ? null : (map.get(String(id)) ?? null);
  const values: Record<string, unknown> = {
    value: numOrNull(r.value),
    mrr: numOrNull(r.mrr),
    lead_time_days:
      effLeadTime !== undefined ? effLeadTime : numOrNull(r.lead_time_days),
    // Colunas textuais/booleanas do núcleo (condicionais SE/E/OU) + valores
    // brutos do registro casado (match:<fonte>:<ref> não-data).
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
    responsible_id: fkName(m.respNameById, r.responsible_id),
    operation_id: fkName(m.opNameById, r.operation_id),
    ...matchVals.values,
  };
  return { values, custom, conv, dateCtx };
}
