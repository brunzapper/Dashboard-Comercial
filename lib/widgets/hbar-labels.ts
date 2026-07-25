// Versão: 1.0 | Data: 25/07/2026
// Reserva de espaço p/ os rótulos EXTERNOS do gráfico de barra HORIZONTAL
// (valor/total à direita da barra + rótulo de variação da comparação): a
// margem direita do BarChart é fixa e a barra do valor máximo encosta na
// borda do SVG — sem reserva, o texto do rótulo sai cortado. Módulo puro
// (client-safe), sem medição de fonte no DOM: heurística proporcional ao
// tamanho da fonte, calibrada p/ os dígitos/moeda dos rótulos de dados.

// Largura estimada (px) de um texto de rótulo SVG (~0.62em por caractere em
// sans-serif + folga fixa). Superestima de leve por design — cortar é pior
// que sobrar 2–3px.
export function estimateChartTextWidth(text: string, fontPx: number): number {
  if (!text) return 0;
  return Math.ceil(text.length * fontPx * 0.62) + 2;
}

// Margem direita do BarChart horizontal. Reservar a MAIOR largura entre os
// rótulos basta p/ todas as barras: o fim de qualquer barra nunca passa da
// largura útil do eixo, então fim + rótulo ≤ útil + reserva. Espelha a
// geometria de renderização: valor em `fim + gap`; variação em
// `fim + gap (+ valor + gap, quando os dois aparecem)`.
export function hbarRightMargin(opts: {
  base: number; // margem original do chart (padding do eixo)
  fontPx: number;
  valueTexts: string[]; // rótulos de valor/total renderizados fora da barra
  varTexts: string[]; // rótulos de variação da comparação
  gap?: number;
}): number {
  const { base, fontPx, valueTexts, varTexts } = opts;
  const gap = opts.gap ?? 4;
  const maxW = (texts: string[]): number =>
    texts.reduce((m, t) => Math.max(m, estimateChartTextWidth(t, fontPx)), 0);
  const valueW = maxW(valueTexts);
  const varW = maxW(varTexts);
  const valueReserve = valueW > 0 ? gap + valueW : 0;
  const varReserve =
    varW > 0 ? gap + (valueW > 0 ? valueW + gap : 0) + varW : 0;
  return base + Math.max(valueReserve, varReserve);
}
