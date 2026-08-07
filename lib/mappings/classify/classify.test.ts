// Versão: 1.0 | Data: 07/08/2026
// Paridade do classificador V5 portado com o comportamento do Apps Script
// legado: casos REAIS tirados dos caches "Map Cargos"/"Map Segmentos"
// (classificados pelo V5 na origem). Regressão aqui = a heurística divergiu
// do sistema antigo — ajuste o port, não o teste.
import { describe, expect, it } from "vitest";

import { classifyCargo, classifyCargoNivel, normalizeCargo } from "./cargo";
import { classifySegmento } from "./segmento";
import { UNCLASSIFIED } from "./shared";

describe("classifyCargo — casos reais do cache legado", () => {
  const cases: [string, string, string][] = [
    ["IT Manager", "TI", "Gerente"],
    ["CTO", "TI", "C-Level"],
    ["Chief Information Officer", "TI", "C-Level"],
    ["Legal Manager", "Legal", "Gerente"],
    ["Gerente Jurídico e Compliance", "Compliance", "Gerente"],
    ["Especialista em Compliance", "Compliance", "Analista"],
    ["Coordenadora de Compliance", "Compliance", "Gerente"], // coordenador ≠ C-Level
    ["HR Coordinator", "RH", "Gerente"],
    ["Gerente Executivo de Pessoas", "RH", "Gerente"],
    ["Diretor de Gente, Comunicação e Responsabilidade Social", "RH", "Diretor"],
    ["Gerente Comercial Corporate", "Vendas", "Gerente"],
    ["Sales Manager", "Vendas", "Gerente"],
    ["Head of Sales and Growth", "Vendas", "Gerente"],
    ["Chief Revenue Officer (CRO)", "Vendas", "C-Level"],
    ["Customer Success Manager", "Customer Success", "Gerente"],
    ["CFO", "Finanças", "C-Level"],
    ["Chief Operating Officer", "Operacional", "C-Level"],
    ["COO - Financial Services", "Operacional", "C-Level"],
    ["Diretor Operacional Industrial", "Operacional", "Diretor"],
    ["Contract Manager", "Operacional", "Gerente"],
    ["Industrial Manager", "Operacional", "Gerente"],
    ["Product Manager Lead | Governança de TI", "Produto", "Gerente"],
    ["CEO", "Administração", "C-Level"],
    ["Founder & CEO", "Administração", "C-Level"],
    ["Compliance Officer", "Compliance", "Diretor"], // officer sem chief = Diretor
    ["Engineering Director", "TI", "Diretor"],
  ];
  for (const [raw, area, nivel] of cases) {
    it(`"${raw}" → ${area}/${nivel}`, () => {
      expect(classifyCargo(raw)).toEqual({ area, nivel });
    });
  }

  it("lixo (só números, curto, sem letras) não classifica", () => {
    for (const junk of ["1440", "ab", "??", "", "  "]) {
      expect(classifyCargo(junk)).toEqual({
        area: UNCLASSIFIED,
        nivel: UNCLASSIFIED,
      });
    }
  });

  it("normalização preserva contexto de cargo e corta empresa", () => {
    // Delimitador forte corta a empresa.
    expect(normalizeCargo("CTO at RB Serviços/Ticket Transporte")).toBe("cto");
    // " em " NÃO corta quando a 2ª parte é área de cargo.
    expect(normalizeCargo("Especialista em Compliance")).toBe(
      "especialista em compliance"
    );
  });

  it("níveis: superintendente/head/tech lead = Gerente; trainee = Analista", () => {
    expect(classifyCargoNivel("superintendente de suprimentos")).toBe("Gerente");
    expect(classifyCargoNivel("tech lead")).toBe("Gerente");
    expect(classifyCargoNivel("trainee de riscos")).toBe("Analista");
    expect(classifyCargoNivel("escrivao")).toBe("Outros");
  });
});

describe("classifySegmento — casos reais do cache legado", () => {
  const cases: [string, string][] = [
    ["farming", "Agronegócio"],
    ["food & beverages", "Indústria - Alimentos e Bebidas"],
    ["information technology & services", "Tecnologia e Telecomunicações"],
    ["wholesale", "Atacado e Distribuição"],
    ["banking", "Serviços Financeiros"],
    ["insurance", "Seguros"],
    ["logistics & supply chain", "Logística e Transportes"],
    ["real estate", "Mercado Imobiliário"],
    ["Energia solar", "Energia e Saneamento"],
    ["Metalúrgica", "Indústria - Metalurgia e Mineração"],
    ["Construção", "Construção Civil e Engenharia"],
    ["Universidade", "Educação e Ensino"],
    ["Hospital", "Saúde e Serviços Hospitalares"],
    ["ONG", "Governo e Terceiro Setor"],
    ["Supermercado", "Varejo e Comércio"],
    ["Agência de Marketing", "Marketing e Comunicação"],
    ["pharmaceuticals", "Indústria - Farmacêutica"],
    ["packaging & containers", "Indústria - Papel, Celulose e Embalagens"],
    ["chemicals", "Indústria - Química, Plástico e Petroquímica"],
    ["apparel & fashion", "Indústria - Têxtil e Vestuário"],
    ["machinery", "Indústria - Máquinas e Equipamentos"],
    ["Consultoria", "Serviços Corporativos e Consultoria"],
  ];
  for (const [raw, categoria] of cases) {
    it(`"${raw}" → ${categoria}`, () => {
      expect(classifySegmento(raw)).toBe(categoria);
    });
  }

  it("verticais de tech mapeiam ao setor de negócio", () => {
    expect(classifySegmento("Fintech de crédito")).toBe("Serviços Financeiros");
    expect(classifySegmento("edtech")).toBe("Educação e Ensino");
    expect(classifySegmento("proptech")).toBe("Mercado Imobiliário");
  });

  it("genéricos/vazios não classificam", () => {
    for (const generic of ["-", "", "n/a", "Empresa", "Grupo", "12"]) {
      expect(classifySegmento(generic)).toBe(UNCLASSIFIED);
    }
  });
});
