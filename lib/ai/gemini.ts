// Versão: 1.0 | Data: 23/07/2026
// Adaptador Google Gemini (generativelanguage v1beta :generateContent).
// Autentica por HEADER (x-goog-api-key) — nunca por ?key= na URL, que vazaria a
// chave em logs. Pede saída em JSON (responseMimeType) para reduzir cercas.
// Papéis: user → "user", assistant → "model".

import { AiTruncatedError } from "./types";
import type { AiClientConfig, AiTextClient, AiMessage } from "./types";
import { postProviderJson } from "./util";

const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";
// 32k: dashboards médios/grandes exportados+reescritos cabem num turno (o
// modo Editar aceita resposta PARCIAL, mas o "Criar a partir de" ecoa muito).
const MAX_OUTPUT_TOKENS = 32768;

interface GeminiResponse {
  candidates?: {
    content?: { parts?: { text?: string }[] };
    finishReason?: string;
  }[];
  promptFeedback?: { blockReason?: string };
}

function toContents(messages: AiMessage[]) {
  return messages.map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }],
  }));
}

export function createGeminiClient(config: AiClientConfig): AiTextClient {
  return {
    async generateText({ system, messages, signal }) {
      const url = `${ENDPOINT}/${encodeURIComponent(config.model)}:generateContent`;
      const data = await postProviderJson<GeminiResponse>("Gemini", url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-goog-api-key": config.apiKey,
        },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents: toContents(messages),
          generationConfig: {
            responseMimeType: "application/json",
            temperature: 0.2,
            maxOutputTokens: MAX_OUTPUT_TOKENS,
          },
        }),
        signal,
      });

      if (data.promptFeedback?.blockReason) {
        throw new Error(
          `Gemini bloqueou a solicitação (${data.promptFeedback.blockReason}).`
        );
      }
      if (data.candidates?.[0]?.finishReason === "MAX_TOKENS") {
        throw new AiTruncatedError("Gemini");
      }
      const parts = data.candidates?.[0]?.content?.parts ?? [];
      const text = parts.map((p) => p.text ?? "").join("");
      if (!text.trim()) {
        throw new Error("Gemini não retornou conteúdo.");
      }
      return text;
    },
  };
}
