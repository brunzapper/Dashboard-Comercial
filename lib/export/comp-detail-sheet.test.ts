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
  DETAIL_COMBINED_NOTE,
  DETAIL_EMPTY_NOTE,
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
    },
  ],
  ...over,
});

const fator = (over: Partial<CompDetailFactor> = {}): CompDetailFactor => ({
  factorId: "f_v",
  label: "Vendas",
  money: true,
  realized: 300,
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
  plans: [{ planId: "p1", planName: "Plano A", factors: [fator()] }],
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
    expect(header[6]).toContain("Soma de Valor");

    const colunas = kindsDe(sheet, "detailHeader")[0];
    expect(colunas).toEqual([
      "Data",
      "Registro",
      "Base",
      "Responsável",
      "Etapa",
      "Valor",
      "Observações",
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
      "",
    ]);

    const subtotal = kindsDe(sheet, "detailSubtotalMoney")[0];
    // O subtotal fecha o OPERANDO (é dele o recorte), não o fator.
    expect(subtotal[0]).toBe("Subtotal — Soma de Valor");
    expect(subtotal[5]).toBe(300);
    expect(norm(String(subtotal[6]))).toContain("Confere com o realizado");
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
    expect(kindsDe(sheet, "detailFactorMoney")[0][5]).toBe(500); // e o oficial, o oficial
    expect(norm(String(subtotal[6]))).toContain("Difere do realizado");
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
    expect(norm(String(headers[0][6]))).toBe(norm(DETAIL_COMBINED_NOTE));
    const subtotais = kindsDe(sheet, "detailSubtotalMoney");
    expect(subtotais.map((r) => r[5])).toEqual([300, 80]);
    // O ponto da correção: nada de "difere do realizado" numa combinação.
    for (const st of subtotais) expect(st[6]).toBe("");
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
            {
              planId: "p1",
              planName: "Plano A",
              factors: [fator({ warnings: ["Aviso de teste"] })],
            },
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
