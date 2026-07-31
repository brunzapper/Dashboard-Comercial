// Versão: 1.0 | Data: 31/07/2026
// Testes do validador `operacoes-edit`: fail-closed por item (chave
// desconhecida, nome não-resolvido/ambíguo, automática intocável, ciclo,
// colisão de nome, prioridade em conflito), catálogo de TRABALHO (referência
// a operação criada no lote; rename vale para o resto do lote) e round-trip
// da serialização canônica pelo PRÓPRIO validador.
import { describe, expect, it } from "vitest";

import {
  serializeOperationsEdit,
  validateOperationsEdit,
} from "./validate";
import {
  MAX_AI_OPERATION_ACTIONS,
  type OperationsEditContext,
} from "./types";

function makeCtx(over: Partial<OperationsEditContext> = {}): OperationsEditContext {
  return {
    operations: [
      { id: "op1", name: "Comercial", parentId: null, active: true, auto: false },
      { id: "op2", name: "Inbound", parentId: "op1", active: true, auto: false },
      { id: "op3", name: "Parceiro X", parentId: "op1", active: true, auto: true },
    ],
    responsibles: [
      { id: "r1", name: "Maria Silva", active: true },
      { id: "r2", name: "João Souza", active: true },
    ],
    links: [{ responsibleId: "r2", operationId: "op1", priority: 1 }],
    profileFields: ["channel", "custom:fonte"],
    sourceKeys: ["deals", "leads"],
    ...over,
  };
}

const wrap = (acoes: unknown[], extra: Record<string, unknown> = {}) =>
  JSON.stringify({ formato: "operacoes-edit", versao: 1, acoes, ...extra });

describe("validateOperationsEdit", () => {
  it("aceita lote válido (criar com pai do lote, vincular à nova, editar, desvincular)", () => {
    const res = validateOperationsEdit(
      wrap(
        [
          { acao: "criar", nome: "Expansão Sul", pai: "Comercial" },
          {
            acao: "criar",
            nome: "Litoral",
            pai: "Expansão Sul",
            perfil: [{ field: "channel", op: "eq_ci", value: "Litoral" }],
          },
          { acao: "vincular", responsavel: "Maria Silva", operacao: "Litoral", prioridade: 1 },
          { acao: "editar", operacao: "Inbound", novo_nome: "Inbound Marketing" },
          { acao: "desvincular", responsavel: "João Souza", operacao: "Comercial" },
        ],
        { notas: ["Assumi Comercial como raiz."] }
      ),
      makeCtx()
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.actions).toHaveLength(5);
    expect(res.warnings).toEqual(["Assumi Comercial como raiz."]);
    const criar2 = res.actions[1];
    expect(criar2.acao === "criar" && criar2.pai?.kind).toBe("nova");
    const vinc = res.actions[2];
    expect(vinc.acao === "vincular" && vinc.operacao.kind).toBe("nova");
  });

  it("round-trip: serialização canônica re-passa pelo validador (rename incluso)", () => {
    const ctx = makeCtx();
    const res = validateOperationsEdit(
      wrap([
        { acao: "editar", operacao: "Inbound", novo_nome: "Inbound Mkt" },
        // Referência pelo nome NOVO depois do rename (catálogo de trabalho).
        { acao: "vincular", responsavel: "Maria Silva", operacao: "Inbound Mkt", prioridade: 2 },
        { acao: "criar", nome: "Nova Área" },
      ]),
      ctx
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const round = validateOperationsEdit(serializeOperationsEdit(res.actions), ctx);
    expect(round.ok).toBe(true);
    if (!round.ok) return;
    expect(round.actions).toEqual(res.actions);
  });

  it("envelope: formato/versão errados, chave desconhecida no topo, teto de ações", () => {
    expect(
      validateOperationsEdit(
        JSON.stringify({ formato: "x", versao: 2, acoes: [{}], extra: 1 }),
        makeCtx()
      ).ok
    ).toBe(false);
    const demais = Array.from({ length: MAX_AI_OPERATION_ACTIONS + 1 }, (_, i) => ({
      acao: "criar",
      nome: `Op ${i}`,
    }));
    const res = validateOperationsEdit(wrap(demais), makeCtx());
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.errors[0]).toContain(`NO MÁXIMO ${MAX_AI_OPERATION_ACTIONS}`);
  });

  it("chave desconhecida POR AÇÃO e acao inválida (exclusão) reprovam", () => {
    let res = validateOperationsEdit(
      wrap([{ acao: "criar", nome: "X", id: "op9" }]),
      makeCtx()
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.errors[0]).toContain('chave desconhecida "id"');
    res = validateOperationsEdit(wrap([{ acao: "excluir", nome: "Inbound" }]), makeCtx());
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.errors[0]).toContain("criar, editar, vincular ou desvincular");
  });

  it("resolução por nome: 0 hits lista cadastrados; duplicata é ambiguidade", () => {
    let res = validateOperationsEdit(
      wrap([{ acao: "editar", operacao: "Sumida", ativa: false }]),
      makeCtx()
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.errors[0]).toContain("Cadastradas: Comercial, Inbound");
    const ctx = makeCtx({
      operations: [
        { id: "a", name: "Dupla", parentId: null, active: true, auto: false },
        { id: "b", name: "dupla", parentId: null, active: true, auto: false },
      ],
    });
    res = validateOperationsEdit(
      wrap([{ acao: "editar", operacao: "Dupla", ativa: false }]),
      ctx
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.errors[0]).toContain("ambíguo");
  });

  it("operação AUTOMÁTICA é intocável nas 4 formas", () => {
    const casos = [
      [{ acao: "editar", operacao: "Parceiro X", ativa: false }],
      [{ acao: "criar", nome: "Sub", pai: "Parceiro X" }],
      [{ acao: "vincular", responsavel: "Maria Silva", operacao: "Parceiro X", prioridade: 1 }],
      [{ acao: "desvincular", responsavel: "João Souza", operacao: "Parceiro X" }],
    ];
    for (const acoes of casos) {
      const res = validateOperationsEdit(wrap(acoes), makeCtx());
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.errors[0]).toContain("AUTOMÁTICA");
    }
  });

  it("ciclo de pai (direto e via lote) e colisão de nome reprovam", () => {
    // Inbound é filha de Comercial — mover Comercial p/ baixo dela = ciclo.
    let res = validateOperationsEdit(
      wrap([{ acao: "editar", operacao: "Comercial", novo_pai: "Inbound" }]),
      makeCtx()
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.errors[0]).toContain("ciclo");
    // Nova sob Inbound; mover Comercial para debaixo da NOVA também fecha ciclo.
    res = validateOperationsEdit(
      wrap([
        { acao: "criar", nome: "Neta", pai: "Inbound" },
        { acao: "editar", operacao: "Comercial", novo_pai: "Neta" },
      ]),
      makeCtx()
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.errors[0]).toContain("ciclo");
    res = validateOperationsEdit(wrap([{ acao: "criar", nome: "inbound" }]), makeCtx());
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.errors[0]).toContain("já existe operação");
  });

  it("vincular: prioridade inválida ou ocupada; desvincular sem vínculo", () => {
    let res = validateOperationsEdit(
      wrap([{ acao: "vincular", responsavel: "Maria Silva", operacao: "Inbound", prioridade: 0 }]),
      makeCtx()
    );
    expect(res.ok).toBe(false);
    // João já tem prioridade 1 em Comercial — outra op na mesma prioridade conflita.
    res = validateOperationsEdit(
      wrap([{ acao: "vincular", responsavel: "João Souza", operacao: "Inbound", prioridade: 1 }]),
      makeCtx()
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.errors[0]).toContain('ocupada por "Comercial"');
    // Desvincular + revincular na mesma prioridade no MESMO lote funciona.
    res = validateOperationsEdit(
      wrap([
        { acao: "desvincular", responsavel: "João Souza", operacao: "Comercial" },
        { acao: "vincular", responsavel: "João Souza", operacao: "Inbound", prioridade: 1 },
      ]),
      makeCtx()
    );
    expect(res.ok).toBe(true);
    res = validateOperationsEdit(
      wrap([{ acao: "desvincular", responsavel: "Maria Silva", operacao: "Comercial" }]),
      makeCtx()
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.errors[0]).toContain("não está vinculado");
  });

  it("perfil: op fora da whitelist, campo fora do catálogo e fonte desconhecida", () => {
    const base = (perfil: unknown) =>
      validateOperationsEdit(
        wrap([{ acao: "criar", nome: "Y", perfil }]),
        makeCtx()
      );
    expect(base([{ field: "channel", op: "match", value: "x" }]).ok).toBe(false);
    expect(base([{ field: "fantasma", op: "eq", value: "x" }]).ok).toBe(false);
    expect(
      base([{ field: "channel", op: "eq", value: "x", sources: ["nope"] }]).ok
    ).toBe(false);
    // perfil: null em editar = limpar (aceito).
    const res = validateOperationsEdit(
      wrap([{ acao: "editar", operacao: "Inbound", perfil: null }]),
      makeCtx()
    );
    expect(res.ok).toBe(true);
  });

  it("editar sem mudanças e code fence tolerado", () => {
    const res = validateOperationsEdit(
      wrap([{ acao: "editar", operacao: "Inbound" }]),
      makeCtx()
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.errors[0]).toContain("nada a alterar");
    const fenced =
      "```json\n" + wrap([{ acao: "criar", nome: "Z" }]) + "\n```";
    expect(validateOperationsEdit(fenced, makeCtx()).ok).toBe(true);
  });
});
