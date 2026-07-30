// Versão: 1.0 | Data: 30/07/2026
// Testes do validador da sugestão de mapeamento de CSV por IA + guarda de
// paridade do SPEC (alvos core reais de CORE_IMPORT_TARGETS, tipos de campo
// novo de IMPORT_NEW_FIELD_TYPES e o EXEMPLO passando pelo validador REAL).
import { describe, expect, it } from "vitest";

import {
  CORE_IMPORT_TARGETS,
  IMPORT_NEW_FIELD_TYPES,
} from "@/lib/import/csv";
import {
  validateCsvMapping,
  type CsvMappingContext,
} from "@/lib/import/csv-mapping/validate";
import {
  buildCsvMappingPromptText,
  CSV_MAPPING_SPEC_EXAMPLE,
} from "@/lib/import/csv-mapping/instructions";

const CTX: CsvMappingContext = {
  csvColumns: ["Nome", "Valor", "Vendedor", "Obs"],
  customFieldKeys: ["origem"],
};

function envelope(colunas: unknown[], extra: Record<string, unknown> = {}) {
  return JSON.stringify({
    formato: "csv-mapeamento",
    versao: 1,
    colunas,
    ...extra,
  });
}

describe("validateCsvMapping", () => {
  it("happy path: core, custom, responsible, new e ignore + notas → warnings", () => {
    const v = validateCsvMapping(
      envelope(
        [
          { coluna: "Nome", alvo: "core:title" },
          { coluna: "Valor", alvo: "custom:origem" },
          { coluna: "Vendedor", alvo: "responsible" },
          { coluna: "Obs", alvo: "new", novo_rotulo: "Observações", novo_tipo: "texto" },
        ],
        { notas: ["Valor parece ser a origem — confira."] }
      ),
      CTX
    );
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(v.items).toHaveLength(4);
    expect(v.items[3]).toEqual({
      coluna: "Obs",
      alvo: "new",
      novoRotulo: "Observações",
      novoTipo: "texto",
    });
    expect(v.warnings).toHaveLength(1);
  });

  it("coluna faltante, desconhecida e duplicada", () => {
    const missing = validateCsvMapping(
      envelope([{ coluna: "Nome", alvo: "core:title" }]),
      CTX
    );
    expect(missing.ok).toBe(false);
    if (!missing.ok) {
      expect(missing.errors.join(" ")).toContain('"Valor"');
    }

    const unknown = validateCsvMapping(
      envelope([{ coluna: "Inexistente", alvo: "ignore" }]),
      CTX
    );
    expect(unknown.ok).toBe(false);

    const dup = validateCsvMapping(
      envelope([
        { coluna: "Nome", alvo: "core:title" },
        { coluna: "Nome", alvo: "ignore" },
      ]),
      CTX
    );
    expect(dup.ok).toBe(false);
    if (!dup.ok) expect(dup.errors.join(" ")).toContain("mais de uma vez");
  });

  it("alvo inválido lista os aceitos", () => {
    const v = validateCsvMapping(
      envelope([{ coluna: "Nome", alvo: "core:banana" }]),
      CTX
    );
    expect(v.ok).toBe(false);
    if (v.ok) return;
    expect(v.errors[0]).toContain("core:title");
    expect(v.errors[0]).toContain("custom:origem");
  });

  it("dois destinos iguais = erro (fora ignore/responsible)", () => {
    const v = validateCsvMapping(
      envelope([
        { coluna: "Nome", alvo: "core:title" },
        { coluna: "Valor", alvo: "core:title" },
        { coluna: "Vendedor", alvo: "responsible" },
        { coluna: "Obs", alvo: "ignore" },
      ]),
      CTX
    );
    expect(v.ok).toBe(false);
    if (v.ok) return;
    expect(v.errors.join(" ")).toContain("core:title");
  });

  it("new sem rótulo ou com tipo inválido", () => {
    const v = validateCsvMapping(
      envelope([
        { coluna: "Nome", alvo: "new" },
        { coluna: "Valor", alvo: "new", novo_rotulo: "V", novo_tipo: "selecao" },
        { coluna: "Vendedor", alvo: "responsible" },
        { coluna: "Obs", alvo: "ignore" },
      ]),
      CTX
    );
    expect(v.ok).toBe(false);
    if (v.ok) return;
    expect(v.errors.join(" ")).toContain("novo_rotulo");
    expect(v.errors.join(" ")).toContain("novo_tipo");
  });
});

describe("SPEC de csv-mapeamento (paridade com o código)", () => {
  const prompt = buildCsvMappingPromptText({
    baseLabel: 'Parceiros ("parceiros")',
    columnsJson: "[]",
    customFieldsJson: "[]",
  });

  it("todo alvo core real e todo tipo de campo novo aparecem no prompt", () => {
    for (const t of CORE_IMPORT_TARGETS) {
      expect(prompt).toContain(`"${t.value}"`);
    }
    for (const t of IMPORT_NEW_FIELD_TYPES) {
      expect(prompt).toContain(t);
    }
  });

  it("o EXEMPLO do SPEC passa pelo validador REAL", () => {
    const ctx: CsvMappingContext = {
      csvColumns: [
        "Nome do Cliente",
        "Vlr Contrato",
        "Vendedor",
        "Observações",
        "Coluna interna X",
      ],
      customFieldKeys: [],
    };
    const v = validateCsvMapping(CSV_MAPPING_SPEC_EXAMPLE, ctx);
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(v.items).toHaveLength(5);
    expect(v.warnings).toHaveLength(1);
  });
});
