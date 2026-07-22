// Versão: 1.0 | Data: 10/07/2026
// Fase 10: paleta categórica central + helpers de cor reutilizados pelos charts
// (widget-chart) e pelo editor de aparência. Antes a paleta vivia hard-coded em
// widget-chart.tsx. Variações de gradiente usam color-mix (oklch), que aceita
// qualquer cor CSS (hex do color input ou var(--chart-*) do design system).
import type { AppearanceSettings } from "@/lib/widgets/types";

// Paleta categórica padrão = tokens do design system (tema claro/escuro).
export const CHART_COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
];

// Paletas nomeadas para pizza (e futuros). A "Design system" é o default e
// reflete os tokens do tema; as demais são fixas para dar variedade.
export const PALETTES: Record<string, { label: string; colors: string[] }> = {
  design: { label: "Design system", colors: CHART_COLORS },
  vivid: {
    label: "Vibrante",
    colors: ["#2563eb", "#16a34a", "#f59e0b", "#dc2626", "#7c3aed", "#0891b2"],
  },
  ocean: {
    label: "Oceano",
    colors: ["#0ea5e9", "#0284c7", "#0369a1", "#075985", "#0c4a6e", "#38bdf8"],
  },
  sunset: {
    label: "Pôr do sol",
    colors: ["#f97316", "#ef4444", "#ec4899", "#d946ef", "#f59e0b", "#facc15"],
  },
  forest: {
    label: "Floresta",
    colors: ["#166534", "#15803d", "#16a34a", "#22c55e", "#4ade80", "#65a30d"],
  },
  gray: {
    label: "Tons de cinza",
    colors: ["#111827", "#374151", "#6b7280", "#9ca3af", "#d1d5db", "#4b5563"],
  },
  // Identidade do preset Inbound (roxo #A98AC0 / verde #01ae84): matizes da
  // marca aprofundados p/ contraste em fundo claro e separação CVD entre
  // vizinhos (validados com scripts de acessibilidade em 21/07/2026). Os hex
  // literais da marca ficam no CHROME (canvas/faixa dos cards do preset).
  inbound: {
    label: "Inbound (roxo & verde)",
    colors: ["#8E5DB8", "#0E9A78", "#B8791F", "#3E7CB1", "#C0637F", "#6B4E8E"],
  },
};

export const DEFAULT_PALETTE_KEY = "design";

// Cor de uma fatia/coluna a partir de uma paleta (com wrap).
export function paletteColor(paletteKey: string | undefined, i: number): string {
  const p = PALETTES[paletteKey ?? DEFAULT_PALETTE_KEY] ?? PALETTES.design;
  return p.colors[i % p.colors.length];
}

// Variação sutil de uma cor base ao longo de n itens (clareia progressivamente).
// Usado no modo gradiente: colunas/fatias vizinhas ficam levemente distintas
// sem perder a identidade da cor base. color-mix aceita hex e var().
export function gradientVariation(base: string, i: number, n: number): string {
  if (n <= 1) return base;
  const t = i / (n - 1); // 0..1
  const towardWhite = Math.round(t * 42); // 0..42%
  if (towardWhite <= 0) return base;
  return `color-mix(in oklch, ${base} ${100 - towardWhite}%, white)`;
}

// Cor de uma série (barra/linha) i, respeitando override por métrica.
export function resolveSeriesColor(
  appearance: AppearanceSettings | undefined,
  metricKey: string,
  index: number
): string {
  return (
    appearance?.seriesColors?.[metricKey] ??
    CHART_COLORS[index % CHART_COLORS.length]
  );
}
