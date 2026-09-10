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
//  - `narrow`: aqui só cabe UMA ação, e ela é "criar". Um "editar" vindo de um
//    texto que a pessoa escreveu para si mesma mexeria numa tarefa que ninguém
//    mandou mexer.
import { describe, expect, it } from "vitest";

import {
  TASKS_EDIT_FORMAT,
  TASKS_EDIT_VERSION,
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

describe("narrow — uma ação, e ela é 'criar'", () => {
  it("nenhuma ação: nada a agendar", () => {
    const r = narrow([]);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.create).toBeNull();
  });

  it("uma criação passa", () => {
    const r = narrow([{ acao: "criar" }]);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.create).not.toBeNull();
  });

  it("duas ações são recusadas — um comentário rende um próximo passo", () => {
    const r = narrow([{ acao: "criar" }, { acao: "criar" }]);
    expect(r.ok).toBe(false);
  });

  it("'editar' e 'concluir' são recusados, com o motivo no erro", () => {
    for (const acao of ["editar", "concluir"]) {
      const r = narrow([{ acao }]);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.errors[0]).toContain(acao);
    }
  });
});
