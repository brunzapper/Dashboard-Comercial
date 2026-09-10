// Versão: 1.0 | Data: 09/09/2026
// QUEM ESPELHA NO BITRIX — a resolução dos três níveis, pura.
//
// A configuração é em cascata, do mais geral para o mais específico, e cada
// nível pode sobrepor o anterior:
//
//   1. BASE       (`data_sources.bitrix_activity_owner`) — "as tarefas de
//                  Deals viram atividade do negócio". É o default de todas as
//                  tarefas ligadas a um registro daquela Base.
//   2. REGRA      (`mirrorBitrix` na ação da automação/série) — "esta série
//                  não espelha", ou "esta espelha mesmo que a Base não".
//   3. TAREFA     (a caixa no formulário) — a decisão de quem está criando
//                  aquela tarefa específica.
//
// Por que os três, e não só o mais simples: a Base sozinha não deixa desligar
// uma série ruidosa; a regra sozinha não cobre a tarefa criada à mão; e a
// caixa sozinha obrigaria a marcar toda vez. Cada nível resolve o que o
// anterior não alcança.
//
// Módulo PURO: o formulário é client e precisa mostrar a caixa já no estado
// certo antes de qualquer ida ao servidor. Quem lê o banco é o enfileirador.

/** A entidade do CRM onde a atividade fica pendurada. */
export type MirrorOwnerEntity = "deal" | "lead";

/**
 * A escolha de um nível que pode HERDAR. "herdar" não é o mesmo que "nunca":
 * é a ausência de decisão, e é o padrão de toda regra existente — por isso
 * ligar o espelho na Base liga as séries que já rodam, sem editá-las.
 */
export type MirrorChoice = "herdar" | "sempre" | "nunca";

export const MIRROR_CHOICE_LABELS: Record<MirrorChoice, string> = {
  herdar: "Como a Base define",
  sempre: "Sempre espelhar",
  nunca: "Nunca espelhar",
};

export interface MirrorInput {
  /**
   * `data_sources.bitrix_activity_owner` da Base do registro vinculado.
   * null = a Base não espelha (o estado de todas, hoje).
   */
  baseOwner: MirrorOwnerEntity | null;
  /** O vínculo do registro com o CRM (`records.source_id`). */
  sourceId: string | null;
  /** Nível 2: a escolha da regra. Ausente = herdar. */
  ruleChoice?: MirrorChoice;
  /** Nível 3: a caixa do formulário. Ausente = herdar. */
  taskChoice?: MirrorChoice;
}

export interface MirrorDecision {
  mirror: boolean;
  ownerEntity: MirrorOwnerEntity | null;
  ownerSourceId: string | null;
  /** Por que não espelha — para a UI explicar em vez de só desabilitar. */
  reason?: string;
}

/**
 * Decide se ESTA tarefa vira atividade no Bitrix, e onde ela fica pendurada.
 *
 * A ordem é específico → geral, mas há um piso que nenhuma escolha atravessa:
 * sem um registro vinculado ao CRM não existe onde pendurar a atividade. Marcar
 * "sempre" numa tarefa solta não pode inventar um dono — devolve o motivo, e a
 * tela diz por que a caixa não vale.
 */
export function resolveMirror(input: MirrorInput): MirrorDecision {
  const off = (reason: string): MirrorDecision => ({
    mirror: false,
    ownerEntity: null,
    ownerSourceId: null,
    reason,
  });

  // O nível mais específico que tenha DECIDIDO alguma coisa.
  const choice =
    input.taskChoice && input.taskChoice !== "herdar"
      ? input.taskChoice
      : input.ruleChoice && input.ruleChoice !== "herdar"
        ? input.ruleChoice
        : "herdar";

  if (choice === "nunca") return off("Espelho desligado para esta tarefa.");

  // "herdar" cai na Base; "sempre" ainda precisa da Base para saber a ENTIDADE
  // (uma atividade sem OWNER_TYPE_ID não existe no Bitrix).
  if (!input.baseOwner) {
    return off(
      choice === "sempre"
        ? "A Base deste registro não está configurada para espelhar no Bitrix."
        : "A Base deste registro não espelha tarefas no Bitrix."
    );
  }
  if (!input.sourceId) {
    return off("Este registro não tem par no Bitrix (sem vínculo com o CRM).");
  }

  return {
    mirror: true,
    ownerEntity: input.baseOwner,
    ownerSourceId: input.sourceId,
  };
}

/** OWNER_TYPE_ID do Bitrix — os códigos do CRM. Lead = 1, Deal = 2. */
export const BITRIX_OWNER_TYPE_ID: Record<MirrorOwnerEntity, number> = {
  lead: 1,
  deal: 2,
};

export function parseMirrorChoice(raw: unknown): MirrorChoice {
  return raw === "sempre" || raw === "nunca" ? raw : "herdar";
}
