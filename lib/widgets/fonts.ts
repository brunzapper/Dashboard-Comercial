// Versão: 1.0 | Data: 22/07/2026
// Resolução dos tamanhos de fonte dos widgets (AppearanceSettings.fonts +
// DashboardSettings.fontScale). Regra: px explícito é ABSOLUTO; "Auto"
// (undefined) usa o default do elemento × escala global do dashboard.
// INVARIANTE: Auto + escala 1 ⇒ undefined (nenhum style emitido) — o render
// fica byte-idêntico ao anterior; widgets não configurados nunca mudam.
import type { CSSProperties } from "react";

// Defaults em px dos elementos controláveis (espelham as classes fixas dos
// pontos de render: text-sm=14, text-3xl=30, text-2xl=24, text-xs=12, e o
// fontSize 11 dos textos de gráfico do Recharts).
export const FONT_DEFAULTS = {
  title: 14,
  value: 30,
  valueMulti: 24,
  labels: 12,
  table: 14,
  chart: 11,
} as const;

// Px efetivo para texto DOM; undefined = "não mexe" (mantém só a classe).
export function resolveFontPx(
  explicit: number | undefined,
  defPx: number,
  scale: number
): number | undefined {
  if (explicit != null) return explicit;
  return scale !== 1 ? Math.round(defPx * scale) : undefined;
}

// Style pronto para mesclar num elemento DOM (spread seguro com undefined).
export function fontStyle(
  explicit: number | undefined,
  defPx: number,
  scale: number
): CSSProperties | undefined {
  const px = resolveFontPx(explicit, defPx, scale);
  return px != null ? { fontSize: px } : undefined;
}

// Px efetivo como número (Recharts exige número em tick/fontSize).
export function resolveFontNum(
  explicit: number | undefined,
  defPx: number,
  scale: number
): number {
  return explicit ?? Math.round(defPx * scale);
}
