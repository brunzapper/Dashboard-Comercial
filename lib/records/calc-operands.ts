// Versão: 1.0 | Data: 19/07/2026
// Catálogo ÚNICO de operandos dos campos calculados POR-REGISTRO ('calculado'):
// os DOIS editores (página /campos — fields-manager — e o FieldForm inline do
// widget-builder) e a validação do servidor (campos/actions.ts) montam a lista
// a partir daqui, para nunca mais divergirem (o inline ficou anos numérico-only
// e degradava fórmulas salvas para refs cruas irrecriáveis).
//
// Inclui TUDO que o motor per-registro resolve (flexibilidade máxima —
// decisão de produto 19/07/2026): números (núcleo + custom, com aninhamento),
// datas (núcleo + custom + casadas + hoje), números do registro CASADO
// (matchNumericOperands, novo — o recalc em lote já resolvia qualquer match:)
// e, no catálogo de texto, as colunas condicionais (próprias + casadas) p/
// SE/E/OU. `unified:` fica de FORA: nunca é injetado no contexto de avaliação
// por registro (oferecê-lo = null silencioso).
// Módulo puro (client+server).
import { CORE_FIELDS } from "@/lib/widgets/fields";
import { BUILTIN_SOURCES, type SourceDef } from "@/lib/sources";
import { NUMERIC_DATA_TYPES, type DataType } from "@/lib/records/types";
import type { Formula } from "@/lib/records/formulas";
import {
  allDateOperands,
  type CustomDateField,
  type OperandRef,
} from "./date-operands";
import {
  allCondOperands,
  COND_DATA_TYPES,
  type CustomCondField,
} from "./cond-operands";
import { transitiveFormulaDependents } from "./formula-deps";

const CORE_NUMERIC = CORE_FIELDS.filter((f) => f.isNumeric);

export interface CustomNumericField {
  field_key: string;
  label: string;
}

/** Colunas numéricas do registro CASADO: match:<fonte>:<core numérico> e
 *  match:<fonte>:custom:<numérico>. Espelha matchCondOperands/matchDateOperands
 *  (mesma convenção de rótulo `↪ <Fonte>: <Campo>` — load-bearing no round-trip
 *  texto⇄tokens; editores e servidor DEVEM usar o mesmo catálogo de fontes). */
export function matchNumericOperands(
  customNumericFields: CustomNumericField[],
  sources: SourceDef[] = BUILTIN_SOURCES
): OperandRef[] {
  const out: OperandRef[] = [];
  for (const { key: src, label: srcLabel } of sources) {
    for (const f of CORE_NUMERIC) {
      out.push({
        ref: `match:${src}:${f.field}`,
        label: `↪ ${srcLabel}: ${f.label}`,
        group: "Registro casado",
      });
    }
    for (const f of customNumericFields) {
      out.push({
        ref: `match:${src}:custom:${f.field_key}`,
        label: `↪ ${srcLabel}: ${f.label}`,
        group: "Registro casado",
      });
    }
  }
  return out;
}

// Linha mínima de field_definitions p/ montar o catálogo — FieldDefinition e o
// DefRow do servidor (campos/actions.ts) são ambos atribuíveis.
export interface CalcOperandDef {
  field_key: string;
  label: string;
  data_type: DataType;
  formula?: Formula | null;
}

export interface PerRecordOperands {
  // Operandos do CONSTRUTOR (+ − × ÷): números + datas (próprias e casadas).
  numericRefs: OperandRef[];
  // Catálogo completo do editor de TEXTO: numericRefs + colunas condicionais
  // (texto/seleção/booleano/relações, próprias e casadas) p/ SE/E/OU.
  allRefs: OperandRef[];
  // Chaves PROIBIDAS como operando: o campo em edição + dependentes transitivos
  // (referenciá-los criaria ciclo). Vazio quando não há campo em edição.
  excludeKeys: Set<string>;
}

/** Catálogo por-registro compartilhado entre /campos, o FieldForm inline do
 *  widget-builder e o servidor. Refs saem SEM decoração (sourceHint/chips) —
 *  cada sítio decora com o próprio `available` (decorateRefOptions). */
export function perRecordCalcOperands(
  fields: CalcOperandDef[],
  sources: SourceDef[] = BUILTIN_SOURCES,
  editingKey?: string
): PerRecordOperands {
  const customNumeric: CustomNumericField[] = fields
    .filter((f) => NUMERIC_DATA_TYPES.includes(f.data_type))
    .map((f) => ({ field_key: f.field_key, label: f.label }));
  const customDateFields: CustomDateField[] = fields
    .filter((f) => f.data_type === "data")
    .map((f) => ({ field_key: f.field_key, label: f.label }));
  const customCondFields: CustomCondField[] = fields
    .filter((f) => COND_DATA_TYPES.includes(f.data_type))
    .map((f) => ({ field_key: f.field_key, label: f.label }));

  const numericRefs: OperandRef[] = [
    ...CORE_NUMERIC.map((f) => ({
      ref: f.field,
      label: f.label,
      group: "Números",
    })),
    ...customNumeric.map((f) => ({
      ref: `custom:${f.field_key}`,
      label: f.label,
      group: "Números",
    })),
    ...allDateOperands(customDateFields, sources),
    ...matchNumericOperands(customNumeric, sources),
  ];
  const allRefs: OperandRef[] = [
    ...numericRefs,
    ...allCondOperands(customCondFields, sources),
  ];

  const excludeKeys = editingKey
    ? transitiveFormulaDependents(editingKey, fields)
    : new Set<string>();
  if (editingKey) excludeKeys.add(editingKey);
  return { numericRefs, allRefs, excludeKeys };
}
