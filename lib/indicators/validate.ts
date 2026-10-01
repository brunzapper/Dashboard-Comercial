// Versão: 1.0 | Data: 01/10/2026
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
  const sourceKeys = new Set(sources.map((s) => s.key));
  for (const s of realized.sources) {
    if (!sourceKeys.has(s))
      return { ok: false, message: `Base desconhecida no realizado ("${s}").` };
  }
  const availableByRef = new Map(available.map((a) => [a.field, a]));
  for (const f of realized.filters) {
    const af = availableByRef.get(f.field);
    if (!af || af.displayOnly || af.aggCalc)
      return { ok: false, message: `Condição do realizado: campo desconhecido ("${f.field}").` };
  }
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
  const v = validateFormulaForContext(realized.formula, {
    kind: "aggregate",
    catalog,
    sources,
  });
  if (!v.ok)
    return { ok: false, message: `Fórmula do realizado: ${v.error ?? "inválida."}` };
  const fk = await validateFkCondNames(supabase, realized.formula);
  if (!fk.ok) return { ok: false, message: `Fórmula do realizado: ${fk.message}` };
  return shape;
}
