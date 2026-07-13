// Versão: 1.0 | Data: 12/07/2026
// Fase 3: operandos de DATA dos campos calculados. Um único lugar que define
// quais refs de data podem entrar numa fórmula (e seus rótulos), para o
// construtor (components/campos/fields-manager.tsx) e a validação no servidor
// (app/(app)/campos/actions.ts) concordarem. Cobre: datas do próprio registro,
// campos personalizados `data`, e datas do registro CASADO (match:<fonte>:<ref>).
import { CORE_FIELDS } from "@/lib/widgets/fields";
import { SOURCE_KEYS, SOURCE_LABELS } from "@/lib/sources";

export interface OperandRef {
  ref: string;
  label: string;
  group?: string;
}

export interface CustomDateField {
  field_key: string;
  label: string;
}

// Colunas de data do núcleo (closed_at, opened_at, source_created_at).
const CORE_DATE_FIELDS = CORE_FIELDS.filter((f) => f.isDate);

// Operando sintético "Data atual" (hoje em Brasília). É resolvido no
// contexto de datas (lib/records/formulas.ts) — não é uma coluna do banco, por
// isso fica só nos operandos PRÓPRIOS (nunca em match:<fonte>:today).
export const TODAY_REF = "today";
const TODAY_OPERAND: OperandRef = {
  ref: TODAY_REF,
  label: "Data atual",
  group: "Datas",
};

/** Datas do próprio registro + campos personalizados `data` + hoje (Brasília). */
export function ownDateOperands(customDateFields: CustomDateField[]): OperandRef[] {
  return [
    TODAY_OPERAND,
    ...CORE_DATE_FIELDS.map((f) => ({ ref: f.field, label: f.label, group: "Datas" })),
    ...customDateFields.map((f) => ({
      ref: `custom:${f.field_key}`,
      label: f.label,
      group: "Datas",
    })),
  ];
}

/** Datas do registro casado por fonte: match:<fonte>:<data|custom:data>. */
export function matchDateOperands(
  customDateFields: CustomDateField[]
): OperandRef[] {
  const out: OperandRef[] = [];
  for (const src of SOURCE_KEYS) {
    for (const f of CORE_DATE_FIELDS) {
      out.push({
        ref: `match:${src}:${f.field}`,
        label: `↪ ${SOURCE_LABELS[src]}: ${f.label}`,
        group: "Registro casado",
      });
    }
    for (const f of customDateFields) {
      out.push({
        ref: `match:${src}:custom:${f.field_key}`,
        label: `↪ ${SOURCE_LABELS[src]}: ${f.label}`,
        group: "Registro casado",
      });
    }
  }
  return out;
}

/** Todos os operandos de data (próprio registro + casado). */
export function allDateOperands(customDateFields: CustomDateField[]): OperandRef[] {
  return [...ownDateOperands(customDateFields), ...matchDateOperands(customDateFields)];
}
