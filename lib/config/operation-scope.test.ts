// Versão: 1.0 | Data: 26/07/2026
// Escopo de operação (Parcerias): fusão de perfis profile-only em `in`/`in_ci`,
// roll-up do pai sobre as filhas, degrade EXATO do comportamento clássico nos
// casos não-fundíveis/mistos e loader batelado (2 queries, subárvore em JS).
import { describe, expect, it } from "vitest";

import {
  fuseOperationProfiles,
  loadOperationScopes,
  operationFilterSet,
  translateOperationFilters,
  type OperationScope,
} from "@/lib/config/operation-scope";
import type { WidgetFilter } from "@/lib/widgets/types";
import { fakeSupabase } from "../../tests/helpers/fake-supabase";

const F = "custom:email_parceiro";
const IMPOSSIBLE_VALUE = ["00000000-0000-0000-0000-000000000000"];

function scope(partial: Partial<OperationScope>): OperationScope {
  return {
    responsibleIds: [],
    profile: [],
    subtreeProfiles: [],
    ...partial,
  };
}

function eqCi(value: string, sources?: string[]): WidgetFilter[] {
  return [
    {
      field: F,
      op: "eq_ci",
      value,
      ...(sources ? { sources: sources as WidgetFilter["sources"] } : {}),
    },
  ];
}

describe("fuseOperationProfiles", () => {
  it("eq+eq exatos fundem em `in` (união deduplicada)", () => {
    const fused = fuseOperationProfiles([
      [{ field: F, op: "eq", value: "a@x.com" }],
      [{ field: F, op: "in", value: ["b@x.com", "a@x.com"] }],
    ]);
    expect(fused).toEqual({
      field: F,
      op: "in",
      value: ["a@x.com", "b@x.com"],
    });
  });

  it("qualquer eq_ci presente promove a `in_ci`", () => {
    const fused = fuseOperationProfiles([
      eqCi("A@X.com"),
      [{ field: F, op: "eq", value: "b@x.com" }],
    ]);
    expect(fused).toMatchObject({ op: "in_ci", value: ["A@X.com", "b@x.com"] });
  });

  it("preserva `sources` quando idêntico em todos", () => {
    const fused = fuseOperationProfiles([
      eqCi("a@x.com", ["leads"]),
      eqCi("b@x.com", ["leads"]),
    ]);
    expect(fused).toMatchObject({ op: "in_ci", sources: ["leads"] });
  });

  it("não funde: campos distintos, sources distintos, multi-condição, op fora do conjunto", () => {
    expect(
      fuseOperationProfiles([
        eqCi("a@x.com"),
        [{ field: "stage", op: "eq_ci", value: "x" }],
      ])
    ).toBeNull();
    expect(
      fuseOperationProfiles([eqCi("a@x.com", ["leads"]), eqCi("b@x.com")])
    ).toBeNull();
    expect(
      fuseOperationProfiles([
        [...eqCi("a@x.com"), { field: "stage", op: "not_null" }],
      ])
    ).toBeNull();
    expect(
      fuseOperationProfiles([[{ field: F, op: "not_null" }]])
    ).toBeNull();
  });
});

describe("operationFilterSet", () => {
  it("compat: 1 operação com vínculo + perfil próprio (inalterado)", () => {
    const scopes = new Map([
      [
        "op1",
        scope({ responsibleIds: ["r1", "r2"], profile: eqCi("a@x.com") }),
      ],
    ]);
    expect(operationFilterSet(["op1"], scopes)).toEqual([
      { field: "responsible_id", op: "in", value: ["r1", "r2"] },
      { field: F, op: "eq_ci", value: "a@x.com" },
    ]);
  });

  it("compat: operação vazia → IMPOSSIBLE explícito", () => {
    const scopes = new Map([["op1", scope({})]]);
    expect(operationFilterSet(["op1"], scopes)).toEqual([
      { field: "responsible_id", op: "in", value: IMPOSSIBLE_VALUE },
    ]);
  });

  it("multi-seleção profile-only funde em `in_ci` (antes zerava)", () => {
    const scopes = new Map([
      ["p1", scope({ profile: eqCi("a@x.com") })],
      ["p2", scope({ profile: eqCi("b@x.com") })],
    ]);
    expect(operationFilterSet(["p1", "p2"], scopes)).toEqual([
      { field: F, op: "in_ci", value: ["a@x.com", "b@x.com"] },
    ]);
  });

  it("roll-up do pai: filhas profile-only fundem; a própria linha do pai fica fora", () => {
    const scopes = new Map([
      [
        "pai",
        scope({
          subtreeProfiles: [
            { opId: "f1", hasResponsibles: false, profile: eqCi("a@x.com") },
            { opId: "f2", hasResponsibles: false, profile: eqCi("b@x.com") },
          ],
        }),
      ],
    ]);
    expect(operationFilterSet(["pai"], scopes)).toEqual([
      { field: F, op: "in_ci", value: ["a@x.com", "b@x.com"] },
    ]);
  });

  it("seleção mista (vínculo + perfil) degrada como antes: só respIds", () => {
    const scopes = new Map([
      ["op1", scope({ responsibleIds: ["r1"] })],
      ["p1", scope({ profile: eqCi("a@x.com") })],
    ]);
    expect(operationFilterSet(["op1", "p1"], scopes)).toEqual([
      { field: "responsible_id", op: "in", value: ["r1"] },
    ]);
  });

  it("multi-seleção não-fundível degrada em IMPOSSIBLE (como antes)", () => {
    const scopes = new Map([
      ["p1", scope({ profile: eqCi("a@x.com") })],
      ["p2", scope({ profile: [{ field: "stage", op: "not_null" }] })],
    ]);
    expect(operationFilterSet(["p1", "p2"], scopes)).toEqual([
      { field: "responsible_id", op: "in", value: IMPOSSIBLE_VALUE },
    ]);
  });

  it("carrySources é herdado pelo filtro fundido sem alvo próprio", () => {
    const scopes = new Map([
      ["p1", scope({ profile: eqCi("a@x.com") })],
      ["p2", scope({ profile: eqCi("b@x.com") })],
    ]);
    expect(operationFilterSet(["p1", "p2"], scopes, ["leads"])).toEqual([
      { field: F, op: "in_ci", value: ["a@x.com", "b@x.com"], sources: ["leads"] },
    ]);
  });

  it("translateOperationFilters reescreve operation_id in → fusão", () => {
    const scopes = new Map([
      ["p1", scope({ profile: eqCi("a@x.com") })],
      ["p2", scope({ profile: eqCi("b@x.com") })],
    ]);
    const outros: WidgetFilter = { field: "stage", op: "not_null" };
    expect(
      translateOperationFilters(
        [outros, { field: "operation_id", op: "in", value: ["p1", "p2"] }],
        scopes
      )
    ).toEqual([outros, { field: F, op: "in_ci", value: ["a@x.com", "b@x.com"] }]);
  });
});

describe("loadOperationScopes (batelado)", () => {
  const OPS = [
    { id: "pai", parent_operation_id: null, filter: [], active: true },
    { id: "f1", parent_operation_id: "pai", filter: eqCi("a@x.com"), active: true },
    { id: "f2", parent_operation_id: "pai", filter: eqCi("b@x.com"), active: true },
    { id: "f3", parent_operation_id: "pai", filter: eqCi("c@x.com"), active: false },
    { id: "outra", parent_operation_id: null, filter: [], active: true },
  ];

  it("2 queries no total; subárvore, perfis ativos e vínculos corretos", async () => {
    const fake = fakeSupabase({
      tables: {
        operations: OPS,
        responsible_operations: [
          { responsible_id: "r1", operation_id: "outra" },
        ],
      },
    });
    const scopes = await loadOperationScopes(fake.db, ["pai", "outra"]);
    expect(fake.queries.length).toBe(2);

    const pai = scopes.get("pai")!;
    expect(pai.responsibleIds).toEqual([]);
    expect(pai.profile).toEqual([]);
    // f3 inativa fica fora do roll-up.
    expect(pai.subtreeProfiles.map((e) => e.opId).sort()).toEqual(["f1", "f2"]);
    expect(pai.subtreeProfiles.every((e) => !e.hasResponsibles)).toBe(true);

    const outra = scopes.get("outra")!;
    expect(outra.responsibleIds).toEqual(["r1"]);
    expect(outra.subtreeProfiles).toEqual([]);
  });

  it("falha do banco degrada para escopos vazios (IMPOSSIBLE a jusante)", async () => {
    const fake = fakeSupabase({
      tables: {
        operations: () => {
          throw new Error("boom");
        },
        responsible_operations: [],
      },
    });
    const scopes = await loadOperationScopes(fake.db, ["p1"]);
    expect(scopes.get("p1")).toEqual({
      responsibleIds: [],
      profile: [],
      subtreeProfiles: [],
    });
  });
});
