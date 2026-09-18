// Versão: 1.0 | Data: 17/09/2026
// A matriz que define a Base manual. O caso de referência é o do pedido:
// 3520 mensagens lançadas em 01→31/08/2026, consultado em janelas diferentes.
// O que estes testes protegem: cada modo responde uma pergunta DIFERENTE, a
// mesma função serve o período do dashboard e o bucket do gráfico, e nenhum
// caminho inventa um dia a partir de data ilegível.
import { describe, expect, it } from "vitest";

import {
  dayIso,
  dayNum,
  manualEntryTouches,
  manualValueForWindow,
  sumManualEntries,
} from "./spread";
import type { ManualEntry, ManualSpread } from "./types";

const mensal = (spread: ManualSpread) => ({
  period_start: "2026-08-01",
  period_end: "2026-08-31",
  value: 3520,
  spread,
});

const w = (from: string | null, to: string | null) => ({ from, to });

describe("manualValueForWindow — o caso do pedido (3520 em agosto)", () => {
  it("âncora: inteiro onde o INÍCIO cai, zero onde não cai", () => {
    expect(manualValueForWindow(mensal("ancora"), w("2026-08-01", "2026-08-31"))).toBe(3520);
    expect(manualValueForWindow(mensal("ancora"), w("2026-08-01", "2026-08-10"))).toBe(3520);
    // O início (dia 1) está fora desta janela — nada entra.
    expect(manualValueForWindow(mensal("ancora"), w("2026-08-11", "2026-08-20"))).toBe(0);
  });

  it("âncora num gráfico por DIA: tudo no primeiro dia", () => {
    expect(manualValueForWindow(mensal("ancora"), w("2026-08-01", "2026-08-01"))).toBe(3520);
    expect(manualValueForWindow(mensal("ancora"), w("2026-08-02", "2026-08-02"))).toBe(0);
  });

  it("interseção: inteiro em TODA janela que encostar — inclusive repetindo", () => {
    expect(manualValueForWindow(mensal("intersecao"), w("2026-08-11", "2026-08-20"))).toBe(3520);
    expect(manualValueForWindow(mensal("intersecao"), w("2026-07-25", "2026-08-05"))).toBe(3520);
    // Repete por bucket: é o preço declarado do modo (MANUAL_SPREAD_HINTS).
    expect(manualValueForWindow(mensal("intersecao"), w("2026-08-02", "2026-08-02"))).toBe(3520);
    // Julho inteiro não encosta em agosto.
    expect(manualValueForWindow(mensal("intersecao"), w("2026-07-01", "2026-07-31"))).toBe(0);
  });

  it("contido: só quando o lançamento cabe inteiro", () => {
    expect(manualValueForWindow(mensal("contido"), w("2026-08-01", "2026-08-31"))).toBe(3520);
    expect(manualValueForWindow(mensal("contido"), w("2026-01-01", "2026-12-31"))).toBe(3520);
    expect(manualValueForWindow(mensal("contido"), w("2026-08-01", "2026-08-10"))).toBe(0);
    expect(manualValueForWindow(mensal("contido"), w("2026-08-11", "2026-08-20"))).toBe(0);
  });

  it("diário: rateia pelos dias do LANÇAMENTO e corta pela janela", () => {
    const porDia = 3520 / 31;
    expect(manualValueForWindow(mensal("diario"), w("2026-08-01", "2026-08-31"))).toBeCloseTo(3520, 9);
    expect(manualValueForWindow(mensal("diario"), w("2026-08-01", "2026-08-10"))).toBeCloseTo(porDia * 10, 9);
    expect(manualValueForWindow(mensal("diario"), w("2026-08-11", "2026-08-20"))).toBeCloseTo(porDia * 10, 9);
    expect(manualValueForWindow(mensal("diario"), w("2026-08-02", "2026-08-02"))).toBeCloseTo(porDia, 9);
    // Janela que extravasa nos dois lados não credita dias que o lançamento
    // não tem.
    expect(manualValueForWindow(mensal("diario"), w("2026-07-01", "2026-09-30"))).toBeCloseTo(3520, 9);
  });

  it("diário: os 31 dias somam exatamente o lançamento", () => {
    let soma = 0;
    for (let d = 1; d <= 31; d++) {
      const dia = `2026-08-${String(d).padStart(2, "0")}`;
      soma += manualValueForWindow(mensal("diario"), w(dia, dia));
    }
    expect(soma).toBeCloseTo(3520, 9);
  });
});

describe("manualValueForWindow — janela aberta e bordas", () => {
  it('"todo período" (sem limites) entra nos quatro modos', () => {
    for (const s of ["ancora", "intersecao", "contido", "diario"] as ManualSpread[]) {
      expect(manualValueForWindow(mensal(s), w(null, null))).toBeCloseTo(3520, 9);
    }
  });

  it("limite só de um lado", () => {
    expect(manualValueForWindow(mensal("contido"), w("2026-08-01", null))).toBe(3520);
    expect(manualValueForWindow(mensal("contido"), w("2026-08-02", null))).toBe(0);
    expect(manualValueForWindow(mensal("diario"), w(null, "2026-08-10"))).toBeCloseTo((3520 / 31) * 10, 9);
  });

  it("lançamento de UM dia se comporta igual nos quatro modos dentro da janela", () => {
    const umDia = { period_start: "2026-08-15", period_end: "2026-08-15", value: 42 };
    for (const s of ["ancora", "intersecao", "contido", "diario"] as ManualSpread[]) {
      expect(manualValueForWindow({ ...umDia, spread: s }, w("2026-08-01", "2026-08-31"))).toBeCloseTo(42, 9);
    }
  });

  it("data ilegível contribui ZERO — nunca vira hoje nem NaN", () => {
    const ruim = { period_start: "", period_end: "2026-08-31", value: 10, spread: "diario" as const };
    expect(manualValueForWindow(ruim, w(null, null))).toBe(0);
    const semValor = { period_start: "2026-08-01", period_end: "2026-08-31", value: Number.NaN, spread: "ancora" as const };
    expect(manualValueForWindow(semValor, w(null, null))).toBe(0);
  });

  it("fim antes do início vira lançamento de um dia (o CHECK do banco impede, o código não conta com isso)", () => {
    const invertido = { period_start: "2026-08-10", period_end: "2026-08-01", value: 7, spread: "diario" as const };
    expect(manualValueForWindow(invertido, w("2026-08-10", "2026-08-10"))).toBeCloseTo(7, 9);
    expect(manualValueForWindow(invertido, w("2026-08-05", "2026-08-05"))).toBe(0);
  });

  it("valor negativo atravessa (estorno é lançamento legítimo)", () => {
    const estorno = { period_start: "2026-08-01", period_end: "2026-08-31", value: -100, spread: "ancora" as const };
    expect(manualValueForWindow(estorno, w("2026-08-01", "2026-08-31"))).toBe(-100);
  });
});

describe("sumManualEntries", () => {
  const e = (id: string, value: number, spread: ManualSpread): ManualEntry => ({
    id,
    series_id: "s1",
    period_start: "2026-08-01",
    period_end: "2026-08-31",
    value,
    responsible_id: null,
    operation_id: null,
    spread,
    note: null,
    coords: {},
  });

  it("vários lançamentos do mesmo dado SOMAM", () => {
    expect(sumManualEntries([e("a", 10, "ancora"), e("b", 25, "ancora")], w("2026-08-01", "2026-08-31"))).toBe(35);
  });

  it("lista vazia é 0 — quem decide '—' é a ausência de dado, não a de lançamento", () => {
    expect(sumManualEntries([], w(null, null))).toBe(0);
  });

  it("modos diferentes na mesma lista convivem", () => {
    const soma = sumManualEntries(
      [e("a", 3100, "diario"), e("b", 420, "ancora")],
      w("2026-08-01", "2026-08-10")
    );
    expect(soma).toBeCloseTo((3100 / 31) * 10 + 420, 9);
  });
});

describe("manualEntryTouches", () => {
  it("é verdadeiro sempre que há pelo menos um dia em comum", () => {
    expect(manualEntryTouches(mensal("ancora"), w("2026-08-31", "2026-09-30"))).toBe(true);
    expect(manualEntryTouches(mensal("ancora"), w("2026-09-01", "2026-09-30"))).toBe(false);
    expect(manualEntryTouches(mensal("ancora"), w(null, null))).toBe(true);
  });

  it("nunca deixa passar um lançamento que algum modo creditaria", () => {
    // Guarda do pré-filtro: se ele disser "não encosta", os 4 modos dão 0.
    const janela = w("2026-09-01", "2026-09-30");
    expect(manualEntryTouches(mensal("ancora"), janela)).toBe(false);
    for (const s of ["ancora", "intersecao", "contido", "diario"] as ManualSpread[]) {
      expect(manualValueForWindow(mensal(s), janela)).toBe(0);
    }
  });
});

describe("dayNum/dayIso", () => {
  it("leem o dia LITERAL do prefixo, ignorando hora e offset", () => {
    expect(dayNum("2026-08-01")).toBe(dayNum("2026-08-01T22:30:00-03:00"));
    expect(dayIso(dayNum("2026-08-01")!)).toBe("2026-08-01");
  });

  it("round-trip estável na virada de ano", () => {
    expect(dayIso(dayNum("2025-12-31")!)).toBe("2025-12-31");
    expect(dayIso(dayNum("2026-01-01")!)).toBe("2026-01-01");
  });

  it("valor não-data é null", () => {
    expect(dayNum("ontem")).toBeNull();
    expect(dayNum(null)).toBeNull();
  });
});
