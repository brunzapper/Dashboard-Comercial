export interface PreviewJob {
  bounds: () => { top: number; left: number };
  run: (signal: AbortSignal) => Promise<void>;
}

/** Uma leitura de captura por vez, linhas de cima para baixo, da esquerda para a direita.
 * O agendador é injetado para testar a fila sem relógio/DOM reais.
 */
export class PreviewQueue {
  private pending = new Set<PreviewJob>();
  private active: { job: PreviewJob; controller: AbortController } | null = null;
  private cancelIdle: (() => void) | null = null;
  private stopped = false;
  constructor(private schedule: (callback: () => void) => () => void) {}

  enqueue(job: PreviewJob) {
    this.pending.add(job);
    this.pump();
    return () => {
      this.pending.delete(job);
      if (this.active?.job === job) this.active.controller.abort();
    };
  }

  /** Invalida a fila inteira antes de a navegação começar, sem aguardar IO. */
  stop() {
    this.stopped = true;
    this.cancelIdle?.();
    this.cancelIdle = null;
    this.pending.clear();
    this.active?.controller.abort();
  }

  start() { this.stopped = false; this.pump(); }

  pause() {
    this.stopped = true;
    this.cancelIdle?.();
    this.cancelIdle = null;
    if (this.active) {
      this.pending.add(this.active.job);
      this.active.controller.abort();
    }
  }

  private pump() {
    if (this.stopped || this.active || this.cancelIdle || !this.pending.size) return;
    this.cancelIdle = this.schedule(() => {
      this.cancelIdle = null;
      if (this.stopped) return;
      const job = [...this.pending].sort((a, b) => {
        const x = a.bounds(), y = b.bounds();
        return Math.abs(x.top - y.top) > 4 ? x.top - y.top : x.left - y.left;
      })[0];
      if (!job) return;
      this.pending.delete(job);
      const controller = new AbortController();
      this.active = { job, controller };
      // Uma prévia com erro nunca segura as próximas nem gera rejeição global.
      void Promise.resolve().then(() => {
        if (!controller.signal.aborted) return job.run(controller.signal);
      }).catch(() => {}).finally(() => {
        this.active = null;
        this.pump();
      });
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
