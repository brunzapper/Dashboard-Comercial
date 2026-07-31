// Versão: 1.0 | Data: 31/07/2026
// Guarda do parse FAIL-CLOSED dos recursos sob demanda (org_features):
// desligado por padrão em TODA forma de entrada inválida — recurso custom
// nunca "liga sozinho" para uma org.
import { describe, expect, it } from "vitest";

import { normalizeOrgFeatures, ORG_FEATURES } from "./org-features";

describe("normalizeOrgFeatures", () => {
  it("linha ausente/lixo ⇒ tudo desligado", () => {
    for (const v of [null, undefined, "x", 1, [], ["remuneracao"]]) {
      const out = normalizeOrgFeatures(v);
      for (const f of ORG_FEATURES) expect(out[f.key]).toBe(false);
    }
  });

  it("só `true` literal liga; truthy não-booleano fica desligado", () => {
    expect(normalizeOrgFeatures({ remuneracao: true }).remuneracao).toBe(true);
    expect(normalizeOrgFeatures({ remuneracao: "true" }).remuneracao).toBe(
      false
    );
    expect(normalizeOrgFeatures({ remuneracao: 1 }).remuneracao).toBe(false);
    expect(normalizeOrgFeatures({ remuneracao: false }).remuneracao).toBe(
      false
    );
  });

  it("chave desconhecida é descartada (catálogo é a fonte de verdade)", () => {
    const out = normalizeOrgFeatures({ outra_coisa: true, remuneracao: true });
    expect(out).toEqual(
      Object.fromEntries(
        ORG_FEATURES.map((f) => [f.key, f.key === "remuneracao"])
      )
    );
  });
});
