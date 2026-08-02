// Versão: 1.0 | Data: 02/08/2026
// Testes puros do export p/ Google Planilhas (lib/comp/sheets-export.ts):
// validação da URL do Web App, id/url de planilha, TTL do ticket (nowMs
// injetado) e caps/shape do payload do relatório.
import { describe, expect, it } from "vitest";

import {
  MAX_PAYLOAD_BYTES,
  MAX_REPORT_ROWS,
  TICKET_TTL_MIN,
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
  };

  it("payload válido passa", () => {
    expect(validateReportPayload(base)).toEqual({ ok: true });
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
      validateReportPayload({ ...base, tabName: "x".repeat(81) }).ok
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
      validateReportPayload({ ...base, rows: rows as (string | number)[][] }).ok
    ).toBe(false);
  });
});
