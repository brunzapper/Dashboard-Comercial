// Versão: 1.0 | Data: 31/07/2026
// Contrato do fluxo "Atualizar registros com IA" (/registros): tipos PUROS
// compartilhados entre o validador (update-validate.ts), o core server-only
// (lib/ai/update-records.ts) e a sheet client-side
// (components/registros/ai-update-sheet.tsx).
//
// Formato do JSON que a IA devolve (uma operação por resposta):
//   { "formato": "registros-update", "versao": 1,
//     "filtros": [ { "field": "custom:fonte", "op": "eq",
//       "value": "Formulário de CRM" } ],
//     "alteracoes": { "custom:sdr_reuniao": "Paulo Vitor Santos" },
//     "notas": ["…"] }
// A base alvo NUNCA vem do JSON (seletor da UI) e a IA NUNCA emite ids de
// registro — os registros afetados são resolvidos no SERVIDOR pelos filtros
// (prévia com contagem + amostra, obrigatória antes do apply). Filtros de
// relação carregam o NOME cadastrado (§4.10 — o runtime resolve nome→id);
// `null`/"" em "alteracoes" LIMPA o campo (diferente do insert, onde vazio =
// omitir). Operadores aceitos = exatamente FILTER_OPS (lib/widgets/filter-ops)
// — op interno (eq_ci/*_num) seria DROPADO em silêncio pelo modo lista e o
// recorte casaria MAIS registros do que a prévia mostrou.
import type { DataType } from "@/lib/records/types";
import type { WidgetFilter } from "@/lib/widgets/types";
import type { EntryFieldSpec, EntryValue } from "@/lib/import/records/types";

export const RECORDS_UPDATE_FORMAT = "registros-update";
export const RECORDS_UPDATE_VERSION = 1;
/**
 * Teto de registros ALTERADOS por operação — mesmo valor de BULK_MAX_ITEMS
 * (lib/kanban/bulk-helpers.ts): o gargalo é a escrita, igual às ações em massa
 * manuais do kanban. Recorte maior = erro alto ("refine os filtros"), nunca
 * fatiamento silencioso.
 */
export const MAX_AI_UPDATE_RECORDS = 200;
/** Linhas da amostra exibida na prévia (antes → depois). */
export const RECORDS_UPDATE_SAMPLE_ROWS = 8;

/** Valor de UMA alteração: escalar canônico ou null (limpar o campo). */
export type UpdateChangeValue = EntryValue | null;

/**
 * Campo aceito em "filtros" (universo MAIOR que o de alvos: inclui colunas
 * não-editáveis e campos visíveis pelo papel — filtrar não é escrever).
 */
export interface UpdateFilterFieldSpec {
  /** Coluna core crua, `custom:<field_key>` ou `responsible_id`/`operation_id`. */
  key: string;
  label: string;
  dataType: DataType | "relacao";
  /** selecao: opções vigentes; relação: NOMES cadastrados (ajuda a IA). */
  options?: string[];
}

/** Contexto de validação/prompt de UMA base (montado no servidor). */
export interface RecordsUpdateContext {
  sourceKey: string;
  sourceLabel: string;
  recordType: string;
  /** Sub-base: a consulta da prévia aplica o predicado da pai + filtro da sub. */
  isSub: boolean;
  /** ALVOS aceitos em "alteracoes" (gating de escrita; `sync` marca Bitrix). */
  fields: EntryFieldSpec[];
  /** Campos aceitos em "filtros". */
  filterFields: UpdateFilterFieldSpec[];
  responsibles: { id: string; name: string }[];
  operations: { id: string; name: string }[];
}

/** Operação validada: filtros canônicos + alterações canônicas. */
export interface ParsedRecordsUpdate {
  /** Filtros prontos p/ o modo lista (relações com NOME — runtime resolve). */
  filters: WidgetFilter[];
  /**
   * Valores canônicos por chave do contrato (null = limpar). Relações ficam
   * com o NOME canônico aqui; os UUIDs resolvidos saem nos campos abaixo.
   */
  changes: Record<string, UpdateChangeValue>;
  /** Presente só se "alteracoes" tocou a relação (null = limpar o vínculo). */
  responsibleId?: string | null;
  operationId?: string | null;
}
