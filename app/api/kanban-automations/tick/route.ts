// Versão: 1.1 | Data: 28/07/2026
// "Tick" das AUTOMAÇÕES do kanban, disparado pelo pg_cron a cada minuto
// (supabase/apply/pg-cron-kanban-automations.sql). Protegido por SYNC_SECRET
// (mesmo padrão de /api/sync/tick e /api/webhooks/tick). Dentro de um
// orçamento de ~45s: enumera os quadros com regra habilitada e roda
// runAllKanbanAutomations (round-robin pelos mais antigos — um quadro grande
// nunca esfomeia os demais; sobras ficam p/ o próximo tick). Tick sem regra
// habilitada custa um único SELECT indexado.
// v1.1 (28/07/2026): reconcile da alocação-como-campo (invariante 24) no
//   orçamento RESTANTE — catch-all p/ registros criados no app/CSV/Sheets,
//   edições manuais do campo derivado (revertidas) e colunas excluídas.
//   Ocioso (nenhum quadro com toggle) custa dois SELECTs baratos.
import { NextResponse } from "next/server";

import { syncSecretAuthorized } from "@/lib/auth/sync-secret";
import { createServiceClient } from "@/lib/supabase/service";
import { runAllKanbanAutomations } from "@/lib/kanban/automations/engine";
import { reconcileAllKanbanAllocationFields } from "@/lib/kanban/allocation-reconcile";

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
    const allocation = await reconcileAllKanbanAllocationFields(db, deadline);
    return NextResponse.json({
      ok: true,
      ...counters,
      allocationBoards: allocation.boards,
      allocationUpdated: allocation.updated,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[kanban-automations/tick]", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
