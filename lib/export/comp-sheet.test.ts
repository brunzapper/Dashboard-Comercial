// Versão: 1.0 | Data: 02/08/2026
// Testes do builder do DEMONSTRATIVO p/ Google Planilhas (comp-sheet.ts):
// shape do grid (largura fixa 7 + kinds paralelo, whitelist do contrato),
// quadro-resumo (números crus, total geral, ordenação por pessoa pt-BR),
// blocos de detalhe (seções, fator peso-0, factorMoney, memória da comissão
// via commissionMemory, sem lançamento), AUSÊNCIA do jargão interno do CSV
// (regressão de linguagem — o demonstrativo é p/ RH/gestor), escopo "minha"
// sem coluna Pessoa e aceitação pelo validateReportPayload do contrato.
// Fixtures espelham comp.test.ts (mesmos planos A/B).
import { describe, expect, it } from "vitest";

import { SHEET_NO_ENTRY_NOTE } from "@/lib/comp/commission-label";
import type { CompPlanConfig } from "@/lib/comp/model";
import {
  COMP_SHEET_KINDS,
  SHEET_TITLES,
  validateReportPayload,
} from "@/lib/comp/sheets-export";

import type { CompStatementInput } from "./comp";
import { COMP_SHEET_COLS, compSheetReport } from "./comp-sheet";

// NBSP do Intl pt-BR normalizado do lado do resultado (escape explícito —
// um NBSP literal no source é invisível e fácil de perder em edição).
const norm = (s: string) => s.replace(/[\u00a0\u202f]/g, " ");

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

// Relatório padrão dos testes: Bruno (Plano B) ANTES de Ana (Plano A) na
// entrada — a ordenação por pessoa deve inverter.
const inputs = () => [
  statement({
    config: configB,
    planName: "Plano B",
    memberLabel: "Bruno",
    baseAmountDefault: 1000,
    entry: entryB,
    targets: { vendas: 100000 },
  }),
  statement({ config: configA, planName: "Plano A", entry: entryA }),
];

const OPTS = { scope: "visao-geral", monthLabel: "Agosto de 2026" } as const;

const rowOf = (
  report: ReturnType<typeof compSheetReport>,
  kind: string,
  col0?: string
) =>
  report.rows.find(
    (r, i) => report.kinds[i] === kind && (col0 == null || r[0] === col0)
  );

describe("compSheetReport", () => {
  it("shape: largura fixa, kinds paralelo à whitelist, título com o mês", () => {
    const report = compSheetReport(inputs(), OPTS);
    expect(report.headers).toHaveLength(COMP_SHEET_COLS);
    expect(report.headers[0]).toBe(
      "Demonstrativo de remuneração — Agosto de 2026"
    );
    expect(report.kinds).toHaveLength(report.rows.length);
    for (const r of report.rows) expect(r).toHaveLength(COMP_SHEET_COLS);
    for (const k of report.kinds) expect(COMP_SHEET_KINDS).toContain(k);
    for (const r of report.rows)
      for (const c of r)
        if (typeof c === "string") expect(c.length).toBeLessThanOrEqual(500);
  });

  it("resumo: uma linha por statement, números CRUS, ordenação por pessoa", () => {
    const report = compSheetReport(inputs(), OPTS);
    const summaries = report.rows.filter(
      (_, i) => report.kinds[i] === "summary"
    );
    expect(summaries).toHaveLength(2);
    // Ana (Plano A) vem antes de Bruno apesar da ordem de entrada.
    expect(summaries[0][0]).toBe("Ana");
    expect(summaries[1][0]).toBe("Bruno");
    // Plano A: só comissão (base/fatores 0, comissão 550, total 550).
    expect(summaries[0][4]).toBe(550);
    expect(summaries[0][6]).toBe(550);
    // Plano B: base 1000, fatores 500, sem comissão ("" — plano sem blocos).
    expect(summaries[1][2]).toBe(1000);
    expect(summaries[1][3]).toBe(500);
    expect(summaries[1][4]).toBe("");
    expect(summaries[1][6]).toBe(500);
  });

  it("total geral soma fatores/comissão/bônus/total e deixa a base vazia", () => {
    const report = compSheetReport(inputs(), OPTS);
    const total = rowOf(report, "summaryTotal")!;
    expect(total[0]).toBe("Total geral");
    expect(total[2]).toBe(""); // base NÃO soma (multiplica os fatores)
    expect(total[3]).toBe(500);
    expect(total[4]).toBe(550);
    expect(total[6]).toBe(1050);
  });

  it("detalhe: seção por pessoa×plano, memória protagonista", () => {
    const report = compSheetReport(inputs(), OPTS);
    expect(rowOf(report, "section", "Ana — Plano A")).toBeTruthy();
    expect(rowOf(report, "section", "Bruno — Plano B")).toBeTruthy();
    // Fator com peso (money sem moeda estrangeira) = factorMoney com a conta.
    const vendas = rowOf(report, "factorMoney", "Vendas")!;
    expect(vendas[1]).toBe(100000);
    expect(vendas[3]).toBe(50);
    expect(vendas[4]).toBe(100);
    expect(vendas[5]).toBe(500);
    expect(norm(String(vendas[6]))).toContain(
      "R$ 1.000,00 × 100% × 50% = R$ 500,00"
    );
    // Fator peso 0 (não-money) = factor com Peso/Valor vazios e nota humana.
    const reunioes = rowOf(report, "factor", "Reuniões")!;
    expect(reunioes[2]).toBe(44);
    expect(reunioes[4]).toBe("");
    expect(reunioes[5]).toBe("");
    expect(String(reunioes[6])).toContain("não gera valor próprio");
    // Memória do bloco de comissão via commissionMemory.
    const premio = rowOf(report, "commission", "Prêmio por reunião")!;
    expect(premio[5]).toBe(550);
    expect(norm(String(premio[6]))).toContain(
      "44 (Reuniões) × R$ 12,50 = R$ 550,00"
    );
    // Plano A (sem fator com peso nem comissão sobre a base): sem linha de
    // base variável no bloco; o total do bloco fecha em 550.
    const blocoTotais = report.rows.filter(
      (_, i) => report.kinds[i] === "blockTotal"
    );
    expect(blocoTotais.some((r) => r[5] === 550)).toBe(true);
    expect(rowOf(report, "info", "Base variável")).toBeTruthy(); // do Plano B
  });

  it("sem lançamento: seção + nota, resumo vazio", () => {
    const report = compSheetReport(
      [statement({ config: configB, planName: "Plano B", memberLabel: "Ana" })],
      OPTS
    );
    const summary = rowOf(report, "summary")!;
    expect(summary.slice(2)).toEqual(["", "", "", "", ""]);
    expect(rowOf(report, "info", SHEET_NO_ENTRY_NOTE)).toBeTruthy();
  });

  it("jargão interno do CSV NÃO aparece no demonstrativo", () => {
    const all = JSON.stringify(
      compSheetReport(
        [
          ...inputs(),
          statement({ config: configB, planName: "Plano B", memberLabel: "Zé" }),
        ],
        OPTS
      ).rows
    );
    expect(all).not.toContain("gatilho/base de comissão");
    expect(all).not.toContain("peso 0%");
    expect(all).not.toContain("não soma no total");
    expect(all).not.toContain("sem lançamento no mês"); // virou SHEET_NO_ENTRY_NOTE
  });

  it('escopo "minha": sem coluna/menção a Pessoa, seção só com o plano', () => {
    const report = compSheetReport(
      [
        statement({
          config: configB,
          planName: "Plano B",
          memberLabel: "",
          baseAmountDefault: 1000,
          entry: entryB,
          targets: { vendas: 100000 },
        }),
      ],
      { scope: "minha", monthLabel: "Agosto de 2026" }
    );
    expect(report.headers[0]).toBe("Minha remuneração — Agosto de 2026");
    const header = rowOf(report, "summaryHeader")!;
    expect(header[0]).toBe("Plano");
    expect(JSON.stringify(report.rows)).not.toContain("Pessoa");
    expect(rowOf(report, "section", "Plano B")).toBeTruthy();
  });

  it("o payload do builder passa no validador do contrato", () => {
    const report = compSheetReport(inputs(), OPTS);
    expect(
      validateReportPayload({
        title: SHEET_TITLES["visao-geral"],
        tabName: "Agosto 2026",
        headers: report.headers,
        rows: report.rows,
        kinds: report.kinds,
      })
    ).toEqual({ ok: true });
  });
});
