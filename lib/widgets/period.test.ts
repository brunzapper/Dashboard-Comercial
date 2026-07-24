// Versão: 1.0 | Data: 24/07/2026
// Testes do filtro de período — presets relativos, ancoragem do dia de
// Brasília (0085) e o filtro sintético `@period` do caminho misto. Invariantes
// centrais: coluna do NÚCLEO (timestamptz) ganha bound com offset explícito
// -03:00; campo custom (texto) fica naive (offset no lower bound excluiria
// date-only); sub-fonte NUNCA entra no byType de "todas as fontes" (mesma
// chave record_type da pai). Relógio fake ao MEIO-DIA UTC: mesmo dia civil em
// UTC e em Brasília (TZ pinado no vitest.config.ts).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Correspondence } from "@/lib/correspondences";
import { BUILTIN_SOURCES, type SourceDef } from "@/lib/sources";
import {
  anchorCoreDateBound,
  applyPeriodToFilters,
  PERIOD_ALL,
  PERIOD_FIELD_SENTINEL,
  patchAuxPeriodByType,
  periodFieldForSource,
  periodKeys,
  resolvePeriodSelection,
  resolveUnifiedPeriodField,
  scopedAuxPeriod,
  type DashboardPeriod,
  type PeriodBetweenValue,
} from "@/lib/widgets/period";
import type { WidgetFilter } from "@/lib/widgets/types";

const CATALOG: SourceDef[] = [
  ...BUILTIN_SOURCES,
  {
    key: "leads_lite",
    recordType: "lead",
    label: "Leads / Clientes Lite",
    shortLabel: "Lite",
    defaultPeriodField: "custom:data_lite",
    builtin: false,
    manualEntry: false,
    parentKey: "leads",
    filter: [{ field: "pipeline", op: "eq", value: "Lite" }],
  },
];

describe("periodKeys", () => {
  it("escopo global (ou aba vazia) usa as chaves fixas retrocompatíveis", () => {
    expect(periodKeys(undefined, "")).toEqual({
      preset: "periodo",
      de: "de",
      ate: "ate",
      campo: "campo",
    });
    expect(periodKeys("tab", "")).toEqual(periodKeys("global", "x"));
  });

  it("escopo tab namespaceia por id da aba", () => {
    expect(periodKeys("tab", "t1")).toEqual({
      preset: "periodo__t1",
      de: "de__t1",
      ate: "ate__t1",
      campo: "campo__t1",
    });
  });
});

describe("resolvePeriodSelection", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-15T12:00:00Z")); // quarta-feira
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("presets relativos resolvem pelo relógio corrente", () => {
    expect(resolvePeriodSelection({ preset: "hoje" }, "closed_at")).toEqual({
      field: "closed_at",
      from: "2026-07-15",
      to: "2026-07-15",
      preset: "hoje",
    });
    expect(
      resolvePeriodSelection({ preset: "este_mes" }, "closed_at")
    ).toMatchObject({ from: "2026-07-01", to: "2026-07-31" });
    expect(
      resolvePeriodSelection({ preset: "este_trimestre" }, "closed_at")
    ).toMatchObject({ from: "2026-07-01", to: "2026-09-30" });
    expect(
      resolvePeriodSelection({ preset: "esta_semana" }, "closed_at")
    ).toMatchObject({ from: "2026-07-13", to: "2026-07-19" });
  });

  it("mes_passado atravessa a virada de ano", () => {
    vi.setSystemTime(new Date("2026-01-15T12:00:00Z"));
    expect(
      resolvePeriodSelection({ preset: "mes_passado" }, "closed_at")
    ).toMatchObject({ from: "2025-12-01", to: "2025-12-31" });
  });

  it("preset tem prioridade sobre de/ate", () => {
    expect(
      resolvePeriodSelection(
        { preset: "hoje", de: "2026-01-01", ate: "2026-02-01" },
        "closed_at"
      )
    ).toMatchObject({ from: "2026-07-15", to: "2026-07-15" });
  });

  it("PERIOD_ALL → sem filtro, mesmo com defaults", () => {
    expect(
      resolvePeriodSelection({ preset: PERIOD_ALL }, "closed_at", {
        preset: "este_mes",
      })
    ).toBeNull();
  });

  it("seleção vazia cai nos defaults; sem defaults → null", () => {
    expect(
      resolvePeriodSelection({}, "closed_at", { preset: "este_mes" })
    ).toMatchObject({ from: "2026-07-01", to: "2026-07-31" });
    expect(resolvePeriodSelection({}, "closed_at")).toBeNull();
  });

  it("datas fora de YYYY-MM-DD são descartadas; só `de` válido → to null", () => {
    expect(resolvePeriodSelection({ de: "15/07/2026" }, "closed_at")).toBeNull();
    expect(
      resolvePeriodSelection({ de: "2026-07-01", ate: "lixo" }, "closed_at")
    ).toEqual({ field: "closed_at", from: "2026-07-01", to: null });
  });
});

describe("anchorCoreDateBound (dia de Brasília, 0085)", () => {
  it("date-only ganha início/fim do dia com offset explícito", () => {
    expect(anchorCoreDateBound("2026-07-01", "from")).toBe(
      "2026-07-01T00:00:00-03:00"
    );
    expect(anchorCoreDateBound("2026-07-31", "to")).toBe(
      "2026-07-31T23:59:59-03:00"
    );
  });

  it("datetime naive ganha o offset; com offset/Z volta intacto (idempotente)", () => {
    expect(anchorCoreDateBound("2026-07-31T23:59:59", "to")).toBe(
      "2026-07-31T23:59:59-03:00"
    );
    expect(anchorCoreDateBound("2026-07-31T23:59:59-03:00", "to")).toBe(
      "2026-07-31T23:59:59-03:00"
    );
    expect(anchorCoreDateBound("2026-07-31T20:00:00Z", "to")).toBe(
      "2026-07-31T20:00:00Z"
    );
    expect(anchorCoreDateBound("", "from")).toBe("");
  });
});

describe("resolveUnifiedPeriodField", () => {
  const corrs: Correspondence[] = [
    {
      id: "1",
      key: "data_venda",
      label: "Data da venda",
      data_type: "data",
      members: [
        { record_type: "negocio", source_key: "deals", field_ref: "closed_at" },
        {
          record_type: "lead",
          source_key: "leads_lite",
          field_ref: "custom:data_lite",
        },
      ],
    },
  ];

  it("campo não-unified é passthrough", () => {
    expect(resolveUnifiedPeriodField("closed_at", "deals", corrs)).toBe(
      "closed_at"
    );
  });

  it("resolve pela SOURCE-KEY do membro (0078), não por record_type", () => {
    expect(resolveUnifiedPeriodField("unified:data_venda", "deals", corrs)).toBe(
      "closed_at"
    );
    expect(
      resolveUnifiedPeriodField("unified:data_venda", "leads_lite", corrs)
    ).toBe("custom:data_lite");
    // "leads" compartilha o record_type "lead" com a sub, mas NÃO tem membro.
    expect(
      resolveUnifiedPeriodField("unified:data_venda", "leads", corrs)
    ).toBeNull();
  });
});

describe("applyPeriodToFilters — caminho uniforme", () => {
  const period: DashboardPeriod = {
    field: "closed_at",
    from: "2026-07-01",
    to: "2026-07-31",
  };

  it("substitui os intervalos do widget no campo e ancora coluna do núcleo", () => {
    const filters: WidgetFilter[] = [
      { field: "closed_at", op: "gte", value: "2020-01-01" },
      { field: "pipeline", op: "eq", value: "Vendas" },
    ];
    const out = applyPeriodToFilters(filters, period);
    expect(out).toEqual([
      { field: "pipeline", op: "eq", value: "Vendas" },
      { field: "closed_at", op: "gte", value: "2026-07-01T00:00:00-03:00" },
      { field: "closed_at", op: "lte", value: "2026-07-31T23:59:59-03:00" },
    ]);
  });

  it("campo custom fica NAIVE (comparação textual; offset excluiria date-only)", () => {
    const out = applyPeriodToFilters([], { ...period, field: "custom:data" });
    expect(out).toEqual([
      { field: "custom:data", op: "gte", value: "2026-07-01" },
      { field: "custom:data", op: "lte", value: "2026-07-31T23:59:59" },
    ]);
  });

  it("mapa por fonte com campo ÚNICO segue no caminho uniforme", () => {
    const out = applyPeriodToFilters(
      [],
      { ...period, fieldBySource: { leads: "closed_at", deals: "closed_at" } },
      ["leads", "deals"]
    );
    expect(out).toHaveLength(2);
    expect(out[0].field).toBe("closed_at");
  });
});

describe("applyPeriodToFilters — caminho misto (@period)", () => {
  const period: DashboardPeriod = {
    field: "closed_at",
    from: "2026-07-01",
    to: "2026-07-31",
    fieldBySource: { leads: "source_created_at", deals: "closed_at" },
  };

  it("emite filtro sintético between com byType por record_type", () => {
    const base: WidgetFilter[] = [{ field: "pipeline", op: "eq", value: "x" }];
    const out = applyPeriodToFilters(base, period, ["leads", "deals"]);
    expect(out).toHaveLength(2);
    const synth = out[1];
    expect(synth.field).toBe(PERIOD_FIELD_SENTINEL);
    expect(synth.op).toBe("between");
    expect(synth.value).toEqual({
      from: "2026-07-01",
      to: "2026-07-31T23:59:59",
      byType: { lead: "source_created_at", negocio: "closed_at" },
    });
  });

  it("em 'todas as fontes', sub-fonte NÃO entra no byType (só raízes)", () => {
    const out = applyPeriodToFilters(
      [],
      {
        ...period,
        fieldBySource: {
          leads: "source_created_at",
          deals: "closed_at",
          leads_lite: "custom:data_lite",
        },
      },
      undefined,
      CATALOG
    );
    const value = out[0].value as PeriodBetweenValue;
    // A sub compartilha o record_type "lead" — se entrasse, sobrescreveria a pai.
    expect(value.byType.lead).toBe("source_created_at");
    expect(value.byType.negocio).toBe("closed_at");
    expect(value.byType.venda_site).toBe("closed_at"); // fallback period.field
  });

  it("sem from/to não emite nada (filtros inalterados)", () => {
    const base: WidgetFilter[] = [{ field: "pipeline", op: "eq", value: "x" }];
    expect(
      applyPeriodToFilters(base, { ...period, from: null, to: null })
    ).toBe(base);
  });
});

describe("scopedAuxPeriod / patchAuxPeriodByType (operando @fonte)", () => {
  it("período sem fieldBySource volta o MESMO objeto (semântica retro)", () => {
    const p: DashboardPeriod = { field: "closed_at", from: "a", to: "b" };
    expect(scopedAuxPeriod(p, "leads_lite", CATALOG)).toBe(p);
    expect(scopedAuxPeriod(null, "leads_lite", CATALOG)).toBeNull();
  });

  it("toda fonte do record_type do escopo passa a apontar pra coluna DELE", () => {
    const p: DashboardPeriod = {
      field: "closed_at",
      from: "2026-07-01",
      to: "2026-07-31",
      fieldBySource: { leads: "source_created_at", deals: "closed_at" },
    };
    const out = scopedAuxPeriod(p, "leads_lite", CATALOG);
    // Sem entrada própria no mapa → cai no defaultPeriodField do catálogo.
    expect(out?.fieldBySource).toMatchObject({
      leads: "custom:data_lite",
      leads_lite: "custom:data_lite",
      deals: "closed_at", // record_type diferente: intacto
    });
  });

  it("patchAuxPeriodByType reescreve SÓ o filtro sentinela @period", () => {
    const plain: WidgetFilter = { field: "closed_at", op: "gte", value: "x" };
    const synth = {
      field: PERIOD_FIELD_SENTINEL,
      op: "between",
      value: {
        from: "2026-07-01",
        to: null,
        byType: { lead: "source_created_at" },
      },
    } as unknown as WidgetFilter;
    const out = patchAuxPeriodByType([plain, synth], "lead", "custom:x");
    expect(out[0]).toBe(plain);
    expect((out[1].value as PeriodBetweenValue).byType).toEqual({
      lead: "custom:x",
    });
  });
});

describe("periodFieldForSource", () => {
  it("override por fonte vence o campo primário", () => {
    const p: DashboardPeriod = {
      field: "closed_at",
      from: null,
      to: null,
      fieldBySource: { estudo: "source_created_at" },
    };
    expect(periodFieldForSource(p, "estudo")).toBe("source_created_at");
    expect(periodFieldForSource(p, "deals")).toBe("closed_at");
  });
});
