// Versão: 1.1 | Data: 19/11/2026
// Guarda do ESQUEMA POR BASE (0156): pertencimento de campo custom (linha do
// esquema ∪ applies_to declarado — vazio deixa de ser "todas"), sub-base usa o
// esquema da pai, perfil do núcleo (coluna fora do perfil só com valor no
// registro; `closed=false` não é valor) e fallback LEGADO quando não há
// esquema (migração não aplicada).
import { describe, expect, it } from "vitest";

import type { RecordRow } from "./types";
import type { SourceDef } from "@/lib/sources";
import {
  baseFieldLabel,
  buildBaseSchema,
  coreHasValue,
  coreProfileOf,
  coreRefInProfile,
  coreRefShown,
  fieldBelongsToBase,
  fieldBelongsToRecordType,
  isRecentlyAdded,
  loadBaseSchema,
  schemaOwnerKey,
  withBaseCoreLabels,
  type BaseSchemaRow,
} from "./base-schema";
import { coreDetailRows, DETAIL_HEADER_REFS } from "./detail-fields";

const src = (over: Partial<SourceDef>): SourceDef => ({
  key: "x",
  recordType: "x",
  label: "X",
  shortLabel: "X",
  defaultPeriodField: "source_created_at",
  builtin: false,
  manualEntry: true,
  ...over,
});

const SOURCES: SourceDef[] = [
  src({ key: "deals", recordType: "negocio", label: "Negócios" }),
  src({ key: "meetime", recordType: "meetime", label: "Meetime" }),
  src({
    key: "deals_enterprise",
    recordType: "negocio",
    label: "Enterprise",
    parentKey: "deals",
  }),
];

const row = (field_ref: string, over: Partial<BaseSchemaRow> = {}): BaseSchemaRow => ({
  field_ref,
  label: null,
  sort_order: null,
  visible: true,
  origin: "manual",
  origin_ref: null,
  removed_at: null,
  ...over,
});

const record = (over: Partial<RecordRow> = {}): RecordRow =>
  ({
    id: "r1",
    record_type: "meetime",
    source_system: "csv",
    title: "Lead X",
    pipeline: null,
    stage: null,
    stage_semantic: null,
    value: null,
    mrr: null,
    currency: null,
    sale_type: null,
    channel: null,
    closed: false,
    closed_at: null,
    opened_at: null,
    source_created_at: "2026-10-01T10:00:00-03:00",
    responsible_id: null,
    operation_id: null,
    related_lead_id: null,
    lead_time_days: null,
    custom_fields: {},
    ...over,
  }) as unknown as RecordRow;

describe("buildBaseSchema", () => {
  it("separa perfil do núcleo e chaves custom", () => {
    const s = buildBaseSchema("deals", "negocio", [
      row("core:pipeline"),
      row("core:stage"),
      row("custom:mrr_contrato"),
    ]);
    expect([...s.coreRefs].sort()).toEqual(["pipeline", "stage"]);
    expect([...s.customKeys]).toEqual(["mrr_contrato"]);
    expect(s.rows.get("core:stage")?.field_ref).toBe("core:stage");
  });

  it("ignora linha malformada", () => {
    const s = buildBaseSchema("deals", "negocio", [
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { field_ref: 42 } as any,
      row("custom:ok"),
    ]);
    expect([...s.customKeys]).toEqual(["ok"]);
  });
});

describe("fieldBelongsToBase", () => {
  const schema = buildBaseSchema("meetime", "meetime", [row("custom:cadencia")]);

  it("campo GLOBAL (applies_to vazio) só entra pela linha do esquema", () => {
    const global = { field_key: "teste_3_3", applies_to: [] };
    expect(fieldBelongsToBase(schema, global, "meetime", SOURCES)).toBe(false);
    const adopted = { field_key: "cadencia", applies_to: [] };
    expect(fieldBelongsToBase(schema, adopted, "meetime", SOURCES)).toBe(true);
  });

  it("applies_to DECLARADO segue valendo (escritores da fase 1)", () => {
    const declared = { field_key: "novo_csv", applies_to: ["meetime"] };
    expect(fieldBelongsToBase(schema, declared, "meetime", SOURCES)).toBe(true);
    const other = { field_key: "mrr_contrato", applies_to: ["negocio"] };
    expect(fieldBelongsToBase(schema, other, "meetime", SOURCES)).toBe(false);
  });

  it("sem esquema cai na regra legada (vazio = todas)", () => {
    const global = { field_key: "teste_3_3", applies_to: [] };
    expect(fieldBelongsToBase(null, global, "meetime", SOURCES)).toBe(true);
  });

  it("sub-base resolve o record_type da pai", () => {
    const deals = buildBaseSchema("deals", "negocio", []);
    const f = { field_key: "bitrix_x", applies_to: ["negocio"] };
    expect(fieldBelongsToBase(deals, f, "deals_enterprise", SOURCES)).toBe(true);
    expect(schemaOwnerKey("deals_enterprise", SOURCES)).toBe("deals");
    expect(schemaOwnerKey("deals", SOURCES)).toBe("deals");
  });
});

describe("visível por Base (v1.1)", () => {
  it("olho fechado tira o campo da Base, mesmo declarado", () => {
    const s = buildBaseSchema("meetime", "meetime", [
      row("custom:cadencia", { visible: false }),
      row("core:pipeline", { visible: false }),
    ]);
    const f = { field_key: "cadencia", applies_to: ["meetime"] };
    expect(fieldBelongsToBase(s, f, "meetime", SOURCES)).toBe(false);
    expect(coreRefShown(s, "pipeline", record())).toBe(false);
    expect(coreRefShown(s, "pipeline", record({ pipeline: "X" }))).toBe(true);
  });

  it("rótulo da Base vence o global; sem esquema, nada muda", () => {
    const s = buildBaseSchema("deals", "negocio", [
      row("core:stage", { label: "Fase do negócio" }),
    ]);
    expect(baseFieldLabel(s, "stage")).toBe("Fase do negócio");
    expect(baseFieldLabel(s, "pipeline")).toBeNull();
    expect(
      withBaseCoreLabels([{ field_key: "stage", label: "Etapa" }], s)[0].label
    ).toBe("Fase do negócio");
    expect(withBaseCoreLabels([{ field_key: "stage", label: "Etapa" }], null)[0].label).toBe(
      "Etapa"
    );
  });

  it("selo Novo: 7 dias, nunca para o núcleo", () => {
    const now = new Date("2026-11-19T12:00:00Z");
    expect(isRecentlyAdded({ first_seen_at: "2026-11-15T00:00:00Z", origin: "bitrix" }, now)).toBe(true);
    expect(isRecentlyAdded({ first_seen_at: "2026-10-01T00:00:00Z", origin: "bitrix" }, now)).toBe(false);
    expect(isRecentlyAdded({ first_seen_at: "2026-11-18T00:00:00Z", origin: "core" }, now)).toBe(false);
  });
});

describe("fieldBelongsToRecordType", () => {
  it("mesma regra pelo record_type do registro", () => {
    const schema = buildBaseSchema("meetime", "meetime", [row("custom:a")]);
    expect(
      fieldBelongsToRecordType(schema, { field_key: "a", applies_to: [] }, "meetime")
    ).toBe(true);
    expect(
      fieldBelongsToRecordType(schema, { field_key: "b", applies_to: [] }, "meetime")
    ).toBe(false);
    expect(
      fieldBelongsToRecordType(null, { field_key: "b", applies_to: [] }, "meetime")
    ).toBe(true);
  });
});

describe("perfil do núcleo", () => {
  const meetime = buildBaseSchema("meetime", "meetime", [
    row("core:source_created_at"),
    row("core:responsible_id"),
  ]);

  it("coluna fora do perfil some… a não ser que o registro tenha valor", () => {
    expect(coreRefShown(meetime, "pipeline", record())).toBe(false);
    expect(coreRefShown(meetime, "pipeline", record({ pipeline: "Vendas" }))).toBe(
      true
    );
    expect(coreRefShown(meetime, "source_created_at", record())).toBe(true);
    expect(coreRefShown(null, "pipeline", record())).toBe(true);
  });

  it("closed=false é o default, não um dado", () => {
    expect(coreHasValue(record({ closed: false }), "closed")).toBe(false);
    expect(coreHasValue(record({ closed: true }), "closed")).toBe(true);
    expect(coreHasValue(record({ stage: "  " }), "stage")).toBe(false);
    expect(coreHasValue(record({ value: 0 }), "value")).toBe(true);
  });

  it("perfil serializado: null = legado", () => {
    expect(coreProfileOf(null)).toBeNull();
    const p = coreProfileOf(meetime);
    expect(p?.sort()).toEqual(["responsible_id", "source_created_at"]);
    expect(coreRefInProfile(null, "mrr", record())).toBe(true);
    expect(coreRefInProfile(p, "mrr", record())).toBe(false);
  });

  it("coreDetailRows recorta pelo perfil e mantém o legado sem ele", () => {
    const rec = record();
    const withProfile = coreDetailRows(
      rec,
      undefined,
      DETAIL_HEADER_REFS,
      coreProfileOf(meetime)
    ).map((r) => r.ref);
    expect(withProfile).toContain("source_created_at");
    expect(withProfile).not.toContain("pipeline");
    expect(withProfile).not.toContain("closed");
    const legacy = coreDetailRows(rec, undefined, DETAIL_HEADER_REFS).map(
      (r) => r.ref
    );
    expect(legacy).toContain("pipeline");
    expect(legacy).toContain("closed");
  });
});

describe("loadBaseSchema", () => {
  const fakeDb = (result: { data: unknown; error: unknown }) => {
    const calls: { table: string; key?: string }[] = [];
    const db = {
      from(table: string) {
        const q = {
          select: () => q,
          eq: (_col: string, v: string) => {
            calls.push({ table, key: v });
            return Promise.resolve(result);
          },
        };
        return q;
      },
    };
    return { db, calls };
  };

  it("lê pelo dono (sub-base → pai)", async () => {
    const { db, calls } = fakeDb({ data: [row("custom:a")], error: null });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const s = await loadBaseSchema(db as any, "deals_enterprise", SOURCES);
    expect(calls).toEqual([{ table: "source_fields", key: "deals" }]);
    expect(s?.sourceKey).toBe("deals");
    expect(s?.recordType).toBe("negocio");
    expect([...(s?.customKeys ?? [])]).toEqual(["a"]);
  });

  it("tabela ausente/erro ⇒ null (legado, nunca quebra a tela)", async () => {
    const { db } = fakeDb({
      data: null,
      error: { message: 'relation "source_fields" does not exist' },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(await loadBaseSchema(db as any, "meetime", SOURCES)).toBeNull();
  });

  it("Base sem linhas = esquema VAZIO (não legado): global não entra", async () => {
    const { db } = fakeDb({ data: [], error: null });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const s = await loadBaseSchema(db as any, "meetime", SOURCES);
    expect(s).not.toBeNull();
    expect(
      fieldBelongsToBase(s, { field_key: "teste_3_3", applies_to: [] }, "meetime", SOURCES)
    ).toBe(false);
  });
});
