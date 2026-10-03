// Versão: 1.0 | Data: 03/10/2026
// `loadSyncTickState` (runner v1.8, 0151): o estado ocioso do tick de sync
// numa RPC. Pinado: o mapeamento da RPC e o FALLBACK — sem a RPC, os helpers
// de sempre e as filas contam como pendentes (o dreno consulta, como antes).
import { describe, expect, it } from "vitest";

import { fakeSupabase } from "@/tests/helpers/fake-supabase";

import { loadSyncTickState } from "./runner";

describe("loadSyncTickState", () => {
  it("lê tudo de UMA RPC", async () => {
    const { db, rpcCalls, queries } = fakeSupabase({
      rpc: {
        sync_tick_state: () => ({
          data: {
            staled: 1,
            running: null,
            last_auto_reconcile_at: "2026-10-03T10:00:00+00:00",
            writeback_pending: false,
            task_mirror_pending: true,
          },
          error: null,
        }),
      },
    });
    const state = await loadSyncTickState(db);
    expect(state).toEqual({
      staled: 1,
      running: null,
      lastAutoReconcileAt: Date.parse("2026-10-03T10:00:00Z"),
      writebackPending: false,
      taskMirrorPending: true,
    });
    expect(rpcCalls).toHaveLength(1);
    expect(queries).toHaveLength(0);
  });

  it("sem a RPC ⇒ consultas de sempre e filas tratadas como pendentes", async () => {
    const { db } = fakeSupabase({
      rpc: {
        sync_tick_state: () => ({ data: null, error: { message: "não existe" } }),
      },
      tables: { sync_jobs: () => ({ data: null, error: null }) },
    });
    const state = await loadSyncTickState(db);
    expect(state.running).toBeNull();
    expect(state.writebackPending).toBe(true);
    expect(state.taskMirrorPending).toBe(true);
  });
});
