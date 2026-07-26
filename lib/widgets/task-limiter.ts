// Versão: 1.0 | Data: 26/07/2026
// Limitador simples de concorrência (sem dependência) — extraído da page do
// dashboard p/ ser compartilhado com a action deferida de widgets de engine
// (runDeferredWidgets): até `max` execuções simultâneas, demais aguardam em
// fila (FIFO). O wrapper devolve a promise do próprio task.
//
// Por que existe: todos os widgets disparando juntos saturam o Postgres num
// dashboard grande (statement timeouts em cascata) e TODOS pioram. O teto
// mantém o paralelismo útil e suaviza o pico; Promise.all internos de um task
// (pernas de métrica, variáveis de calculadora, exprs de nota) não contam.

/** Máximo de widget tasks em voo por render/lote (page e action deferida). */
export const WIDGET_TASK_CONCURRENCY = 8;

export function createTaskLimiter(max: number) {
  let active = 0;
  const queue: (() => void)[] = [];
  return async function run<T>(fn: () => Promise<T>): Promise<T> {
    while (active >= max) {
      await new Promise<void>((resolve) => queue.push(resolve));
    }
    active += 1;
    try {
      return await fn();
    } finally {
      active -= 1;
      queue.shift()?.();
    }
  };
}
