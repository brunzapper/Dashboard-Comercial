// Versão: 1.0 | Data: 07/08/2026
// Guarda do "100% dos campos" de /registros: parse fail-safe do resultado da
// 0120, conjunto/ordem das colunas núcleo e custom da tabela (populada ∪
// atribuída, ACL preservado), linhas da grade núcleo do detalhe (guard de
// coluna ausente) e chaves órfãs de "Outros dados".
import { describe, expect, it } from "vitest";

import type { RecordRow } from "./types";
import {
  coreDetailRows,
  coreRefLabel,
  DETAIL_EDITABLE_CORE_REFS,
  DETAIL_HEADER_REFS,
  orderCoreRefs,
  orphanCustomKeys,
  parsePopulatedRefs,
  tableCoreColumns,
  tableCustomFields,
} from "./detail-fields";

function makeRecord(over: Partial<RecordRow> = {}): RecordRow {
  return {
    id: "r1",
    record_type: "negocio",
    source_system: "bitrix",
    title: "Negócio X",
    pipeline: "Vendas",
    stage: "Contrato",
    stage_semantic: "won",
    value: 100,
    mrr: 50,
    currency: "BRL",
    sale_type: "nova",
    channel: "inbound",
    closed: true,
    closed_at: "2026-08-01T10:00:00-03:00",
    opened_at: "2026-07-01T10:00:00-03:00",
    source_created_at: "2026-06-01T10:00:00-03:00",
    responsible_id: null,
    operation_id: null,
    related_lead_id: null,
    lead_time_days: 30,
    custom_fields: {},
    last_synced_at: null,
    locally_modified_at: null,
    ...over,
  };
}

describe("parsePopulatedRefs", () => {
  it("aceita o shape da 0120 e rejeita qualquer outro (fail-safe ⇒ null)", () => {
    expect(
      parsePopulatedRefs({ core: ["stage"], custom: ["fonte"] })
    ).toEqual({ core: ["stage"], custom: ["fonte"] });
    expect(parsePopulatedRefs({ core: [], custom: [] })).toEqual({
      core: [],
      custom: [],
    });
    for (const bad of [
      null,
      undefined,
      "x",
      [],
      {},
      { core: ["a"] },
      { core: "a", custom: [] },
      { core: [1], custom: [] },
    ]) {
      expect(parsePopulatedRefs(bad)).toBeNull();
    }
  });
});

describe("orderCoreRefs / coreRefLabel", () => {
  it("sort_order da linha core (0086) vence; sem linha, ordem de CORE_FIELDS", () => {
    const defs = [
      { field_key: "closed_at", label: "Fechamento", sort_order: 1 },
      { field_key: "stage", label: "Etapa", sort_order: 2 },
    ];
    expect(orderCoreRefs(["stage", "pipeline", "closed_at"], defs)).toEqual([
      "closed_at",
      "stage",
      "pipeline",
    ]);
    // Sem defs: ordem estática (pipeline vem antes de closed_at).
    expect(orderCoreRefs(["closed_at", "pipeline"])).toEqual([
      "pipeline",
      "closed_at",
    ]);
  });

  it("rótulo: override do /campos vence o estático", () => {
    expect(
      coreRefLabel("closed_at", [
        { field_key: "closed_at", label: "Data de Fechamento (BR)", sort_order: 1 },
      ])
    ).toBe("Data de Fechamento (BR)");
    expect(coreRefLabel("closed_at")).toBe("Data de fechamento");
    expect(coreRefLabel("desconhecida")).toBe("desconhecida");
  });
});

describe("tableCoreColumns", () => {
  it("interseção com as populadas; null (sem RPC) cai no fallback", () => {
    const populated = { core: ["closed_at", "stage", "naoexiste"], custom: [] };
    expect(tableCoreColumns(populated)).toEqual(["stage", "closed_at"]);
    expect(tableCoreColumns(null, undefined, ["stage", "value"])).toEqual([
      "stage",
      "value",
    ]);
  });

  it("nunca inclui identidade/cabeçalho (title/record_type/source_system)", () => {
    const populated = {
      core: ["title", "record_type", "source_system", "value"],
      custom: [],
    };
    expect(tableCoreColumns(populated)).toEqual(["value"]);
  });
});

describe("tableCustomFields", () => {
  const defs: { field_key: string; data_type: "texto" | "numero" | "calculado_agg" }[] = [
    { field_key: "da_base", data_type: "texto" },
    { field_key: "de_fora_populada", data_type: "numero" },
    { field_key: "de_fora_vazia", data_type: "texto" },
    { field_key: "restrita", data_type: "texto" },
    { field_key: "agregada", data_type: "calculado_agg" },
  ];
  const opts = {
    applies: (f: { field_key: string }) => f.field_key === "da_base",
    visible: (f: { field_key: string }) => f.field_key !== "restrita",
    populatedCustom: new Set(["de_fora_populada", "restrita", "agregada"]),
  };

  it("atribuída à base entra mesmo vazia; de fora só populada; ACL e calculado_agg barram", () => {
    expect(tableCustomFields(defs, opts).map((f) => f.field_key)).toEqual([
      "da_base",
      "de_fora_populada",
    ]);
  });
});

describe("coreDetailRows", () => {
  it("modo leitura: núcleo inteiro fora do cabeçalho — closed_at incluso", () => {
    const rows = coreDetailRows(makeRecord(), undefined, DETAIL_HEADER_REFS);
    const refs = rows.map((r) => r.ref);
    expect(refs).toContain("closed_at");
    expect(refs).toContain("pipeline");
    expect(refs).toContain("sale_type");
    expect(refs).toContain("opened_at");
    expect(refs).toContain("stage_semantic");
    expect(refs).toContain("responsible_id");
    expect(refs).not.toContain("title");
    expect(refs).not.toContain("record_type");
  });

  it("modo edição: pula o que tem input próprio (skip = header ∪ editáveis)", () => {
    const skip = new Set([...DETAIL_HEADER_REFS, ...DETAIL_EDITABLE_CORE_REFS]);
    const refs = coreDetailRows(makeRecord(), undefined, skip).map((r) => r.ref);
    expect(refs).toContain("closed_at");
    expect(refs).toContain("pipeline");
    expect(refs).not.toContain("stage");
    expect(refs).not.toContain("value");
    expect(refs).not.toContain("responsible_id");
  });

  it("coluna ausente do select da superfície é pulada (nunca '—' falso)", () => {
    const rec = makeRecord();
    delete (rec as Partial<RecordRow>).stage_semantic;
    delete (rec as Partial<RecordRow>).opened_at;
    const refs = coreDetailRows(rec, undefined, DETAIL_HEADER_REFS).map(
      (r) => r.ref
    );
    expect(refs).not.toContain("stage_semantic");
    expect(refs).not.toContain("opened_at");
    expect(refs).toContain("closed_at");
  });
});

describe("orphanCustomKeys", () => {
  it("só chave com valor e SEM definição; ordenadas; null-safe", () => {
    expect(
      orphanCustomKeys(
        { email: "a@b.c", zeta: 1, alfa: "x", vazia: "", nula: null, fonte: "y" },
        ["fonte"]
      )
    ).toEqual(["alfa", "email", "zeta"]);
    expect(orphanCustomKeys(null, [])).toEqual([]);
    expect(orphanCustomKeys(undefined, ["a"])).toEqual([]);
  });

  it("zero exibível conta como valor (não é vazio)", () => {
    expect(orphanCustomKeys({ contagem: 0 }, [])).toEqual(["contagem"]);
  });
});
