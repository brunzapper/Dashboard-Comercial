// Versão: 1.0 | Data: 27/07/2026
// "Tick" das AUTOMAÇÕES do kanban, disparado pelo pg_cron a cada minuto
// (supabase/apply/pg-cron-kanban-automations.sql). Protegido por SYNC_SECRET
// (mesmo padrão de /api/sync/tick e /api/webhooks/tick). Dentro de um
// orçamento de ~45s: enumera os quadros com regra habilitada e roda
// runAllKanbanAutomations (round-robin pelos mais antigos — um quadro grande
// nunca esfomeia os demais; sobras ficam p/ o próximo tick). Tick sem regra
// habilitada custa um único SELECT indexado.
import { NextResponse } from "next/server";

import { syncSecretAuthorized } from "@/lib/auth/sync-secret";
import { createServiceClient } from "@/lib/supabase/service";
import { runAllKanbanAutomations } from "@/lib/kanban/automations/engine";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const BUDGET_MS = 45_000;

export async function POST(request: Request) {
  try {
    if (!syncSecretAuthorized(request)) {
      return NextResponse.json({ error: "não autorizado" }, { status: 401 });
    }
    const deadline = Date.now() + BUDGET_MS;
    const db = createServiceClient();
    const counters = await runAllKanbanAutomations(db, deadline);
    return NextResponse.json({ ok: true, ...counters });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[kanban-automations/tick]", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
