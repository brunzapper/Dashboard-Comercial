import { describe, expect, it, vi } from "vitest";
import { PreviewQueue, type PreviewJob } from "./queue";

function setup() {
  const idle: (() => void)[] = [];
  const queue = new PreviewQueue((fn) => { idle.push(fn); return () => { const i = idle.indexOf(fn); if (i >= 0) idle.splice(i, 1); }; });
  const tick = async () => { idle.shift()?.(); await new Promise((resolve) => setTimeout(resolve, 0)); };
  return { queue, tick, idle };
}
describe("fila de prévias", () => {
  it("carrega uma por vez, esquerda→direita e depois a linha seguinte, não na ordem de inscrição", async () => {
    const { queue, tick } = setup();
    const order: string[] = [];
    let release!: () => void;
    for (const [name, top, left] of [["third", 200, 0], ["second", 0, 200], ["first", 0, 0]] as const) {
      queue.enqueue({ bounds: () => ({ top, left }), run: async () => {
        order.push(name);
        if (name === "first") await new Promise<void>((resolve) => { release = resolve; });
      } });
    }
    await tick(); await tick();
    expect(order).toEqual(["first"]);
    release(); await tick(); await tick(); await tick();
    expect(order).toEqual(["first", "second", "third"]);
  });
  it("navegação cancela o ativo e descarta os próximos imediatamente", async () => {
    const { queue, tick } = setup();
    let active!: AbortSignal;
    const next = vi.fn();
    queue.enqueue({ bounds: () => ({ top: 0, left: 0 }), run: (signal) => new Promise((resolve) => {
      active = signal;
      signal.addEventListener("abort", () => resolve());
    }) });
    queue.enqueue({ bounds: () => ({ top: 0, left: 100 }), run: next });
    await tick(); queue.stop();
    expect(active.aborted).toBe(true);
    await tick(); await tick();
    expect(next).not.toHaveBeenCalled();
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
