// Versão: 1.0 | Data: 15/07/2026
// Foco/atalho para widget: rola a tela até centralizar o widget-alvo (ou o
// quanto der) e aplica um pulso de destaque (.widget-focus em globals.css).
// scrollIntoView resolve os DOIS scrollers (horizontal do grid e vertical do
// <main>) numa chamada. O id do DOM é posto no wrapper de cada item do grid
// (dashboard-grid.tsx). Client-only (DOM).
export const widgetDomId = (id: string) => `widget-${id}`;

const FOCUS_CLASS = "widget-focus";
const FOCUS_MS = 2200;

/** Rola até o widget e pulsa o destaque. Retorna false se o nó não existe. */
export function scrollToWidget(id: string): boolean {
  const el = document.getElementById(widgetDomId(id));
  if (!el) return false;
  el.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });
  el.classList.remove(FOCUS_CLASS);
  // Reinicia a animação se o widget já estava em foco.
  void el.offsetWidth;
  el.classList.add(FOCUS_CLASS);
  window.setTimeout(() => el.classList.remove(FOCUS_CLASS), FOCUS_MS);
  return true;
}

/**
 * Tenta focar repetidamente: após trocar de aba (ou chegar por URL) o grid
 * remonta e os itens só existem depois do tick do ResizeObserver que mede a
 * largura base (dashboard-grid.tsx) — o retry cobre esse intervalo.
 */
export function focusWidgetWithRetry(
  id: string,
  tries = 15,
  intervalMs = 120
): void {
  let n = 0;
  const attempt = () => {
    if (scrollToWidget(id)) return;
    n += 1;
    if (n < tries) window.setTimeout(attempt, intervalMs);
  };
  attempt();
}
