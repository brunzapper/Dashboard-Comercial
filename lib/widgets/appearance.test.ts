// Versão: 1.0 | Data: 24/07/2026
// Testes do top-N de categorias (limitCategories): rank default pela 1ª
// métrica (byte-compatível com os salvos) e rank por chave EXPLÍCITA
// (`__cat_total:` do pivot de sub-bases — a categoria ranqueia pelo TOTAL
// entre as séries, não por uma série isolada).
import { describe, expect, it } from "vitest";

import { limitCategories } from "@/lib/widgets/appearance";
import { subSeriesCatTotalKey } from "@/lib/widgets/sub-series";

describe("limitCategories", () => {
  it("default: corta pela 1ª métrica e agrega o resto em 'Outros'", () => {
    const rows = [
      { dim_1: "A", metric_1: 1 },
      { dim_1: "B", metric_1: 9 },
      { dim_1: "C", metric_1: 5 },
      { dim_1: "D", metric_1: 2 },
    ];
    const out = limitCategories(rows, "dim_1", ["metric_1"], {
      n: 3,
      others: true,
    });
    expect(out.map((r) => [r.dim_1, r.metric_1])).toEqual([
      ["B", 9],
      ["C", 5],
      ["Outros", 3],
    ]);
  });

  it("rankKey explícita: ranqueia pelo total da categoria (pivot)", () => {
    const total = subSeriesCatTotalKey("metric_1");
    // Pela série sb_0_0, "A" venceria; pelo TOTAL, "B" vence.
    const rows = [
      { dim_2: "A", sb_0_0: 9, sb_1_0: 0, [total]: 9 },
      { dim_2: "B", sb_0_0: 4, sb_1_0: 8, [total]: 12 },
      { dim_2: "C", sb_0_0: 1, sb_1_0: 1, [total]: 2 },
    ];
    const out = limitCategories(
      rows,
      "dim_2",
      ["sb_0_0", "sb_1_0", total],
      { n: 2, others: true },
      total
    );
    expect(out.map((r) => r.dim_2)).toEqual(["B", "Outros"]);
    // "Outros" soma cada chave — inclusive o total (rank/ordenação seguem).
    expect(out[1]).toMatchObject({ sb_0_0: 10, sb_1_0: 1, [total]: 11 });
  });
});
