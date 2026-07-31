// Versão: 1.0 | Data: 31/07/2026
// Testes da sanitização PURA do perfil de operação (módulo compartilhado
// entre updateOperationFilter e o validador do assistente de IA). Semântica
// byte-idêntica à action original: op fora da whitelist reprova; is_null/
// not_null salvam sem value; `in` exige lista não-vazia; escalar nos demais.
import { describe, expect, it } from "vitest";

import {
  NO_VALUE_OPS,
  PROFILE_OPS,
  sanitizeProfileFilters,
} from "./operation-profile";

describe("sanitizeProfileFilters", () => {
  it("aceita condições válidas e normaliza sources (vazio omitido)", () => {
    const res = sanitizeProfileFilters([
      { field: "channel", op: "eq_ci", value: "Litoral", sources: ["deals", ""] },
      { field: "custom:fonte", op: "in", value: ["A", "B"] },
      { field: "closed_at", op: "not_null", value: "ignorado" },
    ]);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.clean).toEqual([
      { field: "channel", op: "eq_ci", value: "Litoral", sources: ["deals"] },
      { field: "custom:fonte", op: "in", value: ["A", "B"] },
      { field: "closed_at", op: "not_null" },
    ]);
  });

  it("reprova: não-array, campo vazio, op fora da whitelist", () => {
    expect(sanitizeProfileFilters("x").ok).toBe(false);
    expect(sanitizeProfileFilters([{ field: " ", op: "eq", value: 1 }]).ok).toBe(false);
    expect(
      sanitizeProfileFilters([{ field: "a", op: "match", value: 1 }]).ok
    ).toBe(false);
  });

  it("reprova valor: `in` sem lista; escalar ausente/objeto nos demais", () => {
    expect(sanitizeProfileFilters([{ field: "a", op: "in", value: [] }]).ok).toBe(false);
    expect(sanitizeProfileFilters([{ field: "a", op: "in", value: "x" }]).ok).toBe(false);
    expect(sanitizeProfileFilters([{ field: "a", op: "eq" }]).ok).toBe(false);
    expect(
      sanitizeProfileFilters([{ field: "a", op: "eq", value: { x: 1 } }]).ok
    ).toBe(false);
  });

  it("whitelists exportadas cobrem o vocabulário do perfil", () => {
    expect(PROFILE_OPS.has("eq_ci")).toBe(true);
    expect(PROFILE_OPS.has("ilike")).toBe(true);
    expect(PROFILE_OPS.has("in_ci")).toBe(false); // interno da fusão, nunca no perfil
    expect([...NO_VALUE_OPS].sort()).toEqual(["is_null", "not_null"]);
  });
});
