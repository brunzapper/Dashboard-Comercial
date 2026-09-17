// Versão: 1.0 | Data: 17/09/2026
// A costura entre um lançamento e as linhas do RPC. O que estes testes
// protegem: a tupla do lançamento casa com a da linha agrupada (é isso, e só
// isso, que faz o número manual se somar ao número sincronizado); a soma dos
// buckets bate com o total do período; e dimensão que não sabemos repartir
// devolve `null` em vez de um rateio inventado.
import { describe, expect, it } from "vitest";

import { bucketCanonicalValue } from "@/lib/widgets/bucket-merge";
import type { Dimension } from "@/lib/widgets/types";

import {
  manualDimPlans,
  manualRowTuple,
  manualTupleKey,
  normalizeManualDimValue,
  projectManualEntries,
  type ManualDimPlan,
} from "./buckets";
import type { ManualEntry } from "./types";

const dateDim = (transform: Dimension["transform"]): ManualDimPlan => ({
  kind: "date",
  transform: transform!,
  weekMode: "restricted",
  weekStart: "monday",
});

const entry = (over: Partial<ManualEntry> = {}): ManualEntry => ({
  id: "e1",
  series_id: "s1",
  period_start: "2026-08-01",
  period_end: "2026-08-31",
  value: 3520,
  responsible_id: null,
  operation_id: null,
  spread: "ancora",
  note: null,
  ...over,
});

const agosto = { from: "2026-08-01", to: "2026-08-31" };
const trimestre = { from: "2026-07-01", to: "2026-09-30" };

const valuesOf = (p: ReturnType<typeof projectManualEntries>, seriesId = "s1") =>
  [...p.byTuple.values()].map((s) => s.bySeries.get(seriesId) ?? 0);

describe("projectManualEntries — dimensão de MÊS", () => {
  const plans = [dateDim("month")];

  it("âncora: uma única barra, no mês do início", () => {
    const p = projectManualEntries([entry()], { plans, period: trimestre });
    expect(p.byTuple.size).toBe(1);
    const [slot] = [...p.byTuple.values()];
    expect(slot.dims).toEqual(["2026-08-01"]);
    expect(slot.bySeries.get("s1")).toBe(3520);
  });

  it("diário: um lançamento de agosto só alimenta o bucket de agosto", () => {
    const p = projectManualEntries([entry({ spread: "diario" })], {
      plans,
      period: trimestre,
    });
    expect(p.byTuple.size).toBe(1);
    expect(valuesOf(p)[0]).toBeCloseTo(3520, 9);
  });

  it("diário: lançamento que ATRAVESSA meses reparte proporcionalmente", () => {
    const p = projectManualEntries(
      [entry({ period_start: "2026-07-30", period_end: "2026-08-02", value: 40, spread: "diario" })],
      { plans, period: trimestre }
    );
    // 4 dias: 2 em julho, 2 em agosto.
    expect(p.byTuple.get(manualTupleKey(["2026-07-01"]))!.bySeries.get("s1")).toBeCloseTo(20, 9);
    expect(p.byTuple.get(manualTupleKey(["2026-08-01"]))!.bySeries.get("s1")).toBeCloseTo(20, 9);
  });

  it("interseção: o lançamento que atravessa meses aparece INTEIRO nos dois", () => {
    const p = projectManualEntries(
      [entry({ period_start: "2026-07-30", period_end: "2026-08-02", value: 40, spread: "intersecao" })],
      { plans, period: trimestre }
    );
    expect(p.byTuple.get(manualTupleKey(["2026-07-01"]))!.bySeries.get("s1")).toBe(40);
    expect(p.byTuple.get(manualTupleKey(["2026-08-01"]))!.bySeries.get("s1")).toBe(40);
  });

  it("contido: o lançamento que atravessa meses não entra em nenhum", () => {
    const p = projectManualEntries(
      [entry({ period_start: "2026-07-30", period_end: "2026-08-02", value: 40, spread: "contido" })],
      { plans, period: trimestre }
    );
    expect(p.byTuple.size).toBe(0);
  });

  it("contido: o lançamento que cabe no mês entra", () => {
    const p = projectManualEntries([entry({ spread: "contido" })], {
      plans,
      period: trimestre,
    });
    expect(valuesOf(p)).toEqual([3520]);
  });

  it("o período do dashboard recorta ANTES de bucketizar", () => {
    // Só julho: o lançamento de agosto não produz bucket nenhum.
    const p = projectManualEntries([entry({ spread: "diario" })], {
      plans,
      period: { from: "2026-07-01", to: "2026-07-31" },
    });
    expect(p.byTuple.size).toBe(0);
  });
});

describe("projectManualEntries — dimensão de DIA", () => {
  const plans = [dateDim("day")];

  it("diário: 31 barras que somam o lançamento", () => {
    const p = projectManualEntries([entry({ spread: "diario" })], { plans, period: agosto });
    expect(p.byTuple.size).toBe(31);
    const soma = valuesOf(p).reduce((a, b) => a + b, 0);
    expect(soma).toBeCloseTo(3520, 9);
  });

  it("âncora: uma barra só, no dia 1", () => {
    const p = projectManualEntries([entry()], { plans, period: agosto });
    expect(p.byTuple.size).toBe(1);
    expect([...p.byTuple.values()][0].dims).toEqual(["2026-08-01"]);
  });

  it("contido num bucket de um dia: só lançamento de um dia entra", () => {
    const umDia = entry({ period_start: "2026-08-15", period_end: "2026-08-15", value: 9, spread: "contido" });
    const p = projectManualEntries([umDia, entry({ spread: "contido" })], { plans, period: agosto });
    expect(p.byTuple.size).toBe(1);
    expect([...p.byTuple.values()][0].bySeries.get("s1")).toBe(9);
  });
});

describe("projectManualEntries — dia da semana (bucket não contíguo)", () => {
  const plans = [dateDim("weekday")];

  it("diário: reparte entre os 7 dias da semana e a soma se preserva", () => {
    // 01/08/2026 é sábado; 31 dias cobrem 4 ou 5 de cada dia da semana.
    const p = projectManualEntries([entry({ spread: "diario" })], { plans, period: agosto });
    expect(p.byTuple.size).toBe(7);
    expect(valuesOf(p).reduce((a, b) => a + b, 0)).toBeCloseTo(3520, 9);
    // As chaves são o isodow (1-7), como o RPC emite.
    for (const slot of p.byTuple.values()) expect(typeof slot.dims[0]).toBe("number");
  });

  it("interseção: o valor inteiro em CADA dia da semana tocado", () => {
    const p = projectManualEntries([entry({ spread: "intersecao" })], { plans, period: agosto });
    expect(valuesOf(p)).toEqual(Array(7).fill(3520));
  });
});

describe("projectManualEntries — atribuição e dimensões combinadas", () => {
  it("responsável/operação entram como tupla, e o não atribuído fica em null", () => {
    const plans: ManualDimPlan[] = [{ kind: "operation" }];
    const p = projectManualEntries(
      [entry({ operation_id: "op-out", value: 35 }), entry({ id: "e2", value: 7 })],
      { plans, period: agosto }
    );
    expect(p.byTuple.get(manualTupleKey(["op-out"]))!.bySeries.get("s1")).toBe(35);
    expect(p.byTuple.get(manualTupleKey([null]))!.bySeries.get("s1")).toBe(7);
  });

  it("mês × operação: a tupla tem as duas coordenadas, na ordem das dims", () => {
    const plans: ManualDimPlan[] = [dateDim("month"), { kind: "operation" }];
    const p = projectManualEntries([entry({ operation_id: "op-out", value: 35 })], {
      plans,
      period: agosto,
    });
    expect([...p.byTuple.values()][0].dims).toEqual(["2026-08-01", "op-out"]);
  });

  it("apelido de responsável funde no PRINCIPAL, como os registros (0101)", () => {
    const plans: ManualDimPlan[] = [{ kind: "responsible" }];
    const p = projectManualEntries(
      [
        entry({ responsible_id: "apelido", value: 10 }),
        entry({ id: "e2", responsible_id: "principal", value: 5 }),
      ],
      { plans, period: agosto, canonicalById: new Map([["apelido", "principal"]]) }
    );
    expect(p.byTuple.size).toBe(1);
    expect(p.byTuple.get(manualTupleKey(["principal"]))!.bySeries.get("s1")).toBe(15);
  });

  it("sem dimensão nenhuma: uma tupla vazia com o total do período", () => {
    const p = projectManualEntries([entry({ spread: "diario" })], {
      plans: [],
      period: { from: "2026-08-01", to: "2026-08-10" },
    });
    expect(p.byTuple.size).toBe(1);
    expect(p.byTuple.get(manualTupleKey([]))!.bySeries.get("s1")).toBeCloseTo((3520 / 31) * 10, 9);
  });

  it("séries diferentes convivem na mesma tupla", () => {
    const plans = [dateDim("month")];
    const p = projectManualEntries(
      [entry({ value: 35 }), entry({ id: "e2", series_id: "s2", value: 604 })],
      { plans, period: agosto }
    );
    const slot = p.byTuple.get(manualTupleKey(["2026-08-01"]))!;
    expect(slot.bySeries.get("s1")).toBe(35);
    expect(slot.bySeries.get("s2")).toBe(604);
  });
});

describe("normalização da tupla — os dois lados precisam colapsar no mesmo valor", () => {
  it("o timestamp do RPC e o dia canônico do merge dão a MESMA chave de mês", () => {
    const plan = dateDim("month");
    // O que o PostgREST devolve para date_trunc('month', …):
    const doRpc = normalizeManualDimValue("2026-08-01T00:00:00", plan);
    // O que o merge client-side (bucketCanonicalValue) grava:
    const doMerge = normalizeManualDimValue("2026-08-01", plan);
    expect(doRpc).toBe(doMerge);
    expect(doRpc).toBe(bucketCanonicalValue("2026-08-01", "month"));
  });

  it("normalizar é idempotente (a linha já fundida passa de novo sem mudar)", () => {
    const plan = dateDim("week_month");
    const uma = normalizeManualDimValue("2026-08-13T00:00:00", plan);
    expect(normalizeManualDimValue(uma, plan)).toBe(uma);
  });

  it("manualRowTuple lê dim_1..dim_n na ordem das dims", () => {
    const plans: ManualDimPlan[] = [dateDim("month"), { kind: "operation" }];
    const tuple = manualRowTuple({ dim_1: "2026-08-01T00:00:00", dim_2: "op-out" }, plans);
    expect(tuple).toEqual(["2026-08-01", "op-out"]);
  });

  it("valor de dimensão ilegível vira grupo próprio e nunca casa com bucket manual", () => {
    const plan = dateDim("month");
    expect(normalizeManualDimValue("sem data", plan)).toBe("sem data");
    expect(normalizeManualDimValue(null, plan)).toBeNull();
  });
});

describe("manualDimPlans — o portão do degrade", () => {
  const isDate = (f: string) => f === "closed_at" || f === "custom:data";

  it("aceita data com transform, responsável e operação", () => {
    const dims: Dimension[] = [
      { field: "closed_at", transform: "month" },
      { field: "responsible_id" },
      { field: "operation_id" },
    ];
    const plans = manualDimPlans(dims, isDate);
    expect(plans?.map((p) => p.kind)).toEqual(["date", "responsible", "operation"]);
  });

  it("recusa dimensão que não sabemos repartir", () => {
    expect(manualDimPlans([{ field: "stage" }], isDate)).toBeNull();
    expect(manualDimPlans([{ field: "custom:fonte" }], isDate)).toBeNull();
    expect(manualDimPlans([{ field: "record_type" }], isDate)).toBeNull();
  });

  it('recusa data com transform "none" — o RPC agrupa por instante', () => {
    expect(manualDimPlans([{ field: "closed_at", transform: "none" }], isDate)).toBeNull();
    expect(manualDimPlans([{ field: "closed_at" }], isDate)).toBeNull();
  });

  it("recusa dimensão condicional ATIVA, mas aceita a inerte", () => {
    const caseFormula = {
      tokens: [{ kind: "func", name: "SE" }],
    } as Dimension["caseFormula"];
    // Sem transform, a expressão está ativa: reclassifica valor de registro.
    expect(manualDimPlans([{ field: "custom:fonte", caseFormula }], isDate)).toBeNull();
    // Com transform, a expressão é INERTE (caseDimActive) — sobra uma dim de
    // data comum, e essa nós sabemos repartir.
    const plans = manualDimPlans(
      [{ field: "closed_at", transform: "month", caseFormula }],
      isDate
    );
    expect(plans?.[0].kind).toBe("date");
  });

  it('recusa "Agrupar período" (dateAgg leva a outro caminho do engine)', () => {
    const dim: Dimension = { field: "closed_at", transform: "month", dateAgg: "median" };
    expect(manualDimPlans([dim], isDate)).toBeNull();
  });

  it("uma dimensão ruim derruba o plano inteiro (nada de meio-aplicado)", () => {
    const dims: Dimension[] = [{ field: "closed_at", transform: "month" }, { field: "stage" }];
    expect(manualDimPlans(dims, isDate)).toBeNull();
  });

  it("semana fechada sáb-sex chega ao plano como âncora de sábado", () => {
    const dims: Dimension[] = [
      { field: "closed_at", transform: "week_month", closedWeek: "sab_sex" },
    ];
    const plans = manualDimPlans(dims, isDate);
    expect(plans?.[0]).toMatchObject({ kind: "date", weekStart: "saturday", weekMode: "full" });
  });
});
