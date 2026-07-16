// Versão: 1.0 | Data: 13/07/2026
// Operandos CONDICIONAIS dos campos calculados (SE/E/OU e comparações): um
// único lugar que define quais colunas de texto/seleção/booleano podem entrar
// numa fórmula (e seus rótulos), para o editor de texto
// (components/campos/formula-text-editor.tsx) e a validação no servidor
// (app/(app)/campos/actions.ts) concordarem. Cobre: colunas textuais/booleanas
// do núcleo, campos personalizados texto/seleção/booleano e os mesmos campos do
// registro CASADO (match:<fonte>:<ref>). Espelha lib/records/date-operands.ts.
import { CORE_FIELDS } from "@/lib/widgets/fields";
import { BUILTIN_SOURCES, type SourceDef } from "@/lib/sources";
import type { OperandRef } from "./date-operands";
import type { DataType } from "./types";

export interface CustomCondField {
  field_key: string;
  label: string;
}

// Tipos de campo personalizados aceitos como operando condicional.
export const COND_DATA_TYPES: DataType[] = ["texto", "selecao", "booleano"];

// Colunas textuais/booleanas do núcleo aceitas em condicionais.
export const CORE_COND_REFS = [
  "title",
  "record_type",
  "source_system",
  "pipeline",
  "stage",
  "stage_semantic",
  "sale_type",
  "channel",
  "currency",
  "closed",
] as const;

const CORE_COND_FIELDS = CORE_FIELDS.filter((f) =>
  (CORE_COND_REFS as readonly string[]).includes(f.field)
);

// Subconjunto do núcleo útil de puxar do registro casado (evita ruído — mesmo
// espírito de MATCH_CORE_FIELDS em lib/widgets/fields.ts).
const MATCH_CORE_COND_REFS = ["title", "stage", "channel", "sale_type"] as const;

/** Colunas condicionais do próprio registro (núcleo + custom texto/seleção/booleano). */
export function ownCondOperands(customCondFields: CustomCondField[]): OperandRef[] {
  return [
    ...CORE_COND_FIELDS.map((f) => ({
      ref: f.field,
      label: f.label,
      group: "Texto/Seleção",
    })),
    ...customCondFields.map((f) => ({
      ref: `custom:${f.field_key}`,
      label: f.label,
      group: "Texto/Seleção",
    })),
  ];
}

/** Colunas condicionais do registro casado: match:<fonte>:<ref|custom:key>.
 *  `sources` = catálogo de fontes (data_sources); ausente = builtins. O rótulo
 *  é load-bearing (round-trip texto⇄tokens): construtor e validação do
 *  servidor DEVEM usar o mesmo catálogo. */
export function matchCondOperands(
  customCondFields: CustomCondField[],
  sources: SourceDef[] = BUILTIN_SOURCES
): OperandRef[] {
  const out: OperandRef[] = [];
  for (const { key: src, label: srcLabel } of sources) {
    for (const f of CORE_COND_FIELDS) {
      if (!(MATCH_CORE_COND_REFS as readonly string[]).includes(f.field)) continue;
      out.push({
        ref: `match:${src}:${f.field}`,
        label: `↪ ${srcLabel}: ${f.label}`,
        group: "Registro casado",
      });
    }
    for (const f of customCondFields) {
      out.push({
        ref: `match:${src}:custom:${f.field_key}`,
        label: `↪ ${srcLabel}: ${f.label}`,
        group: "Registro casado",
      });
    }
  }
  return out;
}

/** Todos os operandos condicionais (próprio registro + casado). */
export function allCondOperands(
  customCondFields: CustomCondField[],
  sources: SourceDef[] = BUILTIN_SOURCES
): OperandRef[] {
  return [
    ...ownCondOperands(customCondFields),
    ...matchCondOperands(customCondFields, sources),
  ];
}
