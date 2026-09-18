// Versão: 1.0 | Data: 18/09/2026
import { describe, expect, it } from "vitest";

import { manualConference, manualLevelLabel } from "./conference";
import type { ManualCoords } from "./families";
import type { ManualBaseData, ManualEntry } from "./types";

const CANAL = { id: "f1", key: "canal", label: "Canal", sort_order: 0 };
const VEND = { id: "f2", key: "vendedor", label: "Vendedor", sort_order: 1 };

let n = 0;
const e = (
  value: number,
  coords: ManualCoords,
  over: Partial<ManualEntry> = {}
): ManualEntry => ({
  id: `e${++n}`,
  series_id: "s1",
  period_start: "2026-08-01",
  period_end: "2026-08-31",
  value,
  responsible_id: null,
  operation_id: null,
  spread: "ancora",
  note: null,
  coords,
  ...over,
});

const base = (entries: ManualEntry[]): ManualBaseData => ({
  series: [
    {
      id: "s1",
      key: "interacoes",
      label: "Interações",
      default_spread: "ancora",
      sort_order: 0,
    },
  ],
  entries,
  families: [CANAL, VEND],
  members: [],
});

const AGOSTO = { from: "2026-08-01", to: "2026-08-31" };
const conf = (entries: ManualEntry[]) =>
  manualConference(base(entries), { seriesId: "s1", window: AGOSTO });

describe("manualLevelLabel", () => {
  it("nomeia o total e os cruzamentos", () => {
    expect(manualLevelLabel([], [CANAL, VEND])).toBe("Total");
    expect(manualLevelLabel(["canal"], [CANAL, VEND])).toBe("Canal");
    expect(manualLevelLabel(["canal", "vendedor"], [CANAL, VEND])).toBe(
      "Canal × Vendedor"
    );
  });

  it("usa o rótulo das famílias EMBUTIDAS, que não têm linha no banco", () => {
    expect(manualLevelLabel(["responsavel"], [])).toBe("Responsável");
    expect(manualLevelLabel(["operacao"], [])).toBe("Operação");
  });
});

describe("manualConference", () => {
  // O caso que a conferência existe para revelar: o cruzamento soma 500 de
  // 1000, e sem esta tela ninguém descobre por quê.
  it("aponta o que falta no nível incompleto", () => {
    const c = conf([
      e(1000, {}),
      e(500, { canal: "ligacao" }),
      e(500, { canal: "email" }),
      e(100, { canal: "ligacao", vendedor: "paulo" }),
      e(250, { canal: "ligacao", vendedor: "gabriella" }),
      e(150, { canal: "ligacao", vendedor: "daniela" }),
    ]);
    expect(c.referenceTotal).toBe(1000);
    expect(c.levels.map((l) => [l.label, l.total, l.delta])).toEqual([
      ["Total", 1000, null],
      ["Canal", 1000, 0],
      ["Canal × Vendedor", 500, -500],
    ]);
  });

  it("sem o total lançado, a referência é a família mais grossa", () => {
    const c = conf([e(500, { canal: "ligacao" }), e(500, { canal: "email" })]);
    expect(c.referenceTotal).toBe(1000);
    expect(c.levels[0].label).toBe("Canal");
    expect(c.levels[0].delta).toBeNull();
  });

  // A aritmética de janela é a do engine, não uma cópia — este é o modo que
  // expõe a diferença: `intersecao` repete o valor em cada janela tocada.
  it("respeita o modo de distribuição, pelo somador de spread.ts", () => {
    const fora = e(700, {}, {
      period_start: "2026-07-01",
      period_end: "2026-07-31",
      spread: "ancora",
    });
    const c = manualConference(base([e(1000, {}), fora]), {
      seriesId: "s1",
      window: AGOSTO,
    });
    // O lançamento de julho não entra na janela de agosto.
    expect(c.referenceTotal).toBe(1000);
    expect(c.levels[0].count).toBe(1);
  });

  it("avisa quando atribuído e não-atribuído convivem no nível ∅", () => {
    // A armadilha pré-existente: os dois estão no nível ∅ e SOMAM (1200).
    const c = conf([e(1000, {}), e(200, {}, { responsible_id: "r1" })]);
    expect(c.mixedAttributionAtRoot).toBe(true);
    expect(c.referenceTotal).toBe(1200);
  });

  it("não avisa quando a atribuição é a única forma presente", () => {
    expect(conf([e(200, {}, { responsible_id: "r1" })]).mixedAttributionAtRoot).toBe(
      false
    );
    expect(conf([e(1000, {})]).mixedAttributionAtRoot).toBe(false);
  });

  it("dado sem lançamento não quebra", () => {
    const c = conf([]);
    expect(c.levels).toEqual([]);
    expect(c.referenceTotal).toBeNull();
  });
});
