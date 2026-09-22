// v2.0 | 21/09/2026 — testes ajustados para concorrência limitada (até 3 jobs)
import { describe, expect, it, vi } from "vitest";
import { PreviewQueue, type PreviewJob } from "./queue";

function setup() {
  const idle: (() => void)[] = [];
  const queue = new PreviewQueue((fn) => { idle.push(fn); return () => { const i = idle.indexOf(fn); if (i >= 0) idle.splice(i, 1); }; });
  const tick = async () => { idle.shift()?.(); await new Promise((resolve) => setTimeout(resolve, 0)); };
  return { queue, tick, idle };
}
describe("fila de prévias", () => {
  it("preparação serial nunca abre dois dashboards ao mesmo tempo", async () => {
    const callbacks: (() => void)[] = [];
    const queue = new PreviewQueue(fn => { callbacks.push(fn); return () => {}; }, 1);
    let release!: () => void;
    const second = vi.fn();
    queue.enqueue({ bounds: () => ({ top: 0, left: 0 }), run: () => new Promise<void>(resolve => { release = resolve; }) });
    queue.enqueue({ bounds: () => ({ top: 0, left: 100 }), run: second });
    callbacks.shift()?.(); await Promise.resolve();
    expect(second).not.toHaveBeenCalled();
    release(); await new Promise(resolve => setTimeout(resolve, 0));
    callbacks.shift()?.(); await Promise.resolve();
    expect(second).toHaveBeenCalledOnce();
  });
  it("carrega até 3 em paralelo, esquerda→direita e depois a linha seguinte", async () => {
    const { queue, tick } = setup();
    const order: string[] = [];
    const releases: (() => void)[] = [];
    for (const [name, top, left] of [["fourth", 200, 0], ["third", 0, 300], ["second", 0, 200], ["first", 0, 0]] as const) {
      queue.enqueue({ bounds: () => ({ top, left }), run: async () => {
        order.push(name);
        await new Promise<void>((resolve) => { releases.push(resolve); });
      } });
    }
    // v2.0: primeiro tick inicia os 3 primeiros jobs de uma vez (ordenados)
    await tick(); await tick();
    expect(order).toEqual(["first", "second", "third"]);
    // Libera o primeiro; o quarto deve iniciar
    releases[0](); await tick(); await tick();
    expect(order).toEqual(["first", "second", "third", "fourth"]);
  });
  it("navegação cancela os ativos e descarta os pendentes", async () => {
    const { queue, tick } = setup();
    const signals: AbortSignal[] = [];
    const pending = vi.fn();
    // 3 jobs ativos + 1 pendente
    for (let i = 0; i < 3; i++) {
      queue.enqueue({ bounds: () => ({ top: 0, left: i * 100 }), run: (signal) => new Promise((resolve) => {
        signals.push(signal);
        signal.addEventListener("abort", () => resolve());
      }) });
    }
    queue.enqueue({ bounds: () => ({ top: 100, left: 0 }), run: pending });
    await tick();
    queue.stop();
    for (const signal of signals) expect(signal.aborted).toBe(true);
    await tick(); await tick();
    expect(pending).not.toHaveBeenCalled();
  });
  it("uma falha libera a fila e desmontar remove o job pendente", async () => {
    const { queue, tick } = setup();
    const failed: PreviewJob = { bounds: () => ({ top: 0, left: 0 }), run: async () => { throw Error("offline"); } };
    const removed = vi.fn(), next = vi.fn(async () => {});
    queue.enqueue(failed);
    const cancel = queue.enqueue({ bounds: () => ({ top: 0, left: 20 }), run: removed });
    queue.enqueue({ bounds: () => ({ top: 0, left: 30 }), run: next });
    cancel(); await tick(); await tick();
    expect(next).toHaveBeenCalledOnce(); expect(removed).not.toHaveBeenCalled();
  });
  it("pausa ao interagir e permite retomar sem perder os jobs", async () => {
    const { queue, tick } = setup();
    const run = vi.fn(async () => {});
    queue.enqueue({ bounds: () => ({ top: 0, left: 0 }), run });
    queue.pause(); await tick(); expect(run).not.toHaveBeenCalled();
    queue.start(); await tick(); expect(run).toHaveBeenCalledOnce();
  });
});
