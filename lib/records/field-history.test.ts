// Versão: 1.0 | Data: 09/09/2026
// O caso REAL que motivou o módulo: campo que só o sync mexeu tem
// `field_modified_at` vazio, e é o audit_log que sabe quando ele mudou.
import { describe, it, expect } from "vitest";

import { fieldChangedAt, loadFieldHistory } from "./field-history";

/** Dublê mínimo do PostgREST: só a cadeia que o loader usa. */
function fakeDb(rows: { record_id: string; field: string; changed_at: string }[]) {
  const calls: { fields: string[] }[] = [];
  const builder = {
    _ids: [] as string[],
    _fields: [] as string[],
    select() {
      return this;
    },
    in(col: string, vals: string[]) {
      if (col === "record_id") this._ids = vals;
      else this._fields = vals;
      return this;
    },
    order() {
      calls.push({ fields: this._fields });
      const ids = this._ids;
      const fields = this._fields;
      return Promise.resolve({
        data: rows.filter(
          (r) => ids.includes(r.record_id) && fields.includes(r.field)
        ),
      });
    },
  };
  return {
    calls,
    db: { from: () => ({ ...builder }) } as never,
  };
}

describe("loadFieldHistory", () => {
  it("acha a data no audit mesmo com field_modified_at VAZIO", async () => {
    // Exatamente o estado dos 36 deals em Nutrição: o sync moveu a etapa, e
    // `field_modified_at` (que é marcador de proteção, não histórico) é null.
    const { db } = fakeDb([
      { record_id: "r1", field: "stage", changed_at: "2026-07-09T03:39:24Z" },
      { record_id: "r1", field: "stage", changed_at: "2026-08-20T10:00:00Z" },
    ]);
    const history = await loadFieldHistory(
      db,
      [{ id: "r1", fieldModifiedAt: null }],
      ["stage"]
    );
    expect(fieldChangedAt(history, "r1", "stage")).toBe("2026-08-20T10:00:00Z");
  });

  it("fica com a MAIS RECENTE entre audit e edição local", async () => {
    const { db } = fakeDb([
      { record_id: "r1", field: "stage", changed_at: "2026-08-01T10:00:00Z" },
    ]);
    const history = await loadFieldHistory(
      db,
      [{ id: "r1", fieldModifiedAt: { stage: "2026-09-05T12:00:00Z" } }],
      ["stage"]
    );
    expect(fieldChangedAt(history, "r1", "stage")).toBe("2026-09-05T12:00:00Z");
  });

  it("a ordem das fontes não decide: audit mais novo vence a edição antiga", async () => {
    const { db } = fakeDb([
      { record_id: "r1", field: "stage", changed_at: "2026-09-09T18:48:16Z" },
    ]);
    const history = await loadFieldHistory(
      db,
      [{ id: "r1", fieldModifiedAt: { stage: "2026-01-02T00:00:00Z" } }],
      ["stage"]
    );
    expect(fieldChangedAt(history, "r1", "stage")).toBe("2026-09-09T18:48:16Z");
  });

  it("campo sem nenhuma fonte devolve null — nunca 'mudou hoje'", async () => {
    const { db } = fakeDb([]);
    const history = await loadFieldHistory(
      db,
      [{ id: "r1", fieldModifiedAt: null }],
      ["stage"]
    );
    expect(fieldChangedAt(history, "r1", "stage")).toBeNull();
  });

  it("não vai ao banco sem registro ou sem campo", async () => {
    const { db, calls } = fakeDb([]);
    expect(await loadFieldHistory(db, [], ["stage"])).toEqual(new Map());
    expect(
      await loadFieldHistory(db, [{ id: "r1", fieldModifiedAt: null }], [])
    ).toEqual(new Map());
    expect(calls).toHaveLength(0);
  });

  it("separa por registro e por campo", async () => {
    const { db } = fakeDb([
      { record_id: "r1", field: "stage", changed_at: "2026-08-01T00:00:00Z" },
      { record_id: "r2", field: "stage", changed_at: "2026-08-02T00:00:00Z" },
      { record_id: "r1", field: "value", changed_at: "2026-08-03T00:00:00Z" },
    ]);
    const history = await loadFieldHistory(
      db,
      [
        { id: "r1", fieldModifiedAt: null },
        { id: "r2", fieldModifiedAt: null },
      ],
      ["stage", "value"]
    );
    expect(fieldChangedAt(history, "r1", "stage")).toBe("2026-08-01T00:00:00Z");
    expect(fieldChangedAt(history, "r2", "stage")).toBe("2026-08-02T00:00:00Z");
    expect(fieldChangedAt(history, "r1", "value")).toBe("2026-08-03T00:00:00Z");
    expect(fieldChangedAt(history, "r2", "value")).toBeNull();
  });
});
