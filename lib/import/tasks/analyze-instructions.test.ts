// Versão: 1.0 | Data: 10/09/2026
// Paridade do enunciado do "Salvar e analisar" (molde de ./instructions.test.ts).
//
// O que estes testes protegem, e é o que torna a superfície reusável em vez de
// duplicada: o enunciado NÃO reescreve o formato — ele acrescenta um pedido em
// cima do SPEC de `tarefas-edit`, que já é derivado das constantes reais. Se
// alguém escrever aqui um segundo formato, a primeira asserção reprova.
//
// E o caso que decide o desenho: aqui `acoes: []` é RESPOSTA, não erro. A
// pergunta é "vale agendar?"; sem um jeito de dizer "não", o modelo inventa uma
// tarefa para todo comentário e a função vira ruído. O validador do contrato
// segue recusando a lista vazia (na outra superfície ela é o modelo não tendo
// trabalhado) — quem reconhece o "não" é o core, antes dele.
import { describe, expect, it } from "vitest";

import { DEFAULT_TASK_PHASES } from "@/lib/kanban/types";

import {
  buildCommentAnalysisPrompt,
  COMMENT_ANALYSIS_RULES,
  MAX_COMMENT_TASK_ACTIONS,
} from "./analyze-instructions";
import { TASKS_SPEC } from "./instructions";
import { TASKS_EDIT_FORMAT, TASKS_EDIT_VERSION } from "./types";
import type { TasksEditContext } from "./types";
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
    },
  ],
  responsibles: [{ id: "r1", name: "Maria Silva" }],
  boards: [],
  defaultPhases: DEFAULT_TASK_PHASES.map((p) => ({
    key: p.key,
    label: p.label ?? p.key,
    completes: p.completesTask === true,
  })),
};

const prompt = buildCommentAnalysisPrompt({
  comment: "Mandei a proposta hoje, ele ficou de responder.",
  todayIso: "2026-09-10",
  record: { title: "Acme Ltda", stage: "Proposta", responsible: "Maria Silva" },
  catalogJson: JSON.stringify({ tarefas_deste_registro: [] }),
});

describe("o enunciado REUSA o SPEC de tarefas", () => {
  it("o formato inteiro vem de lá, não copiado aqui", () => {
    expect(prompt).toContain(TASKS_SPEC);
    expect(COMMENT_ANALYSIS_RULES).not.toContain(TASKS_EDIT_FORMAT);
    expect(COMMENT_ANALYSIS_RULES).not.toContain(`"versao": ${TASKS_EDIT_VERSION}`);
  });

  it("o contexto que só esta superfície tem chega ao texto", () => {
    expect(prompt).toContain("2026-09-10");
    expect(prompt).toContain("Acme Ltda");
    expect(prompt).toContain("Proposta");
    expect(prompt).toContain("Mandei a proposta hoje");
  });

  it("campo de contexto ausente não vira linha vazia", () => {
    const magro = buildCommentAnalysisPrompt({
      comment: "oi",
      todayIso: "2026-09-10",
      record: { title: "Acme", stage: null, responsible: null },
      catalogJson: "{}",
    });
    expect(magro).not.toContain("Etapa atual:");
    expect(magro).not.toContain("Responsável:");
  });
});

describe("as duas restrições estão ditas, e são as que o core impõe", () => {
  it("no máximo uma ação, e ela é 'criar'", () => {
    expect(MAX_COMMENT_TASK_ACTIONS).toBe(1);
    expect(COMMENT_ANALYSIS_RULES).toContain("EXATAMENTE UMA");
    expect(COMMENT_ANALYSIS_RULES).toContain('"editar"');
    expect(COMMENT_ANALYSIS_RULES).toMatch(/NUNCA use "editar" nem "concluir"/);
  });

  it("dizer que NÃO há o que agendar é uma saída explícita", () => {
    expect(COMMENT_ANALYSIS_RULES).toContain('"acoes": []');
  });
});

describe("a régua de prazo", () => {
  it("o prazo dito no comentário vence", () => {
    expect(COMMENT_ANALYSIS_RULES).toMatch(/Se o comentário DIZ quando/);
  });

  it("sem prazo dito, o padrão do mercado SMB de SaaS está enumerado", () => {
    for (const caso of [
      "proposta ou orçamento enviado",
      "sem resposta",
      "reunião ou demonstração marcada",
      "nutrição",
    ]) {
      expect(COMMENT_ANALYSIS_RULES).toContain(caso);
    }
  });

  it("a data pedida é sempre absoluta — nunca 'amanhã'", () => {
    expect(COMMENT_ANALYSIS_RULES).toContain("YYYY-MM-DD");
    expect(COMMENT_ANALYSIS_RULES).toMatch(/Nunca\s+devolva "amanhã"/);
  });
});

describe("o que o enunciado ensina, o validador REAL aceita", () => {
  it("uma criação com prazo absoluto passa", () => {
    const raw = JSON.stringify({
      formato: TASKS_EDIT_FORMAT,
      versao: TASKS_EDIT_VERSION,
      acoes: [
        {
          acao: "criar",
          titulo: "Retomar contato sobre a proposta",
          data: "2026-09-14",
          responsavel: "Maria Silva",
        },
      ],
    });
    const v = validateTasksEdit(raw, ctx);
    expect(v.ok).toBe(true);
  });

  it("a lista VAZIA é recusada pelo validador — e é de propósito", () => {
    // Em /operacao/tarefas a pessoa PEDIU alguma coisa, e uma lista vazia é o
    // modelo não tendo trabalhado. Aqui "não há o que agendar" é a resposta
    // certa, e por isso o core a reconhece ANTES do validador
    // (`readEmptyAnswer`, lib/ai/analyze-comment.ts) — sem afrouxar a régua
    // que a outra superfície precisa.
    const raw = JSON.stringify({
      formato: TASKS_EDIT_FORMAT,
      versao: TASKS_EDIT_VERSION,
      acoes: [],
    });
    expect(validateTasksEdit(raw, ctx).ok).toBe(false);
  });
});
