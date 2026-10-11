// Versão: 1.0 | Data: 11/10/2026
// v1.0 (11/10/2026): TEXTO QUE NÃO CABE e NÚMEROS GRANDES nos cartões da Tree
//   — módulo PURO e client-safe (o editor é Client Component).
//
// Com fonte/tamanho configuráveis (lib/tree/typography.ts) o texto passou a
// poder estourar o cartão. Duas decisões, nas MESMAS duas camadas da
// tipografia (widget `settings.tree.*` → cartão `tree_nodes.display.*`; o
// cartão vence por propriedade):
//   * `fit` — o que fazer quando não cabe: o CARTÃO cresce até caber (padrão;
//     ainda "apertado", com `padding` px das bordas e teto `maxWidth`), o
//     TEXTO encolhe até caber, ou CORTA (o comportamento anterior);
//   * `numbers` — abreviação: "auto" (padrão) só abrevia quando o número não
//     cabe na célula, "sempre" ou "nunca"; estilo k/M/B ("125,4k"), mil/mi/bi
//     ("30 mil") ou sufixos PRÓPRIOS; casas decimais (padrão 1), que caem uma a
//     uma até caber.
// `numberCandidates` é o dono ÚNICO da sequência "do mais longo ao mais
// curto"; quem escolhe o que cabe é a tela (FitNumber, tree-typography.tsx).

import { formatIndicatorValue, type IndicatorUnit } from "@/lib/indicators/model";

// ------------------------------------------------------------------ ajuste

export const TREE_FIT_MODES = ["cartao", "texto", "cortar"] as const;
export type TreeFitMode = (typeof TREE_FIT_MODES)[number];

export const TREE_FIT_MODE_LABELS: Record<TreeFitMode, string> = {
  cartao: "Ajustar o cartão (cresce até caber)",
  texto: "Diminuir o texto até caber",
  cortar: "Cortar o que sobrar",
};

export const TREE_FIT_PADDING_MAX = 24;
export const TREE_FIT_MAX_WIDTH_MIN = 160;
export const TREE_FIT_MAX_WIDTH_MAX = 1600;

export interface TreeCardFit {
  overflow?: TreeFitMode;
  /** Distância do conteúdo às bordas (px) no modo "cartao". */
  padding?: number;
  /** Teto da largura no modo "cartao" (px); o texto quebra linha acima dele. */
  maxWidth?: number;
}

export interface ResolvedCardFit {
  overflow: TreeFitMode;
  padding: number;
  maxWidth: number;
}

export const DEFAULT_CARD_FIT: ResolvedCardFit = { overflow: "cartao", padding: 4, maxWidth: 560 };

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function intIn(v: unknown, min: number, max: number): number | null {
  const n = typeof v === "string" ? Number(v) : v;
  if (typeof n !== "number" || !Number.isFinite(n)) return null;
  const r = Math.round(n);
  return r >= min && r <= max ? r : null;
}

/** Parse fail-closed. Vazio = null. */
export function parseCardFit(raw: unknown): TreeCardFit | null {
  if (!isRecord(raw)) return null;
  const out: TreeCardFit = {};
  if ((TREE_FIT_MODES as readonly unknown[]).includes(raw.overflow)) out.overflow = raw.overflow as TreeFitMode;
  const padding = intIn(raw.padding, 0, TREE_FIT_PADDING_MAX);
  if (padding != null) out.padding = padding;
  const maxWidth = intIn(raw.maxWidth, TREE_FIT_MAX_WIDTH_MIN, TREE_FIT_MAX_WIDTH_MAX);
  if (maxWidth != null) out.maxWidth = maxWidth;
  return Object.keys(out).length > 0 ? out : null;
}

/** Cartão > widget > padrão, por propriedade. */
export function resolveCardFit(
  widget: TreeCardFit | null | undefined,
  node: TreeCardFit | null | undefined
): ResolvedCardFit {
  return {
    overflow: node?.overflow ?? widget?.overflow ?? DEFAULT_CARD_FIT.overflow,
    padding: node?.padding ?? widget?.padding ?? DEFAULT_CARD_FIT.padding,
    maxWidth: node?.maxWidth ?? widget?.maxWidth ?? DEFAULT_CARD_FIT.maxWidth,
  };
}

// ------------------------------------------------------------------ números

export const TREE_ABBREVIATE_MODES = ["auto", "sempre", "nunca"] as const;
export type TreeAbbreviateMode = (typeof TREE_ABBREVIATE_MODES)[number];

export const TREE_ABBREVIATE_LABELS: Record<TreeAbbreviateMode, string> = {
  auto: "Só quando não couber",
  sempre: "Sempre",
  nunca: "Nunca",
};

export const TREE_NUMBER_STYLES = ["k", "mil", "custom"] as const;
export type TreeNumberStyle = (typeof TREE_NUMBER_STYLES)[number];

export const TREE_NUMBER_STYLE_LABELS: Record<TreeNumberStyle, string> = {
  k: "125,4k · 1,2M · 3B",
  mil: "125,4 mil · 1,2 mi · 3 bi",
  custom: "Sufixos próprios",
};

export const TREE_NUMBER_DECIMALS_MAX = 3;
export const TREE_NUMBER_SUFFIX_MAX = 8;

export interface TreeNumberSuffixes {
  mil?: string;
  mi?: string;
  bi?: string;
}

export interface TreeNumberFormat {
  abbreviate?: TreeAbbreviateMode;
  style?: TreeNumberStyle;
  /** Casas decimais do número abreviado (máximo; caem até caber). */
  decimals?: number;
  /** Só no estilo "custom". */
  suffixes?: TreeNumberSuffixes;
  /** Só no estilo "custom": espaço entre o número e o sufixo. */
  space?: boolean;
}

export interface ResolvedNumberFormat {
  abbreviate: TreeAbbreviateMode;
  style: TreeNumberStyle;
  decimals: number;
  suffixes: Required<TreeNumberSuffixes>;
  space: boolean;
}

const STYLE_SUFFIXES: Record<Exclude<TreeNumberStyle, "custom">, { s: Required<TreeNumberSuffixes>; space: boolean }> = {
  k: { s: { mil: "k", mi: "M", bi: "B" }, space: false },
  mil: { s: { mil: "mil", mi: "mi", bi: "bi" }, space: true },
};

export const DEFAULT_NUMBER_FORMAT: ResolvedNumberFormat = {
  abbreviate: "auto",
  style: "k",
  decimals: 1,
  suffixes: STYLE_SUFFIXES.k.s,
  space: false,
};

function cleanSuffix(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim().slice(0, TREE_NUMBER_SUFFIX_MAX);
  return t ? t : null;
}

/** Parse fail-closed. Vazio = null. */
export function parseNumberFormat(raw: unknown): TreeNumberFormat | null {
  if (!isRecord(raw)) return null;
  const out: TreeNumberFormat = {};
  if ((TREE_ABBREVIATE_MODES as readonly unknown[]).includes(raw.abbreviate))
    out.abbreviate = raw.abbreviate as TreeAbbreviateMode;
  if ((TREE_NUMBER_STYLES as readonly unknown[]).includes(raw.style)) out.style = raw.style as TreeNumberStyle;
  const decimals = intIn(raw.decimals, 0, TREE_NUMBER_DECIMALS_MAX);
  if (decimals != null) out.decimals = decimals;
  if (isRecord(raw.suffixes)) {
    const s: TreeNumberSuffixes = {};
    for (const k of ["mil", "mi", "bi"] as const) {
      const v = cleanSuffix(raw.suffixes[k]);
      if (v) s[k] = v;
    }
    if (Object.keys(s).length > 0) out.suffixes = s;
  }
  if (typeof raw.space === "boolean") out.space = raw.space;
  return Object.keys(out).length > 0 ? out : null;
}

/** Cartão > widget > padrão, por propriedade. */
export function resolveNumberFormat(
  widget: TreeNumberFormat | null | undefined,
  node: TreeNumberFormat | null | undefined
): ResolvedNumberFormat {
  const style = node?.style ?? widget?.style ?? DEFAULT_NUMBER_FORMAT.style;
  const base = style === "custom" ? STYLE_SUFFIXES.mil : STYLE_SUFFIXES[style];
  const custom = { ...widget?.suffixes, ...node?.suffixes };
  return {
    abbreviate: node?.abbreviate ?? widget?.abbreviate ?? DEFAULT_NUMBER_FORMAT.abbreviate,
    style,
    decimals: node?.decimals ?? widget?.decimals ?? DEFAULT_NUMBER_FORMAT.decimals,
    suffixes:
      style === "custom"
        ? {
            mil: custom.mil ?? base.s.mil,
            mi: custom.mi ?? base.s.mi,
            bi: custom.bi ?? base.s.bi,
          }
        : base.s,
    space: style === "custom" ? (node?.space ?? widget?.space ?? true) : base.space,
  };
}

function fmtNum(n: number, decimals: number): string {
  return n.toLocaleString("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: decimals });
}

/** Casas decimais que o formato COMPLETO usa para o valor (ver formatIndicatorValue). */
function fullDecimals(value: number, unit: IndicatorUnit): number {
  if (unit === "moeda") return 0;
  if (unit === "percentual") return 1;
  if (unit === "quantidade" && Math.abs(value - Math.round(value)) < 1e-9) return 0;
  return 2;
}

/**
 * As formas de exibir `value`, do MAIS LONGA à mais curta — a tela usa a
 * primeira que cabe. Completo (o formato de sempre) → completo perdendo casas
 * → abreviado com `decimals` casas → … → abreviado sem casas. "sempre" pula o
 * completo (abaixo de mil não há o que abreviar); "nunca" só perde casas.
 * Percentual nunca abrevia. `withUnit` = mostrar "R$"/"%" (unitInCell).
 */
export function numberCandidates(
  value: number | null | undefined,
  unit: IndicatorUnit,
  fmt: ResolvedNumberFormat,
  withUnit = true
): string[] {
  if (value == null || !Number.isFinite(value)) return ["—"];
  const out: string[] = [];
  const push = (s: string) => {
    if (!out.includes(s)) out.push(s);
  };
  const neg = value < 0;
  const abs = Math.abs(value);
  const sign = neg ? "-" : "";
  const money = unit === "moeda" && withUnit;
  const wrap = (body: string) => (money ? `${sign}R$ ${body}` : `${sign}${body}`);

  const full = () => {
    push(formatIndicatorValue(value, unit, { unit: withUnit }));
    for (let d = fullDecimals(value, unit) - 1; d >= 0; d--) {
      if (unit === "percentual") push(`${fmtNum(value, d)}${withUnit ? "%" : ""}`);
      else push(wrap(fmtNum(abs, d)));
    }
  };

  const scales: [number, keyof TreeNumberSuffixes][] = [
    [1e9, "bi"],
    [1e6, "mi"],
    [1e3, "mil"],
  ];
  const abbreviated = () => {
    const step = scales.find(([div]) => abs >= div);
    if (!step) return false;
    const n = abs / step[0];
    const suffix = fmt.suffixes[step[1]];
    for (let d = fmt.decimals; d >= 0; d--) {
      push(wrap(`${fmtNum(n, d)}${fmt.space ? " " : ""}${suffix}`));
    }
    return true;
  };

  if (unit === "percentual" || fmt.abbreviate === "nunca") {
    full();
  } else if (fmt.abbreviate === "sempre") {
    if (!abbreviated()) full();
  } else {
    full();
    abbreviated();
  }
  return out.length > 0 ? out : ["—"];
}
