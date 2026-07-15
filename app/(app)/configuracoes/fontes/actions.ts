// Versão: 1.0 | Data: 15/07/2026
// Server Actions da tela Configurações → Fontes: grava os rótulos CURTOS de
// exibição das fontes (prefixos/chips dos dropdowns de campo) + o rótulo dos
// campos "gerais" em sync_config ('source_labels'). RLS: escrita admin;
// leitura liberada a qualquer autenticado (0009).
"use server";

import { revalidatePath } from "next/cache";

import { requireRole } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import {
  mergeSourceLabels,
  SOURCE_LABELS_CONFIG_KEY,
} from "@/lib/config/source-labels";

export interface SourceLabelsActionState {
  ok?: boolean;
  message?: string;
}

export async function saveSourceLabels(
  _prev: SourceLabelsActionState,
  formData: FormData
): Promise<SourceLabelsActionState> {
  await requireRole("admin");
  // Campo vazio/inválido cai no default (mergeSourceLabels).
  const value = mergeSourceLabels({
    leads: formData.get("leads"),
    deals: formData.get("deals"),
    estudo: formData.get("estudo"),
    geral: formData.get("geral"),
  });
  const supabase = await createClient();
  const { error } = await supabase
    .from("sync_config")
    .upsert(
      { key: SOURCE_LABELS_CONFIG_KEY, value },
      { onConflict: "key" }
    );
  if (error) return { ok: false, message: `Falha ao salvar: ${error.message}` };
  // Os rótulos entram via provider do layout raiz → revalida o app inteiro.
  revalidatePath("/", "layout");
  return { ok: true, message: "Rótulos salvos." };
}
