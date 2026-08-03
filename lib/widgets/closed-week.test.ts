// Versão: 1.0 | Data: 03/08/2026
// Testes da "Semana Fechada" (lib/widgets/closed-week.ts): snap do período
// pela regra da MAIORIA (4+ dias), idempotência, bounds únicos, range vazio
// sem erro e o rewrite da dim enviada ao RPC (rpcDimForClosedWeek).
import { describe, expect, it } from "vitest";

import {
  closedWeekOf,
  dimWeekStart,
  effectiveWeekMode,
  isClosedWeekTransform,
  rpcDimForClosedWeek,
  snapPeriodToClosedWeek,
  snapRangeToClosedWeek,
  weekStartIso,
} from "./closed-week";

describe("weekStartIso", () => {
  it("segunda da semana (seg_dom) e sábado da semana (sab_sex)", () => {
    // 2026-07-01 é uma quarta-feira.
    expect(weekStartIso("2026-07-01", "seg_dom")).toBe("2026-06-29");
    expect(weekStartIso("2026-07-01", "sab_sex")).toBe("2026-06-27");
    // Início da própria semana é ponto fixo.
    expect(weekStartIso("2026-06-29", "seg_dom")).toBe("2026-06-29");
    expect(weekStartIso("2026-06-27", "sab_sex")).toBe("2026-06-27");
    // Domingo (05/07) ainda pertence à semana da segunda 29/06.
    expect(weekStartIso("2026-07-05", "seg_dom")).toBe("2026-06-29");
    // Sexta (03/07) fecha a semana sáb–sex iniciada em 27/06.
    expect(weekStartIso("2026-07-03", "sab_sex")).toBe("2026-06-27");
  });
});

describe("snapRangeToClosedWeek — regra da maioria", () => {
  it("julho/26 seg–dom: 29/06–02/08 (as duas semanas de borda são de julho)", () => {
    expect(snapRangeToClosedWeek("2026-07-01", "2026-07-31", "seg_dom")).toEqual(
      { from: "2026-06-29", to: "2026-08-02" }
    );
  });

  it("julho/26 sáb–sex: 04/07–31/07 (semana 27/06–03/07 tem só 3 dias em julho)", () => {
    expect(snapRangeToClosedWeek("2026-07-01", "2026-07-31", "sab_sex")).toEqual(
      { from: "2026-07-04", to: "2026-07-31" }
    );
  });

  it("agosto/26 seg–dom: começa em 03/08 (01–02/08 são da última semana de julho)", () => {
    expect(snapRangeToClosedWeek("2026-08-01", "2026-08-31", "seg_dom")).toEqual(
      { from: "2026-08-03", to: "2026-08-30" }
    );
  });

  it("é idempotente", () => {
    for (const mode of ["seg_dom", "sab_sex"] as const) {
      const once = snapRangeToClosedWeek("2026-07-01", "2026-07-31", mode);
      expect(snapRangeToClosedWeek(once.from, once.to, mode)).toEqual(once);
    }
  });

  it("bound único snapa só o presente", () => {
    expect(snapRangeToClosedWeek("2026-07-01", null, "seg_dom")).toEqual({
      from: "2026-06-29",
      to: null,
    });
    expect(snapRangeToClosedWeek(null, "2026-07-31", "seg_dom")).toEqual({
      from: null,
      to: "2026-08-02",
    });
  });

  it("período curto sem semana majoritária vira from > to (vazio, sem erro)", () => {
    // Sexta 03/07 sozinha: a semana seg–dom 29/06–05/07 só tem 1 dia dentro do
    // período — from abre p/ a semana seguinte (06/07) e to fecha na própria
    // (05/07): from > to = consulta vazia por design.
    expect(snapRangeToClosedWeek("2026-07-03", "2026-07-03", "seg_dom")).toEqual(
      { from: "2026-07-06", to: "2026-07-05" }
    );
  });

  it("valor não-parseável passa intacto", () => {
    expect(snapRangeToClosedWeek("@today", "2026-07-31", "seg_dom")).toEqual({
      from: "@today",
      to: "2026-08-02",
    });
  });
});

describe("snapPeriodToClosedWeek", () => {
  it("preserva field/preset/fieldBySource e snapa só from/to", () => {
    const period = {
      field: "closed_at",
      from: "2026-07-01",
      to: "2026-07-31",
      preset: "este_mes" as const,
      fieldBySource: { estudo: "source_created_at" },
    };
    expect(snapPeriodToClosedWeek(period, "seg_dom")).toEqual({
      ...period,
      from: "2026-06-29",
      to: "2026-08-02",
    });
  });

  it("null e 'todo o período' são passthrough", () => {
    expect(snapPeriodToClosedWeek(null, "seg_dom")).toBeNull();
    const all = { field: "closed_at", from: null, to: null };
    expect(snapPeriodToClosedWeek(all, "seg_dom")).toBe(all);
  });
});

describe("rpcDimForClosedWeek / helpers de dim", () => {
  it("seg_dom + week_month desce weekMode 'full'; week_year fica intacta", () => {
    expect(
      rpcDimForClosedWeek({
        field: "unified:data_ref",
        transform: "week_month",
        closedWeek: "seg_dom",
      })
    ).toEqual({
      field: "unified:data_ref",
      transform: "week_month",
      weekMode: "full",
      closedWeek: "seg_dom",
    });
    const wy = {
      field: "closed_at",
      transform: "week_year" as const,
      closedWeek: "seg_dom" as const,
    };
    expect(rpcDimForClosedWeek(wy)).toBe(wy);
  });

  it("sab_sex (core/unified) desce como 'day'; custom fica crua", () => {
    expect(
      rpcDimForClosedWeek({
        field: "closed_at",
        transform: "week_month",
        weekMode: "restricted",
        closedWeek: "sab_sex",
      }).transform
    ).toBe("day");
    const custom = {
      field: "custom:data_x",
      transform: "week_month" as const,
      closedWeek: "sab_sex" as const,
    };
    expect(rpcDimForClosedWeek(custom)).toBe(custom);
  });

  it("sem closedWeek ou transform não-semanal: passthrough", () => {
    const plain = { field: "closed_at", transform: "month_year" as const };
    expect(rpcDimForClosedWeek(plain)).toBe(plain);
    const orphan = {
      field: "closed_at",
      transform: "month_year" as const,
      closedWeek: "seg_dom" as const,
    };
    expect(rpcDimForClosedWeek(orphan)).toBe(orphan);
  });

  it("effectiveWeekMode força 'full' e dimWeekStart ancora sáb–sex no sábado", () => {
    const d = {
      field: "closed_at",
      transform: "week_month" as const,
      weekMode: "restricted" as const,
      closedWeek: "sab_sex" as const,
    };
    expect(effectiveWeekMode(d)).toBe("full");
    expect(dimWeekStart(d)).toBe("saturday");
    expect(effectiveWeekMode({ field: "x", transform: "week_month" })).toBe(
      undefined
    );
    expect(dimWeekStart({ field: "x", transform: "week_month" })).toBe(
      "monday"
    );
  });

  it("closedWeekOf: 1ª dim semanal com a opção define a rodada", () => {
    expect(
      closedWeekOf([
        { field: "pipeline" },
        { field: "closed_at", transform: "week_month", closedWeek: "seg_dom" },
      ])
    ).toBe("seg_dom");
    expect(
      closedWeekOf([{ field: "closed_at", transform: "month_year" }])
    ).toBeNull();
    // Opção órfã (transform não-semanal) não ativa nada.
    expect(
      closedWeekOf([
        { field: "closed_at", transform: "month_year", closedWeek: "seg_dom" },
      ])
    ).toBeNull();
  });

  it("isClosedWeekTransform cobre week legado + week_year/week_month", () => {
    expect(isClosedWeekTransform("week")).toBe(true);
    expect(isClosedWeekTransform("week_year")).toBe(true);
    expect(isClosedWeekTransform("week_month")).toBe(true);
    expect(isClosedWeekTransform("month_year")).toBe(false);
    expect(isClosedWeekTransform(undefined)).toBe(false);
  });
});
