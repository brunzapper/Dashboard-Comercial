// Versão: 1.0 | Data: 07/08/2026
// Motor aprendido (banco de palavras): tokenização, votos por pureza,
// thresholds de confiança (nunca chuta), match exato e — o ponto do desenho —
// RETROALIMENTAÇÃO: correção manual muda a sugestão da rodada seguinte.
// Também pina a composição específico→aprendido do registry
// (composeSuggester) usando um domínio real.
import { describe, expect, it } from "vitest";

import {
  MIN_SINGLE_TOKEN_COUNT,
  buildWordBank,
  suggestFromBank,
  tokenizeValue,
} from "./learned";
import { UNCLASSIFIED } from "./shared";
import {
  buildMappingIndex,
  composeSuggester,
  mappingDomain,
} from "../domains";

const TARGETS = ["categoria"];

const entry = (rawNorm: string, categoria: string) => ({
  rawNorm,
  outputs: { categoria },
});

describe("tokenizeValue", () => {
  it("normaliza, remove stopwords/números e deduplica", () => {
    expect(tokenizeValue("Casa de Tintas & Vernizes 123")).toEqual([
      "casa",
      "tintas",
      "vernizes",
    ]);
    expect(tokenizeValue("  ")).toEqual([]);
  });
});

describe("suggestFromBank", () => {
  it("token específico aprendido sugere a categoria; sem evidência ⇒ null", () => {
    const bank = buildWordBank(
      [
        entry("loja de tintas", "Varejo"),
        entry("tintas e vernizes", "Varejo"),
        entry("fábrica de móveis", "Indústria"),
      ],
      TARGETS
    );
    // "tintas" tem 2 evidências 100% Varejo ⇒ confiança.
    expect(suggestFromBank(bank, "Casa de Tintas")).toEqual({
      categoria: "Varejo",
    });
    // Nenhum token conhecido ⇒ pendência.
    expect(suggestFromBank(bank, "Padaria Central")).toBeNull();
  });

  it("token ambíguo (pureza baixa) não decide", () => {
    const bank = buildWordBank(
      [
        entry("consultoria financeira", "Finanças"),
        entry("consultoria de obras", "Construção"),
      ],
      TARGETS
    );
    // "consultoria" está 50/50 — nunca chutar.
    expect(suggestFromBank(bank, "Consultoria Nova")).toBeNull();
  });

  it("match EXATO por norm vence sempre (mesmo Não Classificado)", () => {
    const bank = buildWordBank(
      [{ rawNorm: "serviços", outputs: { categoria: UNCLASSIFIED } }],
      TARGETS
    );
    expect(suggestFromBank(bank, "Serviços")).toEqual({
      categoria: UNCLASSIFIED,
    });
  });

  it("token único 100% puro decide sozinho a partir de N ocorrências", () => {
    const seed = Array.from({ length: MIN_SINGLE_TOKEN_COUNT }, (_, i) =>
      entry(`joalheria ${i === 0 ? "fina" : i === 1 ? "real" : "nobre"}`, "Varejo")
    );
    const bank = buildWordBank(seed, TARGETS);
    expect(suggestFromBank(bank, "Joalheria Central")).toEqual({
      categoria: "Varejo",
    });
  });

  it("RETROALIMENTAÇÃO: a correção manual muda a sugestão seguinte", () => {
    const before = buildWordBank([entry("gráfica rápida", "Marketing")], TARGETS);
    expect(suggestFromBank(before, "Gráfica Central")).toBeNull(); // 1 evidência só
    // Admin corrige/classifica mais uma gráfica → o banco aprende.
    const after = buildWordBank(
      [entry("gráfica rápida", "Marketing"), entry("gráfica editora", "Marketing")],
      TARGETS
    );
    expect(suggestFromBank(after, "Gráfica Central")).toEqual({
      categoria: "Marketing",
    });
  });
});

describe("composeSuggester (registry)", () => {
  it("específico (V5) primeiro; banco aprendido cobre o que o V5 não resolve", () => {
    const segmento = mappingDomain("segmento")!;
    const index = buildMappingIndex([
      { rawNorm: "loja de tintas", outputs: { segmento_classificado: "Varejo e Comércio" } },
      { rawNorm: "tintas imobiliárias", outputs: { segmento_classificado: "Varejo e Comércio" } },
    ]);
    const suggest = composeSuggester(segmento, index);
    // V5 resolve sozinho (fintech) — específico vence.
    expect(suggest("Fintech de crédito")).toEqual({
      segmento_classificado: "Serviços Financeiros",
    });
    // V5 devolve null p/ "Casa de tintas" — o banco aprendido cobre.
    expect(suggest("Casa de tintas")).toEqual({
      segmento_classificado: "Varejo e Comércio",
    });
    // Sem evidência em lugar nenhum ⇒ pendência.
    expect(suggest("Zyx Qwerty")).toBeNull();
  });

  it("domínio SEM classificador codificado funciona só com o aprendido", () => {
    const segmento = mappingDomain("segmento")!;
    const generic = { ...segmento, key: "generico", suggest: undefined };
    const index = buildMappingIndex([
      { rawNorm: "plano ouro", outputs: { segmento_classificado: "Premium" } },
      { rawNorm: "pacote ouro anual", outputs: { segmento_classificado: "Premium" } },
    ]);
    const suggest = composeSuggester(generic, index);
    expect(suggest("Assinatura Ouro")).toEqual({
      segmento_classificado: "Premium",
    });
  });
});
