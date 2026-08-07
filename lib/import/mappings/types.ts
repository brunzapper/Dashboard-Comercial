// Versão: 1.0 | Data: 07/08/2026
// Contrato "mapeamentos-classify" v1 — classificação de valores PENDENTES do
// de-para (0117) por IA (interna via chat OU externa via copiar-prompt →
// colar-JSON). Tipos PUROS compartilhados por validador, SPEC, core e UI.
// A IA devolve UM lote de itens { valor, saidas } — o valor DEVE ser um dos
// pendentes do domínio e as saídas DEVEM usar as categorias aceitas
// (canônicas do registry ∪ já usadas nas entradas). O apply grava entradas
// `origin='ai'` pelos mesmos upserts da página e reaplica o domínio.

export const MAPPINGS_CLASSIFY_FORMAT = "mapeamentos-classify";
export const MAPPINGS_CLASSIFY_VERSION = 1;
/** Teto de itens por resposta (o excedente é erro — a IA fatia em turnos). */
export const MAX_AI_MAPPING_ITEMS = 150;

/** Contexto FRESCO contra o qual o JSON é validado (geração E apply). */
export interface MappingsClassifyContext {
  domainKey: string;
  domainLabel: string;
  rawFieldLabel: string;
  targets: { fieldKey: string; label: string }[];
  /** Categorias aceitas por target: canônicas do domínio ∪ já usadas. */
  optionsByTarget: Record<string, string[]>;
  /** Valores pendentes (sem entrada no de-para), com contagem de registros. */
  pending: { value: string; norm: string; count: number }[];
}

/** Item validado — a prévia (editável) e o apply renderizam daqui. */
export interface ParsedMappingItem {
  /** Forma canônica do valor pendente (a registrada nos registros). */
  rawValue: string;
  rawNorm: string;
  outputs: Record<string, string>;
  /** Registros afetados (exibição na prévia). */
  count: number;
}

export interface MappingsClassifyValidation {
  ok: boolean;
  errors: string[];
  warnings: string[];
  items: ParsedMappingItem[];
}
