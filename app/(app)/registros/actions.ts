// Versão: 1.0 | Data: 05/07/2026
// Server Actions de sync disparadas pela UI (botões da página de Registros).
// Guardadas por papel admin; usam o service role no servidor (via adapter),
// então NÃO expõem o SYNC_SECRET ao browser.
"use server";

import { revalidatePath } from "next/cache";

import { getSessionInfo } from "@/lib/auth/session";
import { bitrixAdapter } from "@/lib/sync/bitrix/adapter";
import type { SyncResult } from "@/lib/sync/adapter";

export interface SyncActionState {
  ok?: boolean;
  message?: string;
  result?: SyncResult;
}

async function ensureAdmin(): Promise<string | null> {
  const session = await getSessionInfo();
  if (!session) return "Sessão expirada.";
  if (!session.roles.includes("admin")) {
    return "Apenas administradores podem sincronizar.";
  }
  return null;
}

export async function backfillAction(
  _prev: SyncActionState,
  _formData: FormData
): Promise<SyncActionState> {
  const err = await ensureAdmin();
  if (err) return { ok: false, message: err };
  try {
    const result = await bitrixAdapter.backfill();
    revalidatePath("/registros");
    return { ok: true, message: "Backfill concluído.", result };
  } catch (error) {
    return { ok: false, message: (error as Error).message };
  }
}

export async function reconcileAction(
  _prev: SyncActionState,
  formData: FormData
): Promise<SyncActionState> {
  const err = await ensureAdmin();
  if (err) return { ok: false, message: err };
  const days = Number(formData.get("days") ?? 3) || 3;
  try {
    const result = await bitrixAdapter.reconcile(days);
    revalidatePath("/registros");
    return {
      ok: true,
      message: `Reconciliação (${days} dia(s)) concluída.`,
      result,
    };
  } catch (error) {
    return { ok: false, message: (error as Error).message };
  }
}
