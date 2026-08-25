// Versão: 1.6 | Data: 22/08/2026
// v1.6: a linha "Cada X vale R$ Y" saiu do detalhamento (repetia a fórmula do
// bloco de comissão); a coluna "Vale (R$)" por registro segue pinada.
// Versão: 1.5 | Data: 22/08/2026
// v1.5: coluna "Descrição" em bloco fundido, com a composição da linha.
// Versão: 1.4 | Data: 19/08/2026
// v1.4: bloco fundido traz UMA linha por registro (a coluna "Operando" saiu —
// não há origem única) e a escada por atingimento declara a meta, com o
// absoluto de cada faixa.
// Versão: 1.3 | Data: 17/08/2026
// v1.3: bloco fundido herda o rótulo do PRINCIPAL (o genérico "Somados" saiu)
// e a fusão é detectada por `mergedFrom`; subtotal com PARCELAS quando as
// partes dobradas não compartilham unidade.
// Versão: 1.2 | Data: 17/08/2026
// v1.2: memória de cálculo — a conta do payout no cabeçalho, "cada X vale
// R$ Y", a escada de faixas (com as NÃO alcançadas visíveis e a aplicada
// marcada), o bloco de comissão do plano e a coluna de origem do bloco somado.
// Versão: 1.1 | Data: 16/08/2026
// v1.1: o detalhamento é por OPERANDO — os testes cobrem o sub-bloco por
// operando e, principalmente, que fator com 2+ operandos NÃO emite nota de
// divergência (era o alarme falso).
// Testes do builder PURO das abas Det-<Nome> (payload v3 do export p/ Google
// Planilhas): shape do grid (largura fixa, kinds↔rows↔links), blocos por plano
// → fator com o realizado OFICIAL no cabeçalho e a soma listada no subtotal,
// link de volta p/ a aba do mês, avisos/vazio como linha `info` e o pino
// anti-jargão (as abas falam a língua do leitor externo, não a do CSV).
import { describe, expect, it } from "vitest";

import {
  DETAIL_BACK_NOTE,
  DETAIL_DIVERGE_MARK,
  DETAIL_EMPTY_NOTE,
  DETAIL_TIER_APPLIED,
  DETAIL_TIER_MISSED,
  detailRowPartsNote,
  detailSumPartsNote,
  detailTargetNote,
  fmtMoneyBRL,
} from "@/lib/comp/commission-label";
import type {
  CompDetailFactor,
  CompDetailMember,
  CompDetailOperand,
} from "@/lib/comp/detail";
import {
  COMP_SHEET_KINDS,
  validateReportPayload,
} from "@/lib/comp/sheets-export";

import { compDetailSheets } from "./comp-detail-sheet";
import { COMP_SHEET_COLS } from "./comp-sheet";

const OPTS = { monthLabel: "Agosto de 2026", overviewTabName: "Agosto 2026" };

const norm = (s: string) => s.replace(/[  ]/g, " ");

const operando = (
  over: Partial<CompDetailOperand> = {}
): CompDetailOperand => ({
  label: "Soma de Valor",
  valueLabel: "Valor",
  aggNote: "Soma de Valor · 2 registros no recorte",
  listedSum: 300,
  total: 2,
  truncated: false,
  mergedFrom: [],
  sumParts: [],
  warnings: [],
  rows: [
    {
      id: "r1",
      date: "01/08/2026",
      title: "Negócio 1",
      sourceLabel: "Negócios",
      responsibleLabel: "Ana",
      stage: "Ganho",
      value: 100,
      valueText: "R$ 100,00",
      contribution: 12.5,
      parts: [],
    },
    {
      id: "r2",
      date: "02/08/2026",
      title: "Negócio 2",
      sourceLabel: "Negócios",
      responsibleLabel: "Ana",
      stage: "Ganho",
      value: 200,
      valueText: "R$ 200,00",
      contribution: 25,
      parts: [],
    },
  ],
  ...over,
});

const fator = (over: Partial<CompDetailFactor> = {}): CompDetailFactor => ({
  factorId: "f_v",
  label: "Vendas",
  money: true,
  realized: 300,
  payoutFormula: null,
  commissions: [],
  operands: [operando()],
  listedForCompare: 300,
  warnings: [],
  ...over,
});

const membro = (over: Partial<CompDetailMember> = {}): CompDetailMember => ({
  memberId: "m1",
  label: "Ana",
  tabName: "Det-Ana",
  monthTotal: 1050,
  plans: [
    { planId: "p1", planName: "Plano A", factors: [fator()], commissions: [] },
  ],
  ...over,
});

/** Fator com os operandos trocados (o resto igual ao fixture). */
const fatorCom = (
  ops: CompDetailOperand[],
  over: Partial<CompDetailFactor> = {}
): CompDetailFactor => fator({ operands: ops, ...over });

const planoCom = (f: CompDetailFactor) => ({
  planId: "p1",
  planName: "Plano A",
  factors: [f],
  commissions: [],
});

const kindsDe = (
  sheet: ReturnType<typeof compDetailSheets>[number],
  kind: string
) => sheet.rows.filter((_, i) => sheet.kinds[i] === kind);

describe("compDetailSheets", () => {
  it("shape: uma aba por pessoa, largura fixa, kinds e links paralelos", () => {
    const [sheet] = compDetailSheets([membro()], OPTS);
    expect(sheet.tabName).toBe("Det-Ana");
    expect(sheet.headers).toHaveLength(COMP_SHEET_COLS);
    expect(sheet.headers[0]).toBe("Detalhamento — Ana — Agosto de 2026");
    expect(sheet.kinds).toHaveLength(sheet.rows.length);
    expect(sheet.links).toHaveLength(sheet.rows.length);
    for (const r of sheet.rows) expect(r).toHaveLength(COMP_SHEET_COLS);
    for (const k of sheet.kinds) expect(COMP_SHEET_KINDS).toContain(k);
  });

  it("a única linha com link é a volta p/ a aba do mês", () => {
    const [sheet] = compDetailSheets([membro()], OPTS);
    const comLink = sheet.links
      .map((l, i) => (l == null ? null : { kind: sheet.kinds[i], alvo: l }))
      .filter(Boolean);
    expect(comLink).toEqual([{ kind: "detailBack", alvo: "Agosto 2026" }]);
    expect(sheet.rows[0][0]).toBe(DETAIL_BACK_NOTE);
  });

  it("bloco do fator: realizado no cabeçalho, Σ listada no subtotal", () => {
    const [sheet] = compDetailSheets([membro()], OPTS);
    const header = kindsDe(sheet, "detailFactorMoney")[0];
    expect(header[0]).toBe("Vendas");
    expect(header[5]).toBe(300); // realizado OFICIAL, cru
    // A coluna de texto é MEMÓRIA agora: a conta do payout, não prosa.
    expect(header[6]).toBe("");

    const colunas = kindsDe(sheet, "detailHeader")[0];
    expect(colunas).toEqual([
      "Data",
      "Registro",
      "Base",
      "Responsável",
      "Etapa",
      "Valor",
      "Vale (R$)",
    ]);

    const linhas = kindsDe(sheet, "detailRowMoney");
    expect(linhas).toHaveLength(2);
    expect(linhas[1]).toEqual([
      "02/08/2026",
      "Negócio 2",
      "Negócios",
      "Ana",
      "Ganho",
      200,
      25, // quanto ESTE registro vale para a remuneração
    ]);

    const subtotal = kindsDe(sheet, "detailSubtotalMoney")[0];
    // O subtotal fecha o OPERANDO (é dele o recorte), não o fator.
    expect(subtotal[0]).toBe("Subtotal — Soma de Valor");
    // Confronto NUMÉRICO: realizado (E) x somado (F), sem frase.
    expect(subtotal[4]).toBe(300);
    expect(subtotal[5]).toBe(300);
    expect(subtotal[6]).toBe("");
  });

  it("fator não-monetário usa os kinds sem moeda", () => {
    const [sheet] = compDetailSheets(
      [
        membro({
          plans: [
            planoCom(
              fatorCom([operando({ valueLabel: "Registros" })], { money: false })
            ),
          ],
        }),
      ],
      OPTS
    );
    expect(kindsDe(sheet, "detailRow")).toHaveLength(2);
    expect(kindsDe(sheet, "detailRowMoney")).toHaveLength(0);
    expect(kindsDe(sheet, "detailFactor")).toHaveLength(1);
  });

  it("divergência com o realizado vira nota, não um número corrigido", () => {
    const [sheet] = compDetailSheets(
      [
        membro({
          plans: [
            planoCom(
              fatorCom([operando({ listedSum: 300 })], {
                realized: 500,
                listedForCompare: 300,
              })
            ),
          ],
        }),
      ],
      OPTS
    );
    const subtotal = kindsDe(sheet, "detailSubtotalMoney")[0];
    expect(subtotal[5]).toBe(300); // a soma listada segue sendo a soma listada
    expect(subtotal[4]).toBe(500); // e o oficial, o oficial — lado a lado
    expect(kindsDe(sheet, "detailFactorMoney")[0][5]).toBe(500);
    expect(subtotal[6]).toBe(DETAIL_DIVERGE_MARK);
  });

  it("fator com 2+ operandos: um bloco cada e NENHUM alarme de divergência", () => {
    const [sheet] = compDetailSheets(
      [
        membro({
          plans: [
            planoCom(
              fatorCom(
                [
                  operando({ label: "Soma de Valor", listedSum: 300 }),
                  operando({ label: "Soma de MRR", listedSum: 80 }),
                ],
                { realized: 220, listedForCompare: null }
              )
            ),
          ],
        }),
      ],
      OPTS
    );
    // Cabeçalho do fator + um sub-cabeçalho por operando.
    const headers = kindsDe(sheet, "detailFactorMoney");
    expect(headers.map((r) => r[0])).toEqual([
      "Vendas",
      "Soma de Valor",
      "Soma de MRR",
    ]);
    const subtotais = kindsDe(sheet, "detailSubtotalMoney");
    expect(subtotais.map((r) => r[5])).toEqual([300, 80]);
    // Nada de confronto numa combinação: sem realizado ao lado, sem marca.
    for (const st of subtotais) {
      expect(st[4]).toBe("");
      expect(st[6]).toBe("");
    }
  });

  it("memória do fator é a CONTA do payout — sem a linha 'cada X vale'", () => {
    const [sheet] = compDetailSheets(
      [
        membro({
          plans: [
            planoCom(
              fator({
                payoutFormula: "R$ 1.000,00 × 60% × 90% = R$ 540,00",
              })
            ),
          ],
        }),
      ],
      OPTS
    );
    // A coluna de texto do cabeçalho é a CONTA, não prosa explicativa.
    expect(kindsDe(sheet, "detailFactorMoney")[0][6]).toBe(
      "R$ 1.000,00 × 60% × 90% = R$ 540,00"
    );
    // A linha "Cada X vale R$ Y" saiu: a fórmula do bloco de comissão logo
    // abaixo já diz o valor por unidade ("40 × R$ 12,50 = R$ 500,00"), e num
    // fator em dinheiro ela era a própria taxa em outras palavras. Sem
    // comissão neste fator, não sobra linha de memória alguma.
    expect(kindsDe(sheet, "detailMemory")).toEqual([]);
  });

  it("escada: as faixas NÃO alcançadas aparecem, a aplicada vem marcada", () => {
    const comissao = {
      blockId: "premio",
      label: "Prêmio por reunião",
      kind: "per_unit" as const,
      tierBy: "realized" as const,
      triggerMoney: false,
      triggerLabel: "Reuniões",
      triggerTarget: null,
      triggerRealized: 44,
      formula: "44 (Reuniões) × R$ 12,50 = R$ 550,00",
      tierNote: "faixa a partir de 40 (Reuniões: 44)",
      memberTiers: false,
      value: 550,
      tiers: [
        { fromPct: 0, amount: 10, applied: false, reached: true },
        { fromPct: 40, amount: 12.5, applied: true, reached: true },
        { fromPct: 80, amount: 15, applied: false, reached: false },
      ],
    };
    const [sheet] = compDetailSheets(
      [
        membro({
          plans: [
            {
              planId: "p1",
              planName: "Plano A",
              factors: [fator({ commissions: [comissao] })],
              commissions: [comissao],
            },
          ],
        }),
      ],
      OPTS
    );
    // Dentro do fator E como bloco próprio do plano: a escada sai duas vezes.
    const aplicada = kindsDe(sheet, "detailTierApplied");
    const demais = kindsDe(sheet, "detailTier");
    expect(aplicada).toHaveLength(2);
    expect(demais).toHaveLength(4);
    expect(aplicada[0][0]).toBe("A partir de 40");
    expect(norm(String(aplicada[0][5]))).toBe("R$ 12,50");
    expect(aplicada[0][6]).toBe(DETAIL_TIER_APPLIED);
    // A faixa de cima fica VISÍVEL — é ela que explica o valor aplicado.
    const naoAlcancada = demais.find((r) => r[0] === "A partir de 80");
    expect(naoAlcancada?.[6]).toBe(DETAIL_TIER_MISSED);
    // O bloco de comissão do plano leva o valor que soma no total.
    const cabecalhos = kindsDe(sheet, "detailFactorMoney").map((r) => r[0]);
    expect(cabecalhos.filter((l) => l === "Prêmio por reunião")).toHaveLength(2);
  });

  it("escada por ATINGIMENTO declara a meta e o absoluto de cada faixa", () => {
    const comissao = {
      blockId: "meta_reunioes",
      label: "Prêmio por meta de reuniões",
      kind: "flat" as const,
      tierBy: "attainment" as const,
      triggerMoney: false,
      triggerLabel: "Reuniões",
      triggerTarget: 20,
      triggerRealized: 3,
      formula: null,
      tierNote: "nenhuma faixa atingida (gatilho: 15%)",
      memberTiers: false,
      value: 0,
      tiers: [
        { fromPct: 50, amount: 500, applied: false, reached: false },
        { fromPct: 100, amount: 1000, applied: false, reached: false },
      ],
    };
    const [sheet] = compDetailSheets(
      [
        membro({
          plans: [
            {
              planId: "p1",
              planName: "Plano A",
              factors: [fator({ commissions: [comissao] })],
              commissions: [],
            },
          ],
        }),
      ],
      OPTS
    );
    // Sem isto o leitor via "não alcançada" sem saber o alvo.
    const memoria = kindsDe(sheet, "detailMemory").map((r) => norm(String(r[0])));
    expect(memoria).toContain(
      norm(detailTargetNote("Reuniões", 20, 3, false) ?? "")
    );
    // 50% de 20 reuniões = 10.
    const faixas = kindsDe(sheet, "detailTier").map((r) => norm(String(r[0])));
    expect(faixas[0]).toContain("(10)");
    expect(faixas[1]).toContain("(20)");
  });

  it("bloco fundido: rótulo do PRINCIPAL e a 4ª coluna descrevendo a linha", () => {
    const [sheet] = compDetailSheets(
      [
        membro({
          plans: [
            planoCom(
              fatorCom(
                [
                  operando({
                    label: "Soma de Valor",
                    mergedFrom: ["Soma de MRR"],
                    rows: [operando().rows[0]],
                  }),
                ],
                { listedForCompare: null }
              )
            ),
          ],
        }),
      ],
      OPTS
    );
    // A linha fundida é do REGISTRO, então a 4ª coluna descreve a composição
    // em vez de repetir o responsável (que é o dono da aba).
    expect(kindsDe(sheet, "detailHeader")[0][3]).toBe("Descrição");
  });

  it("bloco fundido: a 4ª coluna vira Descrição com a composição da linha", () => {
    const parts = [
      { label: "Implementação", value: 1000 },
      { label: "MRR do contrato", value: 3000 },
    ];
    const [sheet] = compDetailSheets(
      [
        membro({
          plans: [
            planoCom(
              fatorCom(
                [
                  operando({
                    mergedFrom: ["Soma de Implementação"],
                    rows: [{ ...operando().rows[0], value: 4000, parts }],
                  }),
                ],
                { listedForCompare: null }
              )
            ),
          ],
        }),
      ],
      OPTS
    );
    expect(kindsDe(sheet, "detailHeader")[0][3]).toBe("Descrição");
    expect(norm(String(kindsDe(sheet, "detailRowMoney")[0][3]))).toBe(
      norm(detailRowPartsNote(parts, true))
    );
    expect(norm(detailRowPartsNote(parts, true))).toBe(
      `${norm(fmtMoneyBRL(1000))} de Implementação + ${norm(fmtMoneyBRL(3000))} de MRR do contrato`
    );
    // O subtotal fecha com o rótulo do principal, não um genérico.
    expect(kindsDe(sheet, "detailSubtotalMoney")[0][0]).toBe(
      "Subtotal — Soma de Valor"
    );
  });

  it("fusão de unidades diferentes: subtotal traz as PARCELAS, não um total", () => {
    const parts = [
      { label: "Soma de Valor", value: 300, money: true },
      { label: "Contagem de registros", value: 4, money: false },
    ];
    const [sheet] = compDetailSheets(
      [
        membro({
          plans: [
            planoCom(
              fatorCom(
                [
                  operando({
                    mergedFrom: ["Contagem de registros"],
                    listedSum: null,
                    sumParts: parts,
                  }),
                ],
                { listedForCompare: null }
              )
            ),
          ],
        }),
      ],
      OPTS
    );
    const st = kindsDe(sheet, "detailSubtotalMoney")[0];
    expect(st[5]).toBe(""); // sem número único — somar seria mentira
    expect(st[6]).toBe(detailSumPartsNote(parts));
  });

  it("operando sem registros: nota de vazio, sem cabeçalho nem subtotal", () => {
    const [sheet] = compDetailSheets(
      [
        membro({
          plans: [
            planoCom(
              fatorCom([operando({ rows: [], total: 0, listedSum: 0 })], {
                listedForCompare: 0,
              })
            ),
          ],
        }),
      ],
      OPTS
    );
    expect(kindsDe(sheet, "info").map((r) => r[0])).toContain(DETAIL_EMPTY_NOTE);
    expect(sheet.kinds).not.toContain("detailHeader");
    expect(sheet.kinds).not.toContain("detailSubtotalMoney");
  });

  it("avisos do fator viram linhas `info` antes da tabela", () => {
    const [sheet] = compDetailSheets(
      [
        membro({
          plans: [
            planoCom(fator({ warnings: ["Aviso de teste"] })),
          ],
        }),
      ],
      OPTS
    );
    const avisoIdx = sheet.rows.findIndex((r) => r[0] === "Aviso de teste");
    expect(sheet.kinds[avisoIdx]).toBe("info");
    expect(avisoIdx).toBeLessThan(sheet.kinds.indexOf("detailHeader"));
  });

  it("fecha com o total do mês da pessoa", () => {
    const [sheet] = compDetailSheets([membro()], OPTS);
    const total = kindsDe(sheet, "memberTotal")[0];
    expect(total[0]).toBe("Total — Ana");
    expect(total[5]).toBe(1050);
    expect(sheet.kinds[sheet.kinds.length - 1]).toBe("memberTotal");
  });

  it("as abas passam no validador do contrato", () => {
    const details = compDetailSheets([membro(), membro({
      memberId: "m2",
      label: "Bruno",
      tabName: "Det-Bruno",
    })], OPTS);
    expect(
      validateReportPayload({
        title: "Remuneração — Visão geral",
        tabName: "Agosto 2026",
        headers: ["Demonstrativo", "", "", "", "", "", ""],
        rows: [["Ana", "", "", "", "", 1050, ""]],
        kinds: ["section"],
        links: ["Det-Ana"],
        details,
      })
    ).toEqual({ ok: true });
  });

  it("jargão interno do CSV NÃO aparece nas abas de detalhamento", () => {
    const all = JSON.stringify(compDetailSheets([membro()], OPTS));
    expect(all).not.toContain("gatilho/base de comissão");
    expect(all).not.toContain("peso 0%");
    expect(all).not.toContain("não soma no total");
    expect(all).not.toContain("memberField");
  });
});
