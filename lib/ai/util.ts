// Versão: 1.0 | Data: 23/07/2026
// Utilitário de rede compartilhado pelos adaptadores de IA: um POST JSON com
// mensagens de erro legíveis (status + trecho do corpo) e tratamento de
// timeout/cancelamento (AbortSignal). Segue o estilo fetch nativo do projeto
// (lib/webhooks/deliver.ts, lib/sync/bitrix/client.ts) — sem SDK/axios.

export async function postProviderJson<T>(
  provider: string,
  url: string,
  init: RequestInit
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch (err) {
    if (
      err instanceof DOMException &&
      (err.name === "TimeoutError" || err.name === "AbortError")
    ) {
      throw new Error(`Tempo limite ao chamar ${provider}.`);
    }
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Falha de rede ao chamar ${provider}: ${msg}`);
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
