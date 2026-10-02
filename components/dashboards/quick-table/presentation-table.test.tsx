// @vitest-environment jsdom
// Versão: 1.0 | Data: 02/10/2026
// Tabela de SLIDE da Tabela Livre (a marcação da antiga Tabela de metas sobre
// a matriz da Tabela Livre). O que se protege: cabeçalho por mês, etiqueta da
// linha como texto no Clássico ("N1 MRR novo", o visual de sempre), meta
// editável pelo clique e a linha de total somando as metas acima.
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { goalTableToQuickTable } from "@/lib/widgets/quick-table/goal-convert";
import { buildQuickTableMatrix } from "@/lib/widgets/quick-table/model";
import type { QuickTableGoalsData } from "@/lib/widgets/quick-table/goals";

import { useGoalDisplay } from "./goal-cells";
import { GoalPresentationTable } from "./presentation-table";

const month = (target: number | null, realized: number | null = null) => ({
  target,
  realized,
  attainment: target && realized != null ? (realized / target) * 100 : null,
  status: "ok" as const,
  elapsed: 1,
});

const row = (label: string) => ({
  indicator: "mrr",
  defaultLabel: label,
  unit: "quantidade" as const,
  rollup: "soma" as const,
  direction: "maior_melhor" as const,
  responsibleName: null,
  responsibleMissing: false,
  hasRealized: true,
});

function Harness({ onCommit }: { onCommit: (r: string, m: string, raw: string) => void }) {
  const qt = goalTableToQuickTable({
    rows: [
      { indicator: "mrr", label: "N1 MRR novo" },
      { indicator: "mrr", label: "N0 MRR final", bold: true },
    ],
    editable: true,
  });
  qt.rows.push({ id: "qr_tot", label: "Soma", bind: { kind: "total" } });
  const goals: QuickTableGoalsData = {
    months: ["2026-10", "2026-11"],
    monthsByCol: { qc_g_meses: ["2026-10", "2026-11"] },
    canEdit: true,
    rows: {
      qr_g0: { ...row("x"), months: { "2026-10": month(10, 5), "2026-11": month(20) } },
      qr_g1: { ...row("y"), months: { "2026-10": month(1), "2026-11": month(2) } },
    },
  };
  const matrix = buildQuickTableMatrix({
    qt,
    cells: [],
    data: null,
    userRoles: ["admin"],
    available: [],
    goals,
  });
  const kit = useGoalDisplay(qt.display, qt.goals);
  return (
    <GoalPresentationTable
      matrix={matrix}
      kit={kit}
      fontScale={1}
      presenting={false}
      refreshing={false}
      goalMonths={goals.months}
      displayOf={(c) => c.display}
      editingKey={null}
      pendingKeys={new Set()}
      onStartEdit={vi.fn()}
      onCommit={onCommit}
      onCancel={vi.fn()}
    />
  );
}

describe("GoalPresentationTable", () => {
  it("cabeçalho por mês, etiqueta como texto no Clássico e total somado", () => {
    render(<Harness onCommit={vi.fn()} />);
    expect(screen.getByRole("columnheader", { name: "Indicador" })).toBeTruthy();
    expect(screen.getAllByRole("columnheader")).toHaveLength(4);
    // Clássico: a etiqueta volta como texto do rótulo (visual de sempre).
    expect(screen.getByText("N1 MRR novo")).toBeTruthy();
    // Linha de total: 10+1 e 20+2.
    const total = screen.getByText("Soma").closest("tr")!;
    expect(total.textContent).toContain("11");
    expect(total.textContent).toContain("22");
  });
  it("a meta do mês é um botão editável para o admin", () => {
    render(<Harness onCommit={vi.fn()} />);
    const buttons = screen.getAllByTitle("Clique para editar a meta");
    expect(buttons.length).toBe(4);
    expect(buttons.every((b) => !(b as HTMLButtonElement).disabled)).toBe(true);
  });
});
