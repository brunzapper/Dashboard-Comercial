// Versão: 1.0 | Data: 23/07/2026
// Adaptador OpenAI (Chat Completions, /v1/chat/completions). Autentica por
// Bearer. Pede saída em JSON (response_format json_object — exige a palavra
// "json" no prompt, garantida pelo SPEC). Sem temperature (alguns modelos novos
// só aceitam o default). O system vira a 1ª mensagem role:"system".

import type { AiClientConfig, AiTextClient, AiMessage } from "./types";
import { postProviderJson } from "./util";

const ENDPOINT = "https://api.openai.com/v1/chat/completions";

interface OpenAiResponse {
  choices?: { message?: { content?: string } }[];
}

export function createOpenAiClient(config: AiClientConfig): AiTextClient {
  return {
    async generateText({ system, messages, signal }) {
      const chat = [
        { role: "system", content: system },
        ...messages.map((m: AiMessage) => ({ role: m.role, content: m.content })),
      ];
      const data = await postProviderJson<OpenAiResponse>("OpenAI", ENDPOINT, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify({
          model: config.model,
          messages: chat,
          response_format: { type: "json_object" },
        }),
        signal,
      });

      const text = data.choices?.[0]?.message?.content ?? "";
      if (!text.trim()) {
        throw new Error("OpenAI não retornou conteúdo.");
      }
      return text;
    },
  };
}
