// Versão: 1.0 | Data: 08/09/2026
// Server Actions FINAS do assistente de IA de TAREFAS — wrappers dos cores de
// lib/ai/manage-tasks.ts (gate/validação/aplicação moram lá). Módulo
// "use server" só exporta async functions: re-exportar TIPO daqui faz o
// compilador emitir `export type` como re-export de VALOR e derruba TODAS as
// actions da página em runtime (regra Turbopack — o sheet importa os tipos com
// `import type` direto do core).
"use server";

import {
  applyTasksCore,
  buildTasksPromptCore,
  generateTasksCore,
  previewTasksCore,
  type ApplyTasksState,
  type GenerateTasksInput,
  type GenerateTasksState,
} from "@/lib/ai/manage-tasks";

export async function generateTasksWithAi(
  input: GenerateTasksInput
): Promise<GenerateTasksState> {
  return generateTasksCore(input);
}

export async function previewTasksJson(
  raw: string
): Promise<GenerateTasksState> {
  return previewTasksCore(raw);
}

export async function buildTasksPrompt(): Promise<{
  ok: boolean;
  prompt?: string;
  message?: string;
}> {
  return buildTasksPromptCore();
}

export async function applyTasksEdit(raw: string): Promise<ApplyTasksState> {
  // Os choke points já fazem revalidatePath("/operacao/tarefas") por item.
  return applyTasksCore(raw);
}
