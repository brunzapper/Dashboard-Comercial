// Versão: 1.0 | Data: 02/10/2026
// v1.0 (02/10/2026): EXPRESSÕES nos textos do esqueleto de slide (headline e
//   kicker de cada aba). A headline de um slide costuma citar números ("MRR
//   final chega a R$ 585 mil"), e digitá-los congelava o slide: a meta mudava
//   e o título continuava dizendo o valor antigo. Agora o texto aceita as
//   MESMAS expressões {= … } da Nota (gramática, catálogo agregado e choke
//   point `runCalculatedWidget` — avaliadas na page; ver
//   app/(app)/dashboards/[id]/page.tsx), e este módulo PURO só monta o texto
//   final. O valor sai em ESCALA ("R$ 115 mil", "4,2 mi") — num título, o
//   número cheio pesa mais que a frase.
import type { CalcWidgetResult } from "@/lib/widgets/types";
import { compactNumber } from "@/lib/widgets/format";
import { NOTE_MAX_EXPRS, parseNoteTemplate } from "@/lib/widgets/note-template";

/** O texto tem alguma expressão {=…}? (Barato — evita parse/consulta à toa.) */
export function hasSlideExpr(text: string | null | undefined): boolean {
  return typeof text === "string" && text.includes("{=");
}

/** As expressões do texto, na ordem (teto da Nota). */
export function slideExprSources(text: string | null | undefined): string[] {
  if (!hasSlideExpr(text)) return [];
  return parseNoteTemplate(text ?? "").sources.slice(0, NOTE_MAX_EXPRS);
}

/** Valor de uma expressão para um TÍTULO: em escala, com o símbolo da moeda. */
export function formatSlideValue(r: CalcWidgetResult | undefined): string {
  if (!r) return "…";
  if (r.text != null && r.text !== "") return r.text;
  if (r.value == null || !Number.isFinite(r.value)) return "—";
  const { number, suffix } = compactNumber(r.value);
  const num = suffix ? `${number} ${suffix}` : number;
  if (!r.currency) return num;
  return r.currency === "BRL" ? `R$ ${num}` : `${r.currency} ${num}`;
}

/**
 * Texto final: cada {=…} trocado pelo valor (na ordem de `values`). Links de
 * widget [rótulo](@…) viram só o rótulo — um título não navega.
 */
export function renderSlideText(
  text: string,
  values: (CalcWidgetResult | undefined)[]
): string {
  if (!hasSlideExpr(text)) return text;
  return parseNoteTemplate(text)
    .parts.map((p) =>
      p.kind === "text"
        ? p.text
        : p.kind === "link"
          ? p.label
          : formatSlideValue(values[p.index])
    )
    .join("");
}
