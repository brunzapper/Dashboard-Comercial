// Versão: 1.0 | Data: 19/11/2026
import { describe, expect, it } from "vitest";

import { missingRefs, reconcileOriginFields } from "./base-schema-sync";

describe("missingRefs", () => {
  it("devolve só o que deixou de vir", () => {
    expect(
      missingRefs(
        [{ field_ref: "custom:a" }, { field_ref: "custom:b" }],
        new Set(["custom:a"])
      )
    ).toEqual(["custom:b"]);
  });
});

describe("reconcileOriginFields", () => {
  it("lista vazia de presentes não reconcilia (nada é marcado removido)", async () => {
    const db = {
      from() {
        throw new Error("não deveria consultar");
      },
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r = await reconcileOriginFields(db as any, {
      sourceKey: "deals",
      origin: "bitrix",
      presentRefs: [],
    });
    expect(r).toBeNull();
  });

  it("marca removed_at só nos ausentes da MESMA origem", async () => {
    const updates: { patch: Record<string, unknown>; refs: string[] }[] = [];
    const db = {
      from() {
        let patch: Record<string, unknown> | null = null;
        const q = {
          update(p: Record<string, unknown>) {
            patch = p;
            return q;
          },
          select() {
            return q;
          },
          eq() {
            return q;
          },
          is() {
            return Promise.resolve({
              data: [{ field_ref: "custom:a" }, { field_ref: "custom:gone" }],
              error: null,
            });
          },
          in(_c: string, refs: string[]) {
            updates.push({ patch: patch ?? {}, refs });
            return Promise.resolve({ error: null });
          },
        };
        return q;
      },
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r = await reconcileOriginFields(db as any, {
      sourceKey: "deals",
      origin: "bitrix",
      presentRefs: ["custom:a"],
    });
    expect(r).toEqual({ seen: 1, removed: 1 });
    expect(updates[0].refs).toEqual(["custom:a"]);
    expect(updates[0].patch.removed_at).toBeNull();
    expect(updates[1].refs).toEqual(["custom:gone"]);
    expect(updates[1].patch.removed_at).toBeTruthy();
  });

  it("erro de banco ⇒ null, nunca lança", async () => {
    const db = {
      from() {
        const q = {
          update: () => q,
          eq: () => q,
          in: () => Promise.resolve({ error: { message: "boom" } }),
        };
        return q;
      },
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r = await reconcileOriginFields(db as any, {
      sourceKey: "deals",
      origin: "bitrix",
      presentRefs: ["custom:a"],
    });
    expect(r).toBeNull();
  });
});
