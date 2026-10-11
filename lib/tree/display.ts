// Versão: 1.2 | Data: 11/10/2026
// v1.2 (11/10/2026): mais cores e cor LIVRE — a paleta ganha rosa, ciano,
//   índigo, lima, turquesa, cinza e escuro; o cartão aceita borda e fundo em
//   #RRGGBB (vencem o tom); o widget define um padrão de cor
//   (`settings.tree.card`) que cada cartão sobrepõe (`resolveCardColors`).
//   `display.fit`/`display.numbers`: texto que não cabe e números grandes do
//   cartão (lib/tree/card-fit.ts).
// Versão: 1.1 | Data: 11/10/2026
// v1.1 (11/10/2026): `TreeNodeDisplay.typography` — fonte e tamanho por tipo
//   de texto DESTE cartão, sobre o padrão do widget (lib/tree/typography.ts).
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

import type { CSSProperties } from "react";
import { normalizeHexColor } from "@/lib/theme";
import { parseTreeTypography, type TreeTypography } from "./typography";
import {
  parseCardFit,
  parseNumberFormat,
  type TreeCardFit,
  type TreeNumberFormat,
} from "./card-fit";

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
  // v1.2
  "rosa",
  "ciano",
  "indigo",
  "lima",
  "turquesa",
  "cinza",
  "escuro",
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
  rosa: "Rosa",
  ciano: "Ciano",
  indigo: "Índigo",
  lima: "Lima",
  turquesa: "Turquesa",
  cinza: "Cinza",
  escuro: "Escuro",
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
  rosa: "border-pink-500/50 bg-pink-500/5",
  ciano: "border-cyan-500/50 bg-cyan-500/5",
  indigo: "border-indigo-500/50 bg-indigo-500/5",
  lima: "border-lime-500/60 bg-lime-500/10",
  turquesa: "border-teal-500/50 bg-teal-500/5",
  cinza: "border-zinc-400/70 bg-zinc-500/10",
  escuro: "border-zinc-700 bg-zinc-800 text-zinc-50 dark:border-zinc-500 dark:bg-zinc-900",
};

/** v1.2: cor do cartão — tom da paleta e/ou borda/fundo livres (#RRGGBB). */
export interface TreeCardColors {
  tone?: TreeTone;
  borderColor?: string;
  bgColor?: string;
}

/** Parse fail-closed das cores (tom "padrao" = ausência). */
export function parseCardColors(raw: unknown): TreeCardColors | null {
  if (!isRecord(raw)) return null;
  const out: TreeCardColors = {};
  if (typeof raw.tone === "string" && (TREE_TONES as readonly string[]).includes(raw.tone)) {
    if (raw.tone !== "padrao") out.tone = raw.tone as TreeTone;
  }
  const border = normalizeHexColor(raw.borderColor);
  if (border) out.borderColor = border;
  const bg = normalizeHexColor(raw.bgColor);
  if (bg) out.bgColor = bg;
  return Object.keys(out).length > 0 ? out : null;
}

/**
 * v1.2: a cor EFETIVA de um cartão. O cartão vence o widget por propriedade;
 * a cor livre vence o tom (e só a propriedade escolhida: borda livre + tom
 * mantém o fundo do tom). `goal` (Resultado) mantém o destaque âmbar contra
 * o padrão do WIDGET — só a escolha do próprio cartão o substitui.
 */
export function resolveCardColors(
  widget: TreeCardColors | null | undefined,
  node: TreeCardColors | null | undefined,
  goal = false
): { tone: Exclude<TreeTone, "padrao"> | null; style: CSSProperties | undefined } {
  const w = goal ? null : widget;
  const tone = (node?.tone ?? w?.tone ?? null) as Exclude<TreeTone, "padrao"> | null;
  const border = normalizeHexColor(node?.borderColor ?? w?.borderColor);
  const bg = normalizeHexColor(node?.bgColor ?? w?.bgColor);
  const style: CSSProperties = {};
  if (border) style.borderColor = border;
  if (bg) style.backgroundColor = bg;
  return { tone, style: Object.keys(style).length > 0 ? style : undefined };
}

/** Escolhas de exibição de UM cartão (`tree_nodes.display`). */
export interface TreeNodeDisplay {
  /** Rótulo de tipo ao apresentar: forçar mostrar/ocultar (ausente = widget). */
  kindBadge?: "show" | "hide";
  tone?: TreeTone;
  /** v1.2: borda/fundo livres (#RRGGBB) — vencem o tom. */
  borderColor?: string;
  bgColor?: string;
  /** v1.1: fonte/tamanho por tipo de texto (vence o widget por propriedade). */
  typography?: TreeTypography;
  /** v1.2: texto que não cabe (cartão cresce / texto encolhe / corta). */
  fit?: TreeCardFit;
  /** v1.2: abreviação de números grandes. */
  numbers?: TreeNumberFormat;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Parse fail-closed do jsonb (chave estranha some). */
export function parseNodeDisplay(raw: unknown): TreeNodeDisplay | null {
  if (!isRecord(raw)) return null;
  const out: TreeNodeDisplay = {};
  if (raw.kindBadge === "show" || raw.kindBadge === "hide") out.kindBadge = raw.kindBadge;
  const colors = parseCardColors(raw);
  if (colors) Object.assign(out, colors);
  const typography = parseTreeTypography(raw.typography);
  if (typography) out.typography = typography;
  const fit = parseCardFit(raw.fit);
  if (fit) out.fit = fit;
  const numbers = parseNumberFormat(raw.numbers);
  if (numbers) out.numbers = numbers;
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
