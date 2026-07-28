// Versão: 1.0 | Data: 28/07/2026
// CAMPO DE DATA DO FILTRO DE PERÍODO por base (0060/0082/0110): módulo
// canônico e 100% PURO das opções do picker "Campo de data do filtro de
// período" de Registros → Bases (bases e sub-bases). A lista oferecida é
// "só colunas com dados": colunas core + campos personalizados de DATA da
// base que tenham ≥1 linha preenchida NÃO-mock (probe em
// lib/config/period-field-probe.ts — I/O fica lá, nunca aqui); base sem
// linhas cai nas colunas core; o valor salvo SEMPRE aparece, mesmo vazio.
// Não recrie listas de opções de período em componentes — importe daqui.
import { isCoreDef } from "@/lib/records/core-defs";
import type { FieldDefinition } from "@/lib/records/types";
import { fieldAppliesToSource, type SourceDef } from "@/lib/sources";

// Compatível estruturalmente com ComboboxOption (lib/ não importa components/).
export interface PeriodOption {
  value: string;
  label: string;
}

// As 6 colunas core de data aceitas pelo CHECK de default_period_field
// (0060/0110 nas bases; 0082 nas subs). last_synced_at fica de fora por
// design (CHECK não a aceita).
export const CORE_PERIOD_FIELD_OPTIONS: PeriodOption[] = [
  { value: "source_created_at", label: "Data de criação (origem)" },
  { value: "closed_at", label: "Data de fechamento" },
  { value: "opened_at", label: "Data de abertura" },
  { value: "source_modified_at", label: "Data de modificação (origem)" },
  { value: "created_at", label: "Criado no app" },
  { value: "updated_at", label: "Atualizado no app" },
];

// Colunas core NULLABLE: precisam de probe para saber se têm dado na base.
export const NULLABLE_CORE_PERIOD_FIELDS = [
  "source_created_at",
  "closed_at",
  "opened_at",
  "source_modified_at",
] as const;

// created_at/updated_at são NOT NULL default now() (0004): qualquer base com
// ≥1 linha as tem preenchidas — entram sem probe.
export const ALWAYS_FILLED_CORE_PERIOD_FIELDS = [
  "created_at",
  "updated_at",
] as const;

/**
 * Candidatos custom de DATA de uma base: data_type 'data', NUNCA override core
 * (0086 semeia closed_at/opened_at/source_created_at como 'data' com
 * applies_to vazio — virariam opções falsas `custom:closed_at`) e applies_to
 * cobrindo a base (ciente do catálogo: sub herda o record_type da pai).
 */
export function buildCustomDateFieldOptions(
  fields: FieldDefinition[],
  sourceKey: string,
  sources: SourceDef[]
): PeriodOption[] {
  return fields
    .filter(
      (f) =>
        f.data_type === "data" &&
        !isCoreDef(f) &&
        fieldAppliesToSource(f.applies_to, sourceKey, sources)
    )
    .map((f) => ({ value: `custom:${f.field_key}`, label: f.label }));
}

/**
 * Rótulo de um valor de campo de período: lista dada → colunas core → valor
 * cru (campo excluído do catálogo exibe "custom:<key>" — degradação aceita).
 */
export function periodFieldLabel(
  value: string,
  options: PeriodOption[] = []
): string {
  return (
    options.find((o) => o.value === value)?.label ??
    CORE_PERIOD_FIELD_OPTIONS.find((o) => o.value === value)?.label ??
    value
  );
}

/**
 * Garante `value` presente em `options` (valor salvo segue selecionável mesmo
 * fora da lista filtrada — padrão do tzOptions do sources-manager). O rótulo
 * de um custom fora da lista resolve por `labelSource` (catálogo completo).
 */
export function ensurePeriodOption(
  options: PeriodOption[],
  value: string,
  labelSource?: PeriodOption[]
): PeriodOption[] {
  if (!value || options.some((o) => o.value === value)) return options;
  return [...options, { value, label: periodFieldLabel(value, labelSource) }];
}

/**
 * Lista final do picker de campo de período de uma base:
 * - sem linha não-mock (`hasRows` false) → as colunas core (fallback = a base
 *   recém-criada se comporta como antes da 0110);
 * - senão, core + custom filtradas por `filled` (valores com ≥1 linha
 *   preenchida não-mock, saída do probe);
 * - `savedValue` ausente da lista é injetado no fim (nunca some do picker).
 */
export function buildPeriodFieldOptions(input: {
  customOptions: PeriodOption[];
  hasRows: boolean;
  filled: ReadonlySet<string>;
  savedValue?: string;
}): PeriodOption[] {
  const { customOptions, hasRows, filled, savedValue } = input;
  const options = hasRows
    ? [...CORE_PERIOD_FIELD_OPTIONS, ...customOptions].filter((o) =>
        filled.has(o.value)
      )
    : [...CORE_PERIOD_FIELD_OPTIONS];
  return savedValue
    ? ensurePeriodOption(options, savedValue, customOptions)
    : options;
}
