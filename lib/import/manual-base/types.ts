// Versão: 1.1 | Data: 18/09/2026
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
//
// v1.1 (18/09/2026): FAMÍLIAS (0143) e a ATUALIZAÇÃO de célula existente.
//
//  (c) O ALVO de um lançamento é a TRIPLA dado + período + COORDENADAS. Sem a
//      terceira coordenada, "corrigir ligação/Paulo de 100 para 120" não era
//      endereçável — e a rejeição de duplicata, chaveada só por dado + período,
//      recusaria as células legítimas de um cruzamento inteiro.
//
//  (d) `modo` decide o que fazer com o número que JÁ está lá: `substituir` (o
//      padrão, e o que "atualizar" quer dizer) ou `somar` (para "entraram mais
//      20"). A soma é feita no SERVIDOR sobre o valor atual, nunca pela IA —
//      ela erraria calada se o número tivesse mudado entre a prévia e o
//      Aplicar. Continua SEM verbo de exclusão.

export const MANUAL_BASE_FORMAT = "base-manual-edit";
export const MANUAL_BASE_VERSION = 1;

/**
 * O que fazer com o valor que já existe na célula.
 *
 * `substituir` é o padrão porque é o que "atualizar o dado" significa, e é o
 * que o UPSERT do choke point já fazia. `somar` existe porque o outro pedido
 * legítimo é o incremento ("entraram mais 20"), e ele sai quase de graça: a
 * prévia já precisa carregar o valor atual para mostrar a diferença.
 */
export type ManualEntryMode = "substituir" | "somar";
export const MANUAL_ENTRY_MODES: ManualEntryMode[] = ["substituir", "somar"];
export function isManualEntryMode(v: unknown): v is ManualEntryMode {
  return typeof v === "string" && (MANUAL_ENTRY_MODES as string[]).includes(v);
}

/** Tetos das seções de FAMÍLIA (0143). */
export const MAX_AI_MANUAL_FAMILIES = 5;
export const MAX_AI_MANUAL_FAMILY_MEMBERS = 30;

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

/** Uma FAMÍLIA — existente (casada) ou a criar (0143). */
export interface ParsedManualFamily {
  id?: string;
  key: string;
  label: string;
  criar: boolean;
  /** Os membros a GARANTIR. Membro existente nunca é renomeado pela IA. */
  members: { id?: string; key: string; label: string; criar: boolean }[];
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
  /** O que este lançamento endereça (0143) — chave de família → chave de
   *  membro, com `null` no RESIDUAL. `{}` é o nível ∅ (o total). */
  coords: import("@/lib/manual-base/families").ManualCoords;
  /** O que fazer com o valor que já existe na célula. */
  mode: ManualEntryMode;
  /** O valor ATUAL da célula, resolvido no SERVIDOR (nunca vindo do JSON), ou
   *  null quando a célula é nova. É o que faz a prévia dizer "100 → 120" em vez
   *  de exibir uma linha nova indistinguível de uma criação. */
  currentValue: number | null;
  /** O que a IA leu, para a prévia mostrar sem consultar nada. */
  seriesLabel: string;
  responsibleName: string | null;
  operationName: string | null;
  /** "Canal: Ligação · Vendedor: Paulo" — legível, para a prévia. */
  coordLabel: string | null;
}

export interface ParsedManualBaseEdit {
  series: ParsedManualSeries[];
  families: ParsedManualFamily[];
  entries: ParsedManualEntry[];
  notes: string[];
}

/** Catálogo FRESCO — carregado na geração E de novo no apply. */
export interface ManualBaseEditContext {
  series: { id: string; key: string; label: string }[];
  responsibles: { id: string; name: string }[];
  operations: { id: string; name: string }[];
  /** As FAMÍLIAS cadastradas mais as EMBUTIDAS (0143), com os membros. */
  families: {
    key: string;
    label: string;
    builtin: boolean;
    members: { key: string; label: string }[];
  }[];
  /** `chave do dado` → chaves de família DECLARADAS. */
  declarations: Record<string, string[]>;
  /** Os lançamentos que JÁ existem, para a prévia dizer o que muda. Vêm do
   *  servidor; o apply os relê. */
  existing: {
    seriesKey: string;
    periodStart: string;
    periodEnd: string;
    responsibleId: string | null;
    operationId: string | null;
    coords: import("@/lib/manual-base/families").ManualCoords;
    value: number;
  }[];
  /** Hoje em Brasília (`YYYY-MM-DD`) — o SPEC manda usar data absoluta, e o
   *  validador precisa de uma referência para recusar o que for relativo. */
  today: string;
}

export type ManualBaseValidation =
  | { ok: true; parsed: ParsedManualBaseEdit; warnings: string[] }
  | { ok: false; errors: string[] };
