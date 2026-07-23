// Versão: 1.0 | Data: 05/07/2026
// Recebe o push horário do Apps Script (planilha "Estudo de Fechamentos",
// aba Site) e sincroniza para `records`. Protegido por SYNC_SECRET — mesmo
// padrão dos endpoints do Bitrix. Fonte PUSH: não há botão manual na UI.
import { NextResponse } from "next/server";

import { syncSecretAuthorized } from "@/lib/auth/sync-secret";
import { createServiceClient } from "@/lib/supabase/service";
import { syncEstudoFechamentosRows, type SheetSiteRow } from "@/lib/sync/sheets/adapter";
import { runAutoMatch } from "@/lib/records/matching-engine";
import { recalcAllFormulaFields } from "@/lib/records/recalc";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// SYNC_SECRET com comparação constant-time — ver lib/auth/sync-secret.ts.
const authorized = syncSecretAuthorized;

interface Payload {
  source?: string;
  rows?: unknown[];
}

function toNumber(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isNaN(n) ? null : n;
}

function toStr(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

function parseRow(raw: unknown): SheetSiteRow | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const name = toStr(r.name);
  const createdAt = toStr(r.created_at);
  if (!name || !createdAt) return null;

  return {
    name,
    created_at: createdAt,
    email: toStr(r.email),
    consultor: toStr(r.consultor),
    products: toStr(r.products),
    mrr: toNumber(r.mrr),
    plan: toStr(r.plan),
    seats: toNumber(r.seats),
    contract: toNumber(r.contract),
    etapa_crm: toStr(r.etapa_crm),
    canal: toStr(r.canal),
    campanha: toStr(r.campanha),
    lead_created_at: toStr(r.lead_created_at),
    lead_time_days: toNumber(r.lead_time_days),
  };
}

export async function POST(request: Request) {
  try {
    if (!authorized(request)) {
      return NextResponse.json({ error: "não autorizado" }, { status: 401 });
    }

    const payload = (await request.json()) as Payload;
    if (payload.source !== "estudo_fechamentos_site" || !Array.isArray(payload.rows)) {
      return NextResponse.json({ error: "payload inválido" }, { status: 400 });
    }

    const rows = payload.rows.map(parseRow).filter((r): r is SheetSiteRow => r !== null);

    const db = createServiceClient();
    const result = await syncEstudoFechamentosRows(db, rows);
    // Após importar as vendas do site: casa com os leads (auto-match) e refaz o
    // lead time + campos com match:<fonte> (best-effort — não falha o push).
    try {
      await runAutoMatch(db);
      await recalcAllFormulaFields();
    } catch {
      /* ignora: a sincronização das linhas já foi persistida. */
    }
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: (error as Error).message },
      { status: 500 }
    );
  }
}
