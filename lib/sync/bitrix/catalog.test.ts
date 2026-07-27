// Versão: 1.0 | Data: 27/07/2026
// Testes do catálogo dinâmico de campos (syncFieldCatalog, v1.6): o fallback
// POR LINHA quando o upsert em lote falha (uma linha envenenada não pode
// derrubar o catálogo inteiro — modo de falha 0076, revivido em 19→27/07 pela
// curadoria `empresa` sem reconciliação 0075) e a sanitização de \u0000 em
// label/options (veneno de lote preventivo). Cliente fake
// (tests/helpers/fake-supabase); sem banco.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { syncFieldCatalog } from "./catalog";
import type { BitrixLookups } from "./lookups";
import {
  fakeSupabase,
  type RecordedQuery,
} from "../../../tests/helpers/fake-supabase";

// Lookups mínimos: só os métodos que syncFieldCatalog toca. categoryNames()
// vazio pula o refresh das options do pipeline (fora do escopo daqui).
function fakeLookups(overrides?: {
  leadMetas?: {
    fieldId: string;
    title: string;
    type: string;
    items?: { ID: string; VALUE: string }[];
  }[];
}): BitrixLookups {
  return {
    dealFieldMetas: () => [],
    leadFieldMetas: () => overrides?.leadMetas ?? [],
    sourceNames: () => ["Inbound"],
    categoryNames: () => [],
  } as unknown as BitrixLookups;
}

function upsertSteps(queries: RecordedQuery[]) {
  return queries
    .filter((q) => q.table === "field_definitions")
    .flatMap((q) => q.steps.filter((s) => s.method === "upsert"));
}

describe("syncFieldCatalog", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("sanitiza \\u0000 de label e options no payload do upsert", async () => {
    const { db, queries } = fakeSupabase({
      tables: {
        field_definitions: (q) => {
          // SELECT dos toggles existentes → nenhum campo pré-existente.
          if (q.steps.some((s) => s.method === "select")) return { data: [] };
          return { data: null, error: null };
        },
      },
    });

    await syncFieldCatalog(
      db,
      fakeLookups({
        leadMetas: [
          {
            fieldId: "UF_CRM_X1",
            title: "Campo\u0000Sujo",
            type: "enumeration",
            items: [{ ID: "1", VALUE: "Op\u0000ção" }],
          },
        ],
      })
    );

    const batches = upsertSteps(queries);
    expect(batches.length).toBe(1);
    const payload = batches[0].args[0] as {
      field_key: string;
      label: string;
      options: string[];
    }[];
    const row = payload.find((r) => r.field_key === "bitrix_uf_crm_x1");
    expect(row).toBeDefined();
    expect(row!.label).toBe("CampoSujo");
    expect(row!.options).toEqual(["Opção"]);
    // Nenhum \u0000 sobra em lugar NENHUM do payload (curados incluídos).
    expect(JSON.stringify(payload)).not.toContain("\\u0000");
  });

  it("lote falha → reaplica por linha, pulando só a ofensora", async () => {
    const badKey = "bitrix_uf_crm_ruim";
    const { db, queries } = fakeSupabase({
      tables: {
        field_definitions: (q) => {
          if (q.steps.some((s) => s.method === "select")) return { data: [] };
          const up = q.steps.find((s) => s.method === "upsert");
          if (!up) return { data: null, error: null };
          // Lote (payload em array) → falha tudo-ou-nada, como o Postgres.
          if (Array.isArray(up.args[0])) {
            return { data: null, error: { message: "unsupported Unicode escape sequence" } };
          }
          // Por linha: só a envenenada falha.
          const row = up.args[0] as { field_key: string };
          return row.field_key === badKey
            ? { data: null, error: { message: "invalid byte" } }
            : { data: null, error: null };
        },
      },
    });

    await syncFieldCatalog(
      db,
      fakeLookups({
        leadMetas: [
          { fieldId: "UF_CRM_RUIM", title: "Ruim", type: "string" },
          { fieldId: "UF_CRM_BOM", title: "Bom", type: "string" },
        ],
      })
    );

    const ups = upsertSteps(queries);
    const batch = ups.filter((s) => Array.isArray(s.args[0]));
    const perRow = ups.filter((s) => !Array.isArray(s.args[0]));
    expect(batch.length).toBe(1);
    const batchRows = batch[0].args[0] as unknown[];
    // TODAS as linhas do lote são reaplicadas individualmente…
    expect(perRow.length).toBe(batchRows.length);
    // …e a ofensora é logada com o field_key para conserto dirigido.
    const logged = vi
      .mocked(console.error)
      .mock.calls.map((c) => String(c[0]));
    expect(logged.some((m) => m.includes(badKey))).toBe(true);
    expect(logged.some((m) => m.includes("1 de"))).toBe(true);
  });

  it("lote OK → nenhum upsert por linha", async () => {
    const { db, queries } = fakeSupabase({
      tables: {
        field_definitions: (q) => {
          if (q.steps.some((s) => s.method === "select")) return { data: [] };
          return { data: null, error: null };
        },
      },
    });

    await syncFieldCatalog(
      db,
      fakeLookups({
        leadMetas: [{ fieldId: "UF_CRM_OK", title: "Ok", type: "string" }],
      })
    );

    expect(upsertSteps(queries).length).toBe(1);
    expect(console.error).not.toHaveBeenCalled();
  });
});
