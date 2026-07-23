// Versão: 1.0 | Data: 23/07/2026
// Adaptador Anthropic Claude (Messages API, /v1/messages). Autentica por
// x-api-key + anthropic-version. Sem temperature/top_p (removidos em Opus 4.7+
// — enviá-los daria 400) e sem thinking (geração de JSON não precisa; mantém a
// extração de texto simples). Papéis: user/assistant diretos.

import { AiTruncatedError } from "./types";
import type { AiClientConfig, AiTextClient, AiMessage } from "./types";
import { postProviderJson } from "./util";

const ENDPOINT = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
const MAX_TOKENS = 16000;

interface ClaudeResponse {
  content?: { type?: string; text?: string }[];
  stop_reason?: string;
}

export function createClaudeClient(config: AiClientConfig): AiTextClient {
  return {
    async generateText({ system, messages, signal }) {
      const data = await postProviderJson<ClaudeResponse>("Claude", ENDPOINT, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": config.apiKey,
          "anthropic-version": ANTHROPIC_VERSION,
        },
        body: JSON.stringify({
          model: config.model,
          max_tokens: MAX_TOKENS,
          system,
          messages: messages.map((m: AiMessage) => ({
            role: m.role,
            content: m.content,
          })),
        }),
        signal,
      });

      if (data.stop_reason === "refusal") {
        throw new Error("Claude recusou a solicitação por política de segurança.");
      }
      if (data.stop_reason === "max_tokens") {
        throw new AiTruncatedError("Claude");
      }
      const text = (data.content ?? [])
        .filter((b) => b.type === "text")
        .map((b) => b.text ?? "")
        .join("");
      if (!text.trim()) {
        throw new Error("Claude não retornou conteúdo de texto.");
      }
      return text;
    },
  };
}
