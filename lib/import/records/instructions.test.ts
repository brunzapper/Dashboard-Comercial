// Versão: 1.0 | Data: 30/07/2026
// GUARDA DE PARIDADE do SPEC de inserção de registros por IA (espelho do teste
// do SPEC de dashboards): o prompt deve cobrir TODA coluna editável do núcleo
// (EDITABLE_CORE_COLUMNS — coluna nova sem cobertura quebra aqui), os códigos
// de moeda reais e o teto de 10; e o EXEMPLO do SPEC precisa passar pelo
// validador REAL (exemplo quebrado ensinaria a IA errado).
import { describe, expect, it } from "vitest";

import { EDITABLE_CORE_COLUMNS } from "@/lib/config/core-writeback";
import { CURRENCY_OPTIONS } from "@/lib/widgets/currency";
import {
  buildRecordsPromptText,
  RECORDS_SPEC_EXAMPLE,
} from "@/lib/import/records/instructions";
import { MAX_AI_INSERT_RECORDS } from "@/lib/import/records/types";
import { validateRecordsInsert } from "@/lib/import/records/validate";
import type { RecordsEntryContext } from "@/lib/import/records/types";

const prompt = buildRecordsPromptText({
  baseLabel: 'Parceiros ("parceiros")',
  todayIso: "2026-07-30",
  catalogJson: "{}",
  samplesJson: "[]",
  samplesNote: "nota",
});

describe("SPEC de registros-insert (paridade com o código)", () => {
  it("toda coluna de EDITABLE_CORE_COLUMNS aparece no prompt", () => {
    for (const col of Object.keys(EDITABLE_CORE_COLUMNS)) {
      expect(prompt).toContain(`"${col}"`);
    }
  });

  it("teto de registros e códigos de moeda reais presentes", () => {
    expect(prompt).toContain(`NO MÁXIMO ${MAX_AI_INSERT_RECORDS}`);
    for (const c of CURRENCY_OPTIONS) {
      expect(prompt).toContain(c.value);
    }
  });

  it("o EXEMPLO do SPEC passa pelo validador REAL", () => {
    const ctx: RecordsEntryContext = {
      sourceKey: "parceiros",
      sourceLabel: "Parceiros",
      recordType: "parceiros",
      fields: [
        { key: "title", label: "Título", kind: "core", dataType: "texto" },
        { key: "value", label: "Valor", kind: "core", dataType: "moeda" },
        {
          key: "currency",
          label: "Moeda",
          kind: "core",
          dataType: "texto",
          options: CURRENCY_OPTIONS.map((c) => c.value),
          strictOptions: true,
        },
        { key: "closed", label: "Fechado", kind: "core", dataType: "booleano" },
        { key: "closed_at", label: "Fechamento", kind: "core", dataType: "data" },
        {
          key: "responsible_id",
          label: "Responsável",
          kind: "relation",
          dataType: "relacao",
          options: ["Maria Silva"],
          strictOptions: true,
        },
        {
          key: "custom:origem_lead",
          label: "Origem",
          kind: "custom",
          dataType: "selecao",
          options: ["Indicação"],
          strictOptions: true,
        },
      ],
      responsibles: [{ id: "r1", name: "Maria Silva" }],
      operations: [],
    };
    const v = validateRecordsInsert(RECORDS_SPEC_EXAMPLE, ctx);
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(v.records).toHaveLength(2);
    expect(v.warnings).toHaveLength(1);
  });
});
