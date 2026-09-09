// Versão: 1.0 | Data: 07/09/2026
// Guarda do validador do contrato `kanban-config`. O que interessa aqui é que
// ele NÃO tem régua própria: quadro pelo sanitizeKanbanSettings, regra pelo
// parseAutomationRule fail-closed, alvo de set_field pela lista que o servidor
// deriva de setFieldTargetError. Puro (sem banco): contexto sintético.
import { describe, expect, it } from "vitest";

import { KANBAN_OVERFLOW_KEY } from "@/lib/kanban/types";

import { MAX_AI_AUTOMATION_RULES, type KanbanConfigContext } from "./types";
import { serializeKanbanConfig, validateKanbanConfig } from "./validate";

const ctx: KanbanConfigContext = {
  atual: {
    mode: "registros",
    source: "deals",
    columnSource: "custom",
    columns: [
      { key: "novo", label: "Novo" },
      { key: "feito", label: "Concluído" },
    ],
  },
  quadroLabel: "Funil",
  sourceKeys: ["deals", "leads", "reuniao"],
  rootSourceKeys: ["deals", "leads"],
  fields: [
    { ref: "title", label: "Título" },
    { ref: "value", label: "Valor" },
    { ref: "closed_at", label: "Fechamento" },
    { ref: "custom:fonte", label: "Fonte" },
  ],
  settableFields: [{ ref: "custom:fonte", label: "Fonte" }],
  selectOptionsByField: {},
  columns: [
    { key: "novo", label: "Novo" },
    { key: "feito", label: "Concluído" },
  ],
  automacoes: [],
};

function doc(body: Record<string, unknown>): string {
  return JSON.stringify({
    formato: "kanban-config",
    versao: 1,
    ...body,
  });
}

const regra = (over: Record<string, unknown> = {}) => ({
  nome: "Regra",
  condicoes: [{ kind: "tasks", metric: "open", op: "eq", value: 0 }],
  acao: { type: "move_to_column", targetKey: "feito" },
  ...over,
});

describe("envelope", () => {
  it("recusa resposta sem objeto JSON", () => {
    const res = validateKanbanConfig("não sei fazer isso", ctx);
    expect(res.ok).toBe(false);
  });

  it("recusa formato/versão errados", () => {
    const res = validateKanbanConfig(
      JSON.stringify({ formato: "outro", versao: 9, quadro: {} }),
      ctx
    );
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.errors.join("\n")).toContain("formato");
    expect(res.errors.join("\n")).toContain("versao");
  });

  it("recusa resposta sem nada a aplicar", () => {
    const res = validateKanbanConfig(doc({}), ctx);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.errors.join("\n")).toContain("nada a aplicar");
  });

  it("coleta notas como avisos", () => {
    const res = validateKanbanConfig(
      doc({ automacoes: [regra()], notas: ["assumi X"] }),
      ctx
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.warnings).toEqual(["assumi X"]);
  });
});

describe("quadro — delta mesclado e saneado", () => {
  it("preserva a config atual nas chaves omitidas", () => {
    const res = validateKanbanConfig(
      doc({ quadro: { columns: [{ key: "novo", label: "Entrada" }] } }),
      ctx
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.quadro).toMatchObject({
      mode: "registros",
      source: "deals",
      columnSource: "custom",
    });
    expect(res.value.quadro?.columns).toEqual([{ key: "novo", label: "Entrada" }]);
  });

  it("erra em ref de campo desconhecida (checkRef injetado)", () => {
    const res = validateKanbanConfig(
      doc({ quadro: { card: { titleField: "nao_existe" } } }),
      ctx
    );
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.errors.join("\n")).toContain("nao_existe");
  });

  it("faz STRIP do vínculo local mesmo vindo no delta", () => {
    const res = validateKanbanConfig(
      doc({ quadro: { allocationFieldKey: "fase_alheia" } }),
      ctx
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.quadro).not.toHaveProperty("allocationFieldKey");
    expect(res.warnings.join("\n")).toContain("allocationFieldKey");
  });
});

describe("automações — parse fail-closed e alvos", () => {
  it("numera a posição na ordem do array", () => {
    const res = validateKanbanConfig(
      doc({
        automacoes: [regra({ nome: "A" }), regra({ nome: "B", ativa: false })],
      }),
      ctx
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.automacoes?.map((a) => [a.nome, a.ativa, a.posicao])).toEqual([
      ["A", true, 0],
      ["B", false, 1],
    ]);
  });

  it("exige nome e recusa nome repetido", () => {
    expect(validateKanbanConfig(doc({ automacoes: [regra({ nome: "" })] }), ctx).ok).toBe(
      false
    );
    const dup = validateKanbanConfig(
      doc({ automacoes: [regra({ nome: "X" }), regra({ nome: "x" })] }),
      ctx
    );
    expect(dup.ok).toBe(false);
    if (dup.ok) return;
    expect(dup.errors.join("\n")).toContain("já existe outra regra");
  });

  it("recusa regra sem condição (parse fail-closed)", () => {
    const res = validateKanbanConfig(
      doc({ automacoes: [regra({ condicoes: [] })] }),
      ctx
    );
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.errors.join("\n")).toContain("regra incompleta");
  });

  it("recusa a ação que executa esquema — ela não nasce de JSON gerado", () => {
    // A régua não é técnica: a regra dispara um fluxo que escreve FORA do
    // sistema, nasce em simulação e alguém decide armá-la. O parse a aceita
    // (é regra válida); quem barra é o contrato da IA.
    const res = validateKanbanConfig(
      doc({
        automacoes: [
          regra({ acao: { type: "run_schema", schemaKey: "cria_lead" } }),
        ],
      }),
      ctx
    );
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.errors.join("\n")).toContain("executar esquema");
  });

  it("recusa coluna alvo inexistente e a coluna de estouro", () => {
    const fantasma = validateKanbanConfig(
      doc({ automacoes: [regra({ acao: { type: "move_to_column", targetKey: "zzz" } })] }),
      ctx
    );
    expect(fantasma.ok).toBe(false);
    if (fantasma.ok) return;
    expect(fantasma.errors.join("\n")).toContain("não existe neste quadro");

    const overflow = validateKanbanConfig(
      doc({
        automacoes: [
          regra({ acao: { type: "move_to_column", targetKey: KANBAN_OVERFLOW_KEY } }),
        ],
      }),
      ctx
    );
    expect(overflow.ok).toBe(false);
  });

  it("aceita coluna CRIADA no mesmo lote (quadro + automação juntos)", () => {
    const res = validateKanbanConfig(
      doc({
        quadro: { columns: [{ key: "novo" }, { key: "perdido", label: "Perdido" }] },
        automacoes: [
          regra({ acao: { type: "move_to_column", targetKey: "perdido" } }),
        ],
      }),
      ctx
    );
    expect(res.ok).toBe(true);
  });

  it("set_field só aceita alvo da lista derivada de setFieldTargetError", () => {
    const ok = validateKanbanConfig(
      doc({
        automacoes: [
          regra({ acao: { type: "set_field", field: "custom:fonte", value: "Outro" } }),
        ],
      }),
      ctx
    );
    expect(ok.ok).toBe(true);

    const naoGravavel = validateKanbanConfig(
      doc({
        automacoes: [
          regra({ acao: { type: "set_field", field: "closed_at", value: "2026-01-01" } }),
        ],
      }),
      ctx
    );
    expect(naoGravavel.ok).toBe(false);
    if (naoGravavel.ok) return;
    expect(naoGravavel.errors.join("\n")).toContain("não pode ser gravado");
  });

  it("recusa condição sobre campo desconhecido", () => {
    const res = validateKanbanConfig(
      doc({
        automacoes: [
          regra({
            condicoes: [{ kind: "field", filter: { field: "fantasma", op: "eq", value: "x" } }],
          }),
        ],
      }),
      ctx
    );
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.errors.join("\n")).toContain("fantasma");
  });

  it("'registros conectados' exige Base RAIZ", () => {
    const res = validateKanbanConfig(
      doc({
        automacoes: [
          regra({
            condicoes: [
              { kind: "related_count", source: "reuniao", filters: [], op: "gte", value: 1 },
            ],
          }),
        ],
      }),
      ctx
    );
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.errors.join("\n")).toContain("Base raiz");
  });

  it("recusa condição de tempo sobre campo desconhecido", () => {
    const res = validateKanbanConfig(
      doc({
        automacoes: [
          regra({
            condicoes: [
              {
                kind: "time",
                basis: { type: "field_changed", field: "fantasma" },
                op: "gte",
                days: 3,
              },
            ],
          }),
        ],
      }),
      ctx
    );
    expect(res.ok).toBe(false);
  });

  it("respeita o teto do lote", () => {
    const res = validateKanbanConfig(
      doc({
        automacoes: Array.from({ length: MAX_AI_AUTOMATION_RULES + 1 }, (_, i) =>
          regra({ nome: `R${i}` })
        ),
      }),
      ctx
    );
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.errors.join("\n")).toContain(String(MAX_AI_AUTOMATION_RULES));
  });
});

describe("serializeKanbanConfig — round-trip", () => {
  it("o que sai da serialização volta idêntico pelo validador", () => {
    const first = validateKanbanConfig(
      doc({
        quadro: { columns: [{ key: "novo", label: "Entrada" }] },
        automacoes: [regra({ nome: "Fechar" })],
      }),
      ctx
    );
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const again = validateKanbanConfig(serializeKanbanConfig(first.value), ctx);
    expect(again.ok).toBe(true);
    if (!again.ok) return;
    expect(again.value).toEqual(first.value);
  });
});
