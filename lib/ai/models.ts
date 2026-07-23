// Versão: 1.0 | Data: 23/07/2026
// Catálogo (puro, client-safe) de provedores e modelos SUGERIDOS por provedor.
// As listas são só atalhos de UI — o campo de modelo aceita valor livre, então
// não travam o usuário numa versão específica. O 1º item de cada lista é o
// default sugerido ao trocar de provedor. Comece pelo Gemini (plano gratuito);
// Claude/OpenAI ficam prontos para migração futura.

import type { AiProvider } from "./types";

export const AI_PROVIDER_LABELS: Record<AiProvider, string> = {
  gemini: "Google Gemini",
  claude: "Anthropic Claude",
  openai: "OpenAI",
};

export const AI_MODELS_BY_PROVIDER: Record<AiProvider, string[]> = {
  gemini: ["gemini-2.5-flash", "gemini-2.5-pro", "gemini-2.0-flash"],
  claude: ["claude-opus-4-8", "claude-sonnet-5", "claude-haiku-4-5"],
  openai: ["gpt-5", "gpt-5-mini", "gpt-4.1"],
};

export const DEFAULT_AI_PROVIDER: AiProvider = "gemini";

export function defaultModelFor(provider: AiProvider): string {
  return AI_MODELS_BY_PROVIDER[provider][0];
}

export function isAiProvider(value: unknown): value is AiProvider {
  return value === "gemini" || value === "claude" || value === "openai";
}
