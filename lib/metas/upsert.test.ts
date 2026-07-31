// Versão: 1.0 | Data: 30/07/2026
// Testes do upsert programático de metas (módulo compartilhado Metas ↔
// Remuneração). Invariantes: a dança find-then-update respeita a chave
// natural inteira (coalesce do índice único ⇒ is/eq por campo); insert
// carimba org; célula limpa EXCLUI a linha (nunca target=0); o registry pula
// chaves existentes (builtin incluso) e usa onConflict composto.
import { describe, expect, it } from "vitest";

import {
  deleteGoalTarget,
  registerGoalMetrics,
  upsertGoalTarget,
} from "@/lib/metas/upsert";
import { fakeSupabase, hasStep } from "../../tests/helpers/fake-supabase";

const KEY = {
  year: 2026,
  month: 7,
  scope: "responsible",
  responsibleId: "resp-1",
  metric: "comp_vendas",
};

describe("upsertGoalTarget", () => {
  it("meta existente ⇒ update {target} por id (nunca re-insere)", async () => {
    const fake = fakeSupabase({
      tables: {
        goals: (q) => {
          if (hasStep(q, "select", "id")) return { data: { id: "g1" } };
          return { data: null };
        },
      },
    });
    const err = await upsertGoalTarget(fake.db, "org-1", KEY, 5000);
    expect(err).toBeNull();
    const update = fake.queries.find((q) => hasStep(q, "update", { target: 5000 }));
    expect(update).toBeDefined();
    expect(hasStep(update!, "eq", "id", "g1")).toBe(true);
    // O find usa a chave natural inteira (is p/ operation_id null).
    const find = fake.queries[0];
    expect(hasStep(find, "eq", "period_year", 2026)).toBe(true);
    expect(hasStep(find, "eq", "period_month", 7)).toBe(true);
    expect(hasStep(find, "is", "operation_id", null)).toBe(true);
    expect(hasStep(find, "eq", "responsible_id", "resp-1")).toBe(true);
  });

  it("meta ausente ⇒ insert com carimbo de org e nulls corretos", async () => {
    const inserted: unknown[] = [];
    const fake = fakeSupabase({
      tables: {
        goals: (q) => {
          const ins = q.steps.find((s) => s.method === "insert");
          if (ins) {
            inserted.push(ins.args[0]);
            return { data: null };
          }
          return { data: null }; // find não acha
        },
      },
    });
    const err = await upsertGoalTarget(
      fake.db,
      "org-1",
      { ...KEY, month: null },
      300
    );
    expect(err).toBeNull();
    expect(inserted).toEqual([
      {
        period_year: 2026,
        period_month: null,
        scope: "responsible",
        operation_id: null,
        responsible_id: "resp-1",
        metric: "comp_vendas",
        target: 300,
        organization_id: "org-1",
      },
    ]);
  });

  it("alvo não-finito é rejeitado sem tocar o banco", async () => {
    const fake = fakeSupabase({ tables: {} });
    const err = await upsertGoalTarget(fake.db, null, KEY, NaN);
    expect(err).toBe("Informe o alvo.");
    expect(fake.queries).toHaveLength(0);
  });
});

describe("deleteGoalTarget", () => {
  it("exclui pela chave natural; ausente é no-op", async () => {
    const fake = fakeSupabase({
      tables: {
        goals: (q) => {
          if (hasStep(q, "select", "id")) return { data: { id: "g2" } };
          return { data: null };
        },
      },
    });
    expect(await deleteGoalTarget(fake.db, KEY)).toBeNull();
    const del = fake.queries.find((q) => hasStep(q, "delete"));
    expect(del).toBeDefined();
    expect(hasStep(del!, "eq", "id", "g2")).toBe(true);

    const fake2 = fakeSupabase({ tables: { goals: () => ({ data: null }) } });
    expect(await deleteGoalTarget(fake2.db, KEY)).toBeNull();
    expect(fake2.queries.some((q) => hasStep(q, "delete"))).toBe(false);
  });
});

describe("registerGoalMetrics", () => {
  it("pula chave existente (builtin/custom) e faz upsert composto das novas", async () => {
    let upserted: unknown = null;
    let upsertOpts: unknown = null;
    const fake = fakeSupabase({
      tables: {
        sync_config: (q) => {
          const up = q.steps.find((s) => s.method === "upsert");
          if (up) {
            upserted = up.args[0];
            upsertOpts = up.args[1];
            return { data: null };
          }
          return { data: { value: [{ key: "sql_inbound", label: "SQL" }] } };
        },
      },
    });
    const { added, error } = await registerGoalMetrics(fake.db, "org-1", [
      { key: "mrr", label: "MRR de novo", money: true }, // builtin ⇒ pulada
      { key: "sql_inbound", label: "Outra" }, // custom existente ⇒ pulada
      { key: "comp_vendas", label: "Plano — Vendas", money: true },
    ]);
    expect(error).toBeNull();
    expect(added.map((d) => d.key)).toEqual(["comp_vendas"]);
    expect(upsertOpts).toEqual({ onConflict: "organization_id,key" });
    expect(upserted).toEqual({
      key: "goal_metrics",
      value: [
        { key: "sql_inbound", label: "SQL" },
        { key: "comp_vendas", label: "Plano — Vendas", money: true },
      ],
      organization_id: "org-1",
    });
  });

  it("nada a adicionar ⇒ não escreve", async () => {
    const fake = fakeSupabase({
      tables: { sync_config: () => ({ data: { value: [] } }) },
    });
    const { added, error } = await registerGoalMetrics(fake.db, null, [
      { key: "mrr", label: "MRR" },
    ]);
    expect(error).toBeNull();
    expect(added).toHaveLength(0);
    expect(fake.queries.some((q) => hasStep(q, "upsert"))).toBe(false);
  });
});
