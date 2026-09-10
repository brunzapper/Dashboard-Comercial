// Versão: 1.0 | Data: 08/09/2026
// Paridade do SPEC de TAREFAS com as constantes reais (molde de
// lib/import/operations/instructions.test.ts). Teto novo ou fase padrão nova
// que não chegue ao texto reprova aqui, e o EXEMPLO do prompt roda pelo
// validador REAL — o prompt nunca ensina um JSON que o próprio sistema
// recusaria.
import { describe, expect, it } from "vitest";

import { DEFAULT_TASK_PHASES } from "@/lib/kanban/types";

import {
  TASKS_SPEC,
  TASKS_SPEC_EXAMPLE,
  buildTasksPromptText,
} from "./instructions";
import { MAX_AI_TASK_ACTIONS, type TasksEditContext } from "./types";
import { validateTasksEdit } from "./validate";

const ctx: TasksEditContext = {
  tasks: [
    {
      id: "t1",
      title: "Ligar para a Acme",
      phase: "a_fazer",
      boardId: null,
      completed: false,
      responsibleId: "r1",
      dueDate: null,
      dueTime: null,
      fromSeries: false,
    },
    {
      id: "t2",
      title: "Enviar contrato",
      phase: "a_fazer",
      boardId: null,
      completed: false,
      responsibleId: null,
      dueDate: null,
      dueTime: null,
      fromSeries: false,
    },
  ],
  responsibles: [
    { id: "r1", name: "Maria Silva" },
    { id: "r2", name: "João Souza" },
  ],
  boards: [
    {
      id: "b1",
      name: "Onboarding",
      phases: [
        { key: "a_fazer", label: "A fazer", completes: false },
        { key: "em_andamento", label: "Em andamento", completes: false },
      ],
    },
  ],
  defaultPhases: DEFAULT_TASK_PHASES.map((p) => ({
    key: p.key,
    label: p.label ?? p.key,
    completes: p.completesTask === true,
  })),
};

describe("SPEC de tarefas — derivado das constantes reais", () => {
  it("interpola o teto do lote", () => {
    expect(TASKS_SPEC).toContain(String(MAX_AI_TASK_ACTIONS));
  });

  it("interpola os rótulos das fases padrão", () => {
    for (const p of DEFAULT_TASK_PHASES) {
      expect(TASKS_SPEC).toContain(p.label ?? p.key);
    }
  });

  it("declara as invariantes que o validador cobra", () => {
    expect(TASKS_SPEC).toContain("nunca invente ids");
    expect(TASKS_SPEC).toContain("NÃO existe ação de exclusão");
    expect(TASKS_SPEC).toContain("EXIGE");
    // Sem esta frase a IA tenta "religar" o registro a cada edição.
    expect(TASKS_SPEC).toContain("CONTINUA ligada");
  });
});

describe("SPEC de tarefas — o EXEMPLO passa pelo validador REAL", () => {
  it("valida as quatro ações", () => {
    const res = validateTasksEdit(TASKS_SPEC_EXAMPLE, ctx);
    expect(res.ok ? [] : res.errors).toEqual([]);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.actions.map((a) => a.acao)).toEqual([
      "criar",
      "criar",
      "editar",
      "concluir",
    ]);
  });

  it("resolve nomes para ids sem que eles apareçam no JSON", () => {
    expect(TASKS_SPEC_EXAMPLE).not.toContain('"id"');
    const res = validateTasksEdit(TASKS_SPEC_EXAMPLE, ctx);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const criar = res.actions[0];
    expect(criar.acao === "criar" && criar.responsavel?.id).toBe("r1");
    const concluir = res.actions[3];
    expect(concluir.acao === "concluir" && concluir.alvo.id).toBe("t1");
  });

  it("avisa da tarefa homônima criada de propósito", () => {
    // "Ligar para a Acme" já existe no catálogo — o exemplo cria outra.
    const res = validateTasksEdit(TASKS_SPEC_EXAMPLE, ctx);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.warnings.some((w) => w.includes("Ligar para a Acme"))).toBe(true);
  });
});

describe("buildTasksPromptText", () => {
  it("embute SPEC e catálogo", () => {
    const prompt = buildTasksPromptText({
      catalogJson: JSON.stringify({ tarefas: ["Enviar contrato"] }),
    });
    expect(prompt).toContain("FORMATO DA RESPOSTA");
    expect(prompt).toContain("CATÁLOGO (JSON)");
    expect(prompt).toContain(TASKS_SPEC);
    expect(prompt).toContain("Enviar contrato");
  });
});
