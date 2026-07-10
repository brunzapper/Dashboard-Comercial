// Versão: 1.2 | Data: 09/07/2026
// Campos disponíveis no construtor de widgets: colunas do núcleo (com rótulos
// PT) + campos personalizados (custom:<key>). Marca quais são numéricos
// (métricas), quais são datas (aceitam transform) e quais são FK (resolver
// rótulo id→nome no engine).
// v1.1 (09/07/2026): Fase 7 — 'calculado' conta como numérico (métrica); a
//   filtragem por show_in_builder é feita por quem carrega os field_definitions.
// v1.2 (09/07/2026): Fase 8 — buildAvailableFields agrega os campos UNIFICADOS
//   (unified:<key>) vindos das correspondências globais.
import { NUMERIC_DATA_TYPES, type FieldDefinition } from "@/lib/records/types";
import type { Correspondence } from "@/lib/correspondences";
import type { Aggregation, Transform } from "./types";

export type FkKind = "responsible" | "operation" | "lead";

export interface AvailableField {
  field: string; // 'stage' | 'responsible_id' | 'custom:xxx' | 'unified:xxx'
  label: string;
  isNumeric: boolean; // pode ser métrica sum/avg
  isDate: boolean; // aceita transform (dia/mês/...)
  fk?: FkKind;
  unified?: boolean; // campo vindo de uma correspondência
}

// Campos do núcleo expostos no builder.
export const CORE_FIELDS: AvailableField[] = [
  { field: "title", label: "Nome (título)", isNumeric: false, isDate: false },
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

/**
 * Junta os campos do núcleo + personalizados (field_definitions) + unificados
 * (correspondências globais). Os unificados aparecem como `unified:<key>`.
 */
export function buildAvailableFields(
  customFields: FieldDefinition[],
  correspondences: Correspondence[] = []
): AvailableField[] {
  const custom = customFields.map((f) => ({
    field: `custom:${f.field_key}`,
    label: f.label,
    isNumeric: NUMERIC_DATA_TYPES.includes(f.data_type),
    isDate: f.data_type === "data",
  }));
  const unified = correspondences.map((c) => ({
    field: `unified:${c.key}`,
    label: `↔ ${c.label}`,
    isNumeric: NUMERIC_DATA_TYPES.includes(c.data_type),
    isDate: c.data_type === "data",
    unified: true,
  }));
  return [...CORE_FIELDS, ...custom, ...unified];
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
