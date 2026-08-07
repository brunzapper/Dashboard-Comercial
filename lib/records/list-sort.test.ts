// Versão: 1.0 | Data: 07/08/2026
// Guarda da ordenação de /registros: whitelist núcleo (sem relações), custom
// só com definição no catálogo e chave segura, expressão `->` (numérico) vs
// `->>` (texto) e o ciclo do toggle. Param inválido ⇒ null (fallback à ordem
// padrão) — nunca expressão perigosa.
import { describe, expect, it } from "vitest";

import type { FieldDefinition } from "./types";
import {
  parseRecordListSort,
  SORTABLE_CORE_REGISTROS,
  sortColumnExpr,
  toggleSort,
} from "./list-sort";

const FIELDS: Pick<FieldDefinition, "field_key" | "data_type">[] = [
  { field_key: "mrr_contrato", data_type: "moeda" },
  { field_key: "qtd_reunioes", data_type: "numero" },
  { field_key: "pontuacao", data_type: "calculado" },
  { field_key: "data_reuniao", data_type: "data" },
  { field_key: "segmento", data_type: "selecao" },
];

describe("parseRecordListSort", () => {
  it("aceita colunas núcleo da whitelist (relações fora)", () => {
    expect(parseRecordListSort("closed_at", "desc", [])).toEqual({
      ref: "closed_at",
      dir: "desc",
    });
    expect(parseRecordListSort("value", "asc", [])).toEqual({
      ref: "value",
      dir: "asc",
    });
    // Relações ordenariam por UUID — rejeitadas.
    expect(parseRecordListSort("responsible_id", "asc", [])).toBeNull();
    expect(parseRecordListSort("operation_id", "desc", [])).toBeNull();
    expect(parseRecordListSort("related_lead_id", "asc", [])).toBeNull();
    expect(SORTABLE_CORE_REGISTROS.has("title")).toBe(true);
    expect(SORTABLE_CORE_REGISTROS.has("responsible_id")).toBe(false);
  });

  it("dir inválido/ausente vira asc; ordenar vazio ⇒ null", () => {
    expect(parseRecordListSort("stage", "", [])).toEqual({
      ref: "stage",
      dir: "asc",
    });
    expect(parseRecordListSort("stage", "lixo", [])).toEqual({
      ref: "stage",
      dir: "asc",
    });
    expect(parseRecordListSort("", "desc", [])).toBeNull();
  });

  it("custom exige definição no catálogo", () => {
    expect(parseRecordListSort("custom:segmento", "asc", FIELDS)).toEqual({
      ref: "custom:segmento",
      dir: "asc",
    });
    expect(parseRecordListSort("custom:inexistente", "asc", FIELDS)).toBeNull();
    // Coluna núcleo digitada como custom não passa.
    expect(parseRecordListSort("custom:stage", "asc", [])).toBeNull();
  });

  it("chave insegura p/ o parse do PostgREST é rejeitada", () => {
    for (const key of ["a.b", "a,b", "a(b)", "a b", 'a"b', "a'b", ""]) {
      expect(parseRecordListSort(`custom:${key}`, "asc", FIELDS)).toBeNull();
    }
  });

  it("refs aleatórios ⇒ null", () => {
    expect(parseRecordListSort("record_type; drop", "asc", [])).toBeNull();
    expect(parseRecordListSort("custom_fields->>x", "asc", [])).toBeNull();
  });
});

describe("sortColumnExpr", () => {
  it("núcleo sai como a própria coluna", () => {
    expect(sortColumnExpr({ ref: "closed_at", dir: "asc" }, FIELDS)).toBe(
      "closed_at"
    );
  });

  it("numero/moeda/calculado ordenam por jsonb `->` (numérico)", () => {
    for (const key of ["mrr_contrato", "qtd_reunioes", "pontuacao"]) {
      expect(sortColumnExpr({ ref: `custom:${key}`, dir: "asc" }, FIELDS)).toBe(
        `custom_fields->${key}`
      );
    }
  });

  it("texto/data/selecao ordenam por `->>` (texto; data naive é lexical)", () => {
    expect(
      sortColumnExpr({ ref: "custom:data_reuniao", dir: "desc" }, FIELDS)
    ).toBe("custom_fields->>data_reuniao");
    expect(
      sortColumnExpr({ ref: "custom:segmento", dir: "asc" }, FIELDS)
    ).toBe("custom_fields->>segmento");
  });
});

describe("toggleSort", () => {
  it("cicla asc → desc → limpa e reinicia ao trocar de coluna", () => {
    const asc = toggleSort(null, "value");
    expect(asc).toEqual({ ref: "value", dir: "asc" });
    const desc = toggleSort(asc, "value");
    expect(desc).toEqual({ ref: "value", dir: "desc" });
    expect(toggleSort(desc, "value")).toBeNull();
    // Coluna diferente sempre recomeça em asc.
    expect(toggleSort(desc, "stage")).toEqual({ ref: "stage", dir: "asc" });
  });
});
