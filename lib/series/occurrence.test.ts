// Versão: 1.2 | Data: 09/09/2026
// v1.1 (09/09/2026): o `until` por ALTERAÇÃO de campo (a quarta forma de
//   encerrar).
// v1.4 (10/09/2026): `occurrencesToOpen` — a janela reposta por CONCLUSÃO.
// v1.2 (09/09/2026): `occurrencesAhead` (as ocorrências futuras) e o
//   `anchorFallback` do registro sem histórico.
// A ocorrência devida é o relógio da série. O que estes testes protegem:
// ela é DERIVADA (a mesma entrada dá sempre a mesma sequência, mesmo com
// rodadas perdidas), ausência de data nunca vira "hoje", e a janela realmente
// para de gerar.
import { describe, expect, it } from "vitest";

import {
  dueOccurrence,
  occurrencesAhead,
  occurrencesToOpen,
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
  it("antes de fechar o primeiro ciclo, não gera nada", () => {
    // Entrou em Nutrição hoje: abrir agora seria ruído, não acompanhamento.
    expect(dueOccurrence({ ...base, todayIso: "2026-09-01" })).toBeNull();
    expect(dueOccurrence({ ...base, todayIso: "2026-09-14" })).toBeNull();
  });

  it("na virada da quinzena, abre a 1ª", () => {
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

  it("com 'imediato', a ocorrência 0 é a do próprio dia da âncora", () => {
    const plan = dueOccurrence({
      ...base,
      firstAt: "imediato",
      todayIso: "2026-09-01",
    });
    expect(plan).toMatchObject({ occurrence: 0, dueDate: "2026-09-01" });
  });

  it("sem âncora não gera nada — data ausente nunca vira hoje", () => {
    expect(dueOccurrence({ ...base, anchorDate: null, todayIso: "2026-10-01" })).toBeNull();
    expect(dueOccurrence({ ...base, anchorDate: "", todayIso: "2026-10-01" })).toBeNull();
  });

  it("fora da janela, para de gerar", () => {
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

  it("respeita o teto de ocorrências", () => {
    expect(
      dueOccurrence({ ...base, todayIso: "2026-10-13", maxOccurrences: 2 })
    ).toBeNull();
  });

  it("cadência inválida não gera nada (nunca todo dia por engano)", () => {
    expect(dueOccurrence({ ...base, cadenceDays: 0, todayIso: "2026-10-01" })).toBeNull();
    expect(dueOccurrence({ ...base, cadenceDays: -7, todayIso: "2026-10-01" })).toBeNull();
  });

  it("hoje antes da âncora não gera nada", () => {
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
  it("lista o tronco da Tree, inclusive ocorrências que ninguém fez", () => {
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
    changedAt: new Map([["stage", "2026-09-01T10:00:00-03:00"]]),
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

describe("resolveBound — quando encerrar", () => {
  const facts = {
    record: {
      id: "r1",
      custom_fields: { data_limite: "2026-11-30" },
    } as never,
    changedAt: new Map([["assinatura", "2026-10-05T14:00:00-03:00"]]),
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
    // Limitar por um fato que não aconteceu encerraria a série em silêncio.
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

// ---------------------------------------------------------------------------
// v1.2 — as ocorrências FUTURAS.
// ---------------------------------------------------------------------------
describe("occurrencesAhead", () => {
  // Quinzenal ancorado em 01/09; em 29/09 a devida é a de número 2.
  const base = {
    anchorDate: "2026-09-01",
    cadenceDays: 14,
    todayIso: "2026-09-29",
    firstAt: "apos_um_ciclo" as const,
  };

  it("devolve a devida hoje MAIS as N seguintes", () => {
    const plans = occurrencesAhead(base, 5);
    expect(plans.map((p) => p.occurrence)).toEqual([2, 3, 4, 5, 6, 7]);
    expect(plans[0].dueDate).toBe("2026-09-29");
    expect(plans[5].dueDate).toBe("2026-12-08");
  });

  // A decisão central: a série não abre de uma vez as ocorrências que ninguém
  // fez. A PRIMEIRA da lista é a devida agora — e ela pode ter vencido há
  // alguns dias (é o que se está devendo hoje); o que não pode é vir a 1ª, a
  // 2ª e a 3ª de meses atrás junto. Âncora em janeiro, quinzenal: a devida em
  // 29/09 é a de número 19, e a lista começa NELA, não na 1.
  it("NUNCA anda para trás, mesmo com a âncora muito antiga", () => {
    const plans = occurrencesAhead(
      { ...base, anchorDate: "2026-01-01", todayIso: "2026-09-29" },
      5
    );
    const devida = dueOccurrence({
      ...base,
      anchorDate: "2026-01-01",
      todayIso: "2026-09-29",
    })!;
    expect(plans[0].occurrence).toBe(devida.occurrence);
    expect(plans.map((p) => p.occurrence)).toEqual([19, 20, 21, 22, 23, 24]);
    // Nenhuma ocorrência de ciclo anterior ao que está em aberto agora.
    for (const p of plans) {
      expect(p.occurrence).toBeGreaterThanOrEqual(devida.occurrence);
      expect(p.dueDate >= devida.dueDate).toBe(true);
    }
  });

  it("count 0 devolve só a devida hoje", () => {
    expect(occurrencesAhead(base, 0).map((p) => p.occurrence)).toEqual([2]);
  });

  it("respeita a borda final: não agenda depois do fim da série", () => {
    const plans = occurrencesAhead({ ...base, untilDate: "2026-10-20" }, 5);
    expect(plans.map((p) => p.dueDate)).toEqual(["2026-09-29", "2026-10-13"]);
  });

  it("respeita o teto de ocorrências", () => {
    const plans = occurrencesAhead({ ...base, maxOccurrences: 4 }, 5);
    expect(plans.map((p) => p.occurrence)).toEqual([2, 3, 4]);
  });

  it("sem ocorrência devida hoje não adianta nada", () => {
    // Antes da primeira: adiantar aqui seria começar cedo demais.
    expect(occurrencesAhead({ ...base, todayIso: "2026-09-05" }, 5)).toEqual([]);
    // Sem âncora, idem.
    expect(occurrencesAhead({ ...base, anchorDate: null }, 5)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// v1.4 — a janela reposta por CONCLUSÃO.
//
// O que separa isto de `occurrencesAhead`: lá a janela anda com o TEMPO, então
// concluir uma ocorrência deixava o vendedor com uma a menos na tela até virar
// o ciclo. Aqui o estoque de futuras abertas é constante — concluiu uma, a
// seguinte do calendário entra no lugar.
// ---------------------------------------------------------------------------
describe("occurrencesToOpen", () => {
  const base = {
    anchorDate: "2026-09-01",
    cadenceDays: 14,
    todayIso: "2026-09-29",
    firstAt: "apos_um_ciclo" as const,
  };
  const open = (n: number) => ({ occurrence: n, open: true });
  const done = (n: number) => ({ occurrence: n, open: false });

  it("do zero, abre a devida hoje e completa o estoque de futuras", () => {
    const plans = occurrencesToOpen(base, { keepAhead: 3, known: [] });
    expect(plans.map((p) => p.occurrence)).toEqual([2, 3, 4, 5]);
    expect(plans[0].dueDate).toBe("2026-09-29");
  });

  it("com o estoque cheio, não abre nada", () => {
    const plans = occurrencesToOpen(base, {
      keepAhead: 3,
      known: [open(2), open(3), open(4), open(5)],
    });
    expect(plans).toEqual([]);
  });

  // O pedido literal: "adicionando 1 a cada vez que uma for concluída".
  it("concluir uma FUTURA repõe exatamente uma", () => {
    const plans = occurrencesToOpen(base, {
      keepAhead: 3,
      known: [open(2), done(3), open(4), open(5)],
    });
    expect(plans.map((p) => p.occurrence)).toEqual([6]);
  });

  // A devida hoje não é uma "futura": concluí-la não muda o estoque à frente.
  it("concluir a DEVIDA não repõe (o estoque de futuras segue cheio)", () => {
    const plans = occurrencesToOpen(base, {
      keepAhead: 3,
      known: [done(2), open(3), open(4), open(5)],
    });
    expect(plans).toEqual([]);
  });

  it("concluir tudo recomeça o estoque a partir da próxima do calendário", () => {
    const plans = occurrencesToOpen(base, {
      keepAhead: 3,
      known: [done(2), done(3), done(4), done(5)],
    });
    expect(plans.map((p) => p.occurrence)).toEqual([6, 7, 8]);
  });

  // A mesma invariante do occurrencesAhead: a série não fabrica passado.
  it("NUNCA anda para trás, mesmo com âncora antiga e nada criado", () => {
    const plans = occurrencesToOpen(
      { ...base, anchorDate: "2026-01-01" },
      { keepAhead: 3, known: [] }
    );
    expect(plans.map((p) => p.occurrence)).toEqual([19, 20, 21, 22]);
  });

  it("keepAhead 0 mantém só a devida hoje", () => {
    expect(
      occurrencesToOpen(base, { keepAhead: 0, known: [] }).map(
        (p) => p.occurrence
      )
    ).toEqual([2]);
    expect(
      occurrencesToOpen(base, { keepAhead: 0, known: [open(2)] })
    ).toEqual([]);
  });

  it("a borda final corta a reposição em vez de estourá-la", () => {
    const plans = occurrencesToOpen(
      { ...base, untilDate: "2026-10-20" },
      { keepAhead: 3, known: [] }
    );
    expect(plans.map((p) => p.dueDate)).toEqual(["2026-09-29", "2026-10-13"]);
  });

  it("respeita o teto de ocorrências", () => {
    const plans = occurrencesToOpen(
      { ...base, maxOccurrences: 4 },
      { keepAhead: 3, known: [] }
    );
    expect(plans.map((p) => p.occurrence)).toEqual([2, 3, 4]);
  });

  it("sem ocorrência devida hoje não abre nada", () => {
    expect(
      occurrencesToOpen({ ...base, todayIso: "2026-09-05" }, {
        keepAhead: 3,
        known: [],
      })
    ).toEqual([]);
    expect(
      occurrencesToOpen({ ...base, anchorDate: null }, {
        keepAhead: 3,
        known: [],
      })
    ).toEqual([]);
  });

  // Ocorrência concluída NUNCA renasce: a trava da 0132 é "aconteceu uma vez
  // na vida", e reabrir a 3ª porque ela foi concluída seria pedir duas vezes.
  it("não recria ocorrência que já existe, aberta ou concluída", () => {
    const plans = occurrencesToOpen(base, {
      keepAhead: 2,
      known: [done(2), done(3), open(4)],
    });
    expect(plans.map((p) => p.occurrence)).toEqual([5]);
  });
});

describe("resolveAnchorDate — fallback", () => {
  const facts = {
    record: { id: "r1" } as never,
    changedAt: null,
    sourceCreatedAt: "2026-07-21T11:11:32-03:00",
    available: [],
  };

  it("sem histórico e sem fallback, NÃO gera nada", () => {
    expect(
      resolveAnchorDate({ kind: "field_changed", field: "stage" }, facts)
    ).toBeNull();
  });

  it("com fallback 'criacao', conta da criação do registro", () => {
    expect(
      resolveAnchorDate(
        { kind: "field_changed", field: "stage" },
        facts,
        "criacao"
      )
    ).toBe("2026-07-21");
  });

  it("o histórico vence o fallback quando existe", () => {
    expect(
      resolveAnchorDate(
        { kind: "field_changed", field: "stage" },
        { ...facts, changedAt: new Map([["stage", "2026-09-01T09:00:00-03:00"]]) },
        "criacao"
      )
    ).toBe("2026-09-01");
  });
});
