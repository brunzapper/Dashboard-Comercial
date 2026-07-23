// Versão: 1.0 | Data: 23/07/2026
// Fábrica de clientes de IA: mapeia o provedor configurado para o adaptador.
// Adicionar um provedor = novo arquivo lib/ai/<provedor>.ts + um case aqui +
// uma entrada em models.ts (a migração para outra API é local).

import type { AiClientConfig, AiTextClient } from "./types";
import { createGeminiClient } from "./gemini";
import { createClaudeClient } from "./claude";
import { createOpenAiClient } from "./openai";

export function getAiClient(config: AiClientConfig): AiTextClient {
  switch (config.provider) {
    case "gemini":
      return createGeminiClient(config);
    case "claude":
      return createClaudeClient(config);
    case "openai":
      return createOpenAiClient(config);
  }
}

export { AiTruncatedError } from "./types";
export type { AiClientConfig, AiTextClient, AiMessage, AiProvider } from "./types";
