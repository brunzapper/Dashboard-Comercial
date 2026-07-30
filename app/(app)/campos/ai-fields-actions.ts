// Versão: 1.0 | Data: 30/07/2026
// Server Actions FINAS da criação de campos por IA — wrappers de
// lib/ai/create-fields.ts (gate/validação/aplicação vivem lá). Regra
// Turbopack: módulo "use server" nunca re-exporta tipos — o cliente importa os
// tipos com `import type` direto do core.
"use server";

import {
  applyGeneratedFieldsCore,
  generateFieldsCore,
  type ApplyFieldsState,
  type GenerateFieldsInput,
  type GenerateFieldsState,
} from "@/lib/ai/create-fields";

export async function generateFieldsWithAi(
  input: GenerateFieldsInput
): Promise<GenerateFieldsState> {
  return generateFieldsCore(input);
}

export async function applyGeneratedFields(
  raw: string
): Promise<ApplyFieldsState> {
  return applyGeneratedFieldsCore(raw);
}
