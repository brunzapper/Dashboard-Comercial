// Versão: 1.1 | Data: 07/08/2026
// v1.1 (07/08/2026): wrappers do MODO SELEÇÃO — alvo = registros selecionados
//   na tabela (checkboxes); os ids viajam por AQUI (argumento), nunca no JSON.
//   Servem a edição manual em massa (bulk-edit-sheet) E a IA sobre
//   selecionados (ai-update-sheet com prop selection).
// Wrappers "use server" FINOS do assistente de ATUALIZAÇÃO EM MASSA por IA —
// gates, contexto, prévia server-side e escrita vivem no core
// (lib/ai/update-records.ts; invariante 25). Regra do Turbopack: módulo
// "use server" só exporta async functions — tipos saem por `import type`
// direto do core.
"use server";

import {
  applyRecordsSelectionCore,
  applyRecordsUpdateCore,
  buildRecordsSelectionPromptCore,
  buildRecordsUpdatePromptCore,
  generateRecordsSelectionUpdateCore,
  generateRecordsUpdateCore,
  loadRecordsUpdateTargetsCore,
  previewRecordsSelectionCore,
  previewRecordsUpdateCore,
  type ApplyRecordsUpdateState,
  type GenerateRecordsUpdateInput,
  type GenerateRecordsUpdateState,
} from "@/lib/ai/update-records";
import type { EntryFieldSpec } from "@/lib/import/records/types";

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

// ----- Modo seleção (registros marcados na tabela) -----

export async function loadRecordsUpdateTargets(sourceKey: string): Promise<
  { ok: true; fields: EntryFieldSpec[] } | { ok: false; message: string }
> {
  return loadRecordsUpdateTargetsCore({ sourceKey });
}

export async function generateRecordsSelectionUpdateWithAi(
  input: GenerateRecordsUpdateInput & { recordIds: string[] }
): Promise<GenerateRecordsUpdateState> {
  return generateRecordsSelectionUpdateCore(input);
}

export async function previewRecordsSelectionUpdateJson(
  raw: string,
  sourceKey: string,
  recordIds: string[]
): Promise<GenerateRecordsUpdateState> {
  return previewRecordsSelectionCore(raw, { sourceKey, recordIds });
}

export async function buildRecordsSelectionUpdatePrompt(
  sourceKey: string,
  recordIds: string[]
): Promise<{ ok: boolean; prompt?: string; message?: string }> {
  return buildRecordsSelectionPromptCore({ sourceKey, recordIds });
}

export async function applyRecordsSelectionUpdate(
  raw: string,
  sourceKey: string,
  recordIds: string[]
): Promise<ApplyRecordsUpdateState> {
  return applyRecordsSelectionCore(raw, { sourceKey, recordIds });
}
