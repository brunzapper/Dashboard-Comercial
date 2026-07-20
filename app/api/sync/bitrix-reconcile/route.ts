// Versão: 1.0 | Data: 05/07/2026
// Reconciliação do Bitrix (refaz a busca por DATE_MODIFY >= agora - N dias).
// Protegido por SYNC_SECRET. Mantido para disparo externo/cron futuro; a UI
// usa uma Server Action guardada por admin (não expõe o segredo ao browser).
import { NextResponse } from "next/server";
import { timingSafeSecretEqual } from "@/lib/auth/secret-compare";

import { getSyncSecret } from "@/lib/env";
import { bitrixAdapter } from "@/lib/sync/bitrix/adapter";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

function authorized(request: Request): boolean {
  const secret = getSyncSecret();
  const header =
    request.headers.get("x-sync-secret") ??
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
    null;
  // v20/07/2026: comparação timing-safe (padrão do /api/ingest).
  return timingSafeSecretEqual(header, secret);
}

export async function POST(request: Request) {
  try {
    if (!authorized(request)) {
      return NextResponse.json({ error: "não autorizado" }, { status: 401 });
    }
    const { searchParams } = new URL(request.url);
    const days = Number(searchParams.get("days") ?? "3") || 3;
    const result = await bitrixAdapter.reconcile(days);
    return NextResponse.json({ ok: true, days, result });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: (error as Error).message },
      { status: 500 }
    );
  }
}
