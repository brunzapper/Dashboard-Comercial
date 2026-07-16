// Versão: 1.2 | Data: 15/07/2026
// v1.1 (15/07/2026): cleanFilters preserva `sources` (fontes-alvo do filtro,
//   pass-through) validado/deduplicado; `record_types` (formato de fio) nunca
//   é persistido.
// v1.2 (15/07/2026): opções de campo cientes de FONTE p/ os dropdowns: rótulo
//   "Fonte · Campo" na visão "Todas", rótulo limpo + grupo por fonte com chip
//   ativo, chips de navegação (sourceChips) e tooltip com a fórmula dos
//   calculados. Substitui o agrupamento antigo por TIPO (Núcleo/Personalizados).
// Helpers de filtro compartilhados entre o construtor de widgets e os controles
// de filtro de visualização (barra da tabela + widget "Filtro por campo").
// Mantém os operadores, o agrupamento de campos e a normalização de filtros num
// só lugar, para os dois usarem exatamente a mesma semântica.
import {
  DEFAULT_SOURCE_DISPLAY_LABELS,
  type SourceDisplayLabels,
} from "@/lib/sources";
import type { AvailableField } from "./fields";
import type { FilterOp, WidgetFilter } from "./types";

// Operadores oferecidos nos seletores (o rótulo é o símbolo/curto em PT).
export const FILTER_OPS: { op: FilterOp; label: string }[] = [
  { op: "eq", label: "=" },
  { op: "neq", label: "≠" },
  { op: "ilike", label: "contém" },
  { op: "gt", label: ">" },
  { op: "gte", label: "≥" },
  { op: "lt", label: "<" },
  { op: "lte", label: "≤" },
  { op: "in", label: "em (lista)" },
  { op: "is_null", label: "é vazio" },
  { op: "not_null", label: "não vazio" },
];

// Operadores sem valor (o input de valor não é exibido).
export function opHasNoValue(op: FilterOp): boolean {
  return op === "is_null" || op === "not_null";
}

// Opção de dropdown de CAMPO (compatível com ComboboxOption). Rótulos daqui são
// EXCLUSIVOS dos dropdowns — cabeçalhos/chips de visualização usam fieldLabel.
export interface FieldOption {
  value: string;
  label: string; // visão "Todas": "Fonte · Campo"
  cleanLabel?: string; // chip de fonte ativo: nome limpo (grupo carrega a fonte)
  group?: string;
  chips?: string[];
  title?: string; // tooltip (fórmula legível dos calculados)
}

// Keys de fonte derivadas dos rótulos de exibição: mergeSourceLabels monta o
// objeto na ordem do CATÁLOGO (builtins primeiro) + "geral" — é assim que as
// fontes dinâmicas chegam a este módulo sem mudar a assinatura dos chamadores.
function sourceKeysOf(labels: SourceDisplayLabels): string[] {
  return Object.keys(labels).filter((k) => k !== "geral");
}

// Chips de fonte dos dropdowns de campo (prop `chips` do Combobox; o chip
// "Todas" é implícito no componente). NAVEGAÇÃO apenas — não altera a consulta.
export function sourceChips(
  labels: SourceDisplayLabels
): { key: string; label: string }[] {
  return [
    ...sourceKeysOf(labels).map((k) => ({ key: k, label: labels[k] })),
    { key: "geral", label: labels.geral },
  ];
}

// Nome do campo com os indicadores próprios (ƒ calculado; ↪ registro casado),
// SEM prefixo de fonte — exibido quando um chip de fonte está ativo.
export function fieldOptionCleanLabel(f: AvailableField): string {
  const name = f.calc ? `ƒ ${f.baseLabel ?? f.label}` : (f.baseLabel ?? f.label);
  return f.baseLabel != null ? `↪ ${name}` : name;
}

// Rótulo da visão "Todas" (lista mistura fontes): "Fonte · Campo". match: usa
// baseLabel para não duplicar a fonte já embutida no `label` (↪ Fonte: Campo).
export function fieldOptionLabel(
  f: AvailableField,
  labels: SourceDisplayLabels
): string {
  const prefix = f.source ? labels[f.source] : labels.geral;
  return `${prefix} · ${fieldOptionCleanLabel(f)}`;
}

// Tooltip da opção: fórmula legível dos campos calculados.
export function fieldOptionTitle(f: AvailableField): string | undefined {
  return f.calc && f.formulaText ? f.formulaText : undefined;
}

// Chips em que o campo aparece: a fonte única; campos gerais aparecem sob CADA
// fonte E sob "Geral" (um campo geral também é utilizável em qualquer fonte).
export function fieldOptionChips(
  f: AvailableField,
  labels: SourceDisplayLabels = DEFAULT_SOURCE_DISPLAY_LABELS
): string[] {
  return f.source ? [f.source] : ["geral", ...sourceKeysOf(labels)];
}

// Cabeçalho de grupo (exibido com chip de fonte ativo): fonte curta; campos do
// registro casado em grupo próprio; gerais em "Geral".
export function fieldOptionGroup(
  f: AvailableField,
  labels: SourceDisplayLabels
): string {
  if (f.source && f.baseLabel != null)
    return `${labels[f.source]} — registro casado`;
  return f.source ? labels[f.source] : labels.geral;
}

// Ordem dos grupos: fontes (ordem do catálogo) → registros casados → gerais.
function fieldGroupRank(f: AvailableField, keys: string[]): number {
  if (!f.source) return 2 * keys.length;
  const i = keys.indexOf(f.source);
  return f.baseLabel != null ? keys.length + i : i;
}

// Decora um catálogo de operandos de fórmula (RefOption/OperandRef) com os
// metadados de exibição derivados do catálogo de campos: fonte curta
// (sourceHint), chips de navegação e tooltip da fórmula. NUNCA toca em `label`
// — o rótulo é load-bearing no round-trip texto⇄tokens e na validação do
// servidor. Refs `agg:<fn>:<campo>` são resolvidos pelo campo interno; match:
// não ganha sourceHint (a fonte já está embutida no rótulo `↪ Fonte:`).
export function decorateRefOptions<T extends { ref: string }>(
  refs: T[],
  available: AvailableField[],
  labels: SourceDisplayLabels
): (T & { sourceHint?: string; chips?: string[]; title?: string })[] {
  const byField = new Map(available.map((f) => [f.field, f] as const));
  return refs.map((r) => {
    let ref = r.ref;
    if (ref.startsWith("agg:")) {
      const rest = ref.slice("agg:".length);
      const i = rest.indexOf(":");
      ref = i === -1 ? "*" : rest.slice(i + 1);
    }
    const f = ref === "*" ? undefined : byField.get(ref);
    if (!f) return r;
    return {
      ...r,
      sourceHint:
        f.baseLabel != null
          ? undefined
          : f.source
            ? labels[f.source]
            : labels.geral,
      chips: fieldOptionChips(f, labels),
      title: fieldOptionTitle(f),
    };
  });
}

// Opções de Combobox a partir dos campos: rótulo prefixado (visão "Todas"),
// rótulo limpo + grupo por fonte (chip ativo), chips e tooltip de fórmula.
export function toFieldOptions(
  fields: AvailableField[],
  labels: SourceDisplayLabels = DEFAULT_SOURCE_DISPLAY_LABELS
): FieldOption[] {
  const keys = sourceKeysOf(labels);
  return [...fields]
    .sort((a, b) => fieldGroupRank(a, keys) - fieldGroupRank(b, keys))
    .map((f) => ({
      value: f.field,
      label: fieldOptionLabel(f, labels),
      cleanLabel: fieldOptionCleanLabel(f),
      group: fieldOptionGroup(f, labels),
      chips: fieldOptionChips(f, labels),
      title: fieldOptionTitle(f),
    }));
}

// Normaliza filtros crus (linhas de UI) → WidgetFilter[] pronto p/ o servidor:
// descarta linhas sem campo; `in` vira lista; operadores sem valor perdem o
// valor; `sources` (fontes-alvo) é validado/deduplicado e só persiste quando
// não-vazio (ausente = todas as fontes).
export function cleanFilters(filters: WidgetFilter[]): WidgetFilter[] {
  return filters
    .filter((f) => f.field)
    .map((f) => {
      // Qualquer key não-vazia vale (fontes dinâmicas); a UI só oferece as do
      // catálogo, e alvos órfãos são inofensivos (ver lib/widgets/filter-sources).
      const sources = [
        ...new Set(
          (f.sources ?? []).filter((s) => typeof s === "string" && s !== "")
        ),
      ];
      const src = sources.length > 0 ? { sources } : {};
      if (f.op === "in") {
        return {
          field: f.field,
          op: f.op,
          value: String(f.value ?? "")
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
          ...src,
        };
      }
      if (opHasNoValue(f.op)) {
        return { field: f.field, op: f.op, ...src };
      }
      return { field: f.field, op: f.op, value: f.value, ...src };
    });
}
