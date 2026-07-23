// Versão: 1.0 | Data: 23/07/2026
// Contrato dos adaptadores de IA (geração direta de dashboards via API).
// Puro (sem deps de servidor): pode ser importado por qualquer camada.
// Um provedor implementa AiTextClient.generateText — devolve o TEXTO bruto da
// resposta; quem chama extrai/valida o JSON (validateDashboardImport).

export type AiProvider = "gemini" | "claude" | "openai";

export interface AiMessage {
  role: "user" | "assistant";
  content: string;
}

export interface AiGenerateInput {
  /** Instrução de sistema (o prompt de import montado por buildImportPrompt). */
  system: string;
  /** Turnos da conversa (descrição do usuário + eventuais correções). */
  messages: AiMessage[];
  /** Timeout/cancelamento (o chamador passa um AbortSignal.timeout). */
  signal?: AbortSignal;
}

export interface AiClientConfig {
  provider: AiProvider;
  model: string;
  /** Chave de API JÁ decifrada — só existe no servidor. */
  apiKey: string;
}

export interface AiTextClient {
  generateText(input: AiGenerateInput): Promise<string>;
}

/**
 * Resposta CORTADA pelo teto de tokens do provedor (stop_reason max_tokens /
 * finishReason MAX_TOKENS / finish_reason length). JSON truncado nunca valida
 * — o orquestrador aborta o laço imediatamente (sem queimar tentativas) com
 * mensagem acionável, em vez de mandar o erro de parse de volta à IA.
 */
export class AiTruncatedError extends Error {
  constructor(provider: string) {
    super(
      `A resposta do ${provider} foi cortada pelo limite de tokens — o dashboard é grande demais para um turno; peça mudanças menores/mais específicas.`
    );
    this.name = "AiTruncatedError";
  }
}
