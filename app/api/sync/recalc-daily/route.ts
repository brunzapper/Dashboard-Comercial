// Versão: 1.0 | Data: 13/07/2026
// Recalcula os campos calculados de TODOS os registros uma vez por dia. Serve
// para refrescar as fórmulas que usam o operando sintético "Data atual" (hoje
// em Brasília): como os campos calculados são MATERIALIZADOS em
// records.custom_fields, um valor tipo `today − closed_at` congelaria no dia do
// cálculo — este recalc diário reatualiza. Protegido por SYNC_SECRET, como o
// tick. Agende via supabase/apply/pg-cron-recalc.sql (ex.: 05:00 UTC ≈ 02:00 BRT).
import { NextResponse } from "next/server";

import { getSyncSecret } from "@/lib/env";
import { recalcAllFormulaFields } from "@/lib/records/recalc";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

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
    const updated = await recalcAllFormulaFields();
    return NextResponse.json({ ok: true, updated });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: (error as Error).message },
      { status: 500 }
    );
  }
}
