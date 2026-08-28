// Versão: 1.3 | Data: 27/08/2026
// v1.3: os pinos de TEXTO mudaram de propósito — o CSV deixou de falar o
// registro interno ("peso 40%", "gatilho/base de comissão", "total manual") e
// passou a consumir as MESMAS frases da planilha (sheet* de commission-label).
// A ORDEM e a quantidade de colunas seguem pinadas: é o que quebra integração
// de terceiro, e continua intocado.
// Versão: 1.2 | Data: 02/08/2026
// v1.2: compReportValues foi REMOVIDO (o export ao Google Planilhas agora tem
// builder próprio com layout de demonstrativo — lib/export/comp-sheet.ts, com
// testes próprios); os pinos do CSV seguem — são a prova de que o refactor
// interno (statementBreakdown) manteve a saída byte-idêntica.
// Testes do CSV de Remuneração (lib/export/comp.ts): headers pinados, linhas
// por fator/comissão/base/bônus/total derivadas pelo MESMO computeEntry dos
// cards (fixtures espelham comp-overview.test.tsx), memória da comissão via
// commissionMemory, convenção de vazio ("—" da UI = ""), decimais com vírgula
// (csvNumber) e concatenação em ordem no compReportCsv.
import { describe, expect, it } from "vitest";

import type { CompPlanConfig } from "@/lib/comp/model";

import {
  COMP_CSV_HEADERS,
  compReportCsv,
  compStatementRows,
  type CompStatementInput,
} from "./comp";

// NBSP do Intl pt-BR normalizado do lado do resultado.
const norm = (s: string) => s.replace(/ /g, " ");

// Plano A: 100% comissão (fator peso 0 + per_unit) — memória "44 × R$ 12,50".
const configA: CompPlanConfig = {
  v: 1,
  factors: [
    {
      id: "reunioes",
      label: "Reuniões",
      weightPct: 0,
      metricKey: "m_r",
      money: false,
      formula: { tokens: [{ kind: "field", ref: "agg:count:*" }] },
      sources: [],
    },
  ],
  commissions: [
    {
      id: "premio",
      label: "Prêmio por reunião",
      triggerFactorId: "reunioes",
      basisKind: "factor",
      basisFactorId: "reunioes",
      tierBy: "realized",
      kind: "per_unit",
      tiers: [
        { fromPct: 0, amount: 10 },
        { fromPct: 26, amount: 12.5 },
      ],
    },
  ],
};

// Plano B: clássico (peso 100%).
const configB: CompPlanConfig = {
  v: 1,
  factors: [
    {
      id: "vendas",
      label: "Vendas",
      weightPct: 100,
      metricKey: "m_v",
      money: true,
      formula: { tokens: [{ kind: "field", ref: "agg:sum:value" }] },
      sources: [],
    },
  ],
};

function statement(
  over: Partial<CompStatementInput> & Pick<CompStatementInput, "config">
): CompStatementInput {
  return {
    planName: "Plano X",
    memberLabel: "Ana",
    baseAmountDefault: null,
    entry: null,
    targets: {},
    targetRates: {},
    ...over,
  };
}

const entryA = {
  responsible_id: "r_ana",
  base_amount: null,
  inputs: {},
  computed: { v: 1, at: "2026-08-01T10:00:00Z", realized: { reunioes: 44 } },
};

const entryB = {
  responsible_id: "r_bruno",
  base_amount: null,
  inputs: {},
  computed: { v: 1, at: "2026-08-01T10:00:00Z", realized: { vendas: 50000 } },
};

const rowBy = (rows: string[][], tipo: string, item = "") =>
  rows.find((r) => r[2] === tipo && (item === "" || r[3] === item));

describe("compStatementRows", () => {
  it("pina os headers do contrato", () => {
    expect(COMP_CSV_HEADERS).toEqual([
      "Plano",
      "Pessoa",
      "Tipo",
      "Item",
      "Meta",
      "Realizado",
      "Atingimento %",
      "Valor (R$)",
      "Memória de cálculo",
    ]);
  });

  it("plano de comissão (peso 0 + per_unit): valor do fator vazio, memória do bloco", () => {
    const rows = compStatementRows(
      statement({ config: configA, planName: "Plano A", entry: entryA })
    );
    const fator = rowBy(rows, "Indicador", "Reuniões")!;
    expect(fator[0]).toBe("Plano A");
    expect(fator[1]).toBe("Ana");
    expect(fator[5]).toBe("44"); // realizado
    expect(fator[7]).toBe(""); // peso 0 sem override ⇒ "—" da UI = vazio
    // Peso 0 sem override: a nota fica VAZIA (a coluna Valor já diz tudo) —
    // mesma regra da planilha desde commission-label v1.10.
    expect(fator[8]).toBe("");

    const comissao = rowBy(rows, "Comissão", "Prêmio por reunião")!;
    expect(comissao[7]).toBe("550");
    expect(norm(comissao[8])).toContain("44 (Reuniões) × R$ 12,50 = R$ 550,00");
    // Bloco único sem override ⇒ sem linha "Comissão (total)".
    expect(rowBy(rows, "Comissão (total)")).toBeUndefined();

    const total = rowBy(rows, "Total")!;
    expect(total[7]).toBe("550");
    expect(total[8]).toBe("");
  });

  it("plano clássico: alvo/realizado/atingimento/valor e total derivados", () => {
    const rows = compStatementRows(
      statement({
        config: configB,
        planName: "Plano B",
        memberLabel: "Bruno",
        baseAmountDefault: 1000,
        entry: entryB,
        targets: { vendas: 100000 },
      })
    );
    const fator = rowBy(rows, "Indicador", "Vendas")!;
    expect(fator[4]).toBe("100000");
    expect(fator[5]).toBe("50000");
    expect(fator[6]).toBe("50");
    expect(fator[7]).toBe("500"); // 1000 × 100% × 50%
    expect(rowBy(rows, "Base variável")![7]).toBe("1000");
    expect(rowBy(rows, "Total")![7]).toBe("500");
  });

  it("decimais saem com vírgula (csvNumber)", () => {
    const rows = compStatementRows(
      statement({
        config: configB,
        baseAmountDefault: 1000,
        entry: {
          ...entryB,
          computed: {
            v: 1,
            at: "2026-08-01T10:00:00Z",
            realized: { vendas: 50500 },
          },
        },
        targets: { vendas: 100000 },
      })
    );
    const fator = rowBy(rows, "Indicador", "Vendas")!;
    expect(fator[6]).toBe("50,5");
  });

  it("bônus e overrides: uma linha por bônus, total manual anotado", () => {
    const rows = compStatementRows(
      statement({
        config: configB,
        baseAmountDefault: 1000,
        entry: {
          ...entryB,
          inputs: {
            overrides: { total: 1234.5 },
            bonuses: [{ id: "b1", label: "Aceleração", amount: 200 }],
          },
        },
        targets: { vendas: 100000 },
      })
    );
    const bonus = rowBy(rows, "Bônus", "Aceleração")!;
    expect(bonus[7]).toBe("200");
    const total = rowBy(rows, "Total")!;
    expect(total[7]).toBe("1234,5");
    expect(total[8]).toBe("Total definido manualmente");
  });

  it("sem lançamento: linha única com a nota", () => {
    const rows = compStatementRows(
      statement({ config: configB, planName: "Plano B", memberLabel: "Ana" })
    );
    expect(rows).toEqual([
      ["Plano B", "Ana", "Total", "", "", "", "", "", "Sem lançamento neste mês."],
    ]);
  });
});

describe("compReportCsv", () => {
  it("concatena demonstrativos na ordem recebida", () => {
    const { headers, rows } = compReportCsv([
      statement({ config: configA, planName: "Plano A", entry: entryA }),
      statement({ config: configB, planName: "Plano B", memberLabel: "Ana" }),
    ]);
    expect(headers).toBe(COMP_CSV_HEADERS);
    expect(rows[0][0]).toBe("Plano A");
    expect(rows[rows.length - 1]).toEqual([
      "Plano B",
      "Ana",
      "Total",
      "",
      "",
      "",
      "",
      "",
      "Sem lançamento neste mês.",
    ]);
  });
});
