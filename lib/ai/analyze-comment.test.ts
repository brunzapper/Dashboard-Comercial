// Versão: 1.0 | Data: 10/09/2026
// Os dois pontos de decisão que só existem no "Salvar e analisar" — e que, por
// serem só desta superfície, são exatamente os que podem divergir do contrato
// sem ninguém notar.
//
// O resto (formato, campos, resolução de nomes) é do `tarefas-edit` e já tem
// dono e teste. Aqui ficam:
//  - `readEmptyAnswer`: "não há o que agendar" é resposta, não erro. Ela roda
//    ANTES do validador porque ele recusa `acoes: []` — e recusa com razão, na
//    superfície onde a pessoa PEDIU alguma coisa.
//  - `narrow`: o TETO de ações. Quais ações existem é decisão do validador
//    (o modo `allowDelete`), não daqui — aqui fica só o que é próprio de ler
//    UM comentário, que rende poucas coisas.
import { describe, expect, it } from "vitest";

import { MAX_COMMENT_TASK_ACTIONS } from "@/lib/import/tasks/analyze-instructions";
import {
  TASKS_EDIT_FORMAT,
  TASKS_EDIT_VERSION,
  type ParsedTaskAction,
} from "@/lib/import/tasks/types";

import { narrow, readEmptyAnswer } from "./analyze-comment";

const envelope = (extra: Record<string, unknown>) =>
  JSON.stringify({
    formato: TASKS_EDIT_FORMAT,
    versao: TASKS_EDIT_VERSION,
    ...extra,
  });

describe("readEmptyAnswer — 'nada a agendar' é resposta", () => {
  it("reconhece a lista vazia do contrato", () => {
    expect(readEmptyAnswer(envelope({ acoes: [] }))).toEqual({ notas: [] });
  });

  it("traz a explicação do modelo, que é mais útil que a frase genérica", () => {
    const r = readEmptyAnswer(
      envelope({ acoes: [], notas: ["O comentário só registra o que já foi feito."] })
    );
    expect(r?.notas).toEqual(["O comentário só registra o que já foi feito."]);
  });

  it("aceita a resposta cercada por bloco de código", () => {
    const r = readEmptyAnswer("```json\n" + envelope({ acoes: [] }) + "\n```");
    expect(r).not.toBeNull();
  });

  it("nota vazia ou não-texto não vira ruído na tela", () => {
    const r = readEmptyAnswer(envelope({ acoes: [], notas: ["  ", 42, "ok"] }));
    expect(r?.notas).toEqual(["ok"]);
  });

  it("com ação, ele NÃO decide nada — quem decide é o validador", () => {
    expect(readEmptyAnswer(envelope({ acoes: [{ acao: "criar" }] }))).toBeNull();
  });

  it("envelope de outro contrato não passa por aqui", () => {
    expect(readEmptyAnswer(JSON.stringify({ formato: "outro", acoes: [] }))).toBeNull();
    expect(
      readEmptyAnswer(JSON.stringify({ formato: TASKS_EDIT_FORMAT, versao: 99, acoes: [] }))
    ).toBeNull();
  });

  it("texto que não é JSON não derruba nada", () => {
    expect(readEmptyAnswer("desculpe, não entendi")).toBeNull();
    expect(readEmptyAnswer("[]")).toBeNull();
  });
});

describe("narrow — o teto desta superfície", () => {
  // A régua de QUAIS ações existem é do validador (modo `allowDelete`); aqui
  // fica só o teto, que é próprio da leitura de um comentário.
  const criar = { acao: "criar", titulo: "x" } as ParsedTaskAction;
  const excluir = {
    acao: "excluir",
    alvo: { id: "t1", titulo: "Demo" },
  } as ParsedTaskAction;

  it("nenhuma ação passa — é a resposta 'nada mudou'", () => {
    const r = narrow([]);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.actions).toEqual([]);
  });

  it("as quatro ações passam, misturadas", () => {
    const lote = [
      criar,
      { acao: "editar", alvo: { id: "t2", titulo: "Proposta" } } as ParsedTaskAction,
      excluir,
    ];
    const r = narrow(lote);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.actions).toHaveLength(3);
  });

  it("acima do teto é recusado, com o número no erro", () => {
    const r = narrow([criar, criar, criar, criar]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]).toContain(String(MAX_COMMENT_TASK_ACTIONS));
  });
});
