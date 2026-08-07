// Versão: 1.0 | Data: 07/08/2026
// Paridade SPEC ↔ contrato do "mapeamentos-classify": constantes reais
// presentes no texto, exemplo do SPEC aceito pelo validador REAL (contexto
// montado do REGISTRY real de domínios — nunca listas paralelas) e round-trip
// canônico da serialização.
import { describe, expect, it } from "vitest";

import { mappingDomain } from "@/lib/mappings/domains";
import {
  MAPPINGS_SPEC,
  MAPPINGS_SPEC_EXAMPLE,
  buildMappingsClassifyPromptText,
} from "./instructions";
import {
  serializeMappingsClassify,
  validateMappingsClassify,
} from "./validate";
import { csvToClassifyJson, looksLikeCsv } from "./csv";
import {
  MAPPINGS_CLASSIFY_FORMAT,
  MAPPINGS_CLASSIFY_VERSION,
  MAX_AI_MAPPING_ITEMS,
  type MappingsClassifyContext,
} from "./types";

// Contexto REALISTA: domínio cargo do registry + pendentes sintéticos que
// cobrem o exemplo do SPEC.
function cargoCtx(): MappingsClassifyContext {
  const cargo = mappingDomain("cargo")!;
  return {
    domainKey: cargo.key,
    domainLabel: cargo.label,
    rawFieldLabel: cargo.rawFieldLabel,
    targets: cargo.targets,
    optionsByTarget: cargo.options,
    pending: [
      { value: "Head of Data Analytics", norm: "head of data analytics", count: 1 },
      { value: "Sócio-Administrador", norm: "sócio-administrador", count: 276 },
      { value: "Negócios", norm: "negócios", count: 1 },
    ],
  };
}

describe("SPEC do mapeamentos-classify", () => {
  it("interpola as constantes reais", () => {
    expect(MAPPINGS_SPEC).toContain(MAPPINGS_CLASSIFY_FORMAT);
    expect(MAPPINGS_SPEC).toContain(`"versao": ${MAPPINGS_CLASSIFY_VERSION}`);
    expect(MAPPINGS_SPEC).toContain(String(MAX_AI_MAPPING_ITEMS));
    expect(MAPPINGS_SPEC).toContain("SUBSTITUI a proposta pendente INTEIRA");
    expect(MAPPINGS_SPEC).toContain("nunca crie");
  });

  it("o EXEMPLO passa pelo validador REAL com o registry real", () => {
    const res = validateMappingsClassify(MAPPINGS_SPEC_EXAMPLE, cargoCtx());
    expect(res.errors).toEqual([]);
    expect(res.ok).toBe(true);
    expect(res.items).toHaveLength(2);
    expect(res.items[0].outputs).toEqual({
      cargo_area: "TI",
      cargo_nivel: "Gerente",
    });
    expect(res.warnings).toHaveLength(1);
  });

  it("o builder embute SPEC + domínio + categorias + pendentes", () => {
    const prompt = buildMappingsClassifyPromptText({
      domainKey: "cargo",
      domainLabel: "Cargos",
      rawFieldLabel: "Cargo",
      targetsJson: `{"cargo_area": ["TI"]}`,
      pendingJson: `[{"valor": "X", "registros": 2}]`,
    });
    expect(prompt).toContain(MAPPINGS_SPEC);
    expect(prompt).toContain("CAMPOS DE SAÍDA E CATEGORIAS ACEITAS (JSON)");
    expect(prompt).toContain("VALORES PENDENTES (JSON)");
    expect(prompt).toContain('Chave: "cargo"');
  });
});

describe("validador — fail-closed com mensagens que guiam", () => {
  it("valor fora dos pendentes lista amostra; categoria inválida lista aceitas", () => {
    const ctx = cargoCtx();
    const bad = JSON.stringify({
      formato: MAPPINGS_CLASSIFY_FORMAT,
      versao: MAPPINGS_CLASSIFY_VERSION,
      dominio: "cargo",
      itens: [
        { valor: "Inexistente", saidas: { cargo_area: "TI" } },
        { valor: "Negócios", saidas: { cargo_area: "Categoria Nova" } },
        { valor: "Head of Data Analytics", saidas: { campo_errado: "TI" } },
      ],
    });
    const res = validateMappingsClassify(bad, ctx);
    expect(res.ok).toBe(false);
    expect(res.errors.some((e) => e.includes("não está entre os valores PENDENTES"))).toBe(true);
    expect(res.errors.some((e) => e.includes("não é uma categoria aceita"))).toBe(true);
    expect(res.errors.some((e) => e.includes('campo de saída desconhecido "campo_errado"'))).toBe(true);
  });

  it("dominio errado, duplicado e teto são erros", () => {
    const ctx = cargoCtx();
    const wrongDomain = validateMappingsClassify(
      JSON.stringify({
        formato: MAPPINGS_CLASSIFY_FORMAT,
        versao: MAPPINGS_CLASSIFY_VERSION,
        dominio: "segmento",
        itens: [{ valor: "Negócios", saidas: { cargo_area: "TI" } }],
      }),
      ctx
    );
    expect(wrongDomain.ok).toBe(false);
    const dup = validateMappingsClassify(
      JSON.stringify({
        formato: MAPPINGS_CLASSIFY_FORMAT,
        versao: MAPPINGS_CLASSIFY_VERSION,
        dominio: "cargo",
        itens: [
          { valor: "Negócios", saidas: { cargo_area: "Vendas" } },
          { valor: "negócios", saidas: { cargo_area: "TI" } },
        ],
      }),
      ctx
    );
    expect(dup.ok).toBe(false);
    expect(dup.errors.some((e) => e.includes("repetido"))).toBe(true);
  });

  it("CSV colado (fieldKey OU rótulo no cabeçalho) converte e valida", () => {
    const ctx = cargoCtx();
    const csv =
      "valor,cargo_area,Cargo — Nível hierárquico\n" +
      '"Head of Data Analytics",TI,Gerente\n' +
      '"Sócio-Administrador",Administração,C-Level\n';
    expect(looksLikeCsv(csv)).toBe(true);
    expect(looksLikeCsv(MAPPINGS_SPEC_EXAMPLE)).toBe(false);
    const conv = csvToClassifyJson(csv, ctx);
    expect(conv.ok, conv.ok ? "" : conv.errors.join("; ")).toBe(true);
    if (!conv.ok) return;
    const res = validateMappingsClassify(conv.json, ctx);
    expect(res.errors).toEqual([]);
    expect(res.items).toHaveLength(2);
    expect(res.items[1].outputs).toEqual({
      cargo_area: "Administração",
      cargo_nivel: "C-Level",
    });
  });

  it("CSV com coluna desconhecida lista as aceitas", () => {
    const conv = csvToClassifyJson("valor,campo_x\nA,B\n", cargoCtx());
    expect(conv.ok).toBe(false);
    if (conv.ok) return;
    expect(conv.errors[0]).toContain('Coluna desconhecida no CSV: "campo_x"');
    expect(conv.errors[0]).toContain("cargo_area");
  });

  it("SPEC menciona a alternativa CSV do fluxo manual", () => {
    expect(MAPPINGS_SPEC).toContain('cabeçalho\n   "valor,<campos de saída>"');
  });

  it("serialização faz round-trip pelo validador", () => {
    const ctx = cargoCtx();
    const first = validateMappingsClassify(MAPPINGS_SPEC_EXAMPLE, ctx);
    const roundTrip = validateMappingsClassify(
      serializeMappingsClassify("cargo", first.items),
      ctx
    );
    expect(roundTrip.ok).toBe(true);
    expect(roundTrip.items).toEqual(first.items);
  });
});
