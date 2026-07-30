// Versão: 1.0 | Data: 30/07/2026
// Testes do validador estrutural do contrato "campos-create" (criação de
// campos por IA) + guarda de paridade do SPEC (tipos de DATA_TYPE_LABELS,
// funções de FORMULA_FUNC_GROUPS, moedas reais, teto de 10 e o EXEMPLO
// passando pelo validador REAL). A validação de FÓRMULA (catálogo do banco)
// fica no core (lib/ai/create-fields.ts) — aqui só a estrutura.
import { describe, expect, it } from "vitest";

import { DATA_TYPE_LABELS } from "@/lib/records/types";
import { CURRENCY_OPTIONS } from "@/lib/widgets/currency";
import { FORMULA_FUNC_GROUPS } from "@/lib/import/dashboard/settings-docs";
import {
  serializeFieldsCreate,
  validateFieldsCreate,
} from "@/lib/import/fields/validate";
import type { FieldsCreateContext } from "@/lib/import/fields/types";
import {
  buildFieldsPromptText,
  FIELDS_SPEC_EXAMPLE,
} from "@/lib/import/fields/instructions";

const CTX: FieldsCreateContext = {
  existing: [
    { key: "custo", core: false },
    { key: "pipeline", core: true },
  ],
};

function envelope(campos: unknown[], extra: Record<string, unknown> = {}) {
  return JSON.stringify({
    formato: "campos-create",
    versao: 1,
    campos,
    ...extra,
  });
}

describe("validateFieldsCreate", () => {
  it("happy path por tipo + serialização canônica round-trip", () => {
    const raw = envelope(
      [
        { rotulo: "Notas internas", tipo: "texto" },
        { rotulo: "Status do contrato", tipo: "selecao", opcoes: ["Ativo", "Encerrado", " Ativo "] },
        {
          rotulo: "Margem",
          tipo: "calculado",
          formula_texto: "([Valor] - [Custo]) / [Valor]",
          percentual: true,
        },
        { rotulo: "Comissão", tipo: "moeda", moeda: { modo: "fixed", codigo: "brl" } },
      ],
      { notas: ["Assumi Custo existente."] }
    );
    const v = validateFieldsCreate(raw, CTX);
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(v.fields.map((f) => f.fieldKey)).toEqual([
      "notas_internas",
      "status_do_contrato",
      "margem",
      "comissao",
    ]);
    // opções deduplicadas/trimadas; moeda normalizada.
    expect(v.fields[1].opcoes).toEqual(["Ativo", "Encerrado"]);
    expect(v.fields[3].moedaCodigo).toBe("BRL");
    expect(v.warnings).toHaveLength(1);

    const again = validateFieldsCreate(serializeFieldsCreate(v.fields), CTX);
    expect(again.ok).toBe(true);
    if (!again.ok) return;
    expect(again.fields).toEqual(v.fields);
  });

  it("colisões: coluna core, campo existente e duplicata no lote", () => {
    const v = validateFieldsCreate(
      envelope([
        { rotulo: "Pipeline", tipo: "texto" },
        { rotulo: "Custo", tipo: "numero" },
        { rotulo: "Margem X", tipo: "texto" },
        { rotulo: "Margem-X", tipo: "numero" },
      ]),
      CTX
    );
    expect(v.ok).toBe(false);
    if (v.ok) return;
    expect(v.errors.join(" ")).toContain("coluna do núcleo");
    expect(v.errors.join(" ")).toContain('chave "custo"');
    expect(v.errors.join(" ")).toContain("rótulos precisam ser distintos");
  });

  it("regras por tipo: selecao sem opcoes, calculado sem fórmula, moeda/percentual fora do lugar", () => {
    const v = validateFieldsCreate(
      envelope([
        { rotulo: "A", tipo: "selecao" },
        { rotulo: "B", tipo: "calculado" },
        { rotulo: "C", tipo: "texto", moeda: { modo: "fixed" } },
        { rotulo: "D", tipo: "data", percentual: true },
        {
          rotulo: "E",
          tipo: "calculado",
          formula_texto: "[Valor]",
          percentual: true,
          moeda: { modo: "inherit" },
        },
      ]),
      CTX
    );
    expect(v.ok).toBe(false);
    if (v.ok) return;
    const all = v.errors.join(" ");
    expect(all).toContain('exige a lista "opcoes"');
    expect(all).toContain('exige "formula_texto"');
    expect(all).toContain('"moeda" só vale');
    expect(all).toContain('"percentual" só vale');
    expect(all).toContain("não combina");
  });

  it("tipo inválido, chave desconhecida e teto de 10", () => {
    const bad = validateFieldsCreate(
      envelope([{ rotulo: "A", tipo: "cor", extra: 1 }]),
      CTX
    );
    expect(bad.ok).toBe(false);
    if (!bad.ok) {
      expect(bad.errors.join(" ")).toContain('tipo "cor" inválido');
      expect(bad.errors.join(" ")).toContain('chave desconhecida "extra"');
    }

    const many = validateFieldsCreate(
      envelope(Array.from({ length: 11 }, (_, i) => ({ rotulo: `C${i}`, tipo: "texto" }))),
      CTX
    );
    expect(many.ok).toBe(false);
    if (!many.ok) expect(many.errors[0]).toContain("Máximo de 10");
  });
});

describe("SPEC de campos-create (paridade com o código)", () => {
  const prompt = buildFieldsPromptText({ catalogJson: "{}", operandsJson: "{}" });

  it("todo tipo de DATA_TYPE_LABELS e toda função de fórmula aparecem", () => {
    for (const t of Object.keys(DATA_TYPE_LABELS)) {
      expect(prompt).toContain(`"${t}"`);
    }
    for (const fn of Object.keys(FORMULA_FUNC_GROUPS)) {
      expect(prompt).toContain(fn);
    }
  });

  it("moedas reais e teto presentes", () => {
    for (const c of CURRENCY_OPTIONS) {
      expect(prompt).toContain(c.value);
    }
    expect(prompt).toContain("NO MÁXIMO 10");
  });

  it("o EXEMPLO do SPEC passa pelo validador REAL (estrutura)", () => {
    const v = validateFieldsCreate(FIELDS_SPEC_EXAMPLE, { existing: [] });
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(v.fields).toHaveLength(3);
    expect(v.warnings).toHaveLength(1);
  });
});
