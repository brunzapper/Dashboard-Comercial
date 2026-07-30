// Versão: 1.0 | Data: 30/07/2026
// Server Action FINA da sugestão de mapeamento de CSV por IA — wrapper de
// lib/ai/csv-mapping.ts (gate/prompt/validação vivem lá). Regra Turbopack:
// módulo "use server" nunca re-exporta tipos — o wizard importa os tipos com
// `import type` direto do core.
"use server";

import {
  suggestCsvMappingCore,
  type SuggestCsvMappingInput,
  type SuggestCsvMappingState,
} from "@/lib/ai/csv-mapping";

export async function suggestCsvMappingWithAi(
  input: SuggestCsvMappingInput
): Promise<SuggestCsvMappingState> {
  return suggestCsvMappingCore(input);
}
