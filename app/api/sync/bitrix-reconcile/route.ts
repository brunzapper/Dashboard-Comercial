// Versão: 1.0 | Data: 05/07/2026
// Reconciliação do Bitrix (refaz a busca por DATE_MODIFY >= agora - N dias).
// Protegido por SYNC_SECRET. Mantido para disparo externo/cron futuro; a UI
// usa uma Server Action guardada por admin (não expõe o segredo ao browser).
import { NextResponse } from "next/server";

import { syncSecretAuthorized } from "@/lib/auth/sync-secret";
import { bitrixAdapter } from "@/lib/sync/bitrix/adapter";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// SYNC_SECRET com comparação constant-time — ver lib/auth/sync-secret.ts.
const authorized = syncSecretAuthorized;

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
