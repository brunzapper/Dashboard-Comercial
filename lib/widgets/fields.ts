// Versão: 1.0 | Data: 05/07/2026
// Campos disponíveis no construtor de widgets: colunas do núcleo (com rótulos
// PT) + campos personalizados (custom:<key>). Marca quais são numéricos
// (métricas), quais são datas (aceitam transform) e quais são FK (resolver
// rótulo id→nome no engine).
import type { FieldDefinition } from "@/lib/records/types";
import type { Aggregation, Transform } from "./types";

export type FkKind = "responsible" | "operation" | "lead";

export interface AvailableField {
  field: string; // 'stage' | 'responsible_id' | 'custom:xxx'
  label: string;
  isNumeric: boolean; // pode ser métrica sum/avg
  isDate: boolean; // aceita transform (dia/mês/...)
  fk?: FkKind;
}

// Campos do núcleo expostos no builder.
export const CORE_FIELDS: AvailableField[] = [
  { field: "record_type", label: "Tipo de registro", isNumeric: false, isDate: false },
  { field: "source_system", label: "Fonte", isNumeric: false, isDate: false },
  { field: "pipeline", label: "Pipeline", isNumeric: false, isDate: false },
  { field: "stage", label: "Etapa", isNumeric: false, isDate: false },
  { field: "stage_semantic", label: "Situação (aberto/ganho/perdido)", isNumeric: false, isDate: false },
  { field: "sale_type", label: "Tipo de venda", isNumeric: false, isDate: false },
  { field: "channel", label: "Canal", isNumeric: false, isDate: false },
  { field: "currency", label: "Moeda", isNumeric: false, isDate: false },
  { field: "closed", label: "Fechado?", isNumeric: false, isDate: false },
  { field: "responsible_id", label: "Responsável", isNumeric: false, isDate: false, fk: "responsible" },
  { field: "operation_id", label: "Operação", isNumeric: false, isDate: false, fk: "operation" },
  { field: "related_lead_id", label: "Lead relacionado", isNumeric: false, isDate: false, fk: "lead" },
  { field: "value", label: "Valor", isNumeric: true, isDate: false },
  { field: "mrr", label: "MRR", isNumeric: true, isDate: false },
  { field: "lead_time_days", label: "Lead time (dias)", isNumeric: true, isDate: false },
  { field: "closed_at", label: "Data de fechamento", isNumeric: false, isDate: true },
  { field: "opened_at", label: "Data de abertura", isNumeric: false, isDate: true },
  { field: "source_created_at", label: "Data de criação (origem)", isNumeric: false, isDate: true },
];

/** Junta os campos do núcleo com os personalizados (field_definitions). */
export function buildAvailableFields(
  customFields: FieldDefinition[]
): AvailableField[] {
  const custom = customFields.map((f) => ({
    field: `custom:${f.field_key}`,
    label: f.label,
    isNumeric: f.data_type === "numero" || f.data_type === "moeda",
    isDate: f.data_type === "data",
  }));
  return [...CORE_FIELDS, ...custom];
}

export function fieldLabel(
  field: string,
  available: AvailableField[]
): string {
  return available.find((a) => a.field === field)?.label ?? field;
}

export function fieldFk(
  field: string,
  available: AvailableField[]
): FkKind | undefined {
  return available.find((a) => a.field === field)?.fk;
}

export const AGGREGATIONS: Aggregation[] = ["sum", "count", "avg"];
export const DATE_TRANSFORMS: Transform[] = [
  "none",
  "day",
  "week",
  "month",
  "quarter",
  "year",
];
