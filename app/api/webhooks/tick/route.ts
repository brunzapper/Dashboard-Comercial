// Versão: 1.0 | Data: 17/07/2026
// "Tick" dos webhooks de SAÍDA, disparado pelo pg_cron a cada minuto
// (supabase/apply/pg-cron-webhooks.sql). Protegido por SYNC_SECRET (mesmo
// padrão de /api/sync/tick). Dentro de um orçamento de ~45s: drena as entregas
// vencidas (pending + next_attempt_at <= agora + endpoint ativo) com retry/
// backoff, e — se sobrar orçamento — aplica a retenção do outbox e do log de
// entrada. Tick sem nada vencido custa um único SELECT indexado.
import { NextResponse } from "next/server";
import { timingSafeSecretEqual } from "@/lib/auth/secret-compare";

import { getSyncSecret } from "@/lib/env";
import { createServiceClient } from "@/lib/supabase/service";
import { drainDeliveries } from "@/lib/webhooks/deliver";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const BUDGET_MS = 45_000;
// Retenção: entregas 'delivered' > 30d e 'dead' > 90d; eventos órfãos > 90d;
// log de entrada > 30d. Deletes em lotes p/ não estourar o orçamento.
const RETAIN_DELIVERED_DAYS = 30;
const RETAIN_DEAD_DAYS = 90;
const RETAIN_INBOUND_DAYS = 30;
const PURGE_BATCH = 500;

function authorized(request: Request): boolean {
  const secret = getSyncSecret();
  const header =
    request.headers.get("x-sync-secret") ??
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
    null;
  // v20/07/2026: comparação timing-safe (padrão do /api/ingest).
  return timingSafeSecretEqual(header, secret);
}

function daysAgoIso(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

export async function POST(request: Request) {
  try {
    if (!authorized(request)) {
      return NextResponse.json({ error: "não autorizado" }, { status: 401 });
    }
    const deadline = Date.now() + BUDGET_MS;
    const db = createServiceClient();

    const counters = await drainDeliveries(db, deadline);

    let purged = 0;
    if (Date.now() < deadline) {
      // Entregas antigas (delivered/dead) — em lotes.
      for (const [status, days] of [
        ["delivered", RETAIN_DELIVERED_DAYS],
        ["dead", RETAIN_DEAD_DAYS],
      ] as const) {
        if (Date.now() >= deadline) break;
        const { data: old } = await db
          .from("webhook_deliveries")
          .select("id")
          .eq("status", status)
          .lt("created_at", daysAgoIso(days))
          .limit(PURGE_BATCH);
        if (old && old.length > 0) {
          await db
            .from("webhook_deliveries")
            .delete()
            .in(
              "id",
              old.map((r) => r.id as string)
            );
          purged += old.length;
        }
      }
      // Eventos órfãos (sem nenhuma entrega restante) antigos. v20/07/2026:
      // janela alinhada à das entregas expurgadas (RETAIN_DELIVERED_DAYS) —
      // com RETAIN_DEAD_DAYS o órfão sobrevivia 30–90 dias além das entregas.
      if (Date.now() < deadline) {
        const { data: orphans } = await db
          .from("webhook_events")
          .select("id, webhook_deliveries(id)")
          .lt("created_at", daysAgoIso(RETAIN_DELIVERED_DAYS))
          .limit(PURGE_BATCH);
        const orphanIds = (orphans ?? [])
          .filter(
            (e) => ((e.webhook_deliveries as unknown[]) ?? []).length === 0
          )
          .map((e) => e.id as string);
        if (orphanIds.length > 0) {
          await db.from("webhook_events").delete().in("id", orphanIds);
          purged += orphanIds.length;
        }
      }
      // Log de entrada antigo.
      if (Date.now() < deadline) {
        const { data: oldIn } = await db
          .from("webhook_inbound_events")
          .select("id")
          .lt("created_at", daysAgoIso(RETAIN_INBOUND_DAYS))
          .limit(PURGE_BATCH);
        if (oldIn && oldIn.length > 0) {
          await db
            .from("webhook_inbound_events")
            .delete()
            .in(
              "id",
              oldIn.map((r) => r.id as string)
            );
          purged += oldIn.length;
        }
      }
    }

    return NextResponse.json({ ok: true, ...counters, purged });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[webhooks/tick]", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
