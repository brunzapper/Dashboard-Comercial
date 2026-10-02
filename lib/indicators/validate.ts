// Versão: 1.1 | Data: 02/10/2026
// v1.1 (02/10/2026): `validateRealizedFormula` (extraída do save do
//   indicador, mesma régua) e `validateRealizedSource` — a fonte do realizado
//   dos nós da Tree e das linhas de meta da Tabela Livre passa pelo MESMO
//   catálogo e validador; a quebra só aceita campo agrupável. Também
//   `attentionPct` (faixa "Atenção" configurável, padrão 2× a tolerância).
// Validação de SALVAMENTO de um indicador (0149) — a muralha do servidor.
//
// O realizado é uma fórmula AGREGADA: valida pelo MESMO catálogo
// (`buildAggOperandCatalog(availableAggCatalogInput(...))`, com metas, Base
// manual e eixos — o editor da tela monta o MESMO) e pelo MESMO validador de
// contexto (`validateFormulaForContext`) que campos `calculado_agg`, widgets e
// a Remuneração usam. Repetir regra aqui seria a régua paralela que a
// invariante 25 proíbe.
import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { loadSources } from "@/lib/config/sources";
import { loadCorrespondences } from "@/lib/correspondences";
import { loadGoalMetrics } from "@/lib/config/goal-metrics";
import { loadManualAxes, loadManualSeries } from "@/lib/manual-base/load";
import { validateFormulaForContext } from "@/lib/records/formula-validate";
import { validateFkCondNames } from "@/lib/records/formula-server";
import type { FieldDefinition } from "@/lib/records/types";
import {
  availableAggCatalogInput,
  buildAggOperandCatalog,
} from "@/lib/widgets/agg-catalog";
import { buildAvailableFields } from "@/lib/widgets/fields";
import { opHasNoValue } from "@/lib/widgets/filter-ops";

import {
  parseRealizedSource,
  type RealizedSource,
} from "./realized-source";
import {
  INDICATOR_DIRECTION_LABELS,
  INDICATOR_ROLLUP_LABELS,
  INDICATOR_UNIT_LABELS,
  isIndicatorKey,
  parseIndicatorRealized,
  type IndicatorDirection,
  type IndicatorRealized,
  type IndicatorRollup,
  type IndicatorUnit,
} from "./model";

/** O que a tela (e o seed do preset) entrega para gravar. */
export interface IndicatorInput {
  key: string;
  label: string;
  description?: string | null;
  unit: string;
  rollup: string;
  direction: string;
  tolerancePct: number;
  /** v1.1: faixa "Atenção" (%); null = 2× a tolerância; ausente = não mexe. */
  attentionPct?: number | null;
  ownerResponsibleId?: string | null;
  realized: unknown;
  sortOrder?: number;
}

export interface IndicatorRowWrite {
  key: string;
  label: string;
  description: string | null;
  unit: IndicatorUnit;
  rollup: IndicatorRollup;
  direction: IndicatorDirection;
  tolerance_pct: number;
  /** v1.1: presente só quando a entrada o informa (preset antigo não manda). */
  attention_pct?: number | null;
  owner_responsible_id: string | null;
  realized: IndicatorRealized | null;
  sort_order: number;
}

export type IndicatorValidation =
  | { ok: true; row: IndicatorRowWrite }
  | { ok: false; message: string };

/** Contrato estrutural (puro): enums, chave, rótulo, faixa de tolerância. */
export function validateIndicatorShape(input: IndicatorInput): IndicatorValidation {
  const key = String(input.key ?? "").trim();
  if (!isIndicatorKey(key))
    return {
      ok: false,
      message:
        "Chave inválida — use até 40 letras minúsculas, dígitos ou _ (ex.: mrr_novo_inbound).",
    };
  const label = String(input.label ?? "").trim();
  if (!label || label.length > 80)
    return { ok: false, message: "Informe o nome do indicador (até 80 caracteres)." };
  if (!(input.unit in INDICATOR_UNIT_LABELS))
    return { ok: false, message: "Unidade inválida." };
  if (!(input.rollup in INDICATOR_ROLLUP_LABELS))
    return { ok: false, message: "Regra de total inválida." };
  if (!(input.direction in INDICATOR_DIRECTION_LABELS))
    return { ok: false, message: "Direção inválida." };
  const tol = Number(input.tolerancePct);
  if (!Number.isFinite(tol) || tol < 0 || tol > 100)
    return { ok: false, message: "Tolerância deve estar entre 0 e 100%." };
  let attention: number | null | undefined = undefined;
  if (input.attentionPct !== undefined) {
    if (input.attentionPct === null) attention = null;
    else {
      const a = Number(input.attentionPct);
      if (!Number.isFinite(a) || a < tol || a > 100)
        return {
          ok: false,
          message: "A faixa de atenção deve ficar entre a tolerância e 100%.",
        };
      attention = a;
    }
  }
  let realized: IndicatorRealized | null = null;
  if (input.realized != null) {
    realized = parseIndicatorRealized(input.realized);
    if (!realized)
      return {
        ok: false,
        message: "Fórmula do realizado inválida — revise a fórmula e as condições.",
      };
    for (const f of realized.filters) {
      if (f.field === "operation_id")
        return {
          ok: false,
          message:
            "Operação não é filtrável no realizado — filtre por responsável ou por um campo do registro.",
        };
      if (!opHasNoValue(f.op)) {
        const empty = Array.isArray(f.value)
          ? f.value.length === 0
          : String(f.value ?? "").trim() === "";
        if (empty) return { ok: false, message: "Informe o valor de cada condição." };
      }
    }
  }
  const desc = String(input.description ?? "").trim();
  return {
    ok: true,
    row: {
      key,
      label,
      description: desc ? desc.slice(0, 1000) : null,
      unit: input.unit as IndicatorUnit,
      rollup: input.rollup as IndicatorRollup,
      direction: input.direction as IndicatorDirection,
      tolerance_pct: tol,
      ...(attention !== undefined ? { attention_pct: attention } : {}),
      owner_responsible_id: input.ownerResponsibleId || null,
      realized,
      sort_order: Number.isFinite(Number(input.sortOrder)) ? Number(input.sortOrder) : 0,
    },
  };
}

/** Shape + semântica da fórmula/bases/campos contra o catálogo VIVO da org. */
export async function validateIndicatorSave(
  supabase: SupabaseClient,
  orgId: string | null,
  input: IndicatorInput
): Promise<IndicatorValidation> {
  const shape = validateIndicatorShape(input);
  if (!shape.ok || !shape.row.realized) return shape;
  const realized = shape.row.realized;
  const r = await validateRealizedFormula(supabase, orgId, realized);
  return r.ok ? shape : { ok: false, message: `${r.message}` };
}

type RealizedCheck = { ok: true } | { ok: false; message: string };

/** Catálogo VIVO da org para validar uma fórmula agregada de realizado. */
async function loadRealizedCatalog(supabase: SupabaseClient, orgId: string | null) {
  const [sources, correspondences, { data: fieldsData }, registry, manualSeries, manualAxes] =
    await Promise.all([
      loadSources(supabase, orgId),
      loadCorrespondences(supabase, orgId),
      supabase
        .from("field_definitions")
        .select(
          "field_key, label, data_type, formula, applies_to, currency_code, currency_mode, allow_negative, show_as_percent"
        ),
      loadGoalMetrics(supabase),
      loadManualSeries(supabase, orgId),
      loadManualAxes(supabase, orgId),
    ]);
  const allFields = (fieldsData ?? []) as FieldDefinition[];
  const available = buildAvailableFields(allFields, correspondences, sources);
  const catalog = buildAggOperandCatalog(
    availableAggCatalogInput(
      available,
      allFields,
      sources,
      registry,
      manualSeries,
      manualAxes,
      { withNested: true }
    )
  );
  return { sources, available, catalog };
}

/**
 * v1.1: fórmula + bases + condições de um realizado (do indicador ou próprio)
 * contra o catálogo vivo — a MESMA régua do save do indicador.
 */
export async function validateRealizedFormula(
  supabase: SupabaseClient,
  orgId: string | null,
  realized: Pick<IndicatorRealized, "formula" | "sources" | "filters">,
  ctx?: Awaited<ReturnType<typeof loadRealizedCatalog>>
): Promise<RealizedCheck> {
  const { sources, available, catalog } = ctx ?? (await loadRealizedCatalog(supabase, orgId));
  const sourceKeys = new Set(sources.map((s) => s.key));
  for (const s of realized.sources) {
    if (!sourceKeys.has(s))
      return { ok: false, message: `Base desconhecida no realizado ("${s}").` };
  }
  const availableByRef = new Map(available.map((a) => [a.field, a]));
  for (const f of realized.filters) {
    if (f.field === "operation_id")
      return {
        ok: false,
        message:
          "Operação não é filtrável no realizado — filtre por responsável ou por um campo do registro.",
      };
    const af = availableByRef.get(f.field);
    if (!af || af.displayOnly || af.aggCalc)
      return { ok: false, message: `Condição do realizado: campo desconhecido ("${f.field}").` };
    if (!opHasNoValue(f.op)) {
      const empty = Array.isArray(f.value)
        ? f.value.length === 0
        : String(f.value ?? "").trim() === "";
      if (empty) return { ok: false, message: "Informe o valor de cada condição do realizado." };
    }
  }
  const v = validateFormulaForContext(realized.formula, {
    kind: "aggregate",
    catalog,
    sources,
  });
  if (!v.ok)
    return { ok: false, message: `Fórmula do realizado: ${v.error ?? "inválida."}` };
  const fk = await validateFkCondNames(supabase, realized.formula);
  if (!fk.ok) return { ok: false, message: `Fórmula do realizado: ${fk.message}` };
  return { ok: true };
}

/**
 * v1.1: fonte do realizado de um nó/linha. Devolve a versão SANEADA (o parse
 * descarta chaves desconhecidas) ou a mensagem amigável. Sem override, valida
 * só os recortes extras e a quebra (a fórmula é a do catálogo, já validada no
 * save do indicador).
 */
export async function validateRealizedSource(
  supabase: SupabaseClient,
  orgId: string | null,
  raw: unknown
): Promise<{ ok: true; value: RealizedSource } | { ok: false; message: string }> {
  const rs = parseRealizedSource(raw);
  if (!rs) return { ok: false, message: "Fonte do realizado inválida — revise a fórmula e os recortes." };
  const ctx = await loadRealizedCatalog(supabase, orgId);
  const filters = (rs.filters ?? []).map((f) => {
    const { exposed, ...plain } = f;
    void exposed;
    return plain;
  });
  if (rs.override) {
    const r = await validateRealizedFormula(
      supabase,
      orgId,
      { formula: rs.override.formula, sources: rs.override.sources, filters },
      ctx
    );
    if (!r.ok) return r;
  } else if (filters.length > 0) {
    const byRef = new Map(ctx.available.map((a) => [a.field, a]));
    for (const f of filters) {
      const af = byRef.get(f.field);
      if (f.field === "operation_id" || !af || af.displayOnly || af.aggCalc)
        return { ok: false, message: `Recorte do realizado: campo inválido ("${f.field}").` };
    }
  }
  if (rs.breakdown) {
    const af = ctx.available.find((a) => a.field === rs.breakdown!.field);
    if (!af || af.displayOnly || af.aggCalc)
      return {
        ok: false,
        message: `Quebra do realizado: campo não agrupável ("${rs.breakdown.field}").`,
      };
  }
  return { ok: true, value: rs };
}
