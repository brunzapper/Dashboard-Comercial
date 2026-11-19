// Versão: 1.0 | Data: 19/11/2026
import { describe, expect, it } from "vitest";

import type { BaseSchemaRow } from "./base-schema";
import { buildBaseFieldRows, buildBaseQuality } from "./base-page";

const row = (field_ref: string, over: Partial<BaseSchemaRow> = {}): BaseSchemaRow => ({
  field_ref,
  label: null,
  sort_order: null,
  visible: true,
  origin: "bitrix",
  origin_ref: null,
  removed_at: null,
  first_seen_at: "2026-01-01T00:00:00Z",
  ...over,
});

const DEFS = [
  {
    field_key: "bitrix_uf_crm_1",
    label: "UF_CRM_1",
    data_type: "texto",
    source_system: "bitrix",
    source_field_id: "UF_CRM_1",
  },
  {
    field_key: "segmento",
    label: "Segmento",
    data_type: "selecao",
    source_system: "bitrix",
    source_field_id: "UF_CRM_9",
  },
  {
    field_key: "mrr_contrato",
    label: "MRR do contrato",
    data_type: "moeda",
    source_system: "csv",
    source_field_id: null,
  },
];

const FILL = [
  { field_ref: "core:stage", filled: 90, total: 100 },
  { field_ref: "custom:segmento", filled: 50, total: 100 },
  { field_ref: "custom:bitrix_uf_crm_1", filled: 0, total: 100 },
  { field_ref: "custom:mrr_contrato", filled: 3, total: 100 },
  { field_ref: "custom:sem_def", filled: 7, total: 100 },
  { field_ref: "core:mrr", filled: 2, total: 100 },
];

describe("buildBaseFieldRows", () => {
  const rows = buildBaseFieldRows({
    schemaRows: [
      row("core:stage", { label: "Fase do negócio", origin: "core" }),
      row("custom:segmento", { first_seen_at: "2026-11-18T00:00:00Z" }),
      row("custom:bitrix_uf_crm_1", { removed_at: "2026-11-10T00:00:00Z" }),
    ],
    defs: DEFS,
    fill: FILL,
    now: new Date("2026-11-19T00:00:00Z"),
  });

  it("núcleo primeiro, rótulo da Base vence, % preenchido", () => {
    expect(rows[0]).toMatchObject({
      ref: "core:stage",
      label: "Fase do negócio",
      globalLabel: "Etapa",
      filledPct: 90,
      isCore: true,
    });
    const seg = rows.find((r) => r.ref === "custom:segmento")!;
    expect(seg).toMatchObject({ filledPct: 50, isNew: true, originRef: "UF_CRM_9" });
  });

  it("selos: removido e nome interno", () => {
    const uf = rows.find((r) => r.ref === "custom:bitrix_uf_crm_1")!;
    expect(uf.removed).toBe(true);
    expect(uf.internalName).toBe(true);
  });

  it("qualidade: chaves fora do esquema, nunca preenchidos, núcleo fora do perfil", () => {
    const q = buildBaseQuality({
      rows,
      schemaRefs: new Set(["core:stage", "custom:segmento", "custom:bitrix_uf_crm_1"]),
      defs: DEFS,
      fill: FILL,
    });
    expect(q.outside.map((o) => [o.ref, o.defined])).toEqual([
      ["custom:sem_def", false],
      ["custom:mrr_contrato", true],
    ]);
    expect(q.coreOutside.map((o) => o.ref)).toEqual(["core:mrr"]);
    expect(q.neverFilled.map((r) => r.ref)).toEqual(["custom:bitrix_uf_crm_1"]);
    expect(q.removed).toHaveLength(1);
    expect(q.internalNames).toHaveLength(1);
  });
});
