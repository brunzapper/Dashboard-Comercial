// Versão: 1.0 | Data: 11/07/2026
// Helpers de filtro compartilhados entre o construtor de widgets e os controles
// de filtro de visualização (barra da tabela + widget "Filtro por campo").
// Mantém os operadores, o agrupamento de campos e a normalização de filtros num
// só lugar, para os dois usarem exatamente a mesma semântica.
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

// Agrupa os campos do catálogo por origem para os seletores pesquisáveis.
export function fieldGroup(field: string): string {
  if (field.startsWith("custom:")) return "Personalizados";
  if (field.startsWith("unified:")) return "Unificados";
  return "Núcleo";
}

// Opções { value, label, group } para o Combobox a partir dos campos.
export function toFieldOptions(
  fields: AvailableField[]
): { value: string; label: string; group: string }[] {
  return fields.map((f) => ({
    value: f.field,
    label: f.label,
    group: fieldGroup(f.field),
  }));
}

// Normaliza filtros crus (linhas de UI) → WidgetFilter[] pronto p/ o servidor:
// descarta linhas sem campo; `in` vira lista; operadores sem valor perdem o valor.
export function cleanFilters(filters: WidgetFilter[]): WidgetFilter[] {
  return filters
    .filter((f) => f.field)
    .map((f) => {
      if (f.op === "in") {
        return {
          field: f.field,
          op: f.op,
          value: String(f.value ?? "")
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
        };
      }
      if (opHasNoValue(f.op)) {
        return { field: f.field, op: f.op };
      }
      return { field: f.field, op: f.op, value: f.value };
    });
}
