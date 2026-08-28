// Versão: 1.1 | Data: 02/08/2026
// v1.1: layout por COLABORADOR — sem quadro-resumo no topo: seção única por
// pessoa (nome 1× + total consolidado no cabeçalho), planHeader por plano,
// memberTotal com 2+ planos, Total geral só no rodapé (2+ pessoas), Peso
// omitido do header quando nenhum fator o usa e Base variável com a condição
// corrigida (flat não usa a base; totalFormula com comp:base usa).
// Testes do builder do DEMONSTRATIVO p/ Google Planilhas (comp-sheet.ts):
// shape do grid (largura fixa 7 + kinds paralelo, whitelist do contrato),
// blocos por pessoa (seções, fator peso-0, factorMoney, memória da comissão
// via commissionMemory, sem lançamento), AUSÊNCIA do jargão interno do CSV
// (regressão de linguagem — o demonstrativo é p/ RH/gestor), escopo "minha"
// sem menção a Pessoa e aceitação pelo validateReportPayload do contrato.
// Fixtures espelham comp.test.ts (mesmos planos A/B).
import { describe, expect, it } from "vitest";

import {
  SHEET_MEMBER_TOTAL_NOTE,
  SHEET_NO_ENTRY_NOTE,
} from "@/lib/comp/commission-label";
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

// generatedAt injetado: a data de geração é conteúdo do demonstrativo, e um
// teste que depende do relógio quebra sozinho amanhã.
const OPTS = {
  monthLabel: "Agosto de 2026",
  generatedAt: new Date(2026, 7, 27),
} as const;

const rowOf = (
  report: ReturnType<typeof compSheetReport>,
  kind: string,
  col0?: string
) =>
  report.rows.find(
    (r, i) => report.kinds[i] === kind && (col0 == null || r[0] === col0)
  );

const rowsOf = (report: ReturnType<typeof compSheetReport>, kind: string) =>
  report.rows.filter((_, i) => report.kinds[i] === kind);

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

  it("seção por pessoa: nome 1×, total no cabeçalho, ordenação pt-BR", () => {
    const report = compSheetReport(inputs(), OPTS);
    // Sem quadro-resumo no topo: os kinds antigos ficam reservados.
    expect(report.kinds).not.toContain("summaryHeader");
    expect(report.kinds).not.toContain("summary");
    // Ana antes de Bruno apesar da ordem de entrada; nome SÓ na seção.
    const sections = rowsOf(report, "section");
    expect(sections.map((r) => r[0])).toEqual(["Ana", "Bruno"]);
    // Total consolidado (números CRUS) na coluna Valor do cabeçalho.
    expect(sections[0][5]).toBe(550);
    expect(sections[1][5]).toBe(500);
    // Nome do plano vira sub-cabeçalho do bloco da pessoa.
    expect(rowsOf(report, "planHeader").map((r) => r[0])).toEqual([
      "Plano A",
      "Plano B",
    ]);
    // O fecho da pessoa existe SEMPRE (marca o fim do bloco); com um único
    // plano ele substitui o blockTotal — nunca duas linhas "Total" iguais.
    expect(rowsOf(report, "memberTotal").map((r) => r[0])).toEqual([
      "Total — Ana",
      "Total — Bruno",
    ]);
    expect(report.kinds).not.toContain("blockTotal");
    // Duas linhas de respiro abrem cada bloco.
    const primeiraSecao = report.kinds.indexOf("section");
    expect(report.kinds[primeiraSecao - 1]).toBe("blank");
    expect(report.kinds[primeiraSecao - 2]).toBe("blank");
  });

  it("links: a linha da pessoa aponta p/ a aba de detalhe (nome determinístico)", () => {
    const report = compSheetReport(inputs(), OPTS);
    expect(report.links).toHaveLength(report.rows.length);
    expect(report.detailTabs).toEqual([
      { label: "Ana", tabName: "Det-Ana" },
      { label: "Bruno", tabName: "Det-Bruno" },
    ]);
    // Só as linhas `section` linkam; o resto é null.
    const linkadas = report.links
      .map((l, i) => (l == null ? null : { kind: report.kinds[i], l }))
      .filter(Boolean);
    // Linkam as linhas do RESUMO (caminho do RH) e as `section` (caminho de
    // quem está lendo o card da pessoa).
    expect(linkadas).toEqual([
      { kind: "rosterRow", l: "Det-Ana" },
      { kind: "rosterRow", l: "Det-Bruno" },
      { kind: "section", l: "Det-Ana" },
      { kind: "section", l: "Det-Bruno" },
    ]);
    // Homônimos não colidem: a 2ª aba ganha sufixo.
    const homonimos = compSheetReport(
      [
        statement({ config: configA, planName: "Plano A", entry: entryA }),
        statement({
          config: configB,
          planName: "Plano B",
          memberLabel: "Ana",
          entry: entryB,
        }),
      ],
      OPTS
    );
    // Mesma pessoa (mesmo rótulo) = UMA seção, UMA aba.
    expect(homonimos.detailTabs).toEqual([{ label: "Ana", tabName: "Det-Ana" }]);
  });

  it("resumo da folha no TOPO: uma linha por pessoa + total geral", () => {
    // O rodapé `summaryTotal` (só com 2+ pessoas, no fim da planilha) saiu: o
    // RH abria 40 pessoas e tinha de rolar tudo para saber quanto ia pagar.
    const report = compSheetReport(inputs(), OPTS);
    expect(report.kinds).not.toContain("summaryTotal");

    const linhas = rowsOf(report, "rosterRow");
    expect(linhas.map((r) => r[0])).toEqual(["Ana", "Bruno"]);
    expect(linhas[0][5]).toBe(550);
    expect(linhas[1][5]).toBe(500);

    const total = rowOf(report, "rosterTotal")!;
    expect(total[0]).toBe("Total geral");
    expect(total[5]).toBe(1050);
    expect(total[6]).toBe("2 colaboradores");

    // O resumo vem ANTES do primeiro card.
    const fimResumo = report.kinds.indexOf("rosterTotal");
    expect(fimResumo).toBeGreaterThan(-1);
    expect(fimResumo).toBeLessThan(report.kinds.indexOf("section"));

    // Com uma pessoa só o resumo continua (é o índice + a situação da folha).
    const single = compSheetReport([inputs()[0]], OPTS);
    expect(rowOf(single, "rosterTotal")![6]).toBe("1 colaborador");
  });

  it("contexto do topo: competência, mês apurado, situação e geração", () => {
    const metas = (r: ReturnType<typeof compSheetReport>) =>
      rowsOf(r, "meta").map((x) => String(x[0]));

    // Sem year/month o builder OMITE a linha de apuração em vez de inventá-la.
    expect(metas(compSheetReport(inputs(), OPTS))).toEqual([
      "Competência: Agosto de 2026",
      "Situação: prévia — ainda não publicado",
      "Gerado em: 27/08/2026",
    ]);

    // Plano com apuração no mês anterior: a diferença entre mês de pagamento e
    // mês de desempenho passa a ser dita — era invisível na planilha.
    const comApuracao = compSheetReport(
      [
        statement({
          config: { ...configA, apuracao: "mes_anterior" },
          planName: "Plano A",
          entry: entryA,
        }),
      ],
      { ...OPTS, year: 2026, month: 8 }
    );
    expect(metas(comApuracao)).toContain(
      "Desempenho apurado sobre: Julho de 2026"
    );

    // Publicado × prévia sai de comp_entries.published_at; misto é dito.
    const publicado = compSheetReport(
      [
        statement({
          config: configA,
          planName: "Plano A",
          entry: { ...entryA, published_at: "2026-09-01T10:00:00Z" },
        }),
      ],
      OPTS
    );
    expect(metas(publicado)).toContain("Situação: publicado");

    const misto = compSheetReport(
      [
        statement({
          config: configA,
          planName: "Plano A",
          entry: { ...entryA, published_at: "2026-09-01T10:00:00Z" },
        }),
        statement({
          config: configB,
          planName: "Plano B",
          memberLabel: "Bruno",
          baseAmountDefault: 1000,
          entry: entryB,
          targets: { vendas: 100000 },
        }),
      ],
      OPTS
    );
    expect(metas(misto)).toContain(
      "Situação: prévia — 1 de 2 lançamentos ainda não publicados"
    );
  });

  it("legenda fecha a planilha, com a definição na coluna de prosa", () => {
    const report = compSheetReport(inputs(), OPTS);
    expect(report.kinds[report.kinds.length - 1]).toBe("legend");
    const legenda = rowsOf(report, "legend");
    // Termo na coluna A, definição na ÚLTIMA (a que o script quebra e limita —
    // texto longo numa coluna do meio alargaria a planilha inteira).
    expect(legenda.map((r) => r[0])).toContain("Base variável");
    expect(legenda.every((r) => r[1] === "" && String(r[6]).length > 0)).toBe(
      true
    );
  });

  it("pessoa com 2+ planos: seção única, composição no cabeçalho e memberTotal", () => {
    const report = compSheetReport(
      [
        statement({ config: configA, planName: "Plano A", entry: entryA }),
        statement({
          config: configB,
          planName: "Plano B",
          baseAmountDefault: 1000,
          entry: entryB,
          targets: { vendas: 100000 },
        }),
      ],
      OPTS
    );
    const sections = rowsOf(report, "section");
    expect(sections).toHaveLength(1);
    expect(sections[0][0]).toBe("Ana");
    expect(sections[0][5]).toBe(1050);
    expect(norm(String(sections[0][6]))).toBe(
      "Fatores R$ 500,00 + Comissão R$ 550,00"
    );
    expect(rowsOf(report, "planHeader")).toHaveLength(2);
    const memberTotal = rowOf(report, "memberTotal", "Total — Ana")!;
    expect(memberTotal[5]).toBe(1050);
    expect(memberTotal[6]).toBe(SHEET_MEMBER_TOTAL_NOTE);
  });

  it("detalhe: memória protagonista, Peso omitido quando nenhum fator o usa", () => {
    const report = compSheetReport(inputs(), OPTS);
    // Plano A (só comissão): header sem rótulo "Peso"; Plano B com.
    const headers = rowsOf(report, "detailHeader");
    expect(headers.map((r) => r[4])).toEqual(["", "Peso"]);
    // Fator com peso (money sem moeda estrangeira) = factorMoney com a conta.
    const vendas = rowOf(report, "factorMoney", "Vendas")!;
    expect(vendas[1]).toBe(100000);
    expect(vendas[3]).toBe(50);
    expect(vendas[4]).toBe(100);
    expect(vendas[5]).toBe(500);
    expect(norm(String(vendas[6]))).toContain(
      "R$ 1.000,00 × 100% × 50% = R$ 500,00"
    );
    // Fator peso 0 (não-money) = factor com Peso/Valor vazios. A nota fica em
    // BRANCO: sem valor próprio não há conta a explicar, e a frase se repetia
    // em toda linha de todo colaborador.
    const reunioes = rowOf(report, "factor", "Reuniões")!;
    expect(reunioes[2]).toBe(44);
    expect(reunioes[4]).toBe("");
    // Valor: "—" (e não célula em branco) — vazio lê-se como dado faltando.
    expect(reunioes[5]).toBe("—");
    expect(reunioes[6]).toBe("");
    // Memória do bloco de comissão via commissionMemory.
    const premio = rowOf(report, "commission", "Prêmio por reunião")!;
    expect(premio[5]).toBe(550);
    expect(norm(String(premio[6]))).toContain(
      "44 (Reuniões) × R$ 12,50 = R$ 550,00"
    );
    // Plano A (sem fator com peso nem comissão sobre a base): sem linha de
    // base variável no bloco; o total do bloco fecha em 550.
    // Ana tem um plano só: o fecho da pessoa é quem carrega o total do bloco.
    const totaisPessoa = rowsOf(report, "memberTotal");
    expect(totaisPessoa.some((r) => r[5] === 550)).toBe(true);
    expect(rowOf(report, "info", "Base variável")).toBeTruthy(); // do Plano B
  });

  it("base variável: flat sobre a base NÃO conta; totalFormula com comp:base conta", () => {
    // Comissão flat "sobre a base": o valor da faixa é fixo — a base não
    // participa e a linha é omitida.
    const flatConfig: CompPlanConfig = {
      ...configA,
      commissions: [
        {
          id: "premio",
          label: "Prêmio fixo",
          triggerFactorId: "reunioes",
          basisKind: "base",
          tierBy: "realized",
          kind: "flat",
          tiers: [{ fromPct: 0, amount: 300 }],
        },
      ],
    };
    const flat = compSheetReport(
      [statement({ config: flatConfig, planName: "Plano A", entry: entryA })],
      OPTS
    );
    expect(rowOf(flat, "info", "Base variável")).toBeFalsy();
    // Fórmula livre do total referenciando comp:base: a base participa.
    const formulaConfig: CompPlanConfig = {
      ...configA,
      totalFormula: { tokens: [{ kind: "field", ref: "comp:base" }] },
    };
    const formula = compSheetReport(
      [
        statement({
          config: formulaConfig,
          planName: "Plano A",
          baseAmountDefault: 2000,
          entry: entryA,
        }),
      ],
      OPTS
    );
    const baseRow = rowOf(formula, "info", "Base variável")!;
    expect(baseRow[5]).toBe(2000);
  });

  it("sem lançamento: seção com total vazio + nota no bloco do plano", () => {
    const report = compSheetReport(
      [statement({ config: configB, planName: "Plano B", memberLabel: "Ana" })],
      OPTS
    );
    const section = rowOf(report, "section", "Ana")!;
    expect(section[5]).toBe("");
    expect(section[6]).toBe("");
    expect(rowOf(report, "planHeader", "Plano B")).toBeTruthy();
    expect(rowOf(report, "info", SHEET_NO_ENTRY_NOTE)).toBeTruthy();
    expect(report.kinds).not.toContain("detailHeader");
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

  it("com 2+ planos o blockTotal por plano volta, além do fecho da pessoa", () => {
    const report = compSheetReport(
      [
        statement({ config: configA, planName: "Plano A", entry: entryA }),
        statement({
          config: configB,
          planName: "Plano B",
          baseAmountDefault: 1000,
          entry: entryB,
          targets: { vendas: 100000 },
        }),
      ],
      OPTS
    );
    expect(rowsOf(report, "blockTotal")).toHaveLength(2);
    expect(rowOf(report, "memberTotal", "Total — Ana")![6]).toBe(
      SHEET_MEMBER_TOTAL_NOTE
    );
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
        links: report.links,
      })
    ).toEqual({ ok: true });
  });
});
