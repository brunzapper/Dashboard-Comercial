// Versão: 1.0 | Data: 05/07/2026
// Backfill inicial do Bitrix. Protegido por SYNC_SECRET (header x-sync-secret
// ou Authorization: Bearer). Roda no ambiente da Vercel — nunca depende de
// credencial local.
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
    const result = await bitrixAdapter.backfill();
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: (error as Error).message },
      { status: 500 }
    );
  }
}
