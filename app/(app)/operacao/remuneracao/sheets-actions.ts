// Versão: 1.1 | Data: 05/08/2026 (v1.1: rota movida p/ /operacao/remuneracao
// — revalidatePath atualizado; gates/chave de área "remuneracao" intocados.)
// Versão: 1.0 | Data: 02/08/2026
// Actions do export p/ Google Planilhas (0115) — separadas de actions.ts
// (884 linhas; este fluxo puxa imports próprios: token + service client).
// createSheetExportTicket cria o TICKET single-use do handshake com o Web App
// do Apps Script: valida sessão/área/escopo + caps do payload
// (lib/comp/sheets-export.ts), lê o spreadsheet_id conhecido com o client do
// USUÁRIO (RLS linha-própria de comp_sheet_links) e INSERE o ticket via
// service role com carimbo EXPLÍCITO de org (tabela sem policies — padrão
// api_keys; a RLS não expressa os gates daqui). O payload nasce no CLIENTE
// (o usuário só exporta o que a tela dele já renderiza; destino é o Drive
// DELE — tradeoff documentado em docs/arquitetura.md §4.18). O token em claro
// sai UMA vez na resposta e vive só na URL da aba nova (single-use, TTL 15
// min, sha256 at rest). saveCompSheetsWebappUrl grava a config POR ORG em
// sync_config (client do usuário — a policy admin é a muralha).
"use server";

import { revalidatePath } from "next/cache";

import { isSettingsAreaDenied } from "@/lib/auth/access";
import { getActiveOrgId } from "@/lib/auth/org";
import { getSessionInfo } from "@/lib/auth/session";
import {
  COMP_SHEETS_CONFIG_KEY,
  isCompSheetsWebappUrl,
  loadCompSheetsWebappUrl,
  validateReportPayload,
  type CompSheetScope,
} from "@/lib/comp/sheets-export";
import { generateToken, hashToken } from "@/lib/snapshots/token";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";

export interface SheetTicketInput {
  scope: CompSheetScope;
  year: number;
  month: number;
  title: string;
  tabName: string;
  headers: string[];
  rows: (string | number)[][];
  // Payload v2: kind por linha (paralelo a rows) — o Apps Script formata o
  // demonstrativo por kind; whitelist validada em validateReportPayload.
  kinds: string[];
}

export interface SheetTicketResult {
  ok: boolean;
  message?: string;
  token?: string; // claro — vai SÓ na URL da aba nova, nunca persistido
  webappUrl?: string; // fonte única no momento do clique
}

export async function createSheetExportTicket(
  input: SheetTicketInput
): Promise<SheetTicketResult> {
  const session = await getSessionInfo();
  if (!session) return { ok: false, message: "Sessão expirada." };
  if (await isSettingsAreaDenied("remuneracao"))
    return { ok: false, message: "Acesso a esta área foi bloqueado." };
  if (input.scope !== "visao-geral" && input.scope !== "minha")
    return { ok: false, message: "Escopo inválido." };
  if (input.scope === "visao-geral" && !session.roles.includes("admin"))
    return { ok: false, message: "Apenas administradores." };
  if (
    !Number.isInteger(input.year) ||
    input.year < 2000 ||
    input.year > 2100 ||
    !Number.isInteger(input.month) ||
    input.month < 1 ||
    input.month > 12
  )
    return { ok: false, message: "Período inválido." };
  const payloadCheck = validateReportPayload({
    title: input.title,
    tabName: input.tabName,
    headers: input.headers,
    rows: input.rows,
    kinds: input.kinds,
  });
  if (!payloadCheck.ok) return { ok: false, message: payloadCheck.message };

  const supabase = await createClient();
  const orgId = await getActiveOrgId();
  const webappUrl = await loadCompSheetsWebappUrl(supabase, orgId);
  if (!webappUrl)
    return {
      ok: false,
      message:
        "Exportação para Google Planilhas não configurada. Peça a um administrador para configurar a URL do Web App em Remuneração → Google Planilhas.",
    };

  // Planilha já conhecida deste usuário×escopo (client do usuário — a RLS
  // linha-própria recorta; org explícita p/ usuário multi-org).
  let linkQuery = supabase
    .from("comp_sheet_links")
    .select("spreadsheet_id")
    .eq("scope_key", input.scope);
  if (orgId) linkQuery = linkQuery.eq("organization_id", orgId);
  const { data: link } = await linkQuery.maybeSingle();
  const knownSpreadsheetId =
    (link as { spreadsheet_id?: string } | null)?.spreadsheet_id ?? null;

  const token = generateToken();
  const db = createServiceClient();
  // Carimbo de org (multi-org, 0090): insert via service role bypassa a RLS —
  // sem o carimbo, o ticket de uma org nova nasceria na Zapper.
  const { error } = await db.from("comp_sheet_export_tickets").insert({
    ...(orgId ? { organization_id: orgId } : {}),
    user_id: session.user.id,
    scope_key: input.scope,
    period_year: input.year,
    period_month: input.month,
    token_hash: hashToken(token),
    payload: {
      v: 2,
      spreadsheetTitle: input.title,
      tabName: input.tabName,
      headers: input.headers,
      rows: input.rows,
      kinds: input.kinds,
      knownSpreadsheetId,
    },
  });
  if (error) return { ok: false, message: "Não foi possível criar o export." };

  // Limpeza oportunista de tickets velhos do usuário (best-effort).
  void db
    .from("comp_sheet_export_tickets")
    .delete()
    .eq("user_id", session.user.id)
    .lt("created_at", new Date(Date.now() - 24 * 3600e3).toISOString())
    .then(() => undefined);

  return { ok: true, token, webappUrl };
}

/** Grava/limpa a URL do Web App (sync_config, por org) — admin. */
export async function saveCompSheetsWebappUrl(
  url: string
): Promise<{ ok: boolean; message?: string }> {
  const session = await getSessionInfo();
  if (!session) return { ok: false, message: "Sessão expirada." };
  if (!session.roles.includes("admin"))
    return { ok: false, message: "Apenas administradores." };
  if (await isSettingsAreaDenied("remuneracao"))
    return { ok: false, message: "Acesso a esta área foi bloqueado." };

  const supabase = await createClient();
  const orgId = await getActiveOrgId();
  const trimmed = url.trim();
  if (trimmed === "") {
    let del = supabase
      .from("sync_config")
      .delete()
      .eq("key", COMP_SHEETS_CONFIG_KEY);
    if (orgId) del = del.eq("organization_id", orgId);
    const { error } = await del;
    if (error)
      return { ok: false, message: "Não foi possível salvar a configuração." };
  } else {
    if (!isCompSheetsWebappUrl(trimmed))
      return {
        ok: false,
        message:
          "URL inválida — cole a URL /exec do Web App (https://script.google.com/macros/...).",
      };
    const { error } = await supabase.from("sync_config").upsert(
      {
        key: COMP_SHEETS_CONFIG_KEY,
        value: { url: trimmed },
        ...(orgId ? { organization_id: orgId } : {}),
      },
      { onConflict: "organization_id,key" }
    );
    if (error)
      return { ok: false, message: "Não foi possível salvar a configuração." };
  }
  revalidatePath("/operacao/remuneracao");
  return { ok: true };
}
