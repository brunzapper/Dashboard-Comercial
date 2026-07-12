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
import {
  isEditableCoreColumn,
  isEditableRelation,
} from "@/lib/config/core-writeback";
import { resolveFieldMoney } from "./currency";
import type { Aggregation, Transform } from "./types";

export type FkKind = "responsible" | "operation" | "lead";

export interface AvailableField {
  field: string; // 'stage' | 'responsible_id' | 'custom:xxx' | 'unified:xxx'
  label: string;
  isNumeric: boolean; // pode ser métrica sum/avg
  isDate: boolean; // aceita transform (dia/mês/...)
  // Métrica monetária: value/mrr (moeda do registro) ou campo 'moeda'/'calculado'
  // -moeda. Habilita as opções de moeda/conversão da métrica no construtor.
  isMoney?: boolean;
  fk?: FkKind;
  unified?: boolean; // campo vindo de uma correspondência
  // Pode ser editável inline na tabela de registros (custom não calculado, ou
  // coluna do núcleo suportada). O toggle "Editável" do builder só aparece p/ estes.
  editableCapable?: boolean;
  // Editar esta coluna pode gravar de volta no Bitrix (custom de Sync, ou coluna
  // do núcleo mapeada). Habilita o toggle "Gravar no Bitrix".
  writable?: boolean;
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
  { field: "value", label: "Valor", isNumeric: true, isDate: false, isMoney: true },
  { field: "mrr", label: "MRR", isNumeric: true, isDate: false, isMoney: true },
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
  const core = CORE_FIELDS.map((f) => ({
    ...f,
    // Colunas do núcleo editáveis inline: as colunas suportadas (write-back) OU as
    // relações editáveis (responsável — local, sem write-back). `writable` (a caixa
    // "Gravar no Bitrix") continua só para as colunas mapeadas ao Bitrix.
    editableCapable: isEditableCoreColumn(f.field) || isEditableRelation(f.field),
    writable: isEditableCoreColumn(f.field),
  }));
  const custom = customFields.map((f) => ({
    field: `custom:${f.field_key}`,
    label: f.label,
    isNumeric: NUMERIC_DATA_TYPES.includes(f.data_type),
    isDate: f.data_type === "data",
    isMoney: resolveFieldMoney(f).isMoney,
    editableCapable: f.data_type !== "calculado",
    // Campo de Sync do Bitrix (custom com source_field_id) → grava de volta.
    writable: f.source_system === "bitrix" && Boolean(f.source_field_id),
  }));
  const unified = correspondences.map((c) => ({
    field: `unified:${c.key}`,
    label: `↔ ${c.label}`,
    isNumeric: NUMERIC_DATA_TYPES.includes(c.data_type),
    isDate: c.data_type === "data",
    isMoney: c.data_type === "moeda",
    unified: true,
  }));
  return [...core, ...custom, ...unified];
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
// Lista exibida na UI (o RPC ainda aceita os legados day/week/month). Ordem:
// dia da semana, semanas, mês por nome, mês/ano, trimestre, ano.
export const DATE_TRANSFORMS: Transform[] = [
  "none",
  "weekday",
  "week_year",
  "week_month",
  "month_name",
  "month_year",
  "quarter",
  "year",
];
