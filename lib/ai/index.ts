// Versão: 1.1 | Data: 17/09/2026
// v1.1 (17/09/2026): o Gemini sai embrulhado pela escada de rebaixamento
//   (lib/ai/model-fallback.ts). A fiação é AQUI de propósito: esta fábrica é
//   por onde passam as duas únicas call sites (json-loop.ts e
//   generate-dashboard.ts) e, por elas, todas as superfícies de IA — mesma
//   razão de o `fetchProvider` ser o dono único da retentativa de transporte.
//   Claude e OpenAI seguem byte-idênticos (sem escada).
// Fábrica de clientes de IA: mapeia o provedor configurado para o adaptador.
// Adicionar um provedor = novo arquivo lib/ai/<provedor>.ts + um case aqui +
// uma entrada em models.ts (a migração para outra API é local).

import type { AiClientConfig, AiTextClient } from "./types";
import { createGeminiClientWithFallback } from "./model-fallback";
import { createClaudeClient } from "./claude";
import { createOpenAiClient } from "./openai";

export function getAiClient(config: AiClientConfig): AiTextClient {
  switch (config.provider) {
    case "gemini":
      return createGeminiClientWithFallback(config);
    case "claude":
      return createClaudeClient(config);
    case "openai":
      return createOpenAiClient(config);
  }
}

export { AiTruncatedError, AiHttpError, AiOverloadError } from "./types";
export type { AiClientConfig, AiTextClient, AiMessage, AiProvider } from "./types";
