// Versão: 1.0 | Data: 31/07/2026
// Vocabulário e sanitização do PERFIL de operação (WidgetFilter[] em
// operations.filter, 0083) — extraído de updateOperationFilter para módulo
// PURO: o choke point da UI e o validador do assistente de IA de operações
// consomem a MESMA fonte (nunca lista paralela — espírito da invariante 25).
// A semântica é byte-idêntica à action original; mudanças aqui valem para os
// dois consumidores ao mesmo tempo.
import type { WidgetFilter } from "@/lib/widgets/types";

// Ops aceitos no perfil (mesmo vocabulário do editor de sub-fontes + os
// normalizados *_ci — "diferente de" com null contando).
export const PROFILE_OPS = new Set([
  "eq",
  "neq",
  "eq_ci",
  "neq_ci",
  "in",
  "ilike",
  "gt",
  "gte",
  "lt",
  "lte",
  "is_null",
  "not_null",
]);
export const NO_VALUE_OPS = new Set(["is_null", "not_null"]);

export type ProfileSanitizeResult =
  | { ok: true; clean: WidgetFilter[] }
  | { ok: false; message: string };

/**
 * Sanitiza um perfil cru: condição sem campo ou com op fora de PROFILE_OPS
 * reprova; is_null/not_null salvam sem value; `in` exige lista não-vazia de
 * string/number; demais exigem escalar. `sources` é normalizado para array de
 * strings não-vazias (omitido quando vazio).
 */
export function sanitizeProfileFilters(
  filter: unknown
): ProfileSanitizeResult {
  if (!Array.isArray(filter)) return { ok: false, message: "Filtro inválido." };
  const clean: WidgetFilter[] = [];
  for (const f of filter as Partial<WidgetFilter>[]) {
    const field = String(f?.field ?? "").trim();
    const op = String(f?.op ?? "");
    if (!field || !PROFILE_OPS.has(op)) {
      return { ok: false, message: "Condição inválida no perfil." };
    }
    const sources = Array.isArray(f?.sources)
      ? f.sources.map(String).filter(Boolean)
      : undefined;
    if (NO_VALUE_OPS.has(op)) {
      clean.push({
        field,
        op: op as WidgetFilter["op"],
        ...(sources && sources.length > 0
          ? { sources: sources as WidgetFilter["sources"] }
          : {}),
      });
      continue;
    }
    const value = f?.value;
    const scalarOk =
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean";
    const listOk =
      Array.isArray(value) &&
      value.length > 0 &&
      value.every((v) => typeof v === "string" || typeof v === "number");
    if (op === "in" ? !listOk : !scalarOk) {
      return { ok: false, message: `Valor inválido na condição de "${field}".` };
    }
    clean.push({
      field,
      op: op as WidgetFilter["op"],
      value,
      ...(sources && sources.length > 0
        ? { sources: sources as WidgetFilter["sources"] }
        : {}),
    });
  }
  return { ok: true, clean };
}
