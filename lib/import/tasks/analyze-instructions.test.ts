// Versão: 1.2 | Data: 11/09/2026
// v1.2 (11/09/2026): o enunciado manda DECIDIR. O caso que motivou: "o Oscar me
// pediu para contactar no final de outubro" recebeu de volta "existem múltiplas
// tarefas com esse título, especifique a data" — uma pergunta, para quem tinha
// escrito um comentário e não dado uma ordem.
// Versão: 1.1 | Data: 10/09/2026
// v1.1 (10/09/2026): as quatro ações e o modo `allowDelete`. O que os testes
// novos protegem: o SPEC desta superfície ENSINA a exclusão, o de
// /operacao/tarefas continua dizendo que ela não existe, e os dois saem da
// MESMA função — um prompt que dissesse as duas coisas ao mesmo tempo se
// contradiria.
// Paridade do enunciado do "Salvar e analisar" (molde de ./instructions.test.ts).
//
// O que estes testes protegem, e é o que torna a superfície reusável em vez de
// duplicada: o enunciado NÃO reescreve o formato — ele acrescenta um pedido em
// cima do SPEC de `tarefas-edit`, que já é derivado das constantes reais. Se
// alguém escrever aqui um segundo formato, a primeira asserção reprova.
//
// E o caso que decide o desenho: aqui `acoes: []` é RESPOSTA, não erro. A
// pergunta é "o comentário muda alguma coisa?"; sem um jeito de dizer "não", o
// modelo inventa uma ação para todo comentário e a função vira ruído. O
// validador do contrato segue recusando a lista vazia (na outra superfície ela
// é o modelo não tendo trabalhado) — quem reconhece o "não" é o core, antes
// dele.
import { describe, expect, it } from "vitest";

import { DEFAULT_TASK_PHASES } from "@/lib/kanban/types";

import {
  buildCommentAnalysisPrompt,
  COMMENT_ANALYSIS_RULES,
  commentAnalysisRules,
  MAX_COMMENT_TASK_ACTIONS,
} from "./analyze-instructions";
import { TASKS_SPEC, tasksSpec } from "./instructions";
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
      fromSeries: false,
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
  allowDelete: true,
});

describe("o enunciado REUSA o SPEC de tarefas", () => {
  it("o formato inteiro vem de lá, não copiado aqui", () => {
    // Com `allowDelete` o SPEC é o da mesma função, na variante com exclusão.
    expect(prompt).toContain(tasksSpec({ allowDelete: true }));
    expect(COMMENT_ANALYSIS_RULES).not.toContain(TASKS_EDIT_FORMAT);
    expect(COMMENT_ANALYSIS_RULES).not.toContain(`"versao": ${TASKS_EDIT_VERSION}`);
  });

  it("o SPEC desta superfície ENSINA a exclusão; o da outra a NEGA", () => {
    // Um prompt com as duas frases ao mesmo tempo se contradiria — por isso a
    // regra é derivada do modo, não escrita duas vezes.
    expect(prompt).toContain('"excluir"');
    expect(TASKS_SPEC).toContain("NÃO existe ação de exclusão");
    expect(TASKS_SPEC).not.toContain('"excluir"');
    expect(prompt).not.toContain("NÃO existe ação de exclusão");
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

describe("o que o enunciado promete, o core impõe", () => {
  it("o teto de ações aparece no texto", () => {
    expect(MAX_COMMENT_TASK_ACTIONS).toBe(3);
    expect(COMMENT_ANALYSIS_RULES).toContain(
      `no máximo ${MAX_COMMENT_TASK_ACTIONS} ações`
    );
  });

  it("as quatro ações estão descritas, com quando usar cada uma", () => {
    for (const acao of ["criar", "editar", "concluir", "excluir"]) {
      expect(COMMENT_ANALYSIS_RULES).toContain(`"${acao}"`);
    }
    // A confusão que custa caro: concluir é "aconteceu", excluir é "não vai".
    expect(COMMENT_ANALYSIS_RULES).toMatch(/Não confunda com concluir/);
  });

  it("dizer que NADA mudou é uma saída explícita", () => {
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

describe("v1.2 — decidir, não perguntar", () => {
  it("o enunciado proíbe devolver a pergunta e diz como escolher", () => {
    expect(COMMENT_ANALYSIS_RULES).toContain("DECIDA");
    expect(COMMENT_ANALYSIS_RULES).toMatch(/nunca devolva a pergunta/i);
    // A régua concreta: a próxima a vencer, e todas as anteriores à data
    // combinada quando o comentário empurra o assunto para a frente.
    expect(COMMENT_ANALYSIS_RULES).toMatch(/PRÓXIMA a vencer/i);
    const comSerie = commentAnalysisRules({ allowSeries: true });
    expect(comSerie).toContain("adiar_sequencia");
    // Adiar sozinho tira tudo da tela: nada lembraria do combinado até ele
    // vencer. A resposta completa é adiar E marcar o dia.
    expect(comSerie).toMatch(/acrescente TAMBÉM um "criar"/);
    // Sem série no registro, a régua não manda preferir o que não existe.
    expect(COMMENT_ANALYSIS_RULES).not.toContain("adiar_sequencia");
  });

  it("o único caso de recusa é o empate real (mesmo título, mesmo dia)", () => {
    expect(COMMENT_ANALYSIS_RULES).toMatch(/mesmo título no mesmo dia/i);
  });

  it("o SPEC da Tree ensina a segunda coordenada do alvo", () => {
    const base = {
      comment: "O Oscar me pediu para contactar no final de outubro.",
      todayIso: "2026-09-11",
      record: { title: "Acme Ltda", stage: "Nutrição", responsible: "Maria" },
      catalogJson: "{}",
    };
    const comSerie = buildCommentAnalysisPrompt({
      ...base,
      allowDelete: true,
      allowSeries: true,
    });
    expect(comSerie).toContain("tarefa_data");
    expect(comSerie).toContain("adiar_sequencia");
    // Sem o modo, o verbo não aparece: o registro pode não ter série, ou a
    // pessoa pode não poder gravar a exceção.
    const semSerie = buildCommentAnalysisPrompt({ ...base, allowDelete: true });
    expect(semSerie).not.toContain("adiar_sequencia");
    // A chave do alvo, essa, é do contrato — vale nas duas superfícies.
    expect(semSerie).toContain("tarefa_data");
  });
});
