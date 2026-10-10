// Versão: 1.0 | Data: 10/10/2026
// v1.0 (10/10/2026): frases e tons do número vivo dos cards de Operação.
import { describe, expect, it } from "vitest";

import {
  closingMetric,
  daysUntilMonthEnd,
  failedRunsMetric,
  tasksMetric,
} from "./metric-format";

describe("daysUntilMonthEnd", () => {
  it("conta até o último dia do mês (bissexto incluso)", () => {
    expect(daysUntilMonthEnd("2026-10-10")).toBe(21);
    expect(daysUntilMonthEnd("2026-10-31")).toBe(0);
    expect(daysUntilMonthEnd("2028-02-01")).toBe(28);
    expect(daysUntilMonthEnd("lixo")).toBe(0);
  });
});

describe("tons", () => {
  it("tarefas: atenção só com pendência", () => {
    expect(tasksMetric(0).tone).toBe("ok");
    expect(tasksMetric(3)).toEqual({ value: "3", caption: "vencem até hoje", tone: "warn" });
  });
  it("execuções com falha ficam em vermelho", () => {
    expect(failedRunsMetric(2).tone).toBe("bad");
    expect(failedRunsMetric(0).tone).toBe("ok");
  });
  it("fechamento perto do fim do mês avisa", () => {
    expect(closingMetric(0).value).toBe("hoje");
    expect(closingMetric(2).tone).toBe("warn");
    expect(closingMetric(12).tone).toBe("neutral");
  });
});
