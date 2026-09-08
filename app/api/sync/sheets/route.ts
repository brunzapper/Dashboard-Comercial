// Versão: 1.1 | Data: 03/08/2026
// Recebe o push horário do Apps Script (planilha "Estudo de Fechamentos",
// aba Site) e sincroniza para `records`. Protegido por SYNC_SECRET — mesmo
// padrão dos endpoints do Bitrix. Fonte PUSH: não há botão manual na UI.
// v1.1 (03/08/2026): cauda global (runAutoMatch + recalcAllFormulaFields —
// O(N) na tabela inteira) trocada pela incremental de lib/sync/post-ingest
// (escopo venda_site, com orçamento de tempo) + guardas de tamanho: a soma
// loop-por-linha + cauda global estourava o teto de 60s do plano da Vercel
// (FUNCTION_INVOCATION_TIMEOUT) em todo push com a planilha inteira.
import { NextResponse } from "next/server";

import { syncSecretAuthorized } from "@/lib/auth/sync-secret";
import { createServiceClient } from "@/lib/supabase/service";
import { syncEstudoFechamentosRows, type SheetSiteRow } from "@/lib/sync/sheets/adapter";
import { runIncrementalPostSync } from "@/lib/sync/post-ingest";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Guardas de tamanho: generosas de PROPÓSITO — o script legado (pré-v1.1)
// reenvia a planilha INTEIRA a cada hora e precisa continuar aceito; a guarda
// só troca o estouro silencioso de 60s por um erro rápido e claro. O script
// v1.1 (integrations/apps-script) fatia em chunks de ≤500 linhas.
const MAX_ROWS = 20_000;
const MAX_BODY_BYTES = 4_000_000;

// Orçamento da cauda best-effort (auto-match incremental + recalc dirigido):
// além de engolir erro, ela é PULADA quando o push já consumiu o tempo —
// duração era o modo de falha da rota, não só exceção.
const TAIL_BUDGET_MS = 40_000;

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

    const raw = await request.text();
    if (Buffer.byteLength(raw, "utf8") > MAX_BODY_BYTES) {
      return NextResponse.json(
        { error: `payload acima de ${MAX_BODY_BYTES} bytes — envie em chunks` },
        { status: 413 }
      );
    }
    const payload = JSON.parse(raw) as Payload;
    if (payload.source !== "estudo_fechamentos_site" || !Array.isArray(payload.rows)) {
      return NextResponse.json({ error: "payload inválido" }, { status: 400 });
    }
    if (payload.rows.length > MAX_ROWS) {
      return NextResponse.json(
        { error: `máximo de ${MAX_ROWS} linhas por push — envie em chunks` },
        { status: 413 }
      );
    }

    const rows = payload.rows.map(parseRow).filter((r): r is SheetSiteRow => r !== null);

    const db = createServiceClient();
    const startedAt = new Date().toISOString();
    const t0 = Date.now();
    const { result, touchedRecordIds } = await syncEstudoFechamentosRows(db, rows);
    // Após importar as vendas do site: casa com os leads (auto-match) e refaz
    // o lead time + campos com match:<fonte> — INCREMENTAL, só quando este
    // push escreveu algo (best-effort — não falha o push).
    try {
      if (result.inserted + result.updated > 0) {
        await runIncrementalPostSync(db, {
          recordTypes: ["venda_site"],
          since: startedAt,
          touchedIds: touchedRecordIds,
          budgetUntil: t0 + TAIL_BUDGET_MS,
        });
      }
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
