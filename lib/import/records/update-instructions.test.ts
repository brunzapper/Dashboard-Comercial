// Versão: 1.0 | Data: 31/07/2026
// GUARDA DE PARIDADE do SPEC de atualização em massa por IA: o prompt deve
// cobrir TODO operador de FILTER_OPS (op novo sem cobertura quebra aqui),
// TODA coluna editável do núcleo, os códigos de moeda reais e o teto de 200;
// e o EXEMPLO do SPEC precisa passar pelo validador REAL.
import { describe, expect, it } from "vitest";

import { EDITABLE_CORE_COLUMNS } from "@/lib/config/core-writeback";
import { CURRENCY_OPTIONS } from "@/lib/widgets/currency";
import { FILTER_OPS } from "@/lib/widgets/filter-ops";
import {
  buildRecordsUpdatePromptText,
  RECORDS_UPDATE_SELECTION_SPEC,
  RECORDS_UPDATE_SELECTION_SPEC_EXAMPLE,
  RECORDS_UPDATE_SPEC_EXAMPLE,
} from "@/lib/import/records/update-instructions";
import {
  MAX_AI_UPDATE_RECORDS,
  type RecordsUpdateContext,
} from "@/lib/import/records/update-types";
import { validateRecordsUpdate } from "@/lib/import/records/update-validate";

const prompt = buildRecordsUpdatePromptText({
  baseLabel: 'Reunião ("reunioes_qualificadas")',
  todayIso: "2026-07-31",
  catalogJson: "{}",
  samplesJson: "[]",
  samplesNote: "nota",
});

describe("SPEC de registros-update (paridade com o código)", () => {
  it("todo operador de FILTER_OPS aparece no prompt (com rótulo)", () => {
    for (const o of FILTER_OPS) {
      expect(prompt).toContain(`"${o.op}" (${o.label})`);
    }
  });

  it("toda coluna de EDITABLE_CORE_COLUMNS aparece no prompt", () => {
    for (const col of Object.keys(EDITABLE_CORE_COLUMNS)) {
      expect(prompt).toContain(`"${col}"`);
    }
  });

  it("teto de registros e códigos de moeda reais presentes", () => {
    expect(prompt).toContain(`MÁXIMO ${MAX_AI_UPDATE_RECORDS}`);
    for (const c of CURRENCY_OPTIONS) {
      expect(prompt).toContain(c.value);
    }
  });

  it("o EXEMPLO do SPEC passa pelo validador REAL", () => {
    const ctx: RecordsUpdateContext = {
      sourceKey: "reunioes_qualificadas",
      sourceLabel: "Reunião",
      recordType: "lead",
      isSub: true,
      fields: [
        { key: "title", label: "Título", kind: "core", dataType: "texto" },
        {
          key: "custom:sdr_reuniao",
          label: "SDR da Reunião",
          kind: "custom",
          dataType: "selecao",
          options: ["Paulo Vitor Santos"],
          strictOptions: true,
        },
      ],
      filterFields: [
        { key: "custom:fonte", label: "Fonte", dataType: "texto" },
      ],
      responsibles: [{ id: "r1", name: "Paulo Vitor Santos" }],
      operations: [],
    };
    const v = validateRecordsUpdate(RECORDS_UPDATE_SPEC_EXAMPLE, ctx);
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(v.update.filters).toHaveLength(1);
    expect(v.update.changes["custom:sdr_reuniao"]).toBe("Paulo Vitor Santos");
    expect(v.warnings).toHaveLength(1);
  });
});

// v1.1 (07/08/2026): MODO SELEÇÃO — SPEC sem "filtros" (alvo = seleção).
describe("SPEC do modo seleção (paridade com o código)", () => {
  const selectionPrompt = buildRecordsUpdatePromptText(
    {
      baseLabel: 'Reunião ("reunioes_qualificadas")',
      todayIso: "2026-08-07",
      catalogJson: "{}",
      samplesJson: "[]",
      samplesNote: "nota",
      selectionCount: 3,
    },
    "selection"
  );

  const selectionCtx: RecordsUpdateContext = {
    sourceKey: "reunioes_qualificadas",
    sourceLabel: "Reunião",
    recordType: "lead",
    isSub: true,
    fields: [
      { key: "title", label: "Título", kind: "core", dataType: "texto" },
      {
        key: "custom:sdr_reuniao",
        label: "SDR da Reunião",
        kind: "custom",
        dataType: "selecao",
        options: ["Paulo Vitor Santos"],
        strictOptions: true,
      },
    ],
    filterFields: [{ key: "custom:fonte", label: "Fonte", dataType: "texto" }],
    responsibles: [{ id: "r1", name: "Paulo Vitor Santos" }],
    operations: [],
  };

  it("cabeçalho traz a contagem selecionada e o SPEC de seleção", () => {
    expect(selectionPrompt).toContain("SELECIONOU 3 registro(s)");
    expect(selectionPrompt).toContain("REGISTROS SELECIONADOS");
  });

  it("colunas editáveis do núcleo, moedas e teto presentes", () => {
    for (const col of Object.keys(EDITABLE_CORE_COLUMNS)) {
      expect(RECORDS_UPDATE_SELECTION_SPEC).toContain(`"${col}"`);
    }
    for (const c of CURRENCY_OPTIONS) {
      expect(RECORDS_UPDATE_SELECTION_SPEC).toContain(c.value);
    }
    expect(RECORDS_UPDATE_SELECTION_SPEC).toContain(
      `MÁXIMO ${MAX_AI_UPDATE_RECORDS}`
    );
  });

  it("o SPEC de seleção NÃO lista operadores de filtro (o modo não tem)", () => {
    for (const o of FILTER_OPS) {
      expect(RECORDS_UPDATE_SELECTION_SPEC).not.toContain(
        `"${o.op}" (${o.label})`
      );
    }
  });

  it("o EXEMPLO do modo seleção passa pelo validador REAL em modo seleção", () => {
    const v = validateRecordsUpdate(
      RECORDS_UPDATE_SELECTION_SPEC_EXAMPLE,
      selectionCtx,
      { selection: true }
    );
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(v.update.filters).toEqual([]);
    expect(v.update.changes["custom:sdr_reuniao"]).toBe("Paulo Vitor Santos");
  });

  it("o EXEMPLO do modo seleção é REJEITADO pelo modo filtros (sem filtros)", () => {
    const v = validateRecordsUpdate(
      RECORDS_UPDATE_SELECTION_SPEC_EXAMPLE,
      selectionCtx
    );
    expect(v.ok).toBe(false);
  });
});
