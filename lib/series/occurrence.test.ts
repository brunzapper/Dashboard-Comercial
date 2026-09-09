// Versão: 1.1 | Data: 09/09/2026
// v1.1 (09/09/2026): o `until` por ALTERAÇÃO de campo (a quarta forma de
//   parar de cobrar).
// A ocorrência devida é o relógio da série. O que estes testes protegem:
// ela é DERIVADA (a mesma entrada dá sempre a mesma sequência, mesmo com
// rodadas perdidas), ausência de data nunca vira "hoje", e a janela realmente
// para de cobrar.
import { describe, expect, it } from "vitest";

import {
  dueOccurrence,
  occurrencesUntil,
  resolveAnchorDate,
  resolveBound,
} from "./occurrence";

const base = {
  anchorDate: "2026-09-01",
  cadenceDays: 14,
  firstAt: "apos_um_ciclo" as const,
};

describe("dueOccurrence", () => {
  it("antes de fechar o primeiro ciclo, não cobra", () => {
    // Entrou em Nutrição hoje: cobrar agora seria ruído, não acompanhamento.
    expect(dueOccurrence({ ...base, todayIso: "2026-09-01" })).toBeNull();
    expect(dueOccurrence({ ...base, todayIso: "2026-09-14" })).toBeNull();
  });

  it("na virada da quinzena, cobra a 1ª", () => {
    const plan = dueOccurrence({ ...base, todayIso: "2026-09-15" });
    expect(plan).toMatchObject({ occurrence: 1, dueDate: "2026-09-15" });
  });

  it("a ocorrência é derivada — rodada perdida não desalinha a sequência", () => {
    // O tick pode pular dias (deploy, orçamento de tempo). Um contador
    // incremental erraria a conta; a derivação sempre chega na mesma.
    expect(dueOccurrence({ ...base, todayIso: "2026-09-29" })?.occurrence).toBe(2);
    expect(dueOccurrence({ ...base, todayIso: "2026-10-13" })?.occurrence).toBe(3);
    // Dentro do ciclo, a ocorrência não muda (é o que faz repetir ser no-op).
    expect(dueOccurrence({ ...base, todayIso: "2026-10-20" })?.occurrence).toBe(3);
  });

  it("com 'imediato', a cobrança 0 é a do próprio dia da âncora", () => {
    const plan = dueOccurrence({
      ...base,
      firstAt: "imediato",
      todayIso: "2026-09-01",
    });
    expect(plan).toMatchObject({ occurrence: 0, dueDate: "2026-09-01" });
  });

  it("sem âncora não cobra — data ausente nunca vira hoje", () => {
    expect(dueOccurrence({ ...base, anchorDate: null, todayIso: "2026-10-01" })).toBeNull();
    expect(dueOccurrence({ ...base, anchorDate: "", todayIso: "2026-10-01" })).toBeNull();
  });

  it("fora da janela, para de cobrar", () => {
    expect(
      dueOccurrence({ ...base, todayIso: "2026-10-13", untilDate: "2026-10-01" })
    ).toBeNull();
    // A borda inicial atrasa o começo sem mover a âncora: o relógio continua
    // contado da mudança de etapa.
    const comFrom = dueOccurrence({
      ...base,
      todayIso: "2026-10-13",
      fromDate: "2026-10-01",
    });
    expect(comFrom?.occurrence).toBe(3);
  });

  it("respeita o teto de cobranças", () => {
    expect(
      dueOccurrence({ ...base, todayIso: "2026-10-13", maxOccurrences: 2 })
    ).toBeNull();
  });

  it("cadência inválida não cobra (nunca todo dia por engano)", () => {
    expect(dueOccurrence({ ...base, cadenceDays: 0, todayIso: "2026-10-01" })).toBeNull();
    expect(dueOccurrence({ ...base, cadenceDays: -7, todayIso: "2026-10-01" })).toBeNull();
  });

  it("hoje antes da âncora não cobra", () => {
    expect(dueOccurrence({ ...base, todayIso: "2026-08-20" })).toBeNull();
  });

  it("atravessa virada de mês e de ano sem escorregar um dia", () => {
    const plan = dueOccurrence({
      anchorDate: "2026-12-25",
      cadenceDays: 14,
      firstAt: "apos_um_ciclo",
      todayIso: "2027-01-08",
    });
    expect(plan).toMatchObject({ occurrence: 1, dueDate: "2027-01-08" });
  });
});

describe("occurrencesUntil", () => {
  it("lista o tronco da Tree, inclusive cobranças que ninguém fez", () => {
    const list = occurrencesUntil({ ...base, todayIso: "2026-10-13" });
    expect(list.map((o) => o.occurrence)).toEqual([1, 2, 3]);
    expect(list.map((o) => o.dueDate)).toEqual([
      "2026-09-15",
      "2026-09-29",
      "2026-10-13",
    ]);
  });

  it("sem âncora, tronco vazio", () => {
    expect(occurrencesUntil({ ...base, anchorDate: null, todayIso: "2026-10-13" })).toEqual([]);
  });
});

describe("resolveAnchorDate", () => {
  const facts = {
    record: {
      id: "r1",
      custom_fields: { data_x: "2026-05-05" },
    } as never,
    fieldModifiedAt: { stage: "2026-09-01T10:00:00-03:00" },
    sourceCreatedAt: "2026-01-10T08:00:00-03:00",
    available: [],
  };

  it("field_changed lê o mesmo fato que a condição de tempo usa", () => {
    expect(
      resolveAnchorDate({ kind: "field_changed", field: "stage" }, facts)
    ).toBe("2026-09-01");
  });

  it("campo nunca alterado não tem âncora", () => {
    expect(
      resolveAnchorDate({ kind: "field_changed", field: "outro" }, facts)
    ).toBeNull();
  });

  it("created usa a criação na origem", () => {
    expect(resolveAnchorDate({ kind: "created" }, facts)).toBe("2026-01-10");
  });

  it("campo de data do registro", () => {
    expect(
      resolveAnchorDate({ kind: "field", field: "custom:data_x" }, facts)
    ).toBe("2026-05-05");
  });
});

describe("resolveBound — quando parar de cobrar", () => {
  const facts = {
    record: {
      id: "r1",
      custom_fields: { data_limite: "2026-11-30" },
    } as never,
    fieldModifiedAt: { assinatura: "2026-10-05T14:00:00-03:00" },
    sourceCreatedAt: "2026-01-10T08:00:00-03:00",
    available: [],
  };

  it("data fixa é o prazo independente de qualquer campo", () => {
    expect(resolveBound({ kind: "date", date: "2026-12-31" }, facts)).toBe(
      "2026-12-31"
    );
  });

  it("campo de data lê o valor do registro", () => {
    expect(
      resolveBound({ kind: "field", field: "custom:data_limite" }, facts)
    ).toBe("2026-11-30");
  });

  it("field_changed para no DIA em que o campo mudou", () => {
    // O mesmo fato da âncora homônima: nada de consulta nova para saber isso.
    expect(
      resolveBound({ kind: "field_changed", field: "assinatura" }, facts)
    ).toBe("2026-10-05");
  });

  it("campo que nunca mudou não limita — a série segue", () => {
    // Limitar por um fato que não aconteceu pararia a cobrança em silêncio.
    expect(
      resolveBound({ kind: "field_changed", field: "outro" }, facts)
    ).toBeNull();
  });

  it("sem `until`, não há limite", () => {
    expect(resolveBound(undefined, facts)).toBeNull();
  });

  it("o limite realmente corta o tronco", () => {
    const semLimite = occurrencesUntil({
      ...base,
      todayIso: "2026-11-15",
    });
    const comLimite = occurrencesUntil({
      ...base,
      todayIso: "2026-11-15",
      untilDate: resolveBound(
        { kind: "field_changed", field: "assinatura" },
        facts
      ),
    });
    expect(semLimite.length).toBeGreaterThan(comLimite.length);
    // Nada depois do dia em que o campo mudou.
    for (const o of comLimite) expect(o.dueDate <= "2026-10-05").toBe(true);
  });
});
