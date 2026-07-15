// Versão: 1.0 | Data: 15/07/2026
// "Tick" dos snapshots, disparado pelo pg_cron do Supabase a cada 5 minutos
// (supabase/apply/pg-cron-snapshots.sql). Protegido por SYNC_SECRET (mesmo
// padrão de /api/sync/tick). Dentro de um orçamento de ~45s, refresca EM SÉRIE
// os snapshots agendados vencidos (status ativo, modo != manual,
// next_refresh_at <= agora). refreshSnapshot SEMPRE avança next_refresh_at
// (sucesso ou falha) — um snapshot quebrado não vira hot-loop; o erro fica em
// last_refresh_error para a UI de gestão.
import { NextResponse } from "next/server";

import { getSyncSecret } from "@/lib/env";
import { createServiceClient } from "@/lib/supabase/service";
import { refreshSnapshot } from "@/lib/snapshots/refresh";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Abaixo do teto de 60s (Hobby) e do intervalo de 5min do cron.
const BUDGET_MS = 45_000;
// Teto de snapshots por tick (proteção extra além do orçamento de tempo).
const MAX_PER_TICK = 20;

function authorized(request: Request): boolean {
  const secret = getSyncSecret();
  const header =
    request.headers.get("x-sync-secret") ??
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
    null;
  return header !== null && header === secret;
}

export async function POST(request: Request) {
  try {
    if (!authorized(request)) {
      return NextResponse.json({ error: "não autorizado" }, { status: 401 });
    }
    const deadline = Date.now() + BUDGET_MS;
    const db = createServiceClient();

    const { data: due, error } = await db
      .from("snapshots")
      .select("id")
      .eq("status", "active")
      .neq("refresh_mode", "manual")
      .lte("next_refresh_at", new Date().toISOString())
      .order("next_refresh_at", { ascending: true })
      .limit(MAX_PER_TICK);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const results: { id: string; ok: boolean; error?: string }[] = [];
    for (const s of due ?? []) {
      if (Date.now() >= deadline) break;
      const r = await refreshSnapshot(db, s.id as string);
      results.push({ id: s.id as string, ok: r.ok, error: r.error });
    }

    return NextResponse.json({
      due: (due ?? []).length,
      refreshed: results.filter((r) => r.ok).length,
      failed: results.filter((r) => !r.ok).length,
      results,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[snapshots/tick]", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
