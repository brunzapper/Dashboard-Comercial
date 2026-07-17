// Versão: 1.0 | Data: 17/07/2026
// Variação entre o valor atual e o do período de comparação (WidgetRow.__cmp):
// matemática e formatação PURAS, compartilhadas por Card, tabelas, gráficos e
// pelo componente VariationBadge. Sem I/O e sem React.
import type { ComparisonSettings } from "./types";

export interface Variation {
  abs: number; // atual − comparado
  pct: number | null; // (atual − comparado) / |comparado|; null com base 0
  dir: "up" | "down" | "flat";
}

/** null = variação indisponível (sem valor comparado ou atual não numérico). */
export function computeVariation(
  cur: number | null | undefined,
  prev: number | null | undefined
): Variation | null {
  if (cur == null || prev == null) return null;
  if (!Number.isFinite(cur) || !Number.isFinite(prev)) return null;
  const abs = cur - prev;
  const pct = prev !== 0 ? abs / Math.abs(prev) : null;
  const dir = abs > 0 ? "up" : abs < 0 ? "down" : "flat";
  return { abs, pct, dir };
}

/**
 * Tom semântico da variação: subir é "good" por padrão; `invert` (métricas
 * tipo churn) troca. "flat" é neutro.
 */
export function variationTone(
  v: Variation,
  invert?: boolean
): "good" | "bad" | "flat" {
  if (v.dir === "flat") return "flat";
  const up = v.dir === "up";
  return up !== Boolean(invert) ? "good" : "bad";
}

const fmtNum = (n: number): string =>
  n.toLocaleString("pt-BR", { maximumFractionDigits: 2 });

/**
 * Texto da variação (sem seta/cor — isso é do badge): "+12,3%", "−1.234",
 * "+12,3% (+1.234)". `fmtAbs` formata o valor absoluto na escala da métrica
 * (moeda/percentual); ausente usa número pt-BR.
 */
export function formatVariation(
  v: Variation,
  format: NonNullable<ComparisonSettings["format"]>,
  fmtAbs?: (n: number) => string
): string {
  const sign = v.abs > 0 ? "+" : v.abs < 0 ? "−" : "";
  const absText = `${sign}${(fmtAbs ?? fmtNum)(Math.abs(v.abs))}`;
  const pctText =
    v.pct == null
      ? "—"
      : `${sign}${(Math.abs(v.pct) * 100).toLocaleString("pt-BR", {
          maximumFractionDigits: 1,
        })}%`;
  if (format === "abs") return absText;
  if (format === "both") return `${pctText} (${absText})`;
  return pctText;
}
