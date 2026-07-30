// Versão: 1.0 | Data: 30/07/2026
// Testes dos helpers puros da prévia interativa (inserção por IA): a regra do
// produto "só colunas preenchidas aparecem", a ordem do catálogo, a TROCA de
// coluna (remap) e o round-trip da serialização com o validador.
import { describe, expect, it } from "vitest";

import type {
  EntryFieldSpec,
  EntryRecord,
  RecordsEntryContext,
} from "@/lib/import/records/types";
import {
  filledColumns,
  remapColumn,
  removeColumn,
  setCell,
  unusedFields,
} from "@/lib/import/records/preview";
import {
  serializeRecordsInsert,
  validateRecordsInsert,
} from "@/lib/import/records/validate";

const FIELDS: EntryFieldSpec[] = [
  { key: "title", label: "Título", kind: "core", dataType: "texto" },
  { key: "value", label: "Valor", kind: "core", dataType: "moeda" },
  { key: "custom:obs", label: "Obs", kind: "custom", dataType: "texto" },
  { key: "custom:origem", label: "Origem", kind: "custom", dataType: "texto" },
];

const ROWS: EntryRecord[] = [
  { title: "A", value: 10 },
  { title: "B", "custom:obs": "nota" },
];

describe("filledColumns", () => {
  it("só colunas com ≥1 valor, na ordem do catálogo", () => {
    expect(filledColumns(ROWS, FIELDS).map((f) => f.key)).toEqual([
      "title",
      "value",
      "custom:obs",
    ]);
  });

  it("coluna esvaziada por edição some da prévia", () => {
    let rows = ROWS;
    rows = setCell(rows, 0, "value", "");
    expect(filledColumns(rows, FIELDS).map((f) => f.key)).toEqual([
      "title",
      "custom:obs",
    ]);
  });

  it("unusedFields = complemento (alvos de remap)", () => {
    expect(unusedFields(ROWS, FIELDS).map((f) => f.key)).toEqual([
      "custom:origem",
    ]);
  });
});

describe("setCell", () => {
  it("edita só a linha alvo; vazio remove a chave", () => {
    const next = setCell(ROWS, 1, "custom:obs", "editado");
    expect(next[1]["custom:obs"]).toBe("editado");
    expect(next[0]["custom:obs"]).toBeUndefined();
    const cleared = setCell(next, 1, "custom:obs", "  ");
    expect("custom:obs" in cleared[1]).toBe(false);
  });
});

describe("remapColumn / removeColumn", () => {
  it("remap move TODOS os valores da coluna para o novo campo", () => {
    const next = remapColumn(ROWS, "custom:obs", "custom:origem");
    expect(next[1]["custom:origem"]).toBe("nota");
    expect("custom:obs" in next[1]).toBe(false);
    expect("custom:origem" in next[0]).toBe(false); // linha sem valor segue sem
  });

  it("remap preserva valor já existente no destino", () => {
    const rows: EntryRecord[] = [{ title: "A", "custom:obs": "x", "custom:origem": "y" }];
    const next = remapColumn(rows, "custom:obs", "custom:origem");
    expect(next[0]["custom:origem"]).toBe("y");
    expect("custom:obs" in next[0]).toBe(false);
  });

  it("removeColumn tira a chave de todas as linhas", () => {
    const next = removeColumn(ROWS, "title");
    expect(next.every((r) => !("title" in r))).toBe(true);
  });
});

describe("round-trip com o validador", () => {
  it("linhas editadas serializadas passam pelo validador canônico", () => {
    const ctx: RecordsEntryContext = {
      sourceKey: "x",
      sourceLabel: "X",
      recordType: "x",
      fields: FIELDS,
      responsibles: [],
      operations: [],
    };
    // Edição inline transforma número em string — o validador normaliza.
    const rows = setCell(ROWS, 0, "value", "1250.5");
    const v = validateRecordsInsert(serializeRecordsInsert(rows), ctx);
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(v.records[0].values.value).toBe(1250.5);
  });
});
