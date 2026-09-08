// Versão: 1.0 | Data: 08/09/2026
// Guardas do contrato `tarefas-edit`. O que se pina aqui é o conjunto de
// silêncios que o validador transforma em erro corrigível: título ambíguo
// (escolher um seria adivinhar), hora final órfã (o choke point a DESCARTA
// sem avisar) e fase que não existe no quadro efetivo (a tarefa iria para uma
// coluna invisível).
import { describe, expect, it } from "vitest";

import { MAX_AI_TASK_ACTIONS, type TasksEditContext } from "./types";
import { serializeTasksEdit, validateTasksEdit } from "./validate";

function makeCtx(over: Partial<TasksEditContext> = {}): TasksEditContext {
  return {
    tasks: [
      {
        id: "t1",
        title: "Enviar contrato",
        phase: "a_fazer",
        boardId: null,
        completed: false,
        responsibleId: null,
        dueDate: null,
        dueTime: "09:00",
      },
      {
        id: "t2",
        title: "Tarefa fechada",
        phase: "concluida",
        boardId: null,
        completed: true,
        responsibleId: null,
        dueDate: null,
        dueTime: null,
      },
      {
        id: "t3",
        title: "No quadro",
        phase: "triagem",
        boardId: "b1",
        completed: false,
        responsibleId: null,
        dueDate: null,
        dueTime: null,
      },
    ],
    responsibles: [{ id: "r1", name: "Maria Silva" }],
    boards: [
      {
        id: "b1",
        name: "Onboarding",
        phases: [
          { key: "triagem", label: "Triagem", completes: false },
          { key: "pronto", label: "Pronto", completes: true },
        ],
      },
    ],
    defaultPhases: [
      { key: "a_fazer", label: "A fazer", completes: false },
      { key: "concluida", label: "Concluída", completes: true },
    ],
    ...over,
  };
}

const run = (acoes: unknown[], ctx = makeCtx()) =>
  validateTasksEdit(
    JSON.stringify({ formato: "tarefas-edit", versao: 1, acoes }),
    ctx
  );

describe("resolução do alvo", () => {
  it("título ambíguo é ERRO, nunca uma escolha", () => {
    const ctx = makeCtx();
    ctx.tasks.push({ ...ctx.tasks[0], id: "t9" });
    const res = run([{ acao: "editar", tarefa: "Enviar contrato", data: null }], ctx);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.errors.join(" ")).toContain("2 tarefas");
  });

  it("concluir só enxerga tarefas EM ABERTO", () => {
    expect(run([{ acao: "concluir", tarefa: "Tarefa fechada" }]).ok).toBe(false);
    expect(run([{ acao: "concluir", tarefa: "Enviar contrato" }]).ok).toBe(true);
  });

  it("título fora do catálogo é erro (nunca cria uma parecida)", () => {
    const res = run([{ acao: "editar", tarefa: "Não existe", data: null }]);
    expect(res.ok).toBe(false);
  });
});

describe("prazo", () => {
  it("hora_fim sem hora inicial é erro (o choke point a descartaria calado)", () => {
    const res = run([
      { acao: "criar", titulo: "X", hora_fim: "15:00" },
    ]);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.errors.join(" ")).toContain("hora_fim");
  });

  it("na edição, a hora JÁ GRAVADA serve de base para a hora final", () => {
    // t1 tem due_time 09:00 — "hora_fim: 10:00" é válido sem repetir a hora.
    const res = run([
      { acao: "editar", tarefa: "Enviar contrato", hora_fim: "10:00" },
    ]);
    expect(res.ok).toBe(true);
  });

  it("hora final antes da inicial é erro", () => {
    const res = run([
      { acao: "criar", titulo: "X", hora: "14:00", hora_fim: "13:00" },
    ]);
    expect(res.ok).toBe(false);
  });

  it("data fora de YYYY-MM-DD é erro", () => {
    expect(run([{ acao: "criar", titulo: "X", data: "10/09/2026" }]).ok).toBe(false);
  });
});

describe("fase", () => {
  it("aceita o rótulo da coluna do QUADRO escolhido", () => {
    const res = run([
      { acao: "criar", titulo: "X", quadro: "Onboarding", fase: "Pronto" },
    ]);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const a = res.actions[0];
    expect(a.acao === "criar" && a.fase?.key).toBe("pronto");
    expect(a.acao === "criar" && a.fase?.completes).toBe(true);
  });

  it("recusa fase de OUTRO quadro (a tarefa cairia numa coluna invisível)", () => {
    const res = run([{ acao: "criar", titulo: "X", fase: "Triagem" }]);
    expect(res.ok).toBe(false);
  });

  it("na edição, as fases vêm do quadro da PRÓPRIA tarefa", () => {
    expect(run([{ acao: "editar", tarefa: "No quadro", fase: "Pronto" }]).ok).toBe(true);
    expect(run([{ acao: "editar", tarefa: "No quadro", fase: "A fazer" }]).ok).toBe(false);
  });
});

describe("forma da resposta", () => {
  it("recusa chave desconhecida na ação", () => {
    const res = run([{ acao: "criar", titulo: "X", record_id: "abc" }]);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.errors.join(" ")).toContain("record_id");
  });

  it("recusa ação sem mudança", () => {
    expect(run([{ acao: "editar", tarefa: "Enviar contrato" }]).ok).toBe(false);
  });

  it("recusa responsável desconhecido", () => {
    expect(run([{ acao: "criar", titulo: "X", responsavel: "Fulano" }]).ok).toBe(false);
  });

  it("respeita o teto do lote", () => {
    const acoes = Array.from({ length: MAX_AI_TASK_ACTIONS + 1 }, (_, i) => ({
      acao: "criar",
      titulo: `T${i}`,
    }));
    const res = run(acoes);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.errors.join(" ")).toContain(String(MAX_AI_TASK_ACTIONS));
  });
});

describe("serializeTasksEdit", () => {
  it("faz round-trip pelo validador (a prévia pendente volta ao modelo)", () => {
    // Se a serialização perdesse um campo ou emitisse id, o turno seguinte
    // reinjetaria uma prévia que o próprio validador recusaria.
    const ctx = makeCtx();
    const first = run(
      [
        { acao: "criar", titulo: "Nova", quadro: "Onboarding", fase: "Pronto",
          responsavel: "Maria Silva", data: "2026-09-10", hora: "09:00",
          hora_fim: "10:00", descricao: null },
        { acao: "editar", tarefa: "Enviar contrato", responsavel: null },
        { acao: "concluir", tarefa: "Enviar contrato" },
      ],
      ctx
    );
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const json = serializeTasksEdit(first.actions);
    expect(json).not.toContain('"id"');
    const again = validateTasksEdit(json, ctx);
    expect(again.ok ? [] : again.errors).toEqual([]);
    if (!again.ok) return;
    expect(again.actions).toEqual(first.actions);
  });
});
