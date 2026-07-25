// Versão: 1.0 | Data: 25/07/2026
// Medição de largura de texto para os gráficos (reserva de margem p/ rótulos
// externos e auto-flip do rótulo interno em barra horizontal). Caminho
// preferido: canvas 2D (singleton lazy); sem DOM (SSR/jsdom) ou com canvas
// indisponível, cai no estimador determinístico por contagem de caracteres —
// levemente generoso de propósito (cortar rótulo é pior que sobrar margem).

/** Estimativa determinística (fallback sem canvas): ~0,62em por caractere. */
export function estimateTextWidth(text: string, fontPx: number): number {
  if (!text) return 0;
  return Math.ceil(text.length * fontPx * 0.62);
}

let ctx: CanvasRenderingContext2D | null | undefined;
let family: string | undefined;

function context2d(): CanvasRenderingContext2D | null {
  if (ctx !== undefined) return ctx;
  try {
    if (typeof document === "undefined") {
      ctx = null;
    } else {
      ctx = document.createElement("canvas").getContext("2d");
      family =
        getComputedStyle(document.body).fontFamily || "sans-serif";
    }
  } catch {
    ctx = null;
  }
  return ctx ?? null;
}

/** Largura do texto em px na fonte do app (canvas; fallback: estimativa). */
export function measureTextWidth(text: string, fontPx: number): number {
  if (!text) return 0;
  const c = context2d();
  if (!c) return estimateTextWidth(text, fontPx);
  try {
    c.font = `${fontPx}px ${family ?? "sans-serif"}`;
    const w = c.measureText(text).width;
    return Number.isFinite(w) && w > 0
      ? Math.ceil(w)
      : estimateTextWidth(text, fontPx);
  } catch {
    return estimateTextWidth(text, fontPx);
  }
}

/** Máximo de measureTextWidth sobre a lista (0 para lista vazia). */
export function maxTextWidth(texts: string[], fontPx: number): number {
  let max = 0;
  for (const t of texts) {
    const w = measureTextWidth(t, fontPx);
    if (w > max) max = w;
  }
  return max;
}
