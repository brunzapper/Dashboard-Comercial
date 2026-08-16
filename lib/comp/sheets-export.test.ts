// Versão: 1.3 | Data: 16/08/2026
// v1.3: payload v3 — detailTabName (sanitização/truncamento/desempate), kinds
// de detalhe na whitelist e validação de `links`/`details` (coerência com as
// rows, nomes únicos, colisão com a aba do mês e tetos próprios).
// Versão: 1.2 | Data: 02/08/2026
// v1.2: kinds novos do layout por pessoa (planHeader/memberTotal) aceitos.
// v1.1: payload v2 — kinds obrigatório (paralelo às rows, whitelist
// COMP_SHEET_KINDS) no validateReportPayload.
// Testes puros do export p/ Google Planilhas (lib/comp/sheets-export.ts):
// validação da URL do Web App, id/url de planilha, TTL do ticket (nowMs
// injetado) e caps/shape do payload do relatório.
import { describe, expect, it } from "vitest";

import {
  COMP_SHEET_KINDS,
  MAX_DETAIL_ROWS_TOTAL,
  MAX_DETAIL_SHEETS,
  MAX_PAYLOAD_BYTES,
  MAX_REPORT_ROWS,
  MAX_TAB_NAME,
  TICKET_TTL_MIN,
  detailTabName,
  isCompSheetsWebappUrl,
  isSpreadsheetId,
  isSpreadsheetUrl,
  isTicketExpired,
  validateReportPayload,
} from "./sheets-export";

describe("isCompSheetsWebappUrl", () => {
  it("aceita /exec padrão e o deployment de domínio Workspace", () => {
    expect(
      isCompSheetsWebappUrl("https://script.google.com/macros/s/AKfycbx_ab-12/exec")
    ).toBe(true);
    expect(
      isCompSheetsWebappUrl(
        "https://script.google.com/a/macros/empresa.com/s/AKfycbx12/exec"
      )
    ).toBe(true);
  });

  it("rejeita http, host errado, sufixo extra e javascript:", () => {
    expect(
      isCompSheetsWebappUrl("http://script.google.com/macros/s/AKfycbx12/exec")
    ).toBe(false);
    expect(
      isCompSheetsWebappUrl("https://script.evil.com/macros/s/AKfycbx12/exec")
    ).toBe(false);
    expect(
      isCompSheetsWebappUrl(
        "https://script.google.com/macros/s/AKfycbx12/exec?x=1"
      )
    ).toBe(false);
    expect(
      isCompSheetsWebappUrl("https://script.google.com/macros/s/AKfycbx12/dev")
    ).toBe(false);
    expect(isCompSheetsWebappUrl("javascript:alert(1)")).toBe(false);
    expect(isCompSheetsWebappUrl("")).toBe(false);
  });
});

describe("isSpreadsheetId / isSpreadsheetUrl", () => {
  it("id: bounds 10–80, charset base64url", () => {
    expect(isSpreadsheetId("1AbC-dEfG_2345")).toBe(true);
    expect(isSpreadsheetId("curto")).toBe(false);
    expect(isSpreadsheetId("a".repeat(81))).toBe(false);
    expect(isSpreadsheetId("com espaço e mais chars")).toBe(false);
    expect(isSpreadsheetId(123)).toBe(false);
  });

  it("url: exige o prefixo docs.google.com/spreadsheets/", () => {
    expect(
      isSpreadsheetUrl("https://docs.google.com/spreadsheets/d/1AbC/edit")
    ).toBe(true);
    expect(isSpreadsheetUrl("https://docs.google.com/document/d/1AbC")).toBe(
      false
    );
    expect(
      isSpreadsheetUrl(
        "https://docs.google.com/spreadsheets/d/" + "a".repeat(300)
      )
    ).toBe(false);
    expect(isSpreadsheetUrl(null)).toBe(false);
  });
});

describe("isTicketExpired", () => {
  const created = "2026-08-02T10:00:00.000Z";
  const createdMs = Date.parse(created);

  it("fronteira exata dos 15 minutos", () => {
    expect(isTicketExpired(created, createdMs + TICKET_TTL_MIN * 60_000)).toBe(
      false
    );
    expect(
      isTicketExpired(created, createdMs + TICKET_TTL_MIN * 60_000 + 1)
    ).toBe(true);
  });

  it("data inválida expira (fail-closed)", () => {
    expect(isTicketExpired("não-é-data")).toBe(true);
  });
});

describe("validateReportPayload", () => {
  const base = {
    title: "Remuneração — Visão geral",
    tabName: "Agosto 2026",
    headers: ["A", "B"],
    rows: [["x", 1.5]] as (string | number)[][],
    kinds: ["summary"],
  };

  it("payload válido passa", () => {
    expect(validateReportPayload(base)).toEqual({ ok: true });
  });

  it("kinds novos do layout por pessoa passam", () => {
    expect(
      validateReportPayload({
        ...base,
        rows: [
          ["Plano A", ""],
          ["Total — Ana", 550],
        ] as (string | number)[][],
        kinds: ["planHeader", "memberTotal"],
      })
    ).toEqual({ ok: true });
  });

  it("kinds ausente, dessincronizado ou fora da whitelist falha", () => {
    expect(
      validateReportPayload({
        ...base,
        kinds: undefined,
      } as unknown as Parameters<typeof validateReportPayload>[0]).ok
    ).toBe(false);
    expect(validateReportPayload({ ...base, kinds: [] }).ok).toBe(false);
    expect(
      validateReportPayload({ ...base, kinds: ["summary", "blank"] }).ok
    ).toBe(false);
    expect(
      validateReportPayload({ ...base, kinds: ["linhaMagica"] }).ok
    ).toBe(false);
  });

  it("largura divergente falha", () => {
    expect(
      validateReportPayload({ ...base, rows: [["só-uma"]] }).ok
    ).toBe(false);
  });

  it("linhas demais falham", () => {
    const rows = Array.from({ length: MAX_REPORT_ROWS + 1 }, () => ["a", 1]);
    expect(
      validateReportPayload({ ...base, rows: rows as (string | number)[][] }).ok
    ).toBe(false);
  });

  it("célula NaN/Infinity/boolean falha", () => {
    expect(validateReportPayload({ ...base, rows: [["a", NaN]] }).ok).toBe(
      false
    );
    expect(
      validateReportPayload({ ...base, rows: [["a", Infinity]] }).ok
    ).toBe(false);
    expect(
      validateReportPayload({
        ...base,
        rows: [["a", true]] as unknown as (string | number)[][],
      }).ok
    ).toBe(false);
  });

  it("string longa demais / título / aba / headers inválidos falham", () => {
    expect(
      validateReportPayload({ ...base, rows: [["x".repeat(501), 1]] }).ok
    ).toBe(false);
    expect(validateReportPayload({ ...base, title: "" }).ok).toBe(false);
    expect(
      validateReportPayload({ ...base, tabName: "x".repeat(MAX_TAB_NAME + 1) })
        .ok
    ).toBe(false);
    expect(validateReportPayload({ ...base, headers: [] }).ok).toBe(false);
    expect(
      validateReportPayload({
        ...base,
        headers: Array.from({ length: 31 }, (_, i) => `h${i}`),
        rows: [],
      }).ok
    ).toBe(false);
  });

  it("payload acima do teto de bytes falha", () => {
    const big = "y".repeat(500);
    const rows = Array.from({ length: Math.ceil(MAX_PAYLOAD_BYTES / 500) }, () => [
      big,
      1,
    ]);
    expect(
      validateReportPayload({
        ...base,
        rows: rows as (string | number)[][],
        kinds: rows.map(() => "summary"),
      }).ok
    ).toBe(false);
  });
});

describe("detailTabName", () => {
  it("prefixa, higieniza os caracteres proibidos e colapsa espaços", () => {
    const taken = new Set<string>();
    expect(detailTabName("Ana Souza", taken)).toBe("Det-Ana Souza");
    expect(detailTabName("Bruno [SDR] / Vendas", taken)).toBe(
      "Det-Bruno SDR Vendas"
    );
    expect(detailTabName("", taken)).toBe("Det-colaborador");
  });

  it("desempata homônimos e respeita o limite de nome de aba", () => {
    const taken = new Set<string>();
    expect(detailTabName("Ana", taken)).toBe("Det-Ana");
    expect(detailTabName("Ana", taken)).toBe("Det-Ana (2)");
    expect(detailTabName("Ana", taken)).toBe("Det-Ana (3)");
    const longo = detailTabName("x".repeat(200), taken);
    expect(longo).toHaveLength(MAX_TAB_NAME);
    const longo2 = detailTabName("x".repeat(200), taken);
    expect(longo2).toHaveLength(MAX_TAB_NAME);
    expect(longo2).not.toBe(longo);
  });
});

describe("validateReportPayload — links e abas de detalhe (v3)", () => {
  const base = {
    title: "Remuneração — Visão geral",
    tabName: "Agosto 2026",
    headers: ["A", "B"],
    rows: [["x", 1.5]] as (string | number)[][],
    kinds: ["section"],
  };
  const aba = (tabName: string, linhas = 1) => ({
    tabName,
    headers: ["A", "B"],
    rows: Array.from({ length: linhas }, () => ["y", 2]) as (
      | string
      | number
    )[][],
    kinds: Array.from({ length: linhas }, () => "detailRow" as const),
    links: Array.from({ length: linhas }, () => null),
  });

  it("kinds de detalhe estão na whitelist", () => {
    for (const k of [
      "detailBack",
      "detailFactor",
      "detailFactorMoney",
      "detailRow",
      "detailRowMoney",
      "detailSubtotal",
      "detailSubtotalMoney",
    ])
      expect(COMP_SHEET_KINDS).toContain(k);
  });

  it("payload v3 completo passa", () => {
    expect(
      validateReportPayload({
        ...base,
        links: ["Det-Ana"],
        details: [aba("Det-Ana")],
      })
    ).toEqual({ ok: true });
  });

  it("links com comprimento diferente das rows falham", () => {
    expect(
      validateReportPayload({ ...base, links: ["Det-Ana", null] }).ok
    ).toBe(false);
  });

  it("aba de detalhe duplicada ou colidindo com a do mês falha", () => {
    expect(
      validateReportPayload({
        ...base,
        details: [aba("Det-Ana"), aba("Det-Ana")],
      }).ok
    ).toBe(false);
    expect(
      validateReportPayload({ ...base, details: [aba("Agosto 2026")] }).ok
    ).toBe(false);
  });

  it("aba de detalhe malformada falha pelas MESMAS regras da aba do mês", () => {
    const quebrada = { ...aba("Det-Ana"), kinds: ["linhaMagica"] };
    expect(validateReportPayload({ ...base, details: [quebrada] }).ok).toBe(
      false
    );
  });

  it("tetos de abas e de linhas somadas do detalhamento", () => {
    const muitas = Array.from({ length: MAX_DETAIL_SHEETS + 1 }, (_, i) =>
      aba(`Det-${i}`)
    );
    expect(validateReportPayload({ ...base, details: muitas }).ok).toBe(false);
    const gordas = [
      aba("Det-Ana", MAX_DETAIL_ROWS_TOTAL),
      aba("Det-Bruno", 1),
    ];
    expect(validateReportPayload({ ...base, details: gordas }).ok).toBe(false);
  });
});
