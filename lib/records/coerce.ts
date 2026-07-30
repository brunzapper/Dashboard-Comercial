// Versão: 1.0 | Data: 30/07/2026
// Coerção PURA de valores crus (strings de FormData) para os tipos de campo do
// sistema — extraída de lib/records/actions.ts (módulo "use server" só exporta
// async; aqui os helpers ficam testáveis e reutilizáveis pelo fluxo de inserção
// por IA, que serializa valores exatamente como o form e passa por estas mesmas
// funções via createRecord).
//
// Invariante 11 (write side): valor NAIVE de data indo para coluna CORE
// `timestamptz` é hora de parede de Brasília — `coerceCore` ancora com
// `anchorNaiveToBrasilia` (senão o Postgres assume UTC e o dia recua: venda do
// dia 1 lida como do mês anterior pelo read side prefix-based/_widget_local_ts).
// Campos CUSTOM de data seguem naive (texto) em `coerce` — ancorá-los quebraria
// o read side (offset no lower bound excluiria date-only).
import { anchorNaiveToBrasilia } from "@/lib/date/normalize";
import type { DataType } from "@/lib/records/types";

export function numOrNull(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Coerção de valor cru p/ campo PERSONALIZADO (custom_fields — data fica texto). */
export function coerce(
  dataType: DataType,
  raw: FormDataEntryValue | null
): unknown {
  const s = raw == null ? "" : String(raw).trim();
  if (s === "") return null;
  if (dataType === "numero" || dataType === "moeda") {
    const n = Number(s.replace(/\./g, "").replace(",", "."));
    return Number.isNaN(Number(s)) ? (Number.isNaN(n) ? null : n) : Number(s);
  }
  if (dataType === "booleano") {
    return s === "true" ? true : s === "false" ? false : null;
  }
  return s;
}

/** Coerção de valor cru p/ coluna do NÚCLEO (datas ancoradas em Brasília). */
export function coerceCore(
  dataType: DataType,
  raw: FormDataEntryValue | null
): unknown {
  const s = raw == null ? "" : String(raw).trim();
  if (s === "") return null;
  if (dataType === "numero" || dataType === "moeda") {
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  }
  if (dataType === "booleano") {
    return s === "true" ? true : s === "false" ? false : null;
  }
  // Coluna core de data é timestamptz: o dia digitado é dia de BRASÍLIA.
  if (dataType === "data") return anchorNaiveToBrasilia(s.slice(0, 10));
  return s;
}

// Igualdade "normalizada" p/ decidir se uma coluna do núcleo mudou (datas comparam
// só o dia; números por valor; resto por texto).
export function coreEquals(
  dataType: DataType,
  oldVal: unknown,
  newVal: unknown
): boolean {
  if (dataType === "data") {
    return String(oldVal ?? "").slice(0, 10) === String(newVal ?? "").slice(0, 10);
  }
  if (dataType === "numero" || dataType === "moeda") {
    const a = oldVal == null || oldVal === "" ? null : Number(oldVal);
    const b = newVal == null || newVal === "" ? null : Number(newVal);
    return a === b;
  }
  if (dataType === "booleano") return Boolean(oldVal) === Boolean(newVal);
  return String(oldVal ?? "") === String(newVal ?? "");
}
