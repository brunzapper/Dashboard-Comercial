// Versão: 1.0 | Data: 30/07/2026
// Contrato do fluxo "Inserir registros com IA" (/registros): tipos PUROS
// compartilhados entre o validador (validate.ts), os helpers de prévia
// (preview.ts), o core server-only (lib/ai/insert-records.ts) e a sheet
// client-side (components/registros/ai-insert-sheet.tsx).
//
// Formato do JSON que a IA devolve (e que o cliente edita e reenvia no apply):
//   { "formato": "registros-insert", "versao": 1,
//     "registros": [ { "title": "…", "value": 1250.5, "closed_at":
//       "2026-07-28", "responsible_id": "Maria Silva",
//       "custom:origem_lead": "Indicação" } ],
//     "notas": ["…"] }
// Chaves aceitas por registro: colunas de EDITABLE_CORE_COLUMNS (nomes crus),
// `custom:<field_key>` do conjunto EDITÁVEL da base e `responsible_id`/
// `operation_id` com o NOME de exibição (o validador resolve nome→UUID). A base
// alvo NUNCA vem do JSON — é o seletor da UI (mesmo espírito da reescrita de
// `chave` do import de dashboards).
import type { DataType } from "@/lib/records/types";

export const RECORDS_INSERT_FORMAT = "registros-insert";
export const RECORDS_INSERT_VERSION = 1;
export const MAX_AI_INSERT_RECORDS = 10;

/** Valor escalar aceito numa célula do contrato. */
export type EntryValue = string | number | boolean;

/** Um registro do contrato: chave aceita → valor (ausente = coluna vazia). */
export type EntryRecord = Record<string, EntryValue>;

/**
 * Campo aceito pelo contrato (coluna da prévia). `key` é a chave do JSON:
 * coluna core crua, `custom:<field_key>` ou `responsible_id`/`operation_id`.
 */
export interface EntryFieldSpec {
  key: string;
  label: string;
  kind: "core" | "custom" | "relation";
  /** Tipo de coerção/editor ("relacao" para responsável/operação). */
  dataType: DataType | "relacao";
  /**
   * Opções do editor/validação. Custom `selecao`: validação DURA (fora da
   * lista = erro). Core select-capable (0086): SUGESTÃO (não bloqueia — as
   * options do núcleo são reescritas pelo sync). Relações: nomes cadastrados
   * (validação dura por resolução de nome). Moeda core: códigos aceitos.
   */
  options?: string[];
  /** Só options DURAS bloqueiam a validação (custom selecao/relação/moeda). */
  strictOptions?: boolean;
}

/** Contexto de validação/prompt de UMA base (montado no servidor). */
export interface RecordsEntryContext {
  sourceKey: string;
  sourceLabel: string;
  recordType: string;
  /** Campos aceitos em ORDEM de exibição (title → core → relações → customs). */
  fields: EntryFieldSpec[];
  responsibles: { id: string; name: string }[];
  operations: { id: string; name: string }[];
}

/** Registro validado: valores canônicos + relações resolvidas p/ UUID. */
export interface ParsedRecordInsert {
  /** Valores canônicos por chave do contrato (nomes de relação como exibidos). */
  values: EntryRecord;
  responsibleId: string | null;
  operationId: string | null;
}
