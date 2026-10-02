// Versão: 1.0 | Data: 02/10/2026
// Partição do prompt em tópicos (lib/ai/topics/split.ts).
import { describe, expect, it } from "vitest";

import {
  CORE_TOPIC,
  keywordTopics,
  renderChunks,
  splitPrompt,
  stripTopicMarkers,
  topicMarker,
  unmappedTopHeadings,
  type TopicCatalog,
} from "./split";

const catalog: TopicCatalog = {
  domain: "Teste",
  topics: [
    { key: "a", title: "Tópico A", summary: "o A", headings: ['"alpha"'], keywords: ["alfa"] },
    { key: "b", title: "Tópico B", summary: "o B", headings: ["Beta"] },
    { key: "fixo", title: "Fixo", summary: "sempre", always: true, headings: ["Fixo"] },
  ],
};

const text = [
  "Cabeçalho do prompt",
  "## Contrato",
  "linha do contrato",
  '## "alpha" — seção A',
  "conteúdo A",
  "### sub de A (herda)",
  "mais A",
  topicMarker("b"),
  "trecho marcado como B",
  topicMarker("core"),
  "volta ao núcleo",
  "## Beta",
  "conteúdo B",
  "",
  "============================================================",
  "# DADOS",
  "============================================================",
  "",
  "dados do núcleo",
  "## Fixo",
  "sempre vai",
].join("\n");

describe("splitPrompt / renderChunks", () => {
  it('"all" devolve o texto inteiro sem marcadores (o prompt da IA externa)', () => {
    const chunks = splitPrompt(text, catalog);
    expect(renderChunks(chunks, "all")).toBe(stripTopicMarkers(text));
    expect(renderChunks(chunks, "all")).not.toContain("@@topic");
  });

  it("cabeçalho mapeado abre o tópico; nível 3 sem mapa herda; marcador troca", () => {
    const chunks = splitPrompt(text, catalog);
    const byTopic = (t: string) => chunks.filter((c) => c.topic === t).map((c) => c.text).join("\n");
    expect(byTopic("a")).toContain("conteúdo A");
    expect(byTopic("a")).toContain("mais A");
    expect(byTopic("b")).toContain("trecho marcado como B");
    expect(byTopic("b")).toContain("conteúdo B");
    expect(byTopic(CORE_TOPIC)).toContain("volta ao núcleo");
    expect(byTopic(CORE_TOPIC)).toContain("linha do contrato");
  });

  it("a moldura ===== de uma seção acompanha o título (nada de régua solta)", () => {
    const chunks = splitPrompt(text, catalog);
    const dados = chunks.find((c) => c.heading === "DADOS");
    expect(dados?.text.startsWith("====")).toBe(true);
  });

  it("seleção: mantém núcleo + always + escolhidos, lista os de fora", () => {
    const chunks = splitPrompt(text, catalog);
    const out = renderChunks(chunks, new Set(["a"]), catalog);
    expect(out).toContain("conteúdo A");
    expect(out).toContain("sempre vai");
    expect(out).toContain("dados do núcleo");
    expect(out).not.toContain("conteúdo B");
    expect(out).toContain("TÓPICOS NÃO CARREGADOS");
    expect(out).toContain("Tópico B: o B");
  });

  it("palavras-chave casam sem acento e sem caixa", () => {
    expect([...keywordTopics(catalog, "Quero a ALFA de volta")]).toEqual(["a"]);
    expect(keywordTopics(catalog, "nada a ver").size).toBe(0);
  });

  it("acusa cabeçalho de nível 1–2 sem tópico", () => {
    expect(unmappedTopHeadings(text, catalog)).toEqual(["Contrato", "DADOS"]);
  });
});
