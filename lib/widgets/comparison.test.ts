// Versão: 1.0 | Data: 10/08/2026
// Testes do comparisonSpec (matemática pura de ranges da comparação).
// Invariante central (v1.2): intervalo personalizado ABERTO ("de X em
// diante", `to` null) deriva o range com `to` EFETIVO = hoje — a comparação
// não some mais em período personalizado; `from` futuro e só-"Até" seguem sem
// comparação. "Hoje" é INJETADO pelo parâmetro (o módulo segue determinístico
// nos testes; bdCtx.todayIso vence quando presente).
import { describe, expect, it } from "vitest";

import { comparisonSpec, type BusinessDayContext } from "./comparison";
import type { DashboardPeriod } from "./period";
import type { ComparisonSettings } from "./types";

const TODAY = "2026-08-10"; // segunda-feira

const period = (
  from: string | null,
  to: string | null,
  preset?: DashboardPeriod["preset"]
): DashboardPeriod => ({ field: "closed_at", from, to, preset });

const cmp = (over: Partial<ComparisonSettings> = {}): ComparisonSettings => ({
  enabled: true,
  ...over,
});

describe("comparisonSpec — guardas", () => {
  it("desabilitado ou sem período/sem data inicial → null", () => {
    expect(comparisonSpec(period("2026-08-01", "2026-08-10"), undefined)).toBe(
      null
    );
    expect(
      comparisonSpec(
        period("2026-08-01", "2026-08-10"),
        cmp({ enabled: false })
      )
    ).toBe(null);
    expect(comparisonSpec(null, cmp())).toBe(null);
    // Só "Até" (from null): sem duração derivável — sem comparação.
    expect(
      comparisonSpec(period(null, "2026-08-10"), cmp(), undefined, TODAY)
    ).toBe(null);
  });

  it("intervalo aberto com from no FUTURO → null", () => {
    expect(
      comparisonSpec(period("2026-09-01", null), cmp(), undefined, TODAY)
    ).toBe(null);
  });
});

describe("comparisonSpec — personalizado fechado (sem preset)", () => {
  it("previous_period desloca pela duração, terminando na véspera do início", () => {
    expect(comparisonSpec(period("2026-08-01", "2026-08-10"), cmp())).toEqual({
      base: "previous_period",
      from: "2026-07-22",
      to: "2026-07-31",
    });
  });
});

describe("comparisonSpec — intervalo aberto (to efetivo = hoje)", () => {
  it("previous_period: duração from→hoje, terminando na véspera do início", () => {
    // 01/08→10/08 (10 dias) → anterior = 22/07→31/07.
    expect(
      comparisonSpec(period("2026-08-01", null), cmp(), undefined, TODAY)
    ).toEqual({ base: "previous_period", from: "2026-07-22", to: "2026-07-31" });
  });

  it("previous_year: os dois bounds (incl. o to sintetizado) um ano antes", () => {
    expect(
      comparisonSpec(
        period("2026-08-01", null),
        cmp({ base: "previous_year" }),
        undefined,
        TODAY
      )
    ).toEqual({ base: "previous_year", from: "2025-08-01", to: "2025-08-10" });
  });

  it("previous_period_bd sem bdCtx degrada para o range cheio", () => {
    expect(
      comparisonSpec(
        period("2026-08-01", null),
        cmp({ base: "previous_period_bd" }),
        undefined,
        TODAY
      )
    ).toEqual({
      base: "previous_period_bd",
      from: "2026-07-22",
      to: "2026-07-31",
    });
  });

  it("previous_period_bd com bdCtx recorta no N-ésimo dia útil do último mês", () => {
    // Hoje 31/08 (seg) = 21º dia útil de agosto; aberto desde 01/08 ⇒ range
    // anterior = julho cheio, recortado no 21º dia útil de julho (29/07).
    const bd: BusinessDayContext = {
      holidays: new Set(),
      todayIso: "2026-08-31",
    };
    expect(
      comparisonSpec(
        period("2026-08-01", null),
        cmp({ base: "previous_period_bd" }),
        bd,
        // Param divergente de propósito: o bdCtx.todayIso deve VENCER.
        "2026-08-15"
      )
    ).toEqual({
      base: "previous_period_bd",
      from: "2026-07-01",
      to: "2026-07-29",
    });
  });

  it("window_avg: bucket pela duração decorrida e janela de meses cheios", () => {
    // 01/08→10/08 = 10 dias ⇒ bucket "week"; last_12m = ago/2025–jul/2026.
    const spec = comparisonSpec(
      period("2026-08-01", null),
      cmp({ base: "window_avg", window: "last_12m" }),
      undefined,
      TODAY
    );
    expect(spec).toMatchObject({
      base: "window_avg",
      from: "2025-08-01",
      to: "2026-07-31",
      bucket: "week",
    });
    expect(spec?.bucketCount).toBeCloseTo(365 / 7, 5);
  });

  it("window_median: mesmo range/bucket da média", () => {
    // Trimestre = mai–jul (92 dias); bucket semanal ⇒ divisor 92/7.
    const spec = comparisonSpec(
      period("2026-08-01", null),
      cmp({ base: "window_median", window: "quarter" }),
      undefined,
      TODAY
    );
    expect(spec).toMatchObject({
      base: "window_median",
      from: "2026-05-01",
      to: "2026-07-31",
      bucket: "week",
    });
    expect(spec?.bucketCount).toBeCloseTo(92 / 7, 5);
  });
});
