// Versão: 1.0 | Data: 31/07/2026
import { describe, expect, it } from "vitest";

import { MONTH_LABELS, addMonths } from "@/lib/date/month-labels";

describe("month-labels", () => {
  it("tem os 12 meses em pt-BR", () => {
    expect(MONTH_LABELS).toHaveLength(12);
    expect(MONTH_LABELS[0]).toBe("Janeiro");
    expect(MONTH_LABELS[11]).toBe("Dezembro");
  });

  it("addMonths cobre rollover nos dois sentidos e deltas grandes", () => {
    expect(addMonths(2026, 7, 1)).toEqual({ year: 2026, month: 8 });
    expect(addMonths(2026, 12, 1)).toEqual({ year: 2027, month: 1 });
    expect(addMonths(2026, 1, -1)).toEqual({ year: 2025, month: 12 });
    expect(addMonths(2026, 7, -19)).toEqual({ year: 2024, month: 12 });
    expect(addMonths(2026, 7, 0)).toEqual({ year: 2026, month: 7 });
  });
});
