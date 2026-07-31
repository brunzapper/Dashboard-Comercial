// Versão: 1.0 | Data: 31/07/2026
// Wrappers "use server" FINOS do assistente de ATUALIZAÇÃO EM MASSA por IA —
// gates, contexto, prévia server-side e escrita vivem no core
// (lib/ai/update-records.ts; invariante 25). Regra do Turbopack: módulo
// "use server" só exporta async functions — tipos saem por `import type`
// direto do core.
"use server";

import {
  applyRecordsUpdateCore,
  buildRecordsUpdatePromptCore,
  generateRecordsUpdateCore,
  previewRecordsUpdateCore,
  type ApplyRecordsUpdateState,
  type GenerateRecordsUpdateInput,
  type GenerateRecordsUpdateState,
} from "@/lib/ai/update-records";

export async function generateRecordsUpdateWithAi(
  input: GenerateRecordsUpdateInput
): Promise<GenerateRecordsUpdateState> {
  return generateRecordsUpdateCore(input);
}

export async function previewRecordsUpdateJson(
  raw: string,
  sourceKey: string
): Promise<GenerateRecordsUpdateState> {
  return previewRecordsUpdateCore(raw, { sourceKey });
}

export async function buildRecordsUpdatePrompt(sourceKey: string): Promise<{
  ok: boolean;
  prompt?: string;
  message?: string;
}> {
  return buildRecordsUpdatePromptCore({ sourceKey });
}

export async function applyRecordsUpdate(
  raw: string,
  sourceKey: string
): Promise<ApplyRecordsUpdateState> {
  return applyRecordsUpdateCore(raw, { sourceKey });
}
