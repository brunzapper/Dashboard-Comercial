// Versão: 1.0 | Data: 24/07/2026
// Testes de core-defs (0086): linhas core de field_definitions são OVERRIDES,
// nunca campos custom. O caso crítico é source_system NULL/undefined (campos
// locais/app) — a razão documentada para NUNCA usar `.neq("source_system",
// 'core')` no banco (o `<>` derrubaria os NULL); o split é feito em JS.
import { describe, expect, it } from "vitest";

import { isCoreDef, splitCoreDefs } from "@/lib/records/core-defs";

describe("isCoreDef", () => {
  it("reconhece apenas source_system === 'core'", () => {
    expect(isCoreDef({ source_system: "core" })).toBe(true);
    expect(isCoreDef({ source_system: "bitrix" })).toBe(false);
  });

  it("NULL e undefined não são core (campos locais/app)", () => {
    expect(isCoreDef({ source_system: null })).toBe(false);
    expect(isCoreDef({})).toBe(false);
  });
});

describe("splitCoreDefs", () => {
  it("particiona core (Map por field_key) × custom, preservando ordem", () => {
    const rows = [
      { field_key: "forecast", source_system: null },
      { field_key: "pipeline", source_system: "core" },
      { field_key: "uf_crm_123", source_system: "bitrix" },
      { field_key: "closed_at", source_system: "core" },
    ];
    const { custom, core } = splitCoreDefs(rows);
    expect(custom.map((r) => r.field_key)).toEqual(["forecast", "uf_crm_123"]);
    expect([...core.keys()]).toEqual(["pipeline", "closed_at"]);
    expect(core.get("pipeline")).toBe(rows[1]);
  });

  it("linha com source_system NULL fica em custom (regressão do `.neq`)", () => {
    const { custom, core } = splitCoreDefs([
      { field_key: "local_app", source_system: null },
    ]);
    expect(custom).toHaveLength(1);
    expect(core.size).toBe(0);
  });

  it("lista vazia → partições vazias", () => {
    const { custom, core } = splitCoreDefs([]);
    expect(custom).toEqual([]);
    expect(core.size).toBe(0);
  });
});
