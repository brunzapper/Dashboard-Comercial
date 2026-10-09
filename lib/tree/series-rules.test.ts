// Versão: 1.0 | Data: 09/10/2026
// v1.0 (09/10/2026): regra desligada não projeta tronco de série na Tree.
import { describe, expect, it } from "vitest";

import { projectableSeries } from "./series-rules";

const SERIES = {
  key: "nutricao",
  title: "Follow-up de nutrição",
  anchor: { kind: "field_changed", field: "stage" },
  cadence: { defaultDays: 14, overrideScopes: [{ kind: "record" }] },
  firstAt: "apos_um_ciclo",
  grantAttribute: "tree",
};

const rule = (series: unknown = SERIES) => ({
  v: 1,
  conditions: [{ kind: "field", filter: { field: "stage", op: "eq", value: "x" } }],
  action: { type: "create_task_series", series },
});

describe("projectableSeries", () => {
  it("projeta a regra ligada, na ordem de ruleIds", () => {
    const out = projectableSeries(
      ["b", "a"],
      [
        { id: "a", name: "A", rule: rule(), enabled: true },
        { id: "b", name: "B", rule: rule({ ...SERIES, key: "outra" }), enabled: true },
      ]
    );
    expect(out.map((s) => s.ruleId)).toEqual(["b", "a"]);
    expect(out[0].config.key).toBe("outra");
  });

  it("regra DESLIGADA não projeta ocorrências", () => {
    expect(
      projectableSeries(["a"], [{ id: "a", name: "A", rule: rule(), enabled: false }])
    ).toEqual([]);
  });

  it("enabled ausente (leitura antiga) segue projetando", () => {
    expect(projectableSeries(["a"], [{ id: "a", name: "A", rule: rule() }])).toHaveLength(1);
  });

  it("regra que não é série ou não existe é ignorada", () => {
    expect(
      projectableSeries(
        ["a", "x"],
        [
          {
            id: "a",
            name: "A",
            rule: { v: 1, conditions: [], action: { type: "move_to_column", columnKey: "c" } },
            enabled: true,
          },
        ]
      )
    ).toEqual([]);
  });
});
