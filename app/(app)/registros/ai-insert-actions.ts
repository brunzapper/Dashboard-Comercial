// Versão: 1.0 | Data: 30/07/2026
// Server Actions FINAS da inserção de registros por IA — wrappers de
// lib/ai/insert-records.ts (gate/validação/aplicação vivem lá; NÃO recrie
// nada aqui). Regra Turbopack: módulo "use server" NUNCA re-exporta tipos
// (`export type {}` vira re-export de VALOR no chunk e quebra as actions em
// runtime) — o cliente importa os tipos com `import type` direto do core.
"use server";

import {
  applyGeneratedRecordsCore,
  generateRecordsCore,
  type ApplyRecordsState,
  type GenerateRecordsInput,
  type GenerateRecordsState,
} from "@/lib/ai/insert-records";

export async function generateRecordsWithAi(
  input: GenerateRecordsInput
): Promise<GenerateRecordsState> {
  return generateRecordsCore(input);
}

export async function applyGeneratedRecords(
  raw: string,
  args: { sourceKey: string }
): Promise<ApplyRecordsState> {
  return applyGeneratedRecordsCore(raw, args);
}
