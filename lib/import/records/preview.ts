// Versão: 1.0 | Data: 30/07/2026
// Helpers PUROS da prévia interativa da inserção por IA (/registros):
// - regra do produto "só colunas preenchidas aparecem" (filledColumns);
// - edição inline (setCell) e TROCA de coluna de um dado (remapColumn) —
//   o usuário pode realocar todos os valores de uma coluna para outro campo
//   aceito, ou removê-la (removeColumn);
// - serialização de volta ao contrato (serializeRecordsInsert em validate.ts).
// O componente (ai-insert-sheet.tsx) só orquestra; a lógica testável vive aqui.
import type { EntryFieldSpec, EntryRecord } from "@/lib/import/records/types";

/**
 * Colunas exibidas na prévia: só as com ≥1 valor preenchido em algum registro,
 * na ORDEM do catálogo (title → core → relações → customs). Coluna esvaziada
 * por edição some da prévia (e do JSON aplicado).
 */
export function filledColumns(
  rows: EntryRecord[],
  fields: EntryFieldSpec[]
): EntryFieldSpec[] {
  return fields.filter((f) =>
    rows.some((r) => {
      const v = r[f.key];
      return v != null && String(v).trim() !== "";
    })
  );
}

/** Campos do catálogo ainda SEM coluna na prévia (alvos possíveis de remap). */
export function unusedFields(
  rows: EntryRecord[],
  fields: EntryFieldSpec[]
): EntryFieldSpec[] {
  const used = new Set(filledColumns(rows, fields).map((f) => f.key));
  return fields.filter((f) => !used.has(f.key));
}

/** Edita uma célula. Valor vazio remove a chave (coluna some se esvaziar). */
export function setCell(
  rows: EntryRecord[],
  index: number,
  key: string,
  value: string
): EntryRecord[] {
  return rows.map((r, i) => {
    if (i !== index) return r;
    const next = { ...r };
    if (value.trim() === "") delete next[key];
    else next[key] = value;
    return next;
  });
}

/**
 * Move TODOS os valores da coluna `from` para o campo `to` (troca de alocação).
 * O chamador só oferece alvos sem coluna (unusedFields), então não há colisão;
 * por segurança, valor já existente em `to` num registro é preservado.
 */
export function remapColumn(
  rows: EntryRecord[],
  from: string,
  to: string
): EntryRecord[] {
  if (from === to) return rows;
  return rows.map((r) => {
    if (!(from in r)) return r;
    const next = { ...r };
    if (!(to in next)) next[to] = next[from];
    delete next[from];
    return next;
  });
}

/** Remove a coluna inteira (todos os registros perdem a chave). */
export function removeColumn(rows: EntryRecord[], key: string): EntryRecord[] {
  return rows.map((r) => {
    if (!(key in r)) return r;
    const next = { ...r };
    delete next[key];
    return next;
  });
}
