// Versão: 1.1 | Data: 10/09/2026
// v1.1 (10/09/2026): só vocabulário — o substantivo da ocorrência
//   da série saiu do código e virou dado (SeriesConfig.noun, e
//   tasks.occurrence_noun por tarefa).
// REGISTRY dos atributos de registro (0131).
//
// Um "atributo" é uma funcionalidade de Operação pendurada num registro — o
// que a tabela do dashboard abre quando alguém clica na linha. O primeiro é a
// Tree (a árvore de acompanhamento); o segundo entra aqui, não numa migração.
//
// A chave vive em CÓDIGO de propósito: uma tabela de tipos daria a ilusão de
// que dá para criar atributo sem programar, e o que torna um atributo útil é
// justamente a TELA que ele abre. Atributo novo = entrada aqui + a superfície.
//
// Módulo PURO e client-safe (a tabela e o construtor são componentes client) —
// precedente literal de lib/operacao/cards.ts (server-only) × lib/ai/operacao/
// scopes.ts (puro). Nada de I/O aqui: quem lê o banco é lib/attributes/load.ts.

/** O que a superfície do atributo desenha. Sem superfície, não há o que abrir. */
export type AttributeSurface = "tree";

export interface AttributeDef {
  key: string;
  label: string;
  /** Uma linha, no registro de quem opera — vira o texto do construtor. */
  description: string;
  surface: AttributeSurface;
}

export const ATTRIBUTE_REGISTRY: AttributeDef[] = [
  {
    key: "tree",
    label: "Tree",
    description:
      "Árvore de acompanhamento do registro: as tarefas da série, as anotações e o que foi feito em cada uma.",
    surface: "tree",
  },
];

export function attributeDef(key: string): AttributeDef | null {
  return ATTRIBUTE_REGISTRY.find((a) => a.key === key) ?? null;
}

/** Status da participação. `pausado` NÃO tira o registro da funcionalidade. */
export type AttributeStatus = "ativo" | "pausado";

export const ATTRIBUTE_STATUS_LABELS: Record<AttributeStatus, string> = {
  ativo: "Ativo",
  pausado: "Pausado",
};

/** Uma linha de `record_attributes` já parseada. */
export interface RecordAttribute {
  id: string;
  recordId: string;
  attributeKey: string;
  status: AttributeStatus;
  grantedByRuleId: string | null;
  config: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

/**
 * Rótulo de exibição de um atributo — inclusive de chave DESCONHECIDA (um
 * atributo cujo código saiu, ou que veio de uma versão mais nova). A linha
 * existe no banco: escondê-la seria pior que mostrá-la sem superfície.
 */
export function attributeLabel(key: string): string {
  return attributeDef(key)?.label ?? key;
}

/** O atributo tem tela para abrir? Chave fora do registry, não. */
export function attributeHasSurface(key: string): boolean {
  return attributeDef(key) != null;
}
