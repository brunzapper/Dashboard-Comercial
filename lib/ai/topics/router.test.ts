// Versão: 1.0 | Data: 02/10/2026
// Roteador da orquestração por tópicos (lib/ai/topics/router.ts) e o plano de
// duas fases (turn.ts) — sempre FAIL-OPEN.
import { describe, expect, it } from "vitest";

import type { AiGenerateInput, AiTextClient } from "@/lib/ai/types";
import { parseRouterAnswer, routeNotice, routeTopics } from "./router";
import { splitPrompt, type TopicCatalog } from "./split";
import { planTopicTurn } from "./turn";

const catalog: TopicCatalog = {
  domain: "Teste",
  topics: [
    { key: "graficos", title: "Gráficos", summary: "eixos", headings: ["Graficos"], keywords: ["barra"] },
    { key: "tree", title: "Tree", summary: "nós", headings: ["Tree"], keywords: ["arvore"] },
    { key: "kanban", title: "Kanban", summary: "quadro", headings: ["Kanban"] },
  ],
};
const system = "base\n## Graficos\nG\n## Tree\nT\n## Kanban\nK";
const chunks = splitPrompt(system, catalog);

function fake(answer: string | Error): AiTextClient & { calls: AiGenerateInput[] } {
  const calls: AiGenerateInput[] = [];
  return {
    calls,
    async generateText(input) {
      calls.push(input);
      if (answer instanceof Error) throw answer;
      return answer;
    },
  };
}

describe("parseRouterAnswer", () => {
  const known = { topics: new Set(["graficos", "tree"]), items: new Set(["w1", "w2"]) };
  it("ignora chave desconhecida e aceita cerca de código", () => {
    const r = parseRouterAnswer('```json\n{"topicos":["tree","inventado"],"itens":["w2","x"]}\n```', known);
    expect(r && [...r.topics]).toEqual(["tree"]);
    expect(r && r.items !== "all" && [...r.items]).toEqual(["w2"]);
  });
  it('"todos" e itens ausentes = tudo', () => {
    const r = parseRouterAnswer('{"topicos":"todos"}', known);
    expect(r && [...r.topics].sort()).toEqual(["graficos", "tree"]);
    expect(r?.items).toBe("all");
  });
  it("formato inválido ⇒ null (fail-open no chamador)", () => {
    expect(parseRouterAnswer("não sei", known)).toBeNull();
    expect(parseRouterAnswer('{"x":1}', known)).toBeNull();
  });
});

describe("routeTopics", () => {
  it("usa a escolha do roteador e SOMA palavras-chave do pedido", async () => {
    const client = fake('{"topicos":["tree"]}');
    const r = await routeTopics({ client, catalog, chunks, description: "um gráfico de barra" });
    expect(r.routed).toBe(true);
    expect(r.topics !== "all" && [...r.topics].sort()).toEqual(["graficos", "tree"]);
    expect(client.calls[0].system).toContain("tree — Tree: nós");
  });

  it("erro do provedor ⇒ tudo (nunca menos capacidade)", async () => {
    const r = await routeTopics({ client: fake(new Error("503")), catalog, chunks, description: "x" });
    expect(r.routed).toBe(false);
    expect(r.topics).toBe("all");
  });

  it("item escolhido puxa os tópicos dele; item citado pelo nome entra", async () => {
    const client = fake('{"topicos":[],"itens":["w1"]}');
    const r = await routeTopics({
      client,
      catalog,
      chunks,
      description: "ajuste o Funil de vendas",
      items: [
        { id: "w1", label: "MRR — kpi", topics: ["kanban"] },
        { id: "w2", label: "Funil de vendas — funil", topics: ["graficos"] },
      ],
    });
    expect(r.items !== "all" && [...r.items].sort()).toEqual(["w1", "w2"]);
    expect(r.topics !== "all" && [...r.topics].sort()).toEqual(["graficos", "kanban"]);
  });

  it("sem nada a escolher, nem chama o modelo", async () => {
    const client = fake('{"topicos":[]}');
    const r = await routeTopics({
      client,
      catalog: { domain: "x", topics: [] },
      chunks: splitPrompt("só núcleo", { domain: "x", topics: [] }),
      description: "x",
    });
    expect(r.routed).toBe(false);
    expect(client.calls).toHaveLength(0);
  });
});

describe("planTopicTurn", () => {
  it("1ª tentativa recortada, escalonamento = prompt inteiro; avisa o contexto", async () => {
    const notices: string[] = [];
    const plan = await planTopicTurn({
      client: fake('{"topicos":["tree"]}'),
      system,
      catalog,
      description: "oculte o realizado da árvore",
      onNotice: (t) => notices.push(t),
    });
    expect(plan.first).toContain("T");
    expect(plan.first).not.toContain("\nK");
    expect(plan.full).toBe(system);
    expect(notices[0]).toContain("Tree");
    expect(routeNotice(plan.route, catalog, plan.chunks)).toContain("1 de 3");
  });

  it("roteador quebrado ⇒ primeira tentativa já com tudo", async () => {
    const plan = await planTopicTurn({
      client: fake("lixo"),
      system,
      catalog,
      description: "x",
    });
    expect(plan.first).toBe(plan.full);
  });
});
