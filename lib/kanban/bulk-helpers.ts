// Versão: 1.0 | Data: 27/07/2026
// Helpers PUROS das ações em massa do kanban (testáveis sem banco): contrato
// de resultado POR ITEM (o cliente reverte só os cards que falharam), chunking
// e fan-out de um resultado único p/ vários itens (caminhos all-or-nothing,
// ex.: upsert multi-linha de kanban_placements).

/** Resultado de UM item de uma ação em massa. */
export interface BulkItemResult {
  id: string;
  ok: boolean;
  message?: string;
}

/** Estado de retorno das ações em massa (results por item p/ revert parcial). */
export interface BulkActionState {
  ok?: boolean;
  message?: string;
  results?: BulkItemResult[];
}

/** Teto de itens por CHAMADA de action (o cliente fatia antes). */
export const BULK_MAX_ITEMS = 200;

export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Mesmo resultado p/ todos os ids (caminho all-or-nothing). */
export function fanOut(
  ids: string[],
  ok: boolean,
  message?: string
): BulkItemResult[] {
  return ids.map((id) => ({ id, ok, ...(message ? { message } : {}) }));
}

/**
 * Resultado por item a partir do conjunto de ids CONFIRMADOS (ex.: `.select`
 * pós-update/delete — id ausente = RLS bloqueou aquele item).
 */
export function resultsFromReturned(
  requested: string[],
  returned: Iterable<string>,
  failMessage: string
): BulkItemResult[] {
  const okSet = new Set(returned);
  return requested.map((id) =>
    okSet.has(id) ? { id, ok: true } : { id, ok: false, message: failMessage }
  );
}

/** Ids que falharam num conjunto de resultados. */
export function failedIds(results: BulkItemResult[]): string[] {
  return results.filter((r) => !r.ok).map((r) => r.id);
}

/** Mapa auxiliar com limite de concorrência (updates por linha). */
export async function mapLimited<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      for (;;) {
        const i = next++;
        if (i >= items.length) return;
        out[i] = await fn(items[i]);
      }
    })
  );
  return out;
}
