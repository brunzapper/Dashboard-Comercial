// Versão: 1.0 | Data: 02/10/2026
// v1.0 (02/10/2026): EXIBIÇÃO dos cartões da Tree — módulo PURO e client-safe.
//
// O que o cartão mostra deixou de ser fixo:
//   * no modo APRESENTAR, por padrão, somem o rótulo de tipo ("Indicador",
//     "Anotação"…), o "+" de nova branch, o "Agendar próxima" do ritual, o
//     concluir da etapa e os avisos de configuração — é um slide, não a mesa
//     de trabalho. O widget liga cada um de volta
//     (`settings.tree.presentation`) e CADA cartão pode forçar o rótulo de
//     tipo (`tree_nodes.display.kindBadge`, 0150);
//   * fora da apresentação tudo segue como antes (a mesa de trabalho);
//   * a cor do cartão (`display.tone`) é escolha do cartão; ausente = a cor
//     do tipo.
// Dono ÚNICO da decisão: `treeChrome`. Nenhum componente decide sozinho.

/** O que o widget deixa aparecer AO APRESENTAR (ausente = oculto). */
export interface TreePresentationSettings {
  kindBadge?: boolean;
  addBranch?: boolean;
  ritualSchedule?: boolean;
  doneToggle?: boolean;
  /** Avisos "configure…" / "sem metas para o período". */
  warnings?: boolean;
}

export const TREE_PRESENTATION_LABELS: Record<keyof TreePresentationSettings, string> = {
  kindBadge: "Tipo do cartão (Indicador, Anotação…)",
  addBranch: "Botão + (nova branch)",
  ritualSchedule: "“Agendar próxima” dos rituais",
  doneToggle: "Concluir etapa / tarefa",
  warnings: "Avisos de configuração",
};

/** Paleta dos cartões (chaves estáveis; a cor vem do CSS do app). */
export const TREE_TONES = [
  "padrao",
  "neutro",
  "verde",
  "azul",
  "violeta",
  "laranja",
  "ambar",
  "vermelho",
] as const;
export type TreeTone = (typeof TREE_TONES)[number];

export const TREE_TONE_LABELS: Record<TreeTone, string> = {
  padrao: "Cor do tipo",
  neutro: "Neutro",
  verde: "Verde",
  azul: "Azul",
  violeta: "Violeta",
  laranja: "Laranja",
  ambar: "Âmbar",
  vermelho: "Vermelho",
};

/** Classes do cartão por cor (borda + fundo leve). */
export const TREE_TONE_CLASSES: Record<Exclude<TreeTone, "padrao">, string> = {
  neutro: "border-border bg-card",
  verde: "border-emerald-600/60 bg-emerald-500/5",
  azul: "border-sky-500/50 bg-sky-500/5",
  violeta: "border-violet-500/50 bg-violet-500/5",
  laranja: "border-orange-500/50 bg-orange-500/5",
  ambar: "border-amber-500/60 bg-amber-500/10",
  vermelho: "border-red-500/50 bg-red-500/5",
};

/** Escolhas de exibição de UM cartão (`tree_nodes.display`). */
export interface TreeNodeDisplay {
  /** Rótulo de tipo ao apresentar: forçar mostrar/ocultar (ausente = widget). */
  kindBadge?: "show" | "hide";
  tone?: TreeTone;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Parse fail-closed do jsonb (chave estranha some). */
export function parseNodeDisplay(raw: unknown): TreeNodeDisplay | null {
  if (!isRecord(raw)) return null;
  const out: TreeNodeDisplay = {};
  if (raw.kindBadge === "show" || raw.kindBadge === "hide") out.kindBadge = raw.kindBadge;
  if (typeof raw.tone === "string" && (TREE_TONES as readonly string[]).includes(raw.tone)) {
    if (raw.tone !== "padrao") out.tone = raw.tone as TreeTone;
  }
  return Object.keys(out).length > 0 ? out : null;
}

/** Parse da config do widget (só booleanos verdadeiros sobrevivem). */
export function parsePresentationSettings(raw: unknown): TreePresentationSettings {
  if (!isRecord(raw)) return {};
  const out: TreePresentationSettings = {};
  for (const k of Object.keys(TREE_PRESENTATION_LABELS) as (keyof TreePresentationSettings)[]) {
    if (raw[k] === true) out[k] = true;
  }
  return out;
}

export interface TreeChrome {
  kindBadge: boolean;
  addBranch: boolean;
  ritualSchedule: boolean;
  doneToggle: boolean;
  warnings: boolean;
}

/**
 * O que UM cartão mostra. Fora da apresentação: tudo (como sempre).
 * Apresentando: o padrão do widget; o rótulo de tipo ainda obedece ao cartão.
 */
export function treeChrome(
  widget: TreePresentationSettings | null | undefined,
  node: TreeNodeDisplay | null | undefined,
  presenting: boolean
): TreeChrome {
  if (!presenting) {
    return {
      kindBadge: true,
      addBranch: true,
      ritualSchedule: true,
      doneToggle: true,
      warnings: true,
    };
  }
  const w = widget ?? {};
  const kind =
    node?.kindBadge === "show" ? true : node?.kindBadge === "hide" ? false : w.kindBadge === true;
  return {
    kindBadge: kind,
    addBranch: w.addBranch === true,
    ritualSchedule: w.ritualSchedule === true,
    doneToggle: w.doneToggle === true,
    warnings: w.warnings === true,
  };
}
