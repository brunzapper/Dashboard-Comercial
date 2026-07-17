// Versão: 1.0 | Data: 17/07/2026
// Avaliador PURO da formatação condicional (AppearanceSettings.conditional):
// regras valor→estilo e escalas de cor contínuas (heatmap), compartilhado
// pelos renderizadores de tabela (agregada/registros/entidades), pelo Card e
// pelos gráficos. Sem I/O e sem React.
//
// PRECEDÊNCIA com as cores manuais existentes (aplicada nos renderizadores):
//   cellColors (célula explícita) > regra condicional > escala de cor >
//   rowColors/colColors > headerBg/bodyBg/global.
// Racional: o clique manual numa célula é a intenção mais específica; a regra
// é intenção de coluna (mais específica que a cor chapada de coluna/linha).
// Nos gráficos, categoryColors/sliceColors manuais vencem a regra (mesmo
// racional: explícito vence).
import type {
  ColorScale,
  ConditionalFormatting,
  ConditionalRule,
} from "./types";
import type { Variation } from "./variation";

export interface ResolvedCondStyle {
  text?: string;
  fill?: string;
  bold?: boolean;
  icon?: ConditionalRule["style"]["icon"];
}

function numOf(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function matches(
  rule: ConditionalRule,
  value: unknown,
  variation?: Variation | null
): boolean {
  const op = rule.op;
  if (op === "var_up") return variation != null && variation.dir === "up";
  if (op === "var_down") return variation != null && variation.dir === "down";
  if (op === "empty") return value == null || value === "";
  if (op === "not_empty") return value != null && value !== "";
  if (op === "contains") {
    if (value == null || rule.value == null) return false;
    return String(value)
      .toLocaleLowerCase("pt-BR")
      .includes(String(rule.value).toLocaleLowerCase("pt-BR"));
  }
  // Comparações: numéricas quando ambos os lados parseiam; senão texto
  // (eq/neq case-insensitive — mesmo espírito dos filtros normalizados).
  const n = numOf(value);
  const rn = numOf(rule.value);
  if (op === "between") {
    const hi = numOf(rule.value2);
    return n != null && rn != null && hi != null && n >= rn && n <= hi;
  }
  if (n != null && rn != null) {
    switch (op) {
      case "gt":
        return n > rn;
      case "gte":
        return n >= rn;
      case "lt":
        return n < rn;
      case "lte":
        return n <= rn;
      case "eq":
        return n === rn;
      case "neq":
        return n !== rn;
    }
  }
  const a = String(value ?? "").toLocaleLowerCase("pt-BR");
  const b = String(rule.value ?? "").toLocaleLowerCase("pt-BR");
  if (op === "eq") return a === b && a !== "";
  if (op === "neq") return a !== b;
  return false; // ordem entre textos: fora do escopo (use contains/eq)
}

/** Domínio (min/max) por alvo de escala, calculado sobre as linhas visíveis. */
export function scaleDomains(
  rows: Record<string, unknown>[],
  scales: ColorScale[] | undefined,
  valueOf?: (row: Record<string, unknown>, target: string) => unknown
): Record<string, { min: number; max: number }> {
  const out: Record<string, { min: number; max: number }> = {};
  for (const s of scales ?? []) {
    let min = Infinity;
    let max = -Infinity;
    for (const r of rows) {
      const n = numOf(valueOf ? valueOf(r, s.target) : r[s.target]);
      if (n == null) continue;
      if (n < min) min = n;
      if (n > max) max = n;
    }
    if (min !== Infinity) out[s.target] = { min, max };
  }
  return out;
}

// Interpolação por color-mix (CSS nativo, mesmo precedente de palettes.ts) —
// t em [0,1]. Escala de 3 pontos: piecewise em torno do meio (t=0.5).
function scaleColor(s: ColorScale, t: number): string {
  const clamped = Math.max(0, Math.min(1, t));
  if (s.mid) {
    if (clamped <= 0.5) {
      const tt = clamped * 2;
      return `color-mix(in oklch, ${s.mid} ${Math.round(tt * 100)}%, ${s.min})`;
    }
    const tt = (clamped - 0.5) * 2;
    return `color-mix(in oklch, ${s.max} ${Math.round(tt * 100)}%, ${s.mid})`;
  }
  return `color-mix(in oklch, ${s.max} ${Math.round(clamped * 100)}%, ${s.min})`;
}

/**
 * Estilo condicional de um valor num alvo. Regras em ordem — a primeira que
 * casa vence; regra vence escala. `ctx.variation` alimenta var_up/var_down;
 * `ctx.domain` (de scaleDomains) habilita a escala do alvo.
 */
export function evalConditional(
  cond: ConditionalFormatting | undefined,
  target: string,
  value: unknown,
  ctx?: {
    variation?: Variation | null;
    domain?: { min: number; max: number };
  }
): ResolvedCondStyle | null {
  if (!cond) return null;
  for (const rule of cond.rules ?? []) {
    if (rule.target !== target) continue;
    if (matches(rule, value, ctx?.variation)) {
      const { text, fill, bold, icon } = rule.style ?? {};
      if (text || fill || bold || icon) return { text, fill, bold, icon };
    }
  }
  const scale = (cond.scales ?? []).find((s) => s.target === target);
  if (scale && ctx?.domain) {
    const n = numOf(value);
    if (n != null) {
      const { min, max } = ctx.domain;
      const t = max > min ? (n - min) / (max - min) : 0.5;
      return { fill: scaleColor(scale, t) };
    }
  }
  return null;
}

/** A config tem algo a avaliar? (curto-circuito barato nos renderizadores) */
export function hasConditional(
  cond: ConditionalFormatting | undefined
): boolean {
  return Boolean(cond && ((cond.rules?.length ?? 0) > 0 || (cond.scales?.length ?? 0) > 0));
}
