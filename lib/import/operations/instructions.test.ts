// Versão: 1.0 | Data: 31/07/2026
// Paridade do SPEC de operações com o código real (padrão records): todo op
// de PROFILE_OPS aparece no texto, o teto e a regra de operação automática
// estão presentes, e o EXEMPLO do SPEC passa pelo validador REAL com um
// contexto sintético — o exemplo nunca pode divergir do contrato.
import { describe, expect, it } from "vitest";

import { NO_VALUE_OPS, PROFILE_OPS } from "@/lib/config/operation-profile";

import {
  buildOperationsPromptText,
  OPERATIONS_SPEC,
  OPERATIONS_SPEC_EXAMPLE,
} from "./instructions";
import { MAX_AI_OPERATION_ACTIONS, type OperationsEditContext } from "./types";
import { validateOperationsEdit } from "./validate";

describe("SPEC de operacoes-edit (paridade com o código)", () => {
  it("interpola os ops reais do perfil e o teto de ações", () => {
    for (const op of PROFILE_OPS) expect(OPERATIONS_SPEC).toContain(op);
    for (const op of NO_VALUE_OPS) expect(OPERATIONS_SPEC).toContain(op);
    expect(OPERATIONS_SPEC).toContain(`NO MÁXIMO ${MAX_AI_OPERATION_ACTIONS}`);
    expect(OPERATIONS_SPEC).toContain("automatica");
    expect(OPERATIONS_SPEC).toContain("NÃO existe ação de exclusão");
    expect(OPERATIONS_SPEC).toContain("SUBSTITUI a proposta pendente INTEIRA");
  });

  it("o EXEMPLO passa pelo validador REAL (5 ações, 1 nota)", () => {
    const ctx: OperationsEditContext = {
      operations: [
        { id: "op1", name: "Comercial", parentId: null, active: true, auto: false },
        { id: "op2", name: "Parcerias antigas", parentId: null, active: true, auto: false },
      ],
      responsibles: [
        { id: "r1", name: "Maria Silva", active: true },
        { id: "r2", name: "João Souza", active: true },
      ],
      links: [{ responsibleId: "r2", operationId: "op1", priority: 1 }],
      profileFields: ["channel"],
      sourceKeys: ["deals"],
    };
    const res = validateOperationsEdit(OPERATIONS_SPEC_EXAMPLE, ctx);
    expect(res).toMatchObject({ ok: true });
    if (!res.ok) return;
    expect(res.actions).toHaveLength(5);
    expect(res.warnings).toHaveLength(1);
  });

  it("buildOperationsPromptText embute SPEC e catálogo", () => {
    const prompt = buildOperationsPromptText({ catalogJson: '{"operacoes":[]}' });
    expect(prompt).toContain("FORMATO DA RESPOSTA");
    expect(prompt).toContain("CATÁLOGO ATUAL (JSON)");
    expect(prompt).toContain('{"operacoes":[]}');
    expect(prompt).toContain(OPERATIONS_SPEC_EXAMPLE);
  });
});
