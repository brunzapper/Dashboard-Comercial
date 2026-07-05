// Versão: 1.0 | Data: 05/07/2026
// Client HTTP do Bitrix24 (webhook de entrada). Retry com backoff exponencial
// em QUERY_LIMIT_EXCEEDED (3s → 6s → 12s), paginação de 50 itens (parâmetro
// `start`) e pausa entre páginas para respeitar o rate limit.
import { getBitrixWebhookUrl } from "@/lib/env";

export interface BitrixResponse<T> {
  result: T;
  error?: string;
  error_description?: string;
  total?: number;
  next?: number;
}

const RETRY_DELAYS_MS = [3000, 6000, 12000];
const PAGE_PAUSE_MS = 600;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class BitrixClient {
  private base: string;

  constructor(webhookUrl?: string) {
    const url = webhookUrl ?? getBitrixWebhookUrl();
    this.base = url.endsWith("/") ? url : `${url}/`;
  }

  /** Chama um método REST do Bitrix, com retry em rate limit. */
  async call<T>(
    method: string,
    params: Record<string, unknown> = {}
  ): Promise<BitrixResponse<T>> {
    const endpoint = `${this.base}${method}.json`;
    let attempt = 0;

    for (;;) {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(params),
      });

      const text = await res.text();
      let data: BitrixResponse<T>;
      try {
        data = JSON.parse(text) as BitrixResponse<T>;
      } catch {
        throw new Error(
          `Bitrix ${method}: resposta inválida (HTTP ${res.status})`
        );
      }

      if (data.error) {
        if (
          data.error === "QUERY_LIMIT_EXCEEDED" &&
          attempt < RETRY_DELAYS_MS.length
        ) {
          await sleep(RETRY_DELAYS_MS[attempt]);
          attempt += 1;
          continue;
        }
        throw new Error(
          `Bitrix ${method} falhou: ${data.error} ${data.error_description ?? ""}`.trim()
        );
      }

      return data;
    }
  }

  /**
   * Lista paginada (crm.deal.list, crm.lead.list, ...). Percorre todas as
   * páginas via `start`/`next`, com pausa entre elas. Retorna todos os itens.
   */
  async listAll<T>(
    method: string,
    params: Record<string, unknown> = {}
  ): Promise<T[]> {
    const out: T[] = [];
    let start = 0;

    for (;;) {
      const data = await this.call<T[]>(method, { ...params, start });
      const items = data.result ?? [];
      out.push(...items);

      if (typeof data.next === "number") {
        start = data.next;
        await sleep(PAGE_PAUSE_MS);
      } else {
        break;
      }
    }

    return out;
  }
}
