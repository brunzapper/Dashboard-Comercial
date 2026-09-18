// Versão: 1.0 | Data: 18/09/2026
// v1.0 (18/09/2026): as derivações de UI dos EIXOS da Base manual (0143) —
//   opções de dimensão/filtro, valores de um filtro de coordenada e os
//   operadores aceitos.
//
// Por que num módulo, e não no corpo do widget-builder: o construtor já está no
// limite do React Compiler. Com estas quatro funções inline, ele passou a
// responder "Compilation Skipped: Existing memoization could not be preserved"
// — isto é, DESISTIU de compilar o componente, e a memoização manual do
// `calcRefs` (que os editores de fórmula usam como identidade para não
// reemitir onChange em cadeia) deixou de ser preservada. Não foi uma função em
// especial: neutralizar qualquer uma delas isoladamente mantinha o erro. É
// orçamento, então a correção é tirar peso do componente.
//
// Módulo PURO e client-safe.

import type { FilterValueOption, FilterValueSource } from "@/components/filters/filter-value-picker";
import { MANUAL_RESIDUAL_VALUE } from "@/lib/manual-base/coord-filters";
import {
  MANUAL_FAMILY_GROUP,
  manualAxisRef,
  manualResidualLabel,
  parseManualAxisRef,
  type ManualAxisCatalog,
} from "@/lib/manual-base/families";
import { MANUAL_CHIP_KEY, type FieldOption } from "@/lib/widgets/filter-ops";

/**
 * As famílias como opção de DIMENSÃO/FILTRO. Vão COM `chips`, senão a regra do
 * Combobox ("opção sem chips aparece em todos") as espalharia pela lista de cada
 * Base — a armadilha que a métrica manual já pagou na v1.26.
 */
export function manualAxisFieldOptions(axes: ManualAxisCatalog): FieldOption[] {
  return axes.families.map((f) => ({
    value: manualAxisRef(f.key),
    label: `${MANUAL_FAMILY_GROUP} · ${f.label}`,
    cleanLabel: f.label,
    group: MANUAL_FAMILY_GROUP,
    chips: [MANUAL_CHIP_KEY],
  }));
}

/**
 * Os valores de um filtro de coordenada: as chaves dos MEMBROS.
 *
 * `storeAs: "value"` porque o recorte compara CHAVE, não rótulo — renomear
 * "Ligação" para "Telefone" não pode quebrar um filtro gravado. E o RESIDUAL
 * entra como opção porque "Sem Canal" é um grupo de verdade; é por ele existir
 * aqui que `is_null` não precisa (e não deve) ser um operador aceito.
 */
export function manualAxisValueSource(
  field: string,
  axes: ManualAxisCatalog
): FilterValueSource | null {
  const axis = parseManualAxisRef(field);
  if (axis == null) return null;
  const fam = axes.families.find((f) => f.key === axis);
  const label = fam?.label ?? axis;
  const options: FilterValueOption[] = [
    { value: MANUAL_RESIDUAL_VALUE, label: manualResidualLabel(label) },
    ...axes.members
      .filter((m) => m.family_id === fam?.id)
      .slice()
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((m) => ({ value: m.key, label: m.label })),
  ];
  return { kind: "static", load: async () => options, storeAs: "value" };
}

/** O rótulo padrão de uma dimensão de família (o ref cru sairia no campo). */
export function manualAxisDefaultLabel(
  field: string,
  axes: ManualAxisCatalog
): string | null {
  const axis = parseManualAxisRef(field);
  if (axis == null) return null;
  return axes.families.find((f) => f.key === axis)?.label ?? axis;
}
