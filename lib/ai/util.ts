// Versão: 1.1 | Data: 26/07/2026
// Utilitários de rede compartilhados pelos adaptadores de IA: POST JSON e
// stream SSE, com mensagens de erro legíveis (status + trecho do corpo) e
// tratamento de timeout/cancelamento (AbortSignal). Segue o estilo fetch
// nativo do projeto (lib/webhooks/deliver.ts, lib/sync/bitrix/client.ts) —
// sem SDK/axios.

function mapNetworkError(provider: string, err: unknown): Error {
  if (
    err instanceof DOMException &&
    (err.name === "TimeoutError" || err.name === "AbortError")
  ) {
    return new Error(`Tempo limite ao chamar ${provider}.`);
  }
  const msg = err instanceof Error ? err.message : String(err);
  return new Error(`Falha de rede ao chamar ${provider}: ${msg}`);
}

export async function postProviderJson<T>(
  provider: string,
  url: string,
  init: RequestInit
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch (err) {
    throw mapNetworkError(provider, err);
  }

  const body = await res.text();
  if (!res.ok) {
    throw new Error(`${provider} respondeu ${res.status}: ${body.slice(0, 300)}`);
  }
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
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch (err) {
    throw mapNetworkError(provider, err);
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`${provider} respondeu ${res.status}: ${body.slice(0, 300)}`);
  }
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
