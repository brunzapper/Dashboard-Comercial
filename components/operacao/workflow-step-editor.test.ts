// Versão: 1.0 | Data: 09/09/2026
// O construtor não valida nada por conta própria — quem decide o que entra no
// banco é `parseWorkflowDefinition` (fail-closed). Isso só funciona se o que o
// construtor MONTA for aceitável: um passo recém-adicionado que derruba o
// esquema inteiro no primeiro save tornaria o botão "Adicionar passo" inútil.
//
// Estes testes pinam as duas pontas: todo passo em branco nasce válido, e o
// que o parse recusa continua sendo recusado (o construtor não é uma porta dos
// fundos para gravar definição inválida).
import { describe, expect, it } from "vitest";

import { blankStep } from "./workflow-step-editor";
import { WORKFLOW_STEP_TYPES_CATALOG } from "@/lib/workflow/registry";
import { parseWorkflowDefinition } from "@/lib/workflow/types";

const wrap = (steps: unknown[]) => ({
  version: 1,
  form: { fields: [] },
  steps,
});

describe("blankStep", () => {
  it("todo tipo do catálogo tem um passo em branco", () => {
    for (const def of WORKFLOW_STEP_TYPES_CATALOG) {
      expect(
        blankStep(def.type, "p1", def.label),
        `tipo ${def.type} sem passo em branco`
      ).not.toBeNull();
    }
  });

  it("o passo que não precisa de alvo já nasce gravável", () => {
    // Criar entidade no CRM só precisa da entidade: os campos vêm depois.
    const step = blankStep("bitrix.entity.add", "cria", "Criar");
    expect(parseWorkflowDefinition(wrap([step]))).not.toBeNull();
  });

  it("os que PRECISAM de alvo nascem incompletos — e é o parse que cobra", () => {
    // Não é defeito do construtor: montar é incremental, e o card segura o
    // rascunho até fechar em vez de mandar ao servidor o que ele recusaria.
    for (const type of ["bitrix.entity.update", "record.create", "record.update"]) {
      expect(
        parseWorkflowDefinition(wrap([blankStep(type, "p", "X")])),
        `${type} não deveria ser gravável em branco`
      ).toBeNull();
    }
  });

  it("tipo fora do catálogo não vira passo", () => {
    expect(blankStep("http.post", "p1", "X")).toBeNull();
  });

  it("vínculo apontando para passo inexistente é recusado", () => {
    const comOrfao = {
      id: "grava",
      type: "record.create",
      label: "Gravar",
      enabled: true,
      params: {
        sourceKey: "leads",
        core: { title: "x" },
        custom: {},
        linkSourceIdFrom: "passo_que_nao_existe",
      },
    };
    expect(parseWorkflowDefinition(wrap([comOrfao]))).toBeNull();
  });
});
