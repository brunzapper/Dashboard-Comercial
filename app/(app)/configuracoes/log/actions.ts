// Versão: 1.0 | Data: 11/07/2026
// Ações da aba Configurações → Log (fila de write-back do Bitrix). Só admin.
// Reenfileirar volta um item 'error' para 'pending' (zera tentativas) para o
// próximo tick tentar de novo. Escrita via service role (a fila não tem policy
// de update para o client autenticado).
"use server";

import { revalidatePath } from "next/cache";

import { requireRole } from "@/lib/auth/session";
import { createServiceClient } from "@/lib/supabase/service";

export async function requeueWriteback(formData: FormData): Promise<void> {
  await requireRole("admin");
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const db = createServiceClient();
  await db
    .from("bitrix_writeback_queue")
    .update({ status: "pending", attempts: 0, last_error: null, processed_at: null })
    .eq("id", id)
    .eq("status", "error");
  revalidatePath("/configuracoes/log");
}
