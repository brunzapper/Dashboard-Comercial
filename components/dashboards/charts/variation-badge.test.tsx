// @vitest-environment jsdom
// Versão: 1.0 | Data: 24/07/2026
// Testes do badge de variação: "—" (ou nada com hideWhenUnavailable) sem base
// comparável, tom semântico com inversão (métricas tipo churn) e formatos
// pct/abs/both.
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { VariationBadge } from "@/components/dashboards/charts/variation-badge";

describe("VariationBadge", () => {
  it("sem valor comparável → '—'; com hideWhenUnavailable → nada", () => {
    render(<VariationBadge cur={10} prev={null} settings={{ enabled: true }} />);
    expect(screen.getByText("—")).toBeInTheDocument();
    const { container } = render(
      <VariationBadge
        cur={null}
        prev={5}
        settings={{ enabled: true }}
        hideWhenUnavailable
      />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("alta de 25% em verde; invertColors troca o tom (churn)", () => {
    render(<VariationBadge cur={125} prev={100} settings={{ enabled: true }} />);
    const up = screen.getByText("+25%");
    expect(up.className).toContain("text-chart-2");

    render(
      <VariationBadge
        cur={125}
        prev={100}
        settings={{ enabled: true, invertColors: true }}
      />
    );
    const inverted = screen.getAllByText("+25%")[1];
    expect(inverted.className).toContain("text-destructive");
  });

  it("formato 'both' inclui o absoluto formatado por fmtAbs", () => {
    render(
      <VariationBadge
        cur={80}
        prev={100}
        settings={{ enabled: true, format: "both" }}
        fmtAbs={(n) => `R$ ${n}`}
      />
    );
    expect(screen.getByText("−20% (−R$ 20)")).toBeInTheDocument();
  });

  it("variação zero é neutra", () => {
    render(<VariationBadge cur={100} prev={100} settings={{ enabled: true }} />);
    expect(screen.getByText("0%").className).toContain("text-muted-foreground");
  });
});
