// Versão: 1.0 | Data: 15/07/2026
// Template do widget Nota (post-it): texto livre com expressões dinâmicas e
// hyperlinks para widgets.
//  - Expressão: {= <fórmula> } — gramática das fórmulas (lib/records), refs
//    [Rótulo] do catálogo agregado, SE/E/OU, SOMASE etc. O conteúdo vai até o
//    primeiro '}' FORA de aspas ("..."/'...'; sem escapes, como na gramática).
//    '{=' sem fechamento = texto literal até o fim. '{' sem '=' é literal.
//  - Link: [rótulo](@<widgetId>) (mesmo dashboard) ou
//    [rótulo](@<dashboardId>/<widgetId>) (outro dashboard). Inserido pelo
//    picker — o usuário não digita à mão. '[' sem esse padrão é literal (refs
//    [Rótulo] dentro de {=…} nunca chegam aqui: são consumidas pela expressão).
// Puro (sem IO): usado no servidor (page.tsx avalia exprs salvas) e no cliente
// (render + editor in-place). Ver components/dashboards/note-widget.tsx.
import type { WidgetLinkTarget } from "./types";

export type NotePart =
  | { kind: "text"; text: string }
  | { kind: "expr"; index: number; source: string } // index = n-ésima {=…}
  | { kind: "link"; label: string; target: WidgetLinkTarget };

// Teto de expressões avaliadas por nota (cada SOMASE pode gerar query extra).
export const NOTE_MAX_EXPRS = 20;

const UUID = "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}";
// [rótulo](@widget) ou [rótulo](@dashboard/widget) — ancorada na posição.
const LINK_RE = new RegExp(`^\\[([^\\]\\n]+)\\]\\(@(${UUID})(?:/(${UUID}))?\\)`);

/**
 * Divide o texto da nota em partes (texto puro, expressões e links), na ordem.
 * `sources` são as expressões {=…} extraídas (mesma ordem dos `index`).
 */
export function parseNoteTemplate(text: string): {
  parts: NotePart[];
  sources: string[];
} {
  const src = text ?? "";
  const parts: NotePart[] = [];
  const sources: string[] = [];
  let buf = "";
  const flush = () => {
    if (buf) parts.push({ kind: "text", text: buf });
    buf = "";
  };

  let i = 0;
  while (i < src.length) {
    const ch = src[i];

    // {= … } — expressão dinâmica
    if (ch === "{" && src[i + 1] === "=") {
      let j = i + 2;
      let quote: string | null = null;
      while (j < src.length) {
        const c = src[j];
        if (quote) {
          if (c === quote) quote = null;
        } else if (c === '"' || c === "'") {
          quote = c;
        } else if (c === "}") {
          break;
        }
        j += 1;
      }
      if (j >= src.length) {
        // '{=' sem fechamento: literal até o fim.
        buf += src.slice(i);
        i = src.length;
        break;
      }
      flush();
      const source = src.slice(i + 2, j).trim();
      parts.push({ kind: "expr", index: sources.length, source });
      sources.push(source);
      i = j + 1;
      continue;
    }

    // [rótulo](@…) — hyperlink para widget
    if (ch === "[") {
      const m = LINK_RE.exec(src.slice(i));
      if (m) {
        flush();
        const [, label, first, second] = m;
        const target: WidgetLinkTarget = second
          ? { dashboardId: first, widgetId: second }
          : { widgetId: first };
        parts.push({ kind: "link", label, target });
        i += m[0].length;
        continue;
      }
    }

    buf += ch;
    i += 1;
  }
  flush();
  return { parts, sources };
}

/** Markup de um link de nota (inverso do parse). */
export function noteLinkMarkup(label: string, t: WidgetLinkTarget): string {
  const dest = t.dashboardId ? `${t.dashboardId}/${t.widgetId}` : t.widgetId;
  return `[${label}](@${dest})`;
}
