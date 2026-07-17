// Versão: 1.0 | Data: 17/07/2026
// Formatação registro→célula compartilhada (client-safe): extraída do kanban
// (lib/kanban/data.ts, ex-formatRefValue) para que kanban, tela de Registros e
// exports de widget produzam a MESMA string para o mesmo ref ('stage',
// 'value', 'custom:<key>'...). O modo `csv` troca os detalhes que quebrariam o
// round-trip com o import (lib/import/csv.ts): vazio vira "" (não "—"),
// percentual/número saem crus com vírgula decimal e moeda sai sem símbolo.
import type { FieldDefinition, RecordRow } from "@/lib/records/types";
import { isPercentField } from "@/lib/records/types";
import { unifiedMemberRef } from "@/lib/correspondences";
import { CORE_FIELDS, type AvailableField } from "@/lib/widgets/fields";
import {
  DEFAULT_DATE_FORMAT,
  formatDateValue,
  formatPercent,
} from "@/lib/widgets/format";
import {
  formatMoney,
  resolveFieldMoneyFromRecord,
} from "@/lib/widgets/currency";
import { csvNumber } from "@/lib/export/csv";

export interface RecordLabels {
  responsibles?: Record<string, string>;
  operations?: Record<string, string>;
  leads?: Record<string, string>;
}

const CORE_LABELS = new Map(CORE_FIELDS.map((f) => [f.field, f.label]));

// Valor cru de um ref ('stage', 'value', 'custom:<key>') num registro.
export function resolveRecordRef(record: RecordRow, ref: string): unknown {
  if (ref.startsWith("custom:")) {
    return record.custom_fields?.[ref.slice("custom:".length)] ?? null;
  }
  return (record as unknown as Record<string, unknown>)[ref] ?? null;
}

export function recordFieldDef(
  ref: string,
  defs: FieldDefinition[]
): FieldDefinition | null {
  if (!ref.startsWith("custom:")) return null;
  const key = ref.slice("custom:".length);
  return defs.find((d) => d.field_key === key) ?? null;
}

export function recordRefLabel(ref: string, defs: FieldDefinition[]): string {
  return recordFieldDef(ref, defs)?.label ?? CORE_LABELS.get(ref) ?? ref;
}

export interface RecordCellOptions {
  // Modo CSV: reimportável (vazio "", números crus com vírgula, moeda sem
  // símbolo). Sem a flag, comportamento idêntico ao card do kanban.
  csv?: boolean;
}

// Formata o valor de um ref p/ exibição (data/moeda/percentual/booleano).
export function recordCellValue(
  record: RecordRow,
  ref: string,
  defs: FieldDefinition[],
  labels: RecordLabels,
  opts: RecordCellOptions = {}
): string {
  const empty = opts.csv ? "" : "—";
  const raw = resolveRecordRef(record, ref);
  if (raw == null || raw === "") return empty;
  if (ref === "responsible_id") {
    return labels.responsibles?.[String(raw)] ?? empty;
  }
  if (ref === "operation_id") return labels.operations?.[String(raw)] ?? empty;
  if (ref === "related_lead_id") return labels.leads?.[String(raw)] ?? empty;
  if (ref === "value" || ref === "mrr") {
    return opts.csv ? csvNumber(raw) : formatMoney(raw, record.currency);
  }
  const def = recordFieldDef(ref, defs);
  if (def) {
    const money = resolveFieldMoneyFromRecord(def, record);
    if (money.isMoney) {
      return opts.csv ? csvNumber(raw) : formatMoney(raw, money.code);
    }
    if (isPercentField(def)) {
      return opts.csv ? csvNumber(raw) : formatPercent(raw, true);
    }
    if (def.data_type === "data") return formatDateValue(raw, DEFAULT_DATE_FORMAT);
    if (def.data_type === "booleano") {
      return raw === true || raw === "true" ? "Sim" : "Não";
    }
    if (def.data_type === "numero" && opts.csv) return csvNumber(raw);
    return String(raw);
  }
  if (ref === "closed_at" || ref === "opened_at" || ref === "source_created_at") {
    return formatDateValue(raw, DEFAULT_DATE_FORMAT);
  }
  if (ref === "closed") return raw === true || raw === "true" ? "Sim" : "Não";
  if (ref === "lead_time_days" && opts.csv) return csvNumber(raw);
  return String(raw);
}

// Coluna de widget/tabela: além dos refs concretos, resolve os sintéticos do
// modo lista — `unified:<key>` (membro da fonte do registro, via `available`)
// e `match:<fonte>:<ref>` (campo do registro casado, via record.__match).
export function recordColumnValue(
  record: RecordRow,
  field: string,
  defs: FieldDefinition[],
  labels: RecordLabels,
  available: AvailableField[] = [],
  opts: RecordCellOptions = {}
): string {
  const empty = opts.csv ? "" : "—";
  if (field.startsWith("unified:")) {
    const ref = unifiedMemberRef(
      available.find((a) => a.field === field)?.unifiedMembers,
      record.record_type
    );
    return ref ? recordCellValue(record, ref, defs, labels, opts) : empty;
  }
  if (field.startsWith("match:")) {
    const rest = field.slice("match:".length);
    const i = rest.indexOf(":");
    if (i < 0) return empty;
    const src = rest.slice(0, i);
    const ref = rest.slice(i + 1);
    const partner =
      record.__match?.[src as keyof NonNullable<RecordRow["__match"]>];
    if (!partner) return empty;
    return recordCellValue(partner, ref, defs, labels, opts);
  }
  return recordCellValue(record, field, defs, labels, opts);
}
