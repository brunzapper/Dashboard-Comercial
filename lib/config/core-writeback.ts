// Versão: 1.0 | Data: 11/07/2026
// Colunas do NÚCLEO de `records` que podem ser editadas manualmente e (quando o
// registro veio do Bitrix) gravadas de volta. O mapa abaixo diz, por coluna, qual
// é o campo do Bitrix por entidade (deal/lead) — derivado do mapeamento único de
// lib/config/bitrix-field-map.ts. A conversão de valor DE VOLTA (rótulo→id, número,
// data, boolean) já é feita pela fila (lib/sync/bitrix/writeback.ts:toBitrixValue)
// a partir do schema do campo; aqui só apontamos o source_field_id certo.
//
// Nota: `stage` (crm_status) e `pipeline` (crm_category) exigem resolução
// nome→id que o conversor atual não cobre — o item fica 'error' na fila e a
// edição LOCAL é preservada (melhoria futura). Entre as relações, `responsible_id`
// grava de volta o dono (ASSIGNED_BY_ID): o uuid local é traduzido p/
// responsibles.bitrix_user_id no enfileiramento (lib/records/actions.ts). O lead
// relacionado é editável inline (combobox de busca), mas permanece LOCAL — assim
// como a operação, não grava de volta no Bitrix.
import { DEAL_CORE, LEAD_CORE } from "./bitrix-field-map";
import type { DataType } from "@/lib/records/types";

export interface CoreWriteBackTarget {
  deal?: string;
  lead?: string;
}

// Coluna do núcleo → campo do Bitrix por entidade.
export const CORE_WRITEBACK: Record<string, CoreWriteBackTarget> = {
  title: { deal: DEAL_CORE.title, lead: LEAD_CORE.title },
  stage: { deal: DEAL_CORE.stageId, lead: LEAD_CORE.stageId },
  value: { deal: DEAL_CORE.value, lead: LEAD_CORE.value },
  mrr: { deal: DEAL_CORE.mrr }, // lead não tem MRR
  currency: { deal: DEAL_CORE.currency, lead: LEAD_CORE.currency },
  channel: { deal: DEAL_CORE.channel },
  sale_type: { deal: DEAL_CORE.saleType },
  closed: { deal: DEAL_CORE.closed },
  closed_at: { deal: DEAL_CORE.closedAt },
  opened_at: { deal: DEAL_CORE.openedAt },
  pipeline: { deal: DEAL_CORE.categoryId },
  // Responsável (dono): grava ASSIGNED_BY_ID. O valor enfileirado NÃO é o uuid
  // local de `responsibles`, e sim o `bitrix_user_id` resolvido em actions.ts.
  responsible_id: { deal: DEAL_CORE.assignedById, lead: LEAD_CORE.assignedById },
};

// Colunas do núcleo editáveis inline + o tipo p/ coerção/validação (espelha DataType).
export const EDITABLE_CORE_COLUMNS: Record<string, DataType> = {
  title: "texto",
  stage: "texto",
  value: "moeda",
  mrr: "moeda",
  currency: "texto",
  channel: "texto",
  sale_type: "texto",
  closed: "booleano",
  closed_at: "data",
  opened_at: "data",
  pipeline: "texto",
};

export function isEditableCoreColumn(field: string): boolean {
  return Object.prototype.hasOwnProperty.call(EDITABLE_CORE_COLUMNS, field);
}

// Relações editáveis inline (registros individuais): editam uma coluna FK de
// `records` via um SELECT das entidades elegíveis. `responsible_id` usa uma lista
// fixa (responsáveis ativos); `related_lead_id` usa um combobox pesquisável de
// leads (searchLeads). Ambos gravam a FK localmente — só o responsável tem
// write-back no Bitrix (ver WRITEBACK_RELATION_FIELDS).
export const EDITABLE_RELATION_FIELDS = new Set<string>([
  "responsible_id",
  "related_lead_id",
]);

export function isEditableRelation(field: string): boolean {
  return EDITABLE_RELATION_FIELDS.has(field);
}

// Relações que TAMBÉM podem gravar de volta no Bitrix (write-back). Hoje só
// `responsible_id` (→ ASSIGNED_BY_ID, via bitrix_user_id do responsável).
// Operação/lead não têm equivalente e permanecem locais.
export const WRITEBACK_RELATION_FIELDS = new Set<string>(["responsible_id"]);

export function isWriteBackRelation(field: string): boolean {
  return WRITEBACK_RELATION_FIELDS.has(field);
}

// source_field_id do Bitrix p/ uma coluna do núcleo, conforme a entidade.
export function coreWriteBackFieldId(
  field: string,
  entity: "deal" | "lead"
): string | null {
  return CORE_WRITEBACK[field]?.[entity] ?? null;
}
