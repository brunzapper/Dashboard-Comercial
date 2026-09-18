// @vitest-environment jsdom
// Versão: 1.0 | Data: 18/09/2026
// Regressão da v3.6 do widget-chart: a linha "Total geral" de uma tabela
// agregada precisa ler a cor gravada sob a chave reservada "__grand"
// (appearance.table.rowColors["__grp:__grand"]) — não sob uma chave derivada
// do rótulo de exibição ("Total geral"). Antes da correção, o chamador da
// linha de total não passava `keyId`, a chave caía no fallback pelo label e
// a cor gravada ficava órfã (ver widget-chart.tsx v3.6).
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { WidgetChart } from "@/components/dashboards/charts/widget-chart";
import type { WidgetData } from "@/lib/widgets/types";

function buildData(): WidgetData {
  return {
    dimensions: [{ key: "dim_1", label: "Mês" }],
    metrics: [{ key: "metric_1", label: "Total" }],
    rows: [
      { dim_1: "Abril", metric_1: 10 },
      { dim_1: "Maio", metric_1: 20 },
    ],
  };
}

describe("WidgetChart — tabela agregada (Total geral)", () => {
  it("a linha Total geral usa a cor gravada em rowColors['__grp:__grand']", () => {
    render(
      <WidgetChart
        visualType="tabela"
        data={buildData()}
        appearance={{
          table: {
            groupBy: ["dim_1"],
            rowColors: {
              "__grp:__grand": { fill: "#f1f5f9" },
              "__grp:›Abril": { fill: "#f1f5f9" },
            },
          },
        }}
      />
    );
    const grandRow = screen.getByText("Total geral").closest("tr");
    expect(grandRow).not.toBeNull();
    // jsdom normaliza hex → rgb() no CSSOM; compara pela cor resolvida.
    expect(grandRow?.style.background).toBe("rgb(241, 245, 249)");
  });

  it("sem cor gravada p/ '__grand', cai no default (nunca herda a cor de outra linha)", () => {
    render(
      <WidgetChart
        visualType="tabela"
        data={buildData()}
        appearance={{
          table: {
            groupBy: ["dim_1"],
            rowColors: { "__grp:›Abril": { fill: "#ff0000" } },
          },
        }}
      />
    );
    const grandRow = screen.getByText("Total geral").closest("tr");
    expect(grandRow?.style.background).not.toBe("#ff0000");
  });
});
