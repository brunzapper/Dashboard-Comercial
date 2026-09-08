// Versão: 1.0 | Data: 07/09/2026
// Server Actions FINAS do assistente de IA do QUADRO KANBAN — wrappers dos
// cores de lib/ai/kanban-config.ts (gate/validação/aplicação moram lá).
// Módulo "use server" só exporta async functions: re-exportar TIPO daqui faz o
// compilador emitir `export type` como re-export de VALOR e derruba TODAS as
// actions da página em runtime (regra Turbopack — o sheet importa os tipos com
// `import type` direto do core).
"use server";

import { revalidatePath } from "next/cache";

import {
  applyKanbanConfigCore,
  buildKanbanPromptCore,
  generateKanbanConfigCore,
  previewKanbanConfigCore,
  type ApplyKanbanState,
  type GenerateKanbanInput,
  type GenerateKanbanState,
  type KanbanColumnHint,
} from "@/lib/ai/kanban-config";
import type { KanbanOwner } from "@/lib/kanban/data";

export async function generateKanbanConfigWithAi(
  input: GenerateKanbanInput
): Promise<GenerateKanbanState> {
  return generateKanbanConfigCore(input);
}

export async function previewKanbanConfigJson(
  owner: KanbanOwner,
  columns: KanbanColumnHint[],
  raw: string
): Promise<GenerateKanbanState> {
  return previewKanbanConfigCore(owner, columns, raw);
}

export async function buildKanbanConfigPrompt(
  owner: KanbanOwner,
  columns: KanbanColumnHint[]
): Promise<{ ok: boolean; prompt?: string; message?: string }> {
  return buildKanbanPromptCore(owner, columns);
}

export async function applyKanbanConfig(
  owner: KanbanOwner,
  columns: KanbanColumnHint[],
  raw: string
): Promise<ApplyKanbanState> {
  const res = await applyKanbanConfigCore(owner, columns, raw);
  if ((res.appliedCount ?? 0) > 0) {
    // O quadro dedicado e a página cheia do widget; o widget DENTRO do
    // dashboard recarrega pelo router.refresh() do cliente.
    if (owner.kind === "board") revalidatePath(`/kanbans/${owner.id}`);
    else revalidatePath(`/kanbans/w/${owner.id}`);
  }
  return res;
}
