// Versão: 1.0 | Data: 07/08/2026
// Server Actions FINAS do assistente de IA de Mapeamentos — wrappers dos
// cores de lib/ai/classify-mappings.ts (gate/validação/aplicação moram lá;
// módulo "use server" só exporta async functions — regra Turbopack).
"use server";

import { revalidatePath } from "next/cache";

import {
  applyMappingsClassifyCore,
  buildMappingsPromptCore,
  generateMappingsCore,
  previewMappingsCore,
  type ApplyMappingsClassifyState,
  type GenerateMappingsInput,
  type GenerateMappingsState,
} from "@/lib/ai/classify-mappings";

export async function generateMappingsWithAi(
  input: GenerateMappingsInput
): Promise<GenerateMappingsState> {
  return generateMappingsCore(input);
}

export async function previewMappingsJson(
  domainKey: string,
  raw: string
): Promise<GenerateMappingsState> {
  return previewMappingsCore(domainKey, raw);
}

export async function buildMappingsPrompt(domainKey: string): Promise<{
  ok: boolean;
  prompt?: string;
  message?: string;
}> {
  return buildMappingsPromptCore(domainKey);
}

export async function applyGeneratedMappings(
  domainKey: string,
  raw: string
): Promise<ApplyMappingsClassifyState> {
  const res = await applyMappingsClassifyCore(domainKey, raw);
  if ((res.appliedCount ?? 0) > 0) {
    revalidatePath("/operacao/mapeamentos");
    revalidatePath("/dashboards/[id]", "page");
  }
  return res;
}
