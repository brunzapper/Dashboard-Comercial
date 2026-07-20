// Versão: 1.0 | Data: 20/07/2026
// Builder ÚNICO do catálogo de operandos AGREGADOS (fórmulas 'calculado_agg' e
// métricas/expressões de widget). Antes esta montagem estava copiada em SEIS
// sítios (widget-builder, fields-manager, campos/actions, quick-table-actions,
// widget-card/Nota e o viewer de snapshot) — qualquer divergência quebrava o
// round-trip texto⇄tokens (rótulo é load-bearing) ou a paridade editor⇄servidor.
// Reforça a invariante de catálogo único (docs/arquitetura.md §4.1).
//
// Duas formas de derivar o input:
// - availableAggCatalogInput: dos `available` do builder (buildAvailableFields)
//   + defs — sítios de widget (builder, Nota, quick-table, snapshot).
// - defsAggCatalogInput: só das defs (field_definitions) + CORE_FIELDS — página
//   /campos e validação do servidor.
// Módulo puro (client+server).
import {
  COND_DATA_TYPES,
  type CustomCondField,
} from "@/lib/records/cond-operands";
import {
  TODAY_REF,
  type CustomDateField,
  type OperandRef,
} from "@/lib/records/date-operands";
import { NUMERIC_DATA_TYPES, type DataType } from "@/lib/records/types";
import type { SourceDef } from "@/lib/sources";
import {
  aggNestedOperandRefs,
  aggOperandRefs,
  condAggOperandRefs,
  sourceScopedAggOperandRefs,
  type ScopedAggField,
} from "./calc-metrics";
import { CORE_FIELDS, type AvailableField } from "./fields";

// Motivo exibido no seletor para "Data atual" no contexto agregado — o operando
// tokeniza mas nunca compila (mensagem dedicada em validateCondAggRefs);
// desabilitar COM explicação em vez de esconder (política de produto).
export const TODAY_IN_AGG_REASON =
  'Não funciona em fórmulas agregadas — a comparação roda no banco, que não conhece "hoje". Compare com uma data fixa (ex.: >= "2026-01-01").';

export interface AggCatalogInput {
  // Colunas numéricas (alvo de Σ/Média; também alvo/condição de SOMASE).
  numeric: ScopedAggField[];
  // Colunas contáveis (agg:count:<campo> = registros com o campo preenchido).
  countable: ScopedAggField[];
  // Campos 'calculado_agg' referenciáveis como ref plano (aninhamento) —
  // ausente/vazio = sítio sem aninhamento (Nota/quick-table/snapshot hoje).
  nested?: { field_key: string; label: string }[];
  // Colunas de condição de SOMASE/CONT.SE: custom condicionais + datas custom.
  customCond: CustomCondField[];
  customDate: CustomDateField[];
  // Condições sobre campos UNIFICADOS (o chamador tem as correspondências).
  unifiedCond?: { field: string; label: string }[];
  // Catálogo de fontes VIVO (loadSources/useSources) — escopo @fonte e casados
  // casam por rótulo de fonte; editores e servidor DEVEM usar o mesmo.
  sources: SourceDef[];
}

/** Catálogo agregado completo: agg:* + variantes @fonte + aninhados + operandos
 *  de SOMASE/CONT.SE/MÉDIASE. Mesma ordem/rotulagem dos seis sítios originais. */
export function buildAggOperandCatalog(input: AggCatalogInput): OperandRef[] {
  // Escopo @fonte nunca sobre match: (o registro casado já embute a fonte).
  const noMatch = (list: ScopedAggField[]) =>
    list.filter((f) => !f.field.startsWith("match:"));
  const catalog: OperandRef[] = [
    ...aggOperandRefs(input.numeric, input.countable),
    ...sourceScopedAggOperandRefs(
      noMatch(input.numeric),
      noMatch(input.countable),
      input.sources
    ),
    ...aggNestedOperandRefs(input.nested ?? []),
    ...condAggOperandRefs(
      input.numeric,
      input.customCond,
      input.customDate,
      input.sources,
      input.unifiedCond ?? []
    ),
  ];
  return catalog.map((o) =>
    o.ref === TODAY_REF ? { ...o, disabledReason: TODAY_IN_AGG_REASON } : o
  );
}

// Linha mínima de field_definitions p/ derivar o input — FieldDefinition (UI) e
// o DefRow do servidor (campos/actions.ts) são ambos atribuíveis.
export interface AggCatalogDefRow {
  field_key: string;
  label: string;
  data_type: DataType;
  applies_to?: string[] | null;
}

/** Input derivado dos `available` do builder (sítios de widget). `defs` fornece
 *  applies_to (escopo @fonte do custom) e as colunas de condição/data/aninhadas.
 *  `withNested` = oferecer 'calculado_agg' salvos como operando (widget-builder
 *  sim; Nota/quick-table/snapshot mantêm o comportamento atual, sem). */
export function availableAggCatalogInput(
  available: AvailableField[],
  defs: AggCatalogDefRow[],
  sources: SourceDef[],
  opts?: { withNested?: boolean }
): AggCatalogInput {
  // appliesTo decide sob quais fontes o campo ganha variante @fonte: custom usa
  // applies_to; unificado usa os record_types dos membros; núcleo vale em todas.
  const appliesToOf = (f: AvailableField): string[] | null =>
    f.field.startsWith("custom:")
      ? (defs.find((d) => d.field_key === f.field.slice(7))?.applies_to ?? null)
      : f.unifiedMembers
        ? Object.keys(f.unifiedMembers)
        : null;
  const toScoped = (list: AvailableField[]): ScopedAggField[] =>
    list.map((f) => ({
      field: f.field,
      label: f.label,
      appliesTo: appliesToOf(f),
    }));
  return {
    numeric: toScoped(available.filter((f) => f.isNumeric)),
    countable: toScoped(
      available.filter(
        (f) => (f.isNumeric || f.isDate) && !f.aggCalc && !f.displayOnly
      )
    ),
    nested: opts?.withNested
      ? defs
          .filter((d) => d.data_type === "calculado_agg")
          .map((d) => ({ field_key: d.field_key, label: d.label }))
      : [],
    customCond: defs
      .filter((d) => COND_DATA_TYPES.includes(d.data_type))
      .map((d) => ({ field_key: d.field_key, label: d.label })),
    customDate: defs
      .filter((d) => d.data_type === "data")
      .map((d) => ({ field_key: d.field_key, label: d.label })),
    unifiedCond: available
      .filter((f) => f.unified && !f.isNumeric)
      .map((f) => ({ field: f.field, label: f.label })),
    sources,
  };
}

/** Input derivado SÓ das defs + CORE_FIELDS (página /campos e servidor — sem
 *  `available`/correspondências, logo sem unifiedCond). `forbidden` = chaves
 *  proibidas como operando do campo em edição (self + dependentes transitivos);
 *  o servidor filtra aqui, a página /campos passa vazio e filtra no FieldForm
 *  (excludeKeys). */
export function defsAggCatalogInput(
  defs: AggCatalogDefRow[],
  sources: SourceDef[],
  forbidden: Set<string> = new Set()
): AggCatalogInput {
  const allowed = defs.filter((d) => !forbidden.has(d.field_key));
  return {
    numeric: [
      ...CORE_FIELDS.filter((f) => f.isNumeric).map((f) => ({
        field: f.field,
        label: f.label,
      })),
      ...allowed
        .filter((d) => NUMERIC_DATA_TYPES.includes(d.data_type))
        .map((d) => ({
          field: `custom:${d.field_key}`,
          label: d.label,
          appliesTo: d.applies_to,
        })),
    ],
    // Contáveis: datas/numéricos do núcleo (podem ser nulos) + qualquer custom,
    // exceto 'calculado_agg' (contagem de agregado não existe — o aninhamento
    // entra como ref plano em `nested`).
    countable: [
      ...CORE_FIELDS.filter((f) => f.isNumeric || f.isDate).map((f) => ({
        field: f.field,
        label: f.label,
      })),
      ...allowed
        .filter((d) => d.data_type !== "calculado_agg")
        .map((d) => ({
          field: `custom:${d.field_key}`,
          label: d.label,
          appliesTo: d.applies_to,
        })),
    ],
    nested: allowed
      .filter((d) => d.data_type === "calculado_agg")
      .map((d) => ({ field_key: d.field_key, label: d.label })),
    customCond: allowed
      .filter((d) => COND_DATA_TYPES.includes(d.data_type))
      .map((d) => ({ field_key: d.field_key, label: d.label })),
    customDate: allowed
      .filter((d) => d.data_type === "data")
      .map((d) => ({ field_key: d.field_key, label: d.label })),
    sources,
  };
}
