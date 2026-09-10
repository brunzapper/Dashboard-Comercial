// Versão: 1.2 | Data: 10/09/2026
// v1.2 (10/09/2026): RETENTATIVA para as falhas que o próprio provedor manda
//   repetir (429/5xx) e uma frase legível no lugar do JSON de erro cru.
//
//   O que estava errado: `runJsonGenerationLoop` tem três tentativas, mas elas
//   são SÓ para resposta que não passa no validador — qualquer falha de
//   TRANSPORTE cai no `catch` dele e retorna na hora. Um único 503 do Gemini
//   ("This model is currently experiencing high demand… please try again
//   later") matava o turno inteiro, e o usuário via o JSON de erro do Google
//   na tela. Não era defeito de uma superfície: a que pegasse o minuto ruim
//   perdia, e as outras seguiam funcionando — o que faz parecer bug de código
//   novo quando é sobrecarga do provedor.
//
//   A retentativa vive AQUI porque é aqui que passam os três adaptadores
//   (gemini/claude/openai) e, por eles, todas as superfícies de IA. Regras:
//   só status que significam "tente de novo" (429/408/5xx) e falha de rede —
//   4xx de contrato (400 payload inválido, 401/403 chave errada) falham na
//   PRIMEIRA, porque repetir não muda nada e só atrasa o erro; e nunca depois
//   do `AbortSignal` do chamador, que é o teto real do turno. Repetir um POST
//   de geração é seguro: pedido recusado não gerou token nem cobrou nada.
// v1.1 (26/07/2026): stream SSE.
// Utilitários de rede compartilhados pelos adaptadores de IA: POST JSON e
// stream SSE, com mensagens de erro legíveis (status + trecho do corpo) e
// tratamento de timeout/cancelamento (AbortSignal). Segue o estilo fetch
// nativo do projeto (lib/webhooks/deliver.ts, lib/sync/bitrix/client.ts) —
// sem SDK/axios.

/**
 * Status em que repetir tem chance de dar certo.
 *
 * 429 = limite de uso; 408/5xx = sobrecarga ou falha momentânea do provedor.
 * Tudo o mais é contrato (payload, chave, modelo inexistente) e repetir só
 * atrasaria a mensagem que o usuário precisa ler.
 */
const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);

/** Tentativas de TRANSPORTE por chamada (a 1ª mais duas repetições). */
export const AI_HTTP_ATTEMPTS = 3;

const BACKOFF_BASE_MS = 700;
/** Teto de uma espera. O `AbortSignal` do chamador ainda é o teto do turno. */
const BACKOFF_MAX_MS = 8_000;

function isAbort(err: unknown): boolean {
  return (
    err instanceof DOMException &&
    (err.name === "TimeoutError" || err.name === "AbortError")
  );
}

function mapNetworkError(provider: string, err: unknown): Error {
  if (isAbort(err)) {
    return new Error(`Tempo limite ao chamar ${provider}.`);
  }
  const msg = err instanceof Error ? err.message : String(err);
  return new Error(`Falha de rede ao chamar ${provider}: ${msg}`);
}

/** Espera exponencial com jitter — dois clientes não repetem no mesmo instante. */
export function backoffMs(attempt: number, random: () => number = Math.random): number {
  const base = Math.min(BACKOFF_BASE_MS * 2 ** attempt, BACKOFF_MAX_MS);
  return Math.round(base / 2 + random() * (base / 2));
}

/**
 * O `Retry-After` do provedor, quando ele manda um. Aceita as duas formas do
 * cabeçalho (segundos ou data HTTP) e respeita o teto — um "volte em 5
 * minutos" não pode prender o turno inteiro esperando.
 */
export function retryAfterMs(header: string | null): number | null {
  if (!header) return null;
  const secs = Number(header.trim());
  if (Number.isFinite(secs)) {
    return Math.min(Math.max(secs, 0) * 1000, BACKOFF_MAX_MS);
  }
  const at = Date.parse(header);
  if (Number.isNaN(at)) return null;
  return Math.min(Math.max(at - Date.now(), 0), BACKOFF_MAX_MS);
}

/** Espera cancelável: o abort do chamador interrompe o intervalo. */
function sleep(ms: number, signal: AbortSignal | null): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason ?? new DOMException("Aborted", "AbortError"));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * A frase que o usuário lê quando as tentativas acabam.
 *
 * O corpo cru do provedor é um bloco de JSON — informação para quem depura,
 * ruído para quem só queria uma resposta. Aproveita a mensagem de dentro dele
 * quando existe e joga o resto fora.
 */
export function overloadMessage(
  provider: string,
  status: number,
  body: string
): string {
  const what =
    status === 429
      ? "atingiu o limite de uso"
      : "está sobrecarregado no momento";
  let detail = "";
  try {
    const parsed = JSON.parse(body) as { error?: { message?: string } };
    const msg = parsed?.error?.message;
    if (typeof msg === "string" && msg.trim()) {
      detail = ` ${msg.trim().slice(0, 200)}`;
    }
  } catch {
    // Corpo que não é JSON não vira detalhe: o status já diz o essencial.
  }
  return (
    `${provider} ${what} (${status}) — tentei ${AI_HTTP_ATTEMPTS} vezes.` +
    ` Tente de novo em instantes.${detail}`
  );
}

/**
 * `fetch` com as retentativas acima, devolvendo a resposta JÁ OK.
 *
 * Dono único das duas funções abaixo. No caminho SSE isto é seguro porque a
 * repetição acontece ANTES de qualquer evento ser entregue — stream já
 * começado nunca é reiniciado (o consumidor teria visto pensamento duplicado).
 */
async function fetchProvider(
  provider: string,
  url: string,
  init: RequestInit
): Promise<Response> {
  const signal = (init.signal ?? null) as AbortSignal | null;
  let wait = 0;
  let lastStatus = 0;
  let lastBody = "";

  for (let attempt = 0; attempt < AI_HTTP_ATTEMPTS; attempt++) {
    if (attempt > 0) {
      try {
        await sleep(wait, signal);
      } catch (err) {
        // Abort durante a espera: o turno acabou, não há o que repetir.
        throw mapNetworkError(provider, err);
      }
    }

    let res: Response;
    try {
      res = await fetch(url, init);
    } catch (err) {
      // Timeout/cancelamento nunca repete — o teto do chamador já passou.
      if (isAbort(err) || attempt === AI_HTTP_ATTEMPTS - 1) {
        throw mapNetworkError(provider, err);
      }
      wait = backoffMs(attempt);
      continue;
    }

    if (res.ok) return res;

    const body = await res.text().catch(() => "");
    if (!RETRYABLE_STATUS.has(res.status)) {
      // Contrato: a mensagem é a mesma de sempre, com o corpo para depurar.
      throw new Error(`${provider} respondeu ${res.status}: ${body.slice(0, 300)}`);
    }
    lastStatus = res.status;
    lastBody = body;
    wait = retryAfterMs(res.headers.get("retry-after")) ?? backoffMs(attempt);
  }

  throw new Error(overloadMessage(provider, lastStatus, lastBody));
}

export async function postProviderJson<T>(
  provider: string,
  url: string,
  init: RequestInit
): Promise<T> {
  const res = await fetchProvider(provider, url, init);
  const body = await res.text();
  try {
    return JSON.parse(body) as T;
  } catch {
    throw new Error(`${provider} devolveu uma resposta que não é JSON válido.`);
  }
}

/**
 * POST cujo corpo de resposta é um stream SSE (`data: {...}` por evento);
 * itera os payloads JSON já parseados, na ordem. Mesmo contrato de erros do
 * postProviderJson (status != 2xx, timeout/abort — inclusive no meio da
 * leitura, quando o AbortSignal.timeout do chamador estoura).
 */
export async function* streamProviderSse<T>(
  provider: string,
  url: string,
  init: RequestInit
): AsyncGenerator<T> {
  const res = await fetchProvider(provider, url, init);
  if (!res.body) {
    throw new Error(`${provider} não devolveu corpo de resposta.`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      let done: boolean;
      let value: Uint8Array | undefined;
      try {
        ({ done, value } = await reader.read());
      } catch (err) {
        throw mapNetworkError(provider, err);
      }
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, nl).replace(/\r$/, "");
        buffer = buffer.slice(nl + 1);
        if (!line.startsWith("data:")) continue; // comentários/campos SSE fora
        const payload = line.slice(5).trim();
        if (!payload || payload === "[DONE]") continue;
        try {
          yield JSON.parse(payload) as T;
        } catch {
          throw new Error(`${provider} devolveu um evento SSE que não é JSON válido.`);
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}
