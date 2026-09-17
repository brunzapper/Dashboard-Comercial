// Versão: 1.0 | Data: 17/09/2026
// Contrato do assistente da BASE MANUAL (padrão §4.17): a pessoa cola a tabela
// que o Meetime, o Apollo ou a planilha cospem, e a IA devolve DADOS e
// LANÇAMENTOS. A escrita continua sendo dos choke points de
// app/(app)/registros/base-manual/actions.ts — a IA nunca grava (invariante
// 25), e o apply RE-VALIDA o JSON lido da linha da sessão.
//
// Duas decisões que moldam o contrato:
//
//  (a) IDS NUNCA VÊM DO JSON. O dado é casado por RÓTULO ou por chave;
//      responsável e operação, por NOME. É a mesma regra dos filtros por nome
//      (31/07/2026) e a razão de o validador precisar do catálogo FRESCO.
//      Diferença deliberada: aqui nome DESCONHECIDO é ERRO amigável, não o
//      uuid-zero silencioso do runtime — quem cola a tabela pode corrigir na
//      hora, e um lançamento atribuído ao vazio é pior que um erro.
//
//  (b) NÃO EXISTE EXCLUSÃO. Precedente de operações e de /operacao/tarefas:
//      apagar em lote a partir de linguagem natural é destrutivo demais. O que
//      existe é o UPSERT — relançar a tabela do mês ATUALIZA os números, e é
//      justamente o que "ir atualizando conforme o mês avança" pede. Excluir
//      fica na grade, onde é um clique com confirmação.

export const MANUAL_BASE_FORMAT = "base-manual-edit";
export const MANUAL_BASE_VERSION = 1;

/**
 * Tetos do lote. Um lançamento é uma chamada de action com round-trip próprio,
 * e a tabela típica de mensageria tem 5 colunas × poucas linhas. Precedente
 * dos demais contratos (MAX_AI_TASK_ACTIONS e afins).
 */
export const MAX_AI_MANUAL_SERIES = 20;
export const MAX_AI_MANUAL_ENTRIES = 120;

/** Um DADO — existente (casado) ou a criar. */
export interface ParsedManualSeries {
  /** Existe? Então o id resolvido; a criar, ausente. */
  id?: string;
  /** Chave definitiva (`manual:<chave>`). Na criação, derivada do rótulo. */
  key: string;
  label: string;
  /** Só na criação: o dado existente NUNCA é renomeado pela IA (precedente
   *  de operações). */
  criar: boolean;
}

/** Um LANÇAMENTO já resolvido contra o catálogo fresco. */
export interface ParsedManualEntry {
  /** Chave do dado (casa com ParsedManualSeries.key). */
  seriesKey: string;
  periodStart: string;
  periodEnd: string;
  value: number;
  responsibleId: string | null;
  operationId: string | null;
  /** Ausente = herda o padrão do DADO, resolvido no choke point. */
  spread?: import("@/lib/manual-base/types").ManualSpread;
  /** O que a IA leu, para a prévia mostrar sem consultar nada. */
  seriesLabel: string;
  responsibleName: string | null;
  operationName: string | null;
}

export interface ParsedManualBaseEdit {
  series: ParsedManualSeries[];
  entries: ParsedManualEntry[];
  notes: string[];
}

/** Catálogo FRESCO — carregado na geração E de novo no apply. */
export interface ManualBaseEditContext {
  series: { id: string; key: string; label: string }[];
  responsibles: { id: string; name: string }[];
  operations: { id: string; name: string }[];
  /** Hoje em Brasília (`YYYY-MM-DD`) — o SPEC manda usar data absoluta, e o
   *  validador precisa de uma referência para recusar o que for relativo. */
  today: string;
}

export type ManualBaseValidation =
  | { ok: true; parsed: ParsedManualBaseEdit; warnings: string[] }
  | { ok: false; errors: string[] };
