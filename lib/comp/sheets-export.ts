// Versão: 1.0 | Data: 02/08/2026
// Export da Remuneração p/ Google Planilhas (0115) — constantes, validações
// PURAS e o loader da config. O fluxo: a action cria um TICKET single-use
// (token de lib/snapshots/token.ts) com o payload do relatório; o Web App do
// Apps Script (integrations/apps-script/comp_sheets_webapp.gs, rodando como o
// usuário Google que clicou) busca o payload em /api/sheets-export/<token>,
// grava a planilha no Drive DELE e devolve id/url. A URL do Web App é config
// POR ORG em sync_config (chave abaixo — padrão MIRROR_CONFIG_KEY de
// lib/comp/mirror.ts), editável na UI da Remuneração (admin). Validações
// vivem aqui (puras, testáveis sem banco) e são usadas pela action E pela
// rota — nunca duplicar regex/caps nos call sites.
import type { SupabaseClient } from "@supabase/supabase-js";

/** Chave em sync_config (PK organization_id,key): { url: string }. */
export const COMP_SHEETS_CONFIG_KEY = "comp_sheets_webapp";

export const TICKET_TTL_MIN = 15;
export const MAX_REPORT_ROWS = 5000;
export const MAX_PAYLOAD_BYTES = 256_000;

export type CompSheetScope = "visao-geral" | "minha";

/** Título da planilha criada no Drive do usuário (uma por escopo). */
export const SHEET_TITLES: Record<CompSheetScope, string> = {
  "visao-geral": "Remuneração — Visão geral",
  minha: "Minha remuneração",
};

// URL /exec de Web App do Apps Script — aceita o deployment padrão
// (/macros/s/<id>/exec) e o de domínio Workspace (/a/macros/<dominio>/s/...).
const WEBAPP_URL_RE =
  /^https:\/\/script\.google\.com\/(a\/macros\/[^/]+\/|macros\/)s\/[A-Za-z0-9_-]+\/exec$/;

export function isCompSheetsWebappUrl(url: string): boolean {
  return WEBAPP_URL_RE.test(url);
}

/** Id de planilha Google (validação do POST da rota). */
export function isSpreadsheetId(s: unknown): s is string {
  return typeof s === "string" && /^[A-Za-z0-9_-]{10,80}$/.test(s);
}

export function isSpreadsheetUrl(s: unknown): s is string {
  return (
    typeof s === "string" &&
    s.length <= 300 &&
    s.startsWith("https://docs.google.com/spreadsheets/")
  );
}

/** TTL do ticket (puro — nowMs injetável p/ teste). */
export function isTicketExpired(createdAtIso: string, nowMs?: number): boolean {
  const created = Date.parse(createdAtIso);
  if (!Number.isFinite(created)) return true; // fail-closed
  return (nowMs ?? Date.now()) - created > TICKET_TTL_MIN * 60_000;
}

/** Caps + shape do relatório (headers × largura das linhas × células). */
export function validateReportPayload(input: {
  title: string;
  tabName: string;
  headers: string[];
  rows: (string | number)[][];
}): { ok: true } | { ok: false; message: string } {
  const fail = (message: string) => ({ ok: false as const, message });
  if (typeof input.title !== "string" || input.title.length < 1 || input.title.length > 120)
    return fail("Título da planilha inválido.");
  if (typeof input.tabName !== "string" || input.tabName.length < 1 || input.tabName.length > 80)
    return fail("Nome da aba inválido.");
  if (!Array.isArray(input.headers) || input.headers.length < 1 || input.headers.length > 30)
    return fail("Cabeçalhos do relatório inválidos.");
  if (input.headers.some((h) => typeof h !== "string" || h.length > 200))
    return fail("Cabeçalhos do relatório inválidos.");
  if (!Array.isArray(input.rows)) return fail("Linhas do relatório inválidas.");
  if (input.rows.length > MAX_REPORT_ROWS)
    return fail("Relatório grande demais para exportar de uma vez.");
  for (const row of input.rows) {
    if (!Array.isArray(row) || row.length !== input.headers.length)
      return fail("Linhas do relatório inválidas.");
    for (const cell of row) {
      const okCell =
        (typeof cell === "string" && cell.length <= 500) ||
        (typeof cell === "number" && Number.isFinite(cell));
      if (!okCell) return fail("Linhas do relatório inválidas.");
    }
  }
  if (JSON.stringify(input).length > MAX_PAYLOAD_BYTES)
    return fail("Relatório grande demais para exportar de uma vez.");
  return { ok: true };
}

/**
 * Lê sync_config 'comp_sheets_webapp' e valida a URL na LEITURA (fail-closed:
 * valor velho/corrompido vira "não configurado", nunca um redirect estranho).
 */
export async function loadCompSheetsWebappUrl(
  supabase: SupabaseClient,
  orgId: string | null
): Promise<string | null> {
  let query = supabase
    .from("sync_config")
    .select("value")
    .eq("key", COMP_SHEETS_CONFIG_KEY);
  if (orgId) query = query.eq("organization_id", orgId);
  const { data } = await query.maybeSingle();
  const url =
    data?.value && typeof data.value === "object"
      ? String((data.value as { url?: unknown }).url ?? "")
      : "";
  return isCompSheetsWebappUrl(url) ? url : null;
}
