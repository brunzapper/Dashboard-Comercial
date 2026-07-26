// Versão: 1.1 | Data: 26/07/2026
// Adaptador Google Gemini (generativelanguage v1beta :generateContent).
// Autentica por HEADER (x-goog-api-key) — nunca por ?key= na URL, que vazaria a
// chave em logs. Pede saída em JSON (responseMimeType) para reduzir cercas.
// Papéis: user → "user", assistant → "model".
// v1.1: com `onThought` usa :streamGenerateContent (SSE) + thinkingConfig
// includeThoughts para exibir o RACIOCÍNIO ao vivo. Custo: os modelos Gemini
// atuais já pensam por padrão (tokens de raciocínio já cobrados hoje);
// includeThoughts só devolve os RESUMOS de pensamento — não gasta tokens
// extras nem mexe no thinkingBudget. Sem onThought, o caminho não-streaming
// segue byte-idêntico ao v1.0.

import { AiTruncatedError } from "./types";
import type { AiClientConfig, AiTextClient, AiMessage } from "./types";
import { postProviderJson, streamProviderSse } from "./util";

const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";
// 32k: dashboards médios/grandes exportados+reescritos cabem num turno (o
// modo Editar aceita resposta PARCIAL, mas o "Criar a partir de" ecoa muito).
const MAX_OUTPUT_TOKENS = 32768;

interface GeminiPart {
  text?: string;
  /** true = resumo de pensamento (includeThoughts), não faz parte da resposta. */
  thought?: boolean;
}

interface GeminiResponse {
  candidates?: {
    content?: { parts?: GeminiPart[] };
    finishReason?: string;
  }[];
  promptFeedback?: { blockReason?: string };
}

/**
 * Separa um chunk (ou resposta inteira) do Gemini em resumos de pensamento ×
 * texto da resposta, com os sinais de parada/bloqueio. Pura — testável sem
 * rede (lib/ai/gemini.test.ts).
 */
export function splitGeminiChunk(data: GeminiResponse): {
  thoughts: string[];
  text: string;
  finishReason?: string;
  blockReason?: string;
} {
  const candidate = data.candidates?.[0];
  const thoughts: string[] = [];
  let text = "";
  for (const part of candidate?.content?.parts ?? []) {
    if (!part.text) continue;
    if (part.thought) thoughts.push(part.text);
    else text += part.text;
  }
  return {
    thoughts,
    text,
    finishReason: candidate?.finishReason,
    blockReason: data.promptFeedback?.blockReason,
  };
}

function toContents(messages: AiMessage[]) {
  return messages.map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }],
  }));
}

export function createGeminiClient(config: AiClientConfig): AiTextClient {
  return {
    async generateText({ system, messages, signal, onThought }) {
      const headers = {
        "content-type": "application/json",
        "x-goog-api-key": config.apiKey,
      };
      const body = {
        systemInstruction: { parts: [{ text: system }] },
        contents: toContents(messages),
        generationConfig: {
          responseMimeType: "application/json",
          temperature: 0.2,
          maxOutputTokens: MAX_OUTPUT_TOKENS,
          // Só no streaming: resumos de pensamento visíveis (sem custo extra).
          ...(onThought ? { thinkingConfig: { includeThoughts: true } } : {}),
        },
      };

      if (onThought) {
        const url = `${ENDPOINT}/${encodeURIComponent(config.model)}:streamGenerateContent?alt=sse`;
        let text = "";
        let finishReason: string | undefined;
        for await (const data of streamProviderSse<GeminiResponse>(
          "Gemini",
          url,
          { method: "POST", headers, body: JSON.stringify(body), signal }
        )) {
          const chunk = splitGeminiChunk(data);
          if (chunk.blockReason) {
            throw new Error(`Gemini bloqueou a solicitação (${chunk.blockReason}).`);
          }
          for (const t of chunk.thoughts) onThought(t);
          text += chunk.text;
          if (chunk.finishReason) finishReason = chunk.finishReason;
        }
        if (finishReason === "MAX_TOKENS") {
          throw new AiTruncatedError("Gemini");
        }
        if (!text.trim()) {
          throw new Error("Gemini não retornou conteúdo.");
        }
        return text;
      }

      const url = `${ENDPOINT}/${encodeURIComponent(config.model)}:generateContent`;
      const data = await postProviderJson<GeminiResponse>("Gemini", url, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
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
