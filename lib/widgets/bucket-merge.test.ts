// Versão: 1.0 | Data: 03/08/2026
// Testes do merge por bucket (lib/widgets/bucket-merge.ts) com foco na
// "Semana Fechada" sáb–sex: bucket canônico ancorado no sábado, o gate
// dimNeedsClientBucket p/ refs core/`unified:` e a fusão de linhas 'day' do
// RPC em semanas de sábado (sum/count exatos; média = média das médias,
// aproximação documentada).
import { describe, expect, it } from "vitest";

import {
  bucketCanonicalValue,
  dimNeedsClientBucket,
  mergeRowsByBucket,
} from "./bucket-merge";
import type { Dimension, WidgetRow } from "./types";

describe("bucketCanonicalValue com âncora de sábado", () => {
  it("week/week_year: sábado da semana", () => {
    // 2026-07-01 (quarta) pertence à semana sáb–sex 27/06–03/07.
    expect(
      bucketCanonicalValue("2026-07-01", "week_year", "full", "saturday")
    ).toBe("2026-06-27");
    expect(bucketCanonicalValue("2026-07-04", "week", "full", "saturday")).toBe(
      "2026-07-04"
    );
    // Default (monday) segue byte-idêntico ao histórico.
    expect(bucketCanonicalValue("2026-07-01", "week_year")).toBe("2026-06-29");
  });

  it("week_month full: sábado; restricted segue recortando no mês", () => {
    expect(
      bucketCanonicalValue("2026-07-01", "week_month", "full", "saturday")
    ).toBe("2026-06-27");
    expect(
      bucketCanonicalValue("2026-07-01", "week_month", "restricted", "saturday")
    ).toBe("2026-07-01");
  });

  it("valores com hora caem no mesmo bucket (prefixo YYYY-MM-DD)", () => {
    expect(
      bucketCanonicalValue(
        "2026-07-01T14:30:00-03:00",
        "week_month",
        "full",
        "saturday"
      )
    ).toBe("2026-06-27");
  });
});

describe("dimNeedsClientBucket", () => {
  it("sab_sex ativa o merge p/ QUALQUER ref (core/unified), não só custom:", () => {
    expect(
      dimNeedsClientBucket({
        field: "closed_at",
        transform: "week_month",
        closedWeek: "sab_sex",
      })
    ).toBe(true);
    expect(
      dimNeedsClientBucket({
        field: "unified:data_ref",
        transform: "week_year",
        closedWeek: "sab_sex",
      })
    ).toBe(true);
  });

  it("seg_dom NÃO ativa merge p/ core/unified (o servidor já bucketiza)", () => {
    expect(
      dimNeedsClientBucket({
        field: "closed_at",
        transform: "week_month",
        closedWeek: "seg_dom",
      })
    ).toBe(false);
  });

  it("custom: com transform segue ativando (comportamento histórico)", () => {
    expect(
      dimNeedsClientBucket({ field: "custom:data_x", transform: "month_year" })
    ).toBe(true);
    expect(dimNeedsClientBucket({ field: "closed_at" })).toBe(false);
  });
});

describe("mergeRowsByBucket — semanas sáb–sex a partir de linhas 'day'", () => {
  const dims: Dimension[] = [
    { field: "closed_at", transform: "week_month", closedWeek: "sab_sex" },
  ];

  it("funde dias na semana de sábado com weekMode efetivo 'full'", () => {
    // Dias em duas semanas sáb–sex: 27/06–03/07 e 04/07–10/07 (o RPC devolve
    // buckets 'day' como timestamp — o regex lê o prefixo).
    const rows: WidgetRow[] = [
      { dim_1: "2026-06-29T00:00:00", metric_1: 1, metric_2: 10 },
      { dim_1: "2026-07-01T00:00:00", metric_1: 2, metric_2: 20 },
      { dim_1: "2026-07-04T00:00:00", metric_1: 4, metric_2: 40 },
      { dim_1: "2026-07-06T00:00:00", metric_1: 8, metric_2: 60 },
    ];
    const merged = mergeRowsByBucket(rows, dims, [
      { key: "metric_1", kind: "count" },
      { key: "metric_2", kind: "avg" },
    ]);
    expect(merged).toHaveLength(2);
    expect(merged[0].dim_1).toBe("2026-06-27");
    expect(merged[0].metric_1).toBe(3); // count soma (exato)
    expect(merged[0].metric_2).toBe(15); // média das médias (aproximação doc.)
    expect(merged[1].dim_1).toBe("2026-07-04");
    expect(merged[1].metric_1).toBe(12);
    expect(merged[1].metric_2).toBe(50);
  });

  it("sem dim de bucket devolve as linhas INALTERADAS (mesma referência)", () => {
    const rows: WidgetRow[] = [{ dim_1: "A", metric_1: 1 }];
    expect(
      mergeRowsByBucket(rows, [{ field: "pipeline" }], [
        { key: "metric_1", kind: "sum" },
      ])
    ).toBe(rows);
  });
});
