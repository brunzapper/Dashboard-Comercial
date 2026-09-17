// Versão: 1.1 | Data: 17/09/2026
// v1.1 (17/09/2026): erro de transporte TIPADO (AiHttpError/AiOverloadError) e
//   `onNotice` — os dois nasceram do rebaixamento de modelo do Gemini
//   (lib/ai/model-fallback.ts). O wrapper precisa distinguir "o modelo está
//   lotado" de "a chave está errada" sem ler a frase de tela, e precisa de um
//   canal para dizer que trocou de degrau — um canal PRÓPRIO, porque o
//   `onThought` é rotulado "Raciocínio:" na tela e aviso de infraestrutura não
//   é pensamento do modelo.
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
  /**
   * Best-effort: recebe trechos do RACIOCÍNIO do modelo enquanto a resposta é
   * gerada (painel "Editar com IA" exibe ao vivo). Adaptador sem suporte
   * ignora. Regra de custo: só emitir onde o raciocínio já é padrão do modelo
   * (ex.: resumos de pensamento do Gemini) — NUNCA habilitar thinking num
   * modelo em que ele vem desligado, o que geraria tokens extras.
   */
  onThought?: (chunk: string) => void;
  /**
   * Aviso do SISTEMA sobre a própria chamada (não do modelo): hoje só o
   * rebaixamento de modelo por sobrecarga. Separado de `onThought` de
   * propósito — a presença de `onThought` liga `includeThoughts` no corpo do
   * Gemini, e a tela rotula aquele texto como raciocínio. Esta não liga nada.
   */
  onNotice?: (text: string) => void;
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

/**
 * O provedor respondeu com status de erro (v1.1).
 *
 * Existe porque quem chama precisa decidir COISAS DIFERENTES a partir do
 * status, e antes disso só havia uma `Error` plana cuja única pista era o
 * texto da mensagem — que é frase de TELA, em português, e portanto o pior
 * lugar do mundo para pendurar uma decisão de controle.
 *
 * A `message` é passada de FORA, já montada pelo `lib/ai/util.ts`: ela é
 * contrato em dois pontos (o `startsWith(providerLabel)` do `json-loop.ts`,
 * que evita "…(gemini): Gemini está…", e as asserções de `util.test.ts`) e
 * não pode mudar um byte por causa desta classe.
 */
export class AiHttpError extends Error {
  constructor(
    readonly provider: string,
    readonly status: number,
    /** Corpo cru recortado — para depurar, nunca para decidir. */
    readonly body: string,
    message: string
  ) {
    super(message);
    this.name = "AiHttpError";
  }
}

/**
 * Sobrecarga ou limite de uso (408/429/5xx) DEPOIS de esgotar as tentativas
 * de transporte do `fetchProvider` (v1.1).
 *
 * É o ÚNICO gatilho do rebaixamento de modelo (`lib/ai/model-fallback.ts`):
 * "o degrau atual está lotado" é a única falha que trocar de modelo resolve.
 * Chave errada, payload inválido e resposta truncada continuam falhando na
 * cara do usuário, que é onde ele consegue agir.
 */
export class AiOverloadError extends AiHttpError {
  constructor(provider: string, status: number, body: string, message: string) {
    super(provider, status, body, message);
    this.name = "AiOverloadError";
  }
}
