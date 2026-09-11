// Versão: 1.0 | Data: 11/09/2026
// Enquadramento do push (lib/sync/sheets/sweep.ts). A régua que pode APAGAR
// dado vive no SQL (sheet_push_sweep, 0140) e é exercitada no job e2e; aqui o
// contrato é o portão de entrada: o que NÃO é um quadro válido nunca chega a
// pedir varredura, e o modo padrão nunca escreve.
import { describe, expect, it, vi } from "vitest";

import {
  isLastChunk,
  readPushFrame,
  recordPushChunk,
  runSheetSweep,
  sweepMode,
} from "./sweep";

const PUSH = "11111111-1111-4111-8111-111111111111";

describe("readPushFrame", () => {
  it("aceita um quadro completo", () => {
    expect(readPushFrame({ push_id: PUSH, chunk: 1, chunks: 3 })).toEqual({
      pushId: PUSH,
      chunk: 1,
      chunks: 3,
    });
  });

  it("payload do script LEGADO devolve null (e sem quadro não há varredura)", () => {
    expect(readPushFrame({ rows: [] })).toBeNull();
  });

  it.each([
    ["push_id que não é uuid", { push_id: "abc", chunk: 1, chunks: 1 }],
    ["chunk zero", { push_id: PUSH, chunk: 0, chunks: 1 }],
    ["chunk maior que o total", { push_id: PUSH, chunk: 3, chunks: 2 }],
    ["total zero", { push_id: PUSH, chunk: 1, chunks: 0 }],
    ["chunk fracionário", { push_id: PUSH, chunk: 1.5, chunks: 2 }],
    ["chunk ausente", { push_id: PUSH, chunks: 2 }],
  ])("recusa %s", (_label, payload) => {
    expect(readPushFrame(payload as Record<string, unknown>)).toBeNull();
  });
});

describe("isLastChunk", () => {
  it("só o último chunk fecha o quadro", () => {
    expect(isLastChunk({ pushId: PUSH, chunk: 1, chunks: 2 })).toBe(false);
    expect(isLastChunk({ pushId: PUSH, chunk: 2, chunks: 2 })).toBe(true);
    expect(isLastChunk({ pushId: PUSH, chunk: 1, chunks: 1 })).toBe(true);
  });
});

describe("sweepMode", () => {
  it("o padrão é ENSAIO — ligar a varredura é decisão explícita", () => {
    expect(sweepMode({})).toBe("dry");
    expect(sweepMode({ SHEET_SWEEP_MODE: "" })).toBe("dry");
    expect(sweepMode({ SHEET_SWEEP_MODE: "talvez" })).toBe("dry");
  });

  it("reconhece on/off", () => {
    expect(sweepMode({ SHEET_SWEEP_MODE: "on" })).toBe("on");
    expect(sweepMode({ SHEET_SWEEP_MODE: " OFF " })).toBe("off");
  });
});

describe("chamadas ao banco", () => {
  it("recordPushChunk repassa o quadro e a marca de envenenado", async () => {
    const rpc = vi.fn().mockResolvedValue({ error: null });
    const res = await recordPushChunk({ rpc } as never, {
      frame: { pushId: PUSH, chunk: 2, chunks: 2 },
      organizationId: "org-1",
      recordType: "venda_site",
      sourceSystem: "sheet_site",
      seenSourceIds: ["a", "b"],
      poisoned: true,
    });
    expect(res.ok).toBe(true);
    expect(rpc).toHaveBeenCalledWith("sync_push_record_chunk", {
      p_push_id: PUSH,
      p_source_system: "sheet_site",
      p_record_type: "venda_site",
      p_organization_id: "org-1",
      p_chunk: 2,
      p_chunks: 2,
      p_source_ids: ["a", "b"],
      p_poisoned: true,
    });
  });

  it("erro ao registrar o chunk é reportado, não engolido", async () => {
    const rpc = vi.fn().mockResolvedValue({ error: { message: "boom" } });
    const res = await recordPushChunk({ rpc } as never, {
      frame: { pushId: PUSH, chunk: 1, chunks: 1 },
      organizationId: "org-1",
      recordType: "venda_site",
      sourceSystem: "sheet_site",
      seenSourceIds: [],
      poisoned: false,
    });
    expect(res).toEqual({ ok: false, error: "boom" });
  });

  it("runSheetSweep manda o teto e o modo ensaio", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { status: "dry_run" }, error: null });
    const report = await runSheetSweep({ rpc } as never, PUSH, { dryRun: true });
    expect(rpc).toHaveBeenCalledWith("sheet_push_sweep", {
      p_push_id: PUSH,
      p_max_ratio: 0.1,
      p_min_rows: 1,
      p_dry_run: true,
    });
    expect(report.status).toBe("dry_run");
  });

  it("falha no RPC vira status de erro, nunca uma varredura silenciosa", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { message: "nope" } });
    const report = await runSheetSweep({ rpc } as never, PUSH, { dryRun: false });
    expect(report.status).toContain("nope");
  });
});
