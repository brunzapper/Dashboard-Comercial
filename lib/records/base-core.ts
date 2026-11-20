// Versão: 1.0 | Data: 19/11/2026
// Rótulo e opções das colunas do NÚCLEO por Base (esquema por Base, 0156) nas
// telas que mostram registros de UMA Base — módulo PURO (o widget de tabela é
// Client Component).
//
// A coluna `stage` é uma só para lead e negócio. A linha core de
// `field_definitions` (0086) guarda um rótulo e UMA lista de opções para a
// org inteira — hoje "Etapa" com as etapas de LEAD, que é o que o catálogo do
// Bitrix devolve por STATUS. Usada como dropdown na edição inline de uma
// tabela de NEGÓCIOS, ela não continha o valor da linha, e o Combobox
// mostrava "—": a fase do negócio sumia da tela assim que a coluna virava
// editável. O esquema da Base (`source_fields`) já tem o rótulo e as fases
// declaradas POR Base (as de negócio agrupadas por pipeline); estes helpers
// as aplicam onde a tabela decide o que mostrar.
import type { SourceDef } from "@/lib/sources";

export interface BaseCoreOption {
  value: string;
  group?: string | null;
}

export interface CoreEditChoice {
  value: string;
  label: string;
}

/** Base RAIZ dona de um record_type (sub-base herda o esquema da pai). */
export function rootSourceOf(
  sources: readonly SourceDef[],
  recordType: string | null | undefined
): SourceDef | undefined {
  if (!recordType) return undefined;
  return sources.find((s) => !s.parentKey && s.recordType === recordType);
}

function refOf(field: string): string {
  return field.startsWith("custom:") ? field : `core:${field}`;
}

/**
 * Rótulo PRÓPRIO de uma coluna quando todos os registros exibidos são da
 * MESMA Base e ela renomeou a coluna (ex.: `stage` → "Fase do negócio").
 * Registros de Bases diferentes (ou Base sem rótulo próprio) ⇒ null: o
 * cabeçalho segue com o rótulo geral, que vale para todas.
 */
export function sharedBaseFieldLabel(
  sources: readonly SourceDef[],
  recordTypes: Iterable<string | null | undefined>,
  field: string
): string | null {
  const roots = new Set<SourceDef>();
  for (const rt of recordTypes) {
    const root = rootSourceOf(sources, rt);
    if (!root) return null;
    roots.add(root);
    if (roots.size > 1) return null;
  }
  const [only] = roots;
  const label = only?.fieldLabels?.[refOf(field)]?.trim();
  return label ? label : null;
}

/**
 * Opções da edição inline de uma coluna do núcleo num registro, a partir das
 * opções DECLARADAS na Base dele. Com grupo (pipeline) igual ao do registro,
 * só as fases DESSE pipeline — um negócio não muda de funil trocando a fase;
 * sem casar, todas, com o grupo no rótulo. O valor ATUAL sempre entra: um
 * valor fora da lista (fase renomeada/apagada no Bitrix) não pode virar "—"
 * na tela. `declared` vazio/ausente ⇒ null (a célula usa o comportamento de
 * antes).
 */
export function coreEditChoices(
  declared: readonly BaseCoreOption[] | null | undefined,
  group: string | null | undefined,
  current: string | null | undefined
): CoreEditChoice[] | null {
  if (!declared || declared.length === 0) return null;
  const g = group?.trim() || null;
  const inGroup = g ? declared.filter((o) => (o.group ?? "").trim() === g) : [];
  const pick = inGroup.length > 0 ? inGroup : declared;
  const out: CoreEditChoice[] = [];
  const seen = new Set<string>();
  for (const o of pick) {
    const v = o.value.trim();
    if (!v || seen.has(v)) continue;
    seen.add(v);
    const og = o.group?.trim();
    out.push({
      value: v,
      label: inGroup.length === 0 && og ? `${og} · ${v}` : v,
    });
  }
  const cur = current?.trim();
  if (cur && !seen.has(cur)) out.unshift({ value: cur, label: cur });
  return out;
}
