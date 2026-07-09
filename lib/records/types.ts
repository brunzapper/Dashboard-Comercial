// Versão: 1.1 | Data: 09/07/2026
// Tipos compartilhados de registros e definições de campo (UI da Fase 4).
// v1.1 (09/07/2026): Fase 7 — DataType ganha 'booleano' (campos Y/N do Bitrix)
//   e 'calculado' (campo com fórmula); FieldDefinition ganha source_system,
//   source_field_id, show_in_builder e formula.
import type { Formula } from "./formulas";

export type DataType =
  | "texto"
  | "numero"
  | "data"
  | "selecao"
  | "moeda"
  | "booleano"
  | "calculado";

export const DATA_TYPE_LABELS: Record<DataType, string> = {
  texto: "Texto",
  numero: "Número",
  data: "Data",
  selecao: "Seleção",
  moeda: "Moeda",
  booleano: "Booleano",
  calculado: "Calculado",
};

// Tipos numéricos: podem ser métrica (soma/média) e operando de fórmula.
export const NUMERIC_DATA_TYPES: DataType[] = ["numero", "moeda", "calculado"];

export interface FieldDefinition {
  id: string;
  field_key: string;
  label: string;
  data_type: DataType;
  options: string[];
  visible_to_roles: string[];
  editable_by_roles: string[];
  is_local: boolean;
  sort_order: number;
  // Fase 7 (podem vir null em linhas antigas até o próximo select/migração):
  source_system?: string | null;
  source_field_id?: string | null;
  show_in_builder?: boolean;
  formula?: Formula | null;
}

export interface RecordRow {
  id: string;
  record_type: "lead" | "negocio" | "venda_site";
  source_system: "bitrix" | "sheet_site" | "manual";
  title: string | null;
  pipeline: string | null;
  stage: string | null;
  value: number | null;
  mrr: number | null;
  currency: string | null;
  sale_type: string | null;
  channel: string | null;
  closed: boolean;
  closed_at: string | null;
  responsible_id: string | null;
  operation_id: string | null;
  related_lead_id: string | null;
  lead_time_days: number | null;
  custom_fields: Record<string, unknown>;
  last_synced_at: string | null;
  locally_modified_at: string | null;
}

export const RECORD_TYPE_LABELS: Record<RecordRow["record_type"], string> = {
  lead: "Lead",
  negocio: "Negócio",
  venda_site: "Venda do site",
};

export interface OptionItem {
  id: string;
  label: string;
}
