// Versão: 1.0 | Data: 08/09/2026
// O catálogo de fluxos do sistema é DESCRIÇÃO de código que vive em outro
// lugar — descrição apodrece calada. Estes testes pinam o que dá para conferir
// sem rodar nada: as rotas existem, os caminhos de código existem, e nenhuma
// entrada fica sem os campos que a tela mostra.
import { existsSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { SYSTEM_FLOWS, systemFlow } from "./system-schemas";

const root = path.resolve(__dirname, "../..");

function routeExists(route: string): boolean {
  if (route === "/") return existsSync(path.join(root, "app/(app)/page.tsx"));
  const rel = route.replace(/^\//, "");
  return existsSync(path.join(root, "app/(app)", rel, "page.tsx"));
}

describe("SYSTEM_FLOWS", () => {
  it("toda rota de `configuredAt` existe no app", () => {
    for (const flow of SYSTEM_FLOWS) {
      if (!flow.configuredAt) continue;
      expect(
        routeExists(flow.configuredAt),
        `${flow.key}: rota ${flow.configuredAt} não existe`
      ).toBe(true);
    }
  });

  it("todo `code` aponta para um arquivo ou pasta que existe", () => {
    for (const flow of SYSTEM_FLOWS) {
      // Rota dinâmica no caminho ([source]) — confere só a pasta que a contém.
      const p = flow.code.replace(/\[[^\]]+\]\/.*$/, "");
      expect(existsSync(path.join(root, p)), `${flow.key}: ${p}`).toBe(true);
    }
  });

  it("chaves únicas e campos de exibição preenchidos", () => {
    const keys = SYSTEM_FLOWS.map((f) => f.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const flow of SYSTEM_FLOWS) {
      expect(flow.label.trim()).not.toBe("");
      expect(flow.description.trim()).not.toBe("");
      expect(flow.trigger.trim()).not.toBe("");
      expect(flow.configuredWhere.trim()).not.toBe("");
      expect(flow.steps.length).toBeGreaterThan(0);
      for (const s of flow.steps) {
        expect(s.label.trim()).not.toBe("");
        expect(s.detail.trim()).not.toBe("");
      }
    }
  });

  it("systemFlow acha por chave e devolve null no resto", () => {
    expect(systemFlow("sync_bitrix")?.label).toBeTruthy();
    expect(systemFlow("nao_existe")).toBeNull();
  });
});
