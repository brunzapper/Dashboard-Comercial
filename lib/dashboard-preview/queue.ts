export interface PreviewJob {
  bounds: () => { top: number; left: number };
  run: (signal: AbortSignal) => Promise<void>;
}

// v2.0 | 21/09/2026 — concorrência limitada (até MAX_CONCURRENT jobs simultâneos)
const MAX_CONCURRENT = 3;

/** Leituras de captura em paralelo (até 3), linhas de cima para baixo, da esquerda para a direita.
 * O agendador é injetado para testar a fila sem relógio/DOM reais.
 */
export class PreviewQueue {
  private pending = new Set<PreviewJob>();
  private active = new Map<PreviewJob, AbortController>();
  private cancelIdle: (() => void) | null = null;
  private stopped = false;
  constructor(private schedule: (callback: () => void) => () => void) {}

  enqueue(job: PreviewJob) {
    this.pending.add(job);
    this.pump();
    return () => {
      this.pending.delete(job);
      const controller = this.active.get(job);
      if (controller) controller.abort();
    };
  }

  /** Invalida a fila inteira antes de a navegação começar, sem aguardar IO. */
  stop() {
    this.stopped = true;
    this.cancelIdle?.();
    this.cancelIdle = null;
    this.pending.clear();
    for (const controller of this.active.values()) controller.abort();
  }

  start() { this.stopped = false; this.pump(); }

  pause() {
    this.stopped = true;
    this.cancelIdle?.();
    this.cancelIdle = null;
    for (const [job, controller] of this.active) {
      this.pending.add(job);
      controller.abort();
    }
  }

  private pump() {
    if (this.stopped || this.active.size >= MAX_CONCURRENT || this.cancelIdle || !this.pending.size) return;
    this.cancelIdle = this.schedule(() => {
      this.cancelIdle = null;
      if (this.stopped) return;
      const sorted = [...this.pending].sort((a, b) => {
        const x = a.bounds(), y = b.bounds();
        return Math.abs(x.top - y.top) > 4 ? x.top - y.top : x.left - y.left;
      });
      // v2.0: inicia até MAX_CONCURRENT jobs de uma vez
      const slots = MAX_CONCURRENT - this.active.size;
      const batch = sorted.slice(0, slots);
      for (const job of batch) {
        this.pending.delete(job);
        const controller = new AbortController();
        this.active.set(job, controller);
        void Promise.resolve().then(() => {
          if (!controller.signal.aborted) return job.run(controller.signal);
        }).catch(() => {}).finally(() => {
          this.active.delete(job);
          this.pump();
        });
      }
    });
  }
}

/** Cede a thread sem depender de requestIdleCallback: ele pode nunca executar
 * durante animações/atividade contínua. Consumidores pausam na interação e
 * debouncam a preparação; leituras de miniaturas prontas são apenas IO. */
export function schedulePreviewTask(callback: () => void): () => void {
  const timer = setTimeout(callback, 0);
  return () => clearTimeout(timer);
}
