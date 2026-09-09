// Versão: 1.0 | Data: 09/09/2026
// A chave de um esquema é IDENTIDADE: a URL do formulário usa, o seed reconhece
// por ela e ela não muda depois. Como o usuário nomeia o FLUXO (não a chave),
// ela é derivada — e derivar mal produz chave que o CHECK da 0125 recusa, ou
// duas chaves iguais na mesma org.
import { describe, expect, it } from "vitest";

import { uniqueWorkflowKey, workflowKeyFromLabel } from "./schemas";

// O mesmo do CHECK da 0125.
const SLUG = /^[a-z][a-z0-9_]{1,39}$/;

describe("workflowKeyFromLabel", () => {
  it("tira acento, caixa e pontuação", () => {
    expect(workflowKeyFromLabel("Criação de Lead")).toBe("criacao_de_lead");
    expect(workflowKeyFromLabel("Atualizar CRM — parceiros")).toBe(
      "atualizar_crm_parceiros"
    );
  });

  it("nunca começa por dígito ou símbolo (o banco recusaria)", () => {
    expect(SLUG.test(workflowKeyFromLabel("2026 — metas"))).toBe(true);
    expect(SLUG.test(workflowKeyFromLabel("!!!"))).toBe(true);
    expect(SLUG.test(workflowKeyFromLabel("123"))).toBe(true);
  });

  it("respeita o teto de 40 caracteres sem terminar em separador", () => {
    const key = workflowKeyFromLabel("a".repeat(60));
    expect(key.length).toBeLessThanOrEqual(40);
    expect(SLUG.test(key)).toBe(true);
    const longo = workflowKeyFromLabel(`${"palavra ".repeat(10)}`);
    expect(longo.endsWith("_")).toBe(false);
  });
});

describe("uniqueWorkflowKey", () => {
  it("livre = a própria chave", () => {
    expect(uniqueWorkflowKey("Criar lead", new Set())).toBe("criar_lead");
  });

  it("colisão ganha sufixo, e o sufixo também colide sem quebrar", () => {
    const taken = new Set(["criar_lead", "criar_lead_2"]);
    expect(uniqueWorkflowKey("Criar lead", taken)).toBe("criar_lead_3");
  });

  it("chave no limite abre espaço para o sufixo em vez de estourar", () => {
    const base = workflowKeyFromLabel("a".repeat(40));
    const key = uniqueWorkflowKey("a".repeat(40), new Set([base]));
    expect(key.length).toBeLessThanOrEqual(40);
    expect(key).not.toBe(base);
    expect(SLUG.test(key)).toBe(true);
  });
});
