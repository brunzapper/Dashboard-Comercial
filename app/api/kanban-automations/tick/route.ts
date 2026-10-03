// Versão: 1.3 | Data: 03/10/2026
// v1.3 (03/10/2026): PORTÃO DE MUDANÇA (0151, lib/ticks/gate.ts). Antes de
//   carregar qualquer coisa, UMA RPC diz se algum dado lido pela rodada mudou
//   ou se o dia de Brasília virou (toda condição de automação/série/ritual é
//   por DIA). Nada mudou ⇒ responde `skipped` com 1 requisição (eram ~60 por
//   minuto, 24h por dia — o grosso do log ingestion do Supabase). Rodada
//   COMPLETA grava a seq lida no início; incompleta (deadline, teto de ações,
//   erro) não grava e o minuto seguinte roda de novo, como sempre foi.
//   "Executar agora" e o hook pós-sync seguem SEM portão.
// v1.2 (01/10/2026): RITUAIS automáticos da Tree (0149, `runTreeRituals`) no
//   orçamento restante — a próxima ocorrência de cada ritual com `auto` vira
//   tarefa (trava por ocorrência; 23505 = no-op).
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
import { runTreeRituals } from "@/lib/rituals/run";
import {
  beginTickGate,
  commitTickGate,
  TICK_GATE_KEYS,
} from "@/lib/ticks/gate";

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
    // v1.3: nada mudou desde a última rodada completa ⇒ nada a fazer.
    const gate = await beginTickGate(db, TICK_GATE_KEYS.kanbanAutomations);
    if (!gate.run) return NextResponse.json({ ok: true, skipped: true });

    const counters = await runAllKanbanAutomations(db, deadline);
    const allocation = await reconcileAllKanbanAllocationFields(db, deadline);
    // v1.2: rituais automáticos (best-effort — nunca derruba o tick).
    const rituals = await runTreeRituals(db, deadline).catch((e) => {
      console.error("[kanban-automations/tick] rituais:", e);
      return { rituals: 0, created: 0, skipped: 0, complete: false };
    });
    const complete =
      counters.complete && allocation.complete && rituals.complete;
    if (complete) await commitTickGate(db, gate);
    return NextResponse.json({
      ok: true,
      ...counters,
      complete,
      allocationBoards: allocation.boards,
      allocationUpdated: allocation.updated,
      ritualsChecked: rituals.rituals,
      ritualTasksCreated: rituals.created,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[kanban-automations/tick]", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
