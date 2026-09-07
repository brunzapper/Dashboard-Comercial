// Versão: 1.0 | Data: 07/09/2026
// Paridade do SPEC do assistente do QUADRO KANBAN com as constantes reais
// (mesmo molde de lib/import/operations/instructions.test.ts): enum novo em
// lib/kanban/types.ts ou op novo em FILTER_OPS que não chegue ao texto reprova
// aqui, e o EXEMPLO do SPEC roda pelo validador REAL — o prompt nunca ensina
// um JSON que o próprio sistema recusaria.
import { describe, expect, it } from "vitest";

import { MAX_RULE_CONDITIONS } from "@/lib/kanban/automations/types";
import {
  KANBAN_AGG_LABELS,
  KANBAN_DATE_BUCKET_LABELS,
  KANBAN_MAX_BADGES,
  KANBAN_MAX_COLUMNS,
  KANBAN_METRIC_KIND_LABELS,
  KANBAN_MODE_LABELS,
} from "@/lib/kanban/types";
import { FILTER_OPS } from "@/lib/widgets/filter-ops";

import {
  buildKanbanPromptText,
  KANBAN_SPEC,
  KANBAN_SPEC_EXAMPLE,
} from "./instructions";
import { MAX_AI_AUTOMATION_RULES, type KanbanConfigContext } from "./types";
import { validateKanbanConfig } from "./validate";

const ctx: KanbanConfigContext = {
  atual: {
    mode: "registros",
    source: "deals",
    columnSource: "custom",
    columns: [
      { key: "novo", label: "Novo" },
      { key: "andamento", label: "Em andamento" },
      { key: "feito", label: "Concluído" },
    ],
  },
  quadroLabel: "Funil comercial",
  sourceKeys: ["deals", "leads", "reuniao"],
  rootSourceKeys: ["deals", "leads"],
  fields: [
    { ref: "title", label: "Título" },
    { ref: "value", label: "Valor" },
    { ref: "pipeline", label: "Funil" },
    { ref: "custom:fonte", label: "Fonte" },
  ],
  settableFields: [
    { ref: "value", label: "Valor" },
    { ref: "custom:fonte", label: "Fonte" },
  ],
  selectOptionsByField: { pipeline: ["A", "B"] },
  columns: [
    { key: "novo", label: "Novo" },
    { key: "andamento", label: "Em andamento" },
    { key: "feito", label: "Concluído" },
  ],
  automacoes: [],
};

describe("SPEC do kanban — derivado das constantes reais", () => {
  it.each([
    ["KANBAN_MODE_LABELS", KANBAN_MODE_LABELS],
    ["KANBAN_DATE_BUCKET_LABELS", KANBAN_DATE_BUCKET_LABELS],
    ["KANBAN_AGG_LABELS", KANBAN_AGG_LABELS],
    ["KANBAN_METRIC_KIND_LABELS", KANBAN_METRIC_KIND_LABELS],
  ])("interpola %s por inteiro", (_nome, labels) => {
    for (const key of Object.keys(labels)) {
      expect(KANBAN_SPEC).toContain(key);
    }
  });

  it("interpola todos os operadores de filtro", () => {
    for (const { op } of FILTER_OPS) {
      expect(KANBAN_SPEC).toContain(op);
    }
  });

  it("interpola os tetos reais", () => {
    expect(KANBAN_SPEC).toContain(String(MAX_AI_AUTOMATION_RULES));
    expect(KANBAN_SPEC).toContain(String(MAX_RULE_CONDITIONS));
    expect(KANBAN_SPEC).toContain(String(KANBAN_MAX_COLUMNS));
    expect(KANBAN_SPEC).toContain(String(KANBAN_MAX_BADGES));
  });

  it("declara as invariantes que o validador cobra", () => {
    // Frases-invariante: se saírem do texto, a IA passa a errar de forma
    // sistemática num ponto que o validador só sabe recusar.
    expect(KANBAN_SPEC).toContain("SUBSTITUI a proposta pendente INTEIRA");
    expect(KANBAN_SPEC).toContain("DESATIVADA");
    expect(KANBAN_SPEC).toContain("nunca invente ids");
    expect(KANBAN_SPEC).toContain("LISTA COMPLETA");
  });

  it("não oferece os vínculos LOCAIS do quadro", () => {
    // Mesma razão do SPEC de dashboards: são ids daquele quadro (invariante 24).
    expect(KANBAN_SPEC).not.toContain("allocationFieldKey");
    expect(KANBAN_SPEC).not.toContain("taskBoardId");
  });
});

describe("SPEC do kanban — o EXEMPLO passa pelo validador REAL", () => {
  it("valida e devolve as duas seções", () => {
    const res = validateKanbanConfig(KANBAN_SPEC_EXAMPLE, ctx);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.quadro).toBeDefined();
    expect(res.value.automacoes).toHaveLength(1);
    expect(res.value.automacoes?.[0]).toMatchObject({
      nome: "Parado há 7 dias volta para Entrada",
      ativa: true,
      posicao: 0,
    });
    expect(res.value.automacoes?.[0].rule.action).toEqual({
      type: "move_to_column",
      targetKey: "novo",
    });
    expect(res.warnings).toHaveLength(1);
  });

  it("o delta do quadro é MESCLADO sobre a config atual", () => {
    const res = validateKanbanConfig(KANBAN_SPEC_EXAMPLE, ctx);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    // O exemplo não repete mode/source/columnSource — vêm da config atual.
    expect(res.value.quadro).toMatchObject({
      mode: "registros",
      source: "deals",
      columnSource: "custom",
    });
    expect(res.value.quadro?.columns?.map((c) => c.label)).toEqual([
      "Entrada",
      "Em negociação",
      "Ganho",
    ]);
  });
});

describe("buildKanbanPromptText", () => {
  it("embute SPEC e catálogo", () => {
    const prompt = buildKanbanPromptText({
      catalogJson: JSON.stringify({ quadro: "Funil comercial" }),
    });
    expect(prompt).toContain("FORMATO DA RESPOSTA");
    expect(prompt).toContain("QUADRO ATUAL E CATÁLOGO (JSON)");
    expect(prompt).toContain(KANBAN_SPEC);
    expect(prompt).toContain("Funil comercial");
  });
});
