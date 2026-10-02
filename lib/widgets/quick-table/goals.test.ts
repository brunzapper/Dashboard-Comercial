// Versão: 1.0 | Data: 02/10/2026
// Metas na Tabela Livre (goals.ts + goal-convert.ts + a matriz). O que se
// protege:
//  - o conversor da antiga Tabela de metas usa IDS FIXOS (roda a cada carga);
//  - a etiqueta "N1" sai do rótulo UMA vez e vira dado da linha;
//  - a coluna de meta expande um mês por coluna com o col_key do pivot;
//  - a linha de total soma as metas (otimistas) das linhas ligadas ACIMA;
//  - o valor da célula é o número da faceta (fórmulas A1 leem metas).
import { describe, expect, it } from "vitest";

import { goalTableToQuickTable, normalizeLegacyWidget } from "./goal-convert";
import { buildQuickTableMatrix } from "./model";
import type { Widget } from "@/lib/widgets/types";
import { goalColumnMonths, parseTypedGoal, type QuickTableGoalsData } from "./goals";

const month = (target: number | null, realized: number | null = null) => ({
  target,
  realized,
  attainment: target && realized != null ? (realized / target) * 100 : null,
  status: "ok" as const,
  elapsed: 1,
});

describe("goalTableToQuickTable", () => {
  it("modo indicadores: ids fixos, etiqueta extraída, exibição preservada", () => {
    const qt = goalTableToQuickTable({
      mode: "indicadores",
      rows: [
        { indicator: "mrr_novo", label: "N1 MRR novo (R$)" },
        { indicator: "mrr_final", label: "N0 MRR final (R$)", bold: true },
      ],
      months: ["2026-10", "2026-11"],
      editable: true,
      note: "Regra",
    });
    expect(qt.columns.map((c) => [c.id, c.kind])).toEqual([
      ["qc_g_label", "rowLabel"],
      ["qc_g_meses", "goal"],
      ["qc_g_total", "goalTotal"],
    ]);
    expect(qt.columns[1].months).toEqual(["2026-10", "2026-11"]);
    expect(qt.rows[0]).toEqual({
      id: "qr_g0",
      label: "MRR novo (R$)",
      tag: "N1",
      bind: { kind: "indicator", indicator: "mrr_novo" },
    });
    expect(qt.rows[1].bold).toBe(true);
    expect(qt.goals).toEqual({ editable: true });
    expect(qt.display).toEqual({ note: "Regra" });
  });

  it("modo por responsável: uma linha por nome + linha de total", () => {
    const qt = goalTableToQuickTable({
      mode: "por_responsavel",
      indicator: "mrr_novo",
      responsibles: ["Gabriella Salles", "Marcus Barcelos"],
      totalRowLabel: "Compromissos individuais (R$)",
      totalColumn: false,
    });
    expect(qt.columns.map((c) => c.kind)).toEqual(["rowLabel", "goal"]);
    expect(qt.columns[0].header).toBe("Responsável");
    expect(qt.rows.map((r) => r.id)).toEqual(["qr_g0", "qr_g1", "qr_g_total"]);
    expect(qt.rows[1].bind).toEqual({
      kind: "indicator",
      indicator: "mrr_novo",
      responsible: "Marcus Barcelos",
    });
    expect(qt.rows[2].bind).toEqual({ kind: "total" });
  });

  it("normalizeLegacyWidget: só 'metas' muda; o resto volta idêntico", () => {
    const other = { visual_type: "tabela" as const, settings: {} };
    expect(normalizeLegacyWidget(other)).toBe(other);
    const w = normalizeLegacyWidget<Pick<Widget, "visual_type" | "settings">>({
      visual_type: "metas",
      settings: { tab: "painel", goalTable: { rows: [{ indicator: "x" }] } },
    });
    expect(w.visual_type).toBe("tabela_editavel");
    expect(w.settings?.tab).toBe("painel");
    expect("goalTable" in (w.settings ?? {})).toBe(false);
    expect(w.settings?.quickTable?.rows[0].id).toBe("qr_g0");
  });
});

describe("matriz com metas", () => {
  const qt = goalTableToQuickTable({
    mode: "por_responsavel",
    indicator: "mrr",
    responsibles: ["Ana", "Bia"],
    totalRowLabel: "Total",
  });
  const goals: QuickTableGoalsData = {
    months: ["2026-10", "2026-11"],
    monthsByCol: { qc_g_meses: ["2026-10", "2026-11"] },
    canEdit: true,
    rows: {
      qr_g0: {
        indicator: "mrr",
        defaultLabel: "MRR",
        unit: "moeda",
        rollup: "soma",
        direction: "maior_melhor",
        responsibleName: "Ana",
        responsibleMissing: false,
        hasRealized: true,
        months: { "2026-10": month(100, 50), "2026-11": month(200) },
      },
      qr_g1: {
        indicator: "mrr",
        defaultLabel: "MRR",
        unit: "moeda",
        rollup: "soma",
        direction: "maior_melhor",
        responsibleName: "Bia",
        responsibleMissing: false,
        hasRealized: true,
        months: { "2026-10": month(10), "2026-11": month(null) },
      },
    },
  };
  const build = (goalTargets: Record<string, number | null> = {}) =>
    buildQuickTableMatrix({
      qt,
      cells: [],
      data: null,
      userRoles: ["admin"],
      available: [],
      goals,
      goalTargets,
    });

  it("expande um mês por coluna com o col_key do pivot", () => {
    expect(build().cols.map((c) => c.key)).toEqual([
      "qc_g_label",
      "qc_g_meses@2026-10",
      "qc_g_meses@2026-11",
      "qc_g_total",
    ]);
  });

  it("valor da célula = número da faceta; total da linha pela regra", () => {
    const m = build();
    const ana = m.rows[0];
    expect(ana.cells[0].display).toBe("Ana");
    expect(ana.cells[1].value).toBe(100);
    expect(ana.cells[1].goal?.editable).toBe(true);
    expect(ana.cells[3].value).toBe(300);
    expect(ana.cells[3].goal?.realized).toBe(50);
  });

  it("linha de total soma as metas otimistas das ligadas acima", () => {
    const m = build({ "qr_g1|2026-11": 40 });
    const total = m.rows[2];
    expect(total.goal?.isTotal).toBe(true);
    expect(total.cells[1].value).toBe(110);
    expect(total.cells[2].value).toBe(240);
    expect(total.cells[3].value).toBe(350);
  });

  it("sem dados (carregando) a coluna fica como placeholder", () => {
    const m = buildQuickTableMatrix({
      qt,
      cells: [],
      data: null,
      userRoles: [],
      available: [],
    });
    expect(m.goalsLoading).toBe(true);
    expect(m.cols.map((c) => c.key)).toEqual(["qc_g_label", "qc_g_meses", "qc_g_total"]);
  });
});

describe("utilitários", () => {
  it("meses fixos saneados ou os do período", () => {
    expect(goalColumnMonths({ id: "x", kind: "goal", months: ["2026-13", "2026-10"] }, ["2026-01"])).toEqual([
      "2026-10",
    ]);
    expect(goalColumnMonths({ id: "x", kind: "goal" }, ["2026-01"])).toEqual(["2026-01"]);
  });
  it("número digitado em pt-BR", () => {
    expect(parseTypedGoal("R$ 30.220")).toBe(30220);
    expect(parseTypedGoal("23,5")).toBe(23.5);
    expect(parseTypedGoal("")).toBeNull();
    expect(parseTypedGoal("abc")).toBe("invalid");
  });
});
