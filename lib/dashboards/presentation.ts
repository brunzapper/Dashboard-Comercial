// Versão: 1.2 | Data: 02/10/2026
// v1.2 (02/10/2026): PALCO 16:9 — o slide é desenhado num quadro lógico fixo
//   (STAGE_W × STAGE_H, com margens constantes) e escalado inteiro à tela por
//   `stageScale` (letterbox, sem rolagem). 1280×720 é a referência de
//   propósito: o slide fica idêntico ao dashboard visto numa tela de 1280px e
//   cresce por igual no projetor — textos, linhas e gráficos na MESMA
//   proporção (o "só a altura" esticava linhas e deixava a fonte para trás).
//   `effectivePresentation` resolve fit/transition contra o estilo (dono
//   único do padrão) e `enterOrder` dá a ordem de leitura da entrada suave.
// v1.1 (01/10/2026): (a) PRÉ-RENDER — `warmupOrder` dá a ordem em que os
//   slides montam ao entrar no modo (o atual primeiro, depois os seguintes):
//   as Server Actions de um cliente rodam UMA de cada vez, então a ordem de
//   montagem é a ordem em que os dados chegam; `warmupState` decide quando a
//   apresentação pode começar. (b) AJUSTE À TELA — `fitRowHeight` estica (ou
//   encolhe, com piso) a altura da linha do grid para o slide ocupar a altura
//   disponível: a largura já é a da tela; a altura era a gravada em px.
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

/**
 * v1.1: ordem de montagem dos slides no pré-render — o atual, os seguintes
 * (é para lá que o apresentador anda) e por fim os anteriores.
 */
export function warmupOrder(ids: readonly string[], current: string): string[] {
  const i = ids.indexOf(current);
  if (i < 0) return [...ids];
  return [...ids.slice(i), ...ids.slice(0, i).reverse()];
}

export interface WarmupState {
  /** Widgets que avisam prontidão (os que buscam os próprios dados). */
  total: number;
  ready: number;
  /** Pode começar: tudo pronto (ou nada a esperar). */
  done: boolean;
}

/**
 * v1.1: prontidão do pré-render. `armed` = os slides já montaram (antes disso
 * o mapa está vazio e "nada a esperar" seria mentira); `batchLoading` = o lote
 * único dos gráficos do engine ainda está a caminho.
 */
export function warmupState(
  entries: ReadonlyMap<string, boolean>,
  armed: boolean,
  batchLoading: boolean
): WarmupState {
  let ready = 0;
  for (const v of entries.values()) if (v) ready += 1;
  const total = entries.size;
  return { total, ready, done: armed && !batchLoading && ready === total };
}

/** Piso e teto do ajuste à tela, em múltiplos da altura natural da linha. */
export const FIT_MIN_FACTOR = 0.6;
export const FIT_MAX_FACTOR = 3;

/**
 * v1.1: altura de linha que faz `contentRows` linhas ocuparem `available` px.
 * Encolher tem PISO (abaixo dele o conteúdo dos cards ficaria ilegível — o
 * slide rola) e esticar tem TETO (um slide com um card pequeno não vira um
 * card gigante). Sem medida ou sem conteúdo ⇒ a natural.
 */
export function fitRowHeight(
  available: number,
  contentRows: number,
  natural: number
): number {
  if (!(available > 0) || !(contentRows > 0) || !(natural > 0)) return natural;
  const fit = available / contentRows;
  return Math.min(natural * FIT_MAX_FACTOR, Math.max(natural * FIT_MIN_FACTOR, fit));
}

// ---------------------------------------------------------------------------
// v1.2 (02/10/2026): palco 16:9

export const STAGE_W = 1280;
export const STAGE_H = 720;
/** Margens constantes do palco (≈ 96 × 72 px num 1920×1080). */
export const STAGE_PAD_X = 64;
export const STAGE_PAD_Y = 48;

/** Fator que cabe o palco inteiro na janela (letterbox). */
export function stageScale(
  viewportW: number,
  viewportH: number,
  w = STAGE_W,
  h = STAGE_H
): number {
  if (!(viewportW > 0) || !(viewportH > 0)) return 1;
  return Math.min(viewportW / w, viewportH / h);
}

export interface EffectivePresentation {
  fit: "palco" | "altura";
  transition: "suave" | "nenhuma";
}

/**
 * Padrão do modo Apresentar: o que o dashboard fixou vence; ausente, um
 * estilo não-Clássico apresenta em palco com entrada suave e o Clássico mantém
 * o comportamento da 0149 (só a altura, sem transição).
 */
export function effectivePresentation(
  p: { fit?: string; transition?: string } | undefined,
  styled: boolean
): EffectivePresentation {
  const fit = p?.fit === "palco" || p?.fit === "altura" ? p.fit : styled ? "palco" : "altura";
  const transition =
    p?.transition === "suave" || p?.transition === "nenhuma"
      ? p.transition
      : styled
        ? "suave"
        : "nenhuma";
  return { fit, transition };
}

/** Ordem de leitura (linha, depois coluna) — rank por id, para o escalonamento. */
export function enterOrder(
  items: readonly { id: string; x: number; y: number }[]
): Map<string, number> {
  const sorted = [...items].sort((a, b) => a.y - b.y || a.x - b.x);
  return new Map(sorted.map((it, i) => [it.id, i]));
}
