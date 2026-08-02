// Versão: 1.0 | Data: 02/08/2026
// Handshake do export p/ Google Planilhas (0115) — chamado PELO Apps Script
// (UrlFetchApp, servidores do Google; sem sessão). Segurança: token single-use
// de 256 bits (só o sha256 persiste — lib/snapshots/token.ts), pre-gate de
// shape sem tocar o banco, compare constante (padrão da rota de ingest), TTL
// de 15 min e 404 UNIFORME p/ todo caminho de falha (anti-enumeração, doutrina
// do viewer de snapshots). GET CONSOME o ticket (à prova de corrida) e devolve
// o payload congelado; POST (só após o GET, uma única vez) grava o vínculo
// usuário×escopo→planilha em comp_sheet_links com org/user/escopo tirados DA
// LINHA DO TICKET — nunca do corpo. Service role SEMPRE escopado pela linha;
// NUNCA policy anon.
import { timingSafeEqual } from "node:crypto";

import { NextResponse } from "next/server";

import {
  isSpreadsheetId,
  isSpreadsheetUrl,
  isTicketExpired,
} from "@/lib/comp/sheets-export";
import { hashToken, isTokenShaped } from "@/lib/snapshots/token";
import { createServiceClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 10_000;

// 404 UNIFORME p/ tudo (shape inválido, inexistente, expirado, já consumido,
// fora de ordem) — quem não tem um token válido não aprende nada.
function notFoundRes() {
  return NextResponse.json({ error: "não encontrado" }, { status: 404 });
}

interface TicketRow {
  id: string;
  organization_id: string;
  user_id: string;
  scope_key: string;
  payload: Record<string, unknown>;
  created_at: string;
  consumed_at: string | null;
  completed_at: string | null;
  token_hash: string;
}

async function loadTicket(token: string) {
  if (!isTokenShaped(token)) return null; // pré-gate sem tocar o banco
  const db = createServiceClient();
  const computed = hashToken(token);
  const { data } = await db
    .from("comp_sheet_export_tickets")
    .select(
      "id, organization_id, user_id, scope_key, payload, created_at, consumed_at, completed_at, token_hash"
    )
    .eq("token_hash", computed)
    .maybeSingle();
  const row = data as TicketRow | null;
  if (
    !row ||
    row.token_hash.length !== computed.length ||
    !timingSafeEqual(Buffer.from(row.token_hash), Buffer.from(computed))
  )
    return null;
  if (isTicketExpired(row.created_at)) return null; // TTL 15 min
  return { db, row };
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  const t = await loadTicket(token);
  if (!t || t.row.consumed_at !== null) return notFoundRes(); // single-use
  // Consumo à prova de corrida (duas abas com o mesmo token): o UPDATE
  // condicional garante UM vencedor; o perdedor cai no 404 uniforme.
  const { data: claimed } = await t.db
    .from("comp_sheet_export_tickets")
    .update({ consumed_at: new Date().toISOString() })
    .eq("id", t.row.id)
    .is("consumed_at", null)
    .select("id");
  if (!claimed || claimed.length === 0) return notFoundRes();
  const p = t.row.payload as {
    spreadsheetTitle?: unknown;
    tabName?: unknown;
    headers?: unknown;
    rows?: unknown;
    kinds?: unknown;
    knownSpreadsheetId?: unknown;
  };
  return NextResponse.json({
    spreadsheetTitle: p.spreadsheetTitle,
    tabName: p.tabName,
    headers: p.headers,
    rows: p.rows,
    // v2: kinds por linha (demonstrativo). Ticket v1 em trânsito → null e o
    // script novo cai no rendering simples.
    kinds: p.kinds ?? null,
    knownSpreadsheetId: p.knownSpreadsheetId ?? null,
  });
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  const t = await loadTicket(token);
  // Ordem do handshake: só depois do GET (consumed) e uma única vez
  // (completed) — replay do POST não regrava o vínculo.
  if (!t || t.row.consumed_at === null || t.row.completed_at !== null)
    return notFoundRes();
  const text = await req.text();
  if (text.length > MAX_BODY_BYTES) return notFoundRes();
  let body: { spreadsheetId?: unknown; spreadsheetUrl?: unknown };
  try {
    body = JSON.parse(text) as typeof body;
  } catch {
    return notFoundRes();
  }
  if (!isSpreadsheetId(body.spreadsheetId) || !isSpreadsheetUrl(body.spreadsheetUrl))
    return notFoundRes();
  // Vínculo durável: org/user/escopo DA LINHA DO TICKET (nunca do corpo).
  const { error } = await t.db.from("comp_sheet_links").upsert(
    {
      organization_id: t.row.organization_id,
      user_id: t.row.user_id,
      scope_key: t.row.scope_key,
      spreadsheet_id: body.spreadsheetId,
      spreadsheet_url: body.spreadsheetUrl,
    },
    { onConflict: "organization_id,user_id,scope_key" }
  );
  if (error) return NextResponse.json({ ok: false }, { status: 500 });
  await t.db
    .from("comp_sheet_export_tickets")
    .update({ completed_at: new Date().toISOString() })
    .eq("id", t.row.id);
  return NextResponse.json({ ok: true });
}
