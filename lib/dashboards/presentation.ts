// Versão: 1.0 | Data: 01/10/2026
// Modo APRESENTAR de um dashboard — módulo PURO e client-safe.
//
// Cada ABA vira um slide, na ordem das abas. Os widgets seguem vivos e
// interativos (não é um print): apresentar é navegar o MESMO painel em tela
// cheia, sem o cromo de edição. `DashboardSettings.presentation.hiddenTabs`
// deixa abas de trabalho fora dos slides. Estado efêmero: nada persiste.

export type PresentationAction = "next" | "prev" | "first" | "last" | "exit";

/** Ids das abas que são slides, em ordem. Sem abas ⇒ um slide só (""). */
export function slideTabIds(
  tabs: { id: string }[],
  hiddenTabs: readonly string[] | undefined
): string[] {
  if (tabs.length === 0) return [""];
  const hidden = new Set(hiddenTabs ?? []);
  const shown = tabs.map((t) => t.id).filter((id) => !hidden.has(id));
  // Esconder TODAS seria um modo sem slide: cai em todas.
  return shown.length > 0 ? shown : tabs.map((t) => t.id);
}

/** O slide de destino de uma ação (clampado nas pontas). */
export function stepSlide(
  ids: readonly string[],
  current: string,
  action: Exclude<PresentationAction, "exit">
): string {
  if (ids.length === 0) return current;
  const i = Math.max(0, ids.indexOf(current));
  switch (action) {
    case "first":
      return ids[0];
    case "last":
      return ids[ids.length - 1];
    case "next":
      return ids[Math.min(ids.length - 1, i + 1)];
    case "prev":
      return ids[Math.max(0, i - 1)];
  }
}

/** Tecla → ação. Teclas de campo de texto nunca chegam aqui (o chamador filtra). */
export function presentationKeyAction(key: string): PresentationAction | null {
  switch (key) {
    case "ArrowRight":
    case "ArrowDown":
    case "PageDown":
    case " ":
      return "next";
    case "ArrowLeft":
    case "ArrowUp":
    case "PageUp":
      return "prev";
    case "Home":
      return "first";
    case "End":
      return "last";
    case "Escape":
      return "exit";
    default:
      return null;
  }
}

/** Alvo de teclado que é edição (input/textarea/select/contenteditable). */
export function isTypingTarget(el: EventTarget | null): boolean {
  if (!el || typeof (el as HTMLElement).tagName !== "string") return false;
  const h = el as HTMLElement;
  const tag = h.tagName.toLowerCase();
  return tag === "input" || tag === "textarea" || tag === "select" || h.isContentEditable === true;
}
