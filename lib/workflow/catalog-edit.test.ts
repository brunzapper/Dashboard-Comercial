// Versão: 1.0 | Data: 09/09/2026
// O furo que esta rodada fechou: uma automação aparecia na lista do Workflow e
// não tinha como ser editada. O card só oferecia "abrir o quadro", e regra de
// BASE (0127) não tem quadro — dentro do Workflow ela era ineditável.
//
// A tela de construção é endereçada pelo id que o CATÁLOGO já emite, com
// namespace. Estes testes pinam esse contrato: se alguém mudar o formato do id
// sem mudar a rota, o link de edição quebra em silêncio.
import { describe, expect, it } from "vitest";

import { buildWorkflowCatalog, catalogItemFilter } from "./catalog";
import type { OrgAutomationRow } from "./automations-overview";

const regraDeBase: OrgAutomationRow = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Acompanhamento — Nutrição",
  enabled: false,
  position: 0,
  owner: { kind: "source", id: "deals" },
  ownerLabel: "Base Deals",
  // É ISTO que fazia a regra ser ineditável: sem quadro, não há para onde ir.
  ownerHref: null,
  rule: {
    v: 1,
    conditions: [
      { kind: "field", filter: { field: "stage", op: "in", value: ["Nutrição"] } },
    ],
    action: { type: "set_field", field: "custom:x", value: "1" },
  },
  lastRunAt: null,
  lastError: null,
  lastActionCount: 0,
};

describe("catálogo do Workflow: endereço da tela de construção", () => {
  const catalog = buildWorkflowCatalog([], [regraDeBase], []);

  it("a regra entra no catálogo com id namespaced", () => {
    expect(catalog).toHaveLength(1);
    expect(catalog[0].id).toBe(`rule:${regraDeBase.id}`);
  });

  it("o id do catálogo é o parâmetro da rota — kind e uuid separáveis", () => {
    // A rota /operacao/workflow/[item] faz exatamente este split.
    const [kind, ...rest] = catalog[0].id.split(":");
    expect(kind).toBe("rule");
    expect(rest.join(":")).toBe(regraDeBase.id);
  });

  it("regra SEM quadro é classificada como automação e continua na lista", () => {
    // Ela não tem ownerHref; é justamente a que não tinha porta de edição.
    expect(catalogItemFilter(catalog[0])).toBe("automacao");
    expect(regraDeBase.ownerHref).toBeNull();
  });
});
