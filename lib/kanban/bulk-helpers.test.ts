// Versão: 1.0 | Data: 27/07/2026
// Helpers puros das ações em massa: chunking, fan-out, resultado por item a
// partir dos ids confirmados pós-update/delete e mapa com concorrência.
import { describe, expect, it } from "vitest";

import {
  chunk,
  failedIds,
  fanOut,
  mapLimited,
  resultsFromReturned,
} from "./bulk-helpers";

describe("chunk / fanOut", () => {
  it("fatia preservando ordem; último lote menor", () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunk([], 10)).toEqual([]);
  });

  it("fanOut aplica o mesmo resultado a todos (all-or-nothing)", () => {
    expect(fanOut(["a", "b"], false, "erro")).toEqual([
      { id: "a", ok: false, message: "erro" },
      { id: "b", ok: false, message: "erro" },
    ]);
    expect(fanOut(["a"], true)).toEqual([{ id: "a", ok: true }]);
  });
});

describe("resultsFromReturned / failedIds", () => {
  it("id ausente do retorno = RLS bloqueou aquele item", () => {
    const results = resultsFromReturned(["a", "b", "c"], ["a", "c"], "negado");
    expect(results).toEqual([
      { id: "a", ok: true },
      { id: "b", ok: false, message: "negado" },
      { id: "c", ok: true },
    ]);
    expect(failedIds(results)).toEqual(["b"]);
  });
});

describe("mapLimited", () => {
  it("preserva a ordem dos resultados e respeita o limite", async () => {
    let inFlight = 0;
    let peak = 0;
    const out = await mapLimited([1, 2, 3, 4, 5, 6], 2, async (n) => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
      return n * 10;
    });
    expect(out).toEqual([10, 20, 30, 40, 50, 60]);
    expect(peak).toBeLessThanOrEqual(2);
  });
});
