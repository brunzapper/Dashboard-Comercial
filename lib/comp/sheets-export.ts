// Versão: 1.3 | Data: 16/08/2026
// v1.3: payload v3 — ABAS DE DETALHAMENTO por colaborador (`details`, uma
// CompSheetPayloadSheet por pessoa, montada em lib/export/comp-detail-sheet.ts
// a partir do núcleo lib/comp/detail.ts) e `links` (paralelo às rows: nome da
// aba alvo do hiperlink da coluna A). O nome da aba sai de `detailTabName` —
// PURO e determinístico, para que o cliente calcule os mesmos nomes que o
// servidor usará (sem round-trip). Kinds novos `detail*`; tetos próprios do
// detalhe. Script v2.1 ignora `links`/`details` (degradação documentada).
// v1.2: demonstrativo por COLABORADOR — kinds novos `planHeader`/`memberTotal`
// na whitelist; `summaryHeader`/`summary` viram RESERVADOS (o builder não os
// emite mais — ficam na whitelist p/ compat de payload antigo em trânsito e
// porque o script formata por lookup, kind não emitido é inofensivo).
// v1.1: payload v2 — o relatório vira DEMONSTRATIVO (resumo + detalhe na aba
// do mês) e cada linha carrega um KIND (`COMP_SHEET_KINDS`, whitelist deste
// módulo — dono do contrato) que o Apps Script usa p/ formatar (moeda, %,
// bold, fundos). O grid nasce em lib/export/comp-sheet.ts; o validador exige
// kinds paralelo às rows. Script v1 ignora kinds (grid cru com título);
// script v2 sem kinds (ticket v1) cai no rendering antigo.
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
// Teto do payload inteiro (aba do mês + abas de detalhe). Subiu na v3 porque o
// detalhamento carrega registros; segue folgado p/ o jsonb do ticket e p/ o
// UrlFetch do Apps Script.
export const MAX_PAYLOAD_BYTES = 1_200_000;
/** Abas de detalhe por export (uma por colaborador). */
export const MAX_DETAIL_SHEETS = 60;
/** Soma das linhas de TODAS as abas de detalhe. */
export const MAX_DETAIL_ROWS_TOTAL = 6000;
/** Limite de nome de aba do Google Planilhas. */
export const MAX_TAB_NAME = 100;
/** Prefixo das abas geradas (o script apaga as órfãs por ele). */
export const DETAIL_TAB_PREFIX = "Det-";

export type CompSheetScope = "visao-geral" | "minha";

/**
 * Kinds de linha do demonstrativo (payload v2) — o Apps Script formata por
 * kind. Whitelist do validador; o builder (lib/export/comp-sheet.ts) importa
 * o tipo daqui. Reservados (não emitidos hoje): "note" (linhas discretas
 * futuras) e "summaryHeader"/"summary" (quadro-resumo do layout antigo,
 * mantidos p/ compat).
 */
export const COMP_SHEET_KINDS = [
  "summaryHeader",
  "summary",
  "summaryTotal",
  "blank",
  "section",
  "planHeader",
  "detailHeader",
  "factor",
  "factorMoney",
  "commission",
  "bonus",
  "info",
  "blockTotal",
  "memberTotal",
  "note",
  // v3 — linhas das abas de detalhamento (Det-<Nome>).
  "detailBack",
  "detailFactor",
  "detailFactorMoney",
  "detailRow",
  "detailRowMoney",
  "detailSubtotal",
  "detailSubtotalMoney",
  // v3.1 — memória de cálculo: linha de explicação e escada de faixas.
  "detailMemory",
  "detailTier",
  "detailTierApplied",
  // v3.4 — contexto no topo (competência, mês apurado, situação, gerado em),
  // resumo da folha p/ o RH e legenda das colunas. São linhas de LEITURA: o
  // demonstrativo por pessoa segue idêntico abaixo delas.
  "meta",
  "rosterHeader",
  "rosterRow",
  "rosterTotal",
  "legendHeader",
  "legend",
] as const;

export type CompSheetRowKind = (typeof COMP_SHEET_KINDS)[number];

/**
 * Uma aba do payload. A aba do mês viaja "solta" (headers/rows/kinds/links no
 * topo do payload, compat v2); as abas de detalhe viajam em `details` neste
 * formato. `links[i]` = nome da aba alvo do hiperlink da coluna A da linha i
 * (o `gid` só existe no Apps Script — a fórmula é montada LÁ).
 */
export interface CompSheetPayloadSheet {
  tabName: string;
  headers: string[];
  rows: (string | number)[][];
  kinds: CompSheetRowKind[];
  links: (string | null)[];
}

/**
 * Nome da aba de detalhe de um colaborador: PURO e determinístico (o cliente
 * calcula os mesmos nomes que o servidor, sem round-trip). Remove os caracteres
 * proibidos em nome de aba, colapsa espaços, trunca no limite do Sheets e
 * desempata homônimos pela ordem de chegada. `taken` é mutado com o resultado.
 */
export function detailTabName(label: string, taken: Set<string>): string {
  const clean = String(label ?? "")
    .replace(/[[\]*/\\?:]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const base = (DETAIL_TAB_PREFIX + (clean || "colaborador")).slice(
    0,
    MAX_TAB_NAME
  );
  let name = base;
  for (let n = 2; taken.has(name); n += 1) {
    const suffix = ` (${n})`;
    name = base.slice(0, MAX_TAB_NAME - suffix.length) + suffix;
  }
  taken.add(name);
  return name;
}

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

type Fail = { ok: false; message: string };

const fail = (message: string): Fail => ({ ok: false, message });

/**
 * Aba como CHEGA ao validador — `kinds` é `string[]` de propósito: quem valida
 * não pode presumir a whitelist que está justamente conferindo (a saída do
 * builder, `CompSheetPayloadSheet`, é atribuível a este shape).
 */
export interface SheetPayloadInput {
  tabName: string;
  headers: string[];
  rows: (string | number)[][];
  kinds: string[];
  links?: (string | null)[] | null;
}

/**
 * Shape de UMA aba: nome, cabeçalhos, largura das linhas (pinada pelos
 * headers), células, kinds paralelos e links paralelos. Compartilhado pela aba
 * do mês e por cada aba de detalhe — nunca duplique estas regras.
 */
function validateSheet(input: SheetPayloadInput): { ok: true } | Fail {
  if (
    typeof input.tabName !== "string" ||
    input.tabName.length < 1 ||
    input.tabName.length > MAX_TAB_NAME
  )
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
  if (
    !Array.isArray(input.kinds) ||
    input.kinds.length !== input.rows.length ||
    input.kinds.some(
      (k) => !COMP_SHEET_KINDS.includes(k as CompSheetRowKind)
    )
  )
    return fail("Linhas do relatório inválidas.");
  if (input.links != null) {
    if (!Array.isArray(input.links) || input.links.length !== input.rows.length)
      return fail("Links do relatório inválidos.");
    if (
      input.links.some(
        (l) => l !== null && (typeof l !== "string" || l.length > MAX_TAB_NAME)
      )
    )
      return fail("Links do relatório inválidos.");
  }
  return { ok: true };
}

/** Caps + shape do payload: aba do mês (+ links) e abas de detalhe. */
export function validateReportPayload(input: {
  title: string;
  tabName: string;
  headers: string[];
  rows: (string | number)[][];
  kinds: string[];
  links?: (string | null)[] | null;
  details?: SheetPayloadInput[] | null;
}): { ok: true } | Fail {
  if (typeof input.title !== "string" || input.title.length < 1 || input.title.length > 120)
    return fail("Título da planilha inválido.");
  const main = validateSheet(input);
  if (!main.ok) return main;
  if (input.details != null) {
    if (!Array.isArray(input.details) || input.details.length > MAX_DETAIL_SHEETS)
      return fail("Abas de detalhamento demais para exportar de uma vez.");
    let detailRows = 0;
    const seen = new Set<string>();
    for (const sheet of input.details) {
      if (!sheet || typeof sheet !== "object")
        return fail("Aba de detalhamento inválida.");
      const res = validateSheet(sheet);
      if (!res.ok) return res;
      if (seen.has(sheet.tabName))
        return fail("Duas abas de detalhamento com o mesmo nome.");
      seen.add(sheet.tabName);
      if (sheet.tabName === input.tabName)
        return fail("Aba de detalhamento colide com a aba do mês.");
      detailRows += sheet.rows.length;
    }
    if (detailRows > MAX_DETAIL_ROWS_TOTAL)
      return fail("Detalhamento grande demais para exportar de uma vez.");
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
