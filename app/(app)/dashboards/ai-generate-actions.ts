// Versão: 1.0 | Data: 23/07/2026
// Geração DIRETA de dashboard por IA (via API). Remove o "hop" manual de
// copiar/colar: o servidor monta o MESMO prompt do fluxo manual
// (buildImportPrompt — SPEC + modelo das Bases + amostras), chama o provedor
// configurado por org (lib/ai), e roda um laço de AUTOCORREÇÃO usando os erros
// pt-BR do validador (validateDashboardImport) — o mesmo contrato pensado para
// "colar de volta na IA". Ao validar, aplica reusando importDashboardJson
// (gates + GC + persistência idempotente intactos) e o cliente navega ao
// dashboard. A chave da IA é decifrada só aqui (loadOrgAiConfig), nunca no
// browser.
"use server";

import { getSessionInfo } from "@/lib/auth/session";
import { getActiveOrgId } from "@/lib/auth/org";
import { createClient } from "@/lib/supabase/server";
import { loadOrgAiConfig } from "@/lib/ai/config";
import { getAiClient, type AiMessage } from "@/lib/ai";
import { buildImportPrompt } from "@/app/(app)/dashboards/import-prompt-actions";
import { loadImportContext } from "@/lib/import/dashboard/context";
import { validateDashboardImport } from "@/lib/import/dashboard/validate";
import { importDashboardJson, type ImportDashboardState } from "@/app/(app)/dashboards/actions";

export interface GenerateDashboardState extends ImportDashboardState {
  // Último JSON gerado quando o laço falha — o campo manual é preenchido com
  // ele para conserto/importação à mão (degradação graciosa do auto-import).
  draftJson?: string;
}

const MAX_ATTEMPTS = 3;
const CALL_TIMEOUT_MS = 45_000;

export async function generateDashboardWithAi(input: {
  bases: string[];
  description: string;
}): Promise<GenerateDashboardState> {
  const session = await getSessionInfo();
  if (!session) return { ok: false, message: "Sessão expirada." };
  if (!session.permissions.includes("create_dashboards")) {
    return { ok: false, message: "Você não tem permissão para criar dashboards." };
  }
  const bases = (input.bases ?? []).filter(Boolean);
  const description = (input.description ?? "").trim();
  if (bases.length === 0) {
    return { ok: false, message: "Selecione ao menos uma Base." };
  }
  if (!description) {
    return { ok: false, message: "Descreva o dashboard que você quer." };
  }

  const orgId = await getActiveOrgId();
  const aiConfig = await loadOrgAiConfig(orgId);
  if (!aiConfig) {
    return {
      ok: false,
      message:
        "IA não configurada para esta organização. Cadastre o provedor e a chave em Configurações → Integrações.",
    };
  }

  // System = instruções + modelo das Bases + amostras reais (mesmo do manual).
  const prompt = await buildImportPrompt(bases, "compacto");
  if (!prompt.ok || !prompt.prompt) {
    return { ok: false, message: prompt.message ?? "Não foi possível montar o prompt." };
  }
  const system = prompt.prompt;

  const supabase = await createClient();
  const ctx = await loadImportContext(supabase);
  const client = getAiClient(aiConfig);

  const messages: AiMessage[] = [{ role: "user", content: description }];
  let lastErrors: string[] = [];
  let lastRaw = "";

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    let raw: string;
    try {
      raw = await client.generateText({
        system,
        messages,
        signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false, message: `Falha ao chamar a IA (${aiConfig.provider}): ${msg}` };
    }
    lastRaw = raw;

    const validation = validateDashboardImport(raw, ctx);
    if (validation.ok && validation.preset) {
      // Aplica reusando o caminho de import (gates por seção + GC + persistência).
      return await importDashboardJson(raw);
    }

    lastErrors = validation.errors;
    // Turno de correção: JSON anterior + erros pt-BR (contrato do fluxo manual).
    messages.push({ role: "assistant", content: raw });
    messages.push({
      role: "user",
      content:
        "O validador do sistema apontou estes problemas no JSON. Corrija TODOS " +
        "e responda de novo com o JSON inteiro (apenas o bloco JSON, sem texto " +
        "fora dele):\n- " +
        lastErrors.join("\n- "),
    });
  }

  // Esgotou as tentativas sem JSON válido: erros + rascunho para conserto manual.
  return {
    ok: false,
    message:
      "A IA não conseguiu gerar um JSON válido após algumas tentativas. Revise o rascunho abaixo e ajuste/importe manualmente.",
    errors: lastErrors,
    draftJson: lastRaw,
  };
}
