// Versão: 1.0 | Data: 31/07/2026
// Wrappers "use server" FINOS do assistente de IA de operações — gates,
// contexto e validação vivem no core (lib/ai/manage-operations.ts; invariante
// 25). Regra do Turbopack: módulo "use server" só exporta async functions —
// tipos saem por `import type` direto do core.
"use server";

import {
  applyOperationsCore,
  buildOperationsPromptCore,
  generateOperationsCore,
  previewOperationsCore,
  type ApplyOperationsState,
  type GenerateOperationsInput,
  type GenerateOperationsState,
} from "@/lib/ai/manage-operations";

export async function generateOperationsWithAi(
  input: GenerateOperationsInput
): Promise<GenerateOperationsState> {
  return generateOperationsCore(input);
}

export async function applyGeneratedOperations(
  raw: string
): Promise<ApplyOperationsState> {
  return applyOperationsCore(raw);
}

export async function previewOperationsJson(
  raw: string
): Promise<GenerateOperationsState> {
  return previewOperationsCore(raw);
}

export async function buildOperationsPrompt(): Promise<{
  ok: boolean;
  prompt?: string;
  message?: string;
}> {
  return buildOperationsPromptCore();
}
