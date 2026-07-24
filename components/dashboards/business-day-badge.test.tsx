// @vitest-environment jsdom
// Versão: 1.0 | Data: 24/07/2026
// Testes do badge "Nº dia útil" — deve exibir o N vindo do RESULTADO do engine
// (WidgetData.businessDayRef), nunca recomputar na UI, com o rótulo único de
// businessDayOrdinalLabel e a referência legível no tooltip.
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { BusinessDayBadge } from "@/components/dashboards/business-day-badge";

describe("BusinessDayBadge", () => {
  it("exibe o ordinal e detalha a referência 'fim do período' no tooltip", () => {
    render(
      <BusinessDayBadge
        bdRef={{ n: 11, reference: "period_end", date: "2026-07-15" }}
      />
    );
    const badge = screen.getByText("11º dia útil");
    expect(badge).toHaveAttribute(
      "title",
      "Meses comparados até o 11º dia útil — referência: fim do período (15/07/2026)"
    );
  });

  it("referência 'today' formata como hoje (dd/mm/aaaa)", () => {
    render(
      <BusinessDayBadge bdRef={{ n: 3, reference: "today", date: "2026-07-24" }} />
    );
    expect(screen.getByText("3º dia útil")).toHaveAttribute(
      "title",
      expect.stringContaining("hoje (24/07/2026)")
    );
  });
});
