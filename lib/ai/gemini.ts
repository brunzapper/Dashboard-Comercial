// Versão: 1.2 | Data: 10/09/2026
// v1.2 (10/09/2026): SEMPRE :streamGenerateContent. O ramo não-streaming saiu.
//
//   O sintoma: o "Salvar e analisar" da Tree devolvia 503 ("This model is
//   currently experiencing high demand") enquanto a IA do dashboard funcionava
//   — alternando as duas telas no mesmo minuto, com a mesma org, a mesma
//   chave e o mesmo modelo. Sobrecarga aleatória não escolhe sempre a mesma
//   tela: a diferença era o ENDPOINT, escolhido aqui por `onThought`. Quem
//   passava (os painéis com raciocínio ao vivo) transmitia e passava; todo o
//   resto — Tree, tarefas, campos, registros, kanban, remuneração — caía no
//   `:generateContent` e apanhava.
//
//   `:generateContent` obriga o servidor a produzir a resposta INTEIRA antes
//   de responder, e a admissão dele é mais apertada sob carga; a orientação do
//   próprio Google para 503 é usar streaming. Como o contrato do
//   `AiTextClient` é "devolva uma string no fim", transmitir e acumular dá
//   exatamente o mesmo resultado para quem não quer o raciocínio — sem um
//   segundo caminho para diferir do primeiro.
//
//   `thinkingConfig.includeThoughts` NÃO acompanhou: transmitir não liga
//   raciocínio nenhum, pedir os resumos é outra decisão (e a regra de custo do
//   projeto é não ligá-los onde vêm desligados). Sem `onThought` o corpo segue
//   sem a chave, e os pedaços marcados como pensamento são descartados.
// Adaptador Google Gemini (generativelanguage v1beta :streamGenerateContent).
// Autentica por HEADER (x-goog-api-key) — nunca por ?key= na URL, que vazaria a
// chave em logs. Pede saída em JSON (responseMimeType) para reduzir cercas.
// Papéis: user → "user", assistant → "model".
// v1.1: com `onThought`, thinkingConfig includeThoughts para exibir o
// RACIOCÍNIO ao vivo. Custo: os modelos Gemini atuais já pensam por padrão
// (tokens de raciocínio já cobrados hoje); includeThoughts só devolve os
// RESUMOS de pensamento — não gasta tokens extras nem mexe no thinkingBudget.

import { AiTruncatedError } from "./types";
import type { AiClientConfig, AiTextClient, AiMessage } from "./types";
import { streamProviderSse } from "./util";

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
          // Só quem exibe o raciocínio PEDE os resumos (sem custo extra).
          // Não confundir com transmitir: isso agora é sempre (ver v1.2).
          ...(onThought ? { thinkingConfig: { includeThoughts: true } } : {}),
        },
      };

      // Um caminho só (v1.2): transmite sempre, e o `onThought` decide apenas
      // se os resumos de pensamento são PEDIDOS e repassados.
      const url = `${ENDPOINT}/${encodeURIComponent(config.model)}:streamGenerateContent?alt=sse`;
      let text = "";
      let finishReason: string | undefined;
      for await (const data of streamProviderSse<GeminiResponse>("Gemini", url, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal,
      })) {
        const chunk = splitGeminiChunk(data);
        if (chunk.blockReason) {
          throw new Error(`Gemini bloqueou a solicitação (${chunk.blockReason}).`);
        }
        // Sem `onThought` não há `includeThoughts` no corpo, então `thoughts`
        // vem vazio; o descarte aqui é só o cinto de segurança.
        if (onThought) for (const t of chunk.thoughts) onThought(t);
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
    },
  };
}
