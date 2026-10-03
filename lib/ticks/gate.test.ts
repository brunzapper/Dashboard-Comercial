// Versão: 1.0 | Data: 03/10/2026
// PORTÃO DE MUDANÇA dos ticks (0151). O que está em risco aqui é o tick PULAR
// uma rodada que tinha trabalho — por isso os testes pinam: a regra de
// decisão, o FAIL-OPEN (RPC ausente/erro ⇒ roda, como antes do portão), o
// commit só com seq conhecida, a "Última execução" vista pela UI e a guarda
// ESTÁTICA de que toda tabela de TICK_GATE_TABLES tem o trigger na migração.
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { fakeSupabase } from "@/tests/helpers/fake-supabase";

import {
  beginTickGate,
  commitTickGate,
  latestIso,
  shouldRunTick,
  TICK_GATE_KEYS,
  TICK_GATE_TABLES,
  withTickCheck,
} from "./gate";

const NOW = { seq: 42, today: "2026-10-03", ms: Date.parse("2026-10-03T12:00:00Z") };
const SETTLED = {
  seenSeq: 42,
  seenDay: "2026-10-03",
  pendingConfirm: false,
  lastFullAt: NOW.ms - 5 * 60_000,
};

describe("shouldRunTick", () => {
  it("nada mudou, mesmo dia, rodada recente ⇒ pula", () => {
    expect(shouldRunTick(SETTLED, NOW)).toBe(false);
  });

  it("seq avançou (algum dado mudou) ⇒ roda", () => {
    expect(shouldRunTick({ ...SETTLED, seenSeq: 41 }, NOW)).toBe(true);
  });

  it("o dia de Brasília virou ⇒ roda (condições são por DIA)", () => {
    expect(shouldRunTick({ ...SETTLED, seenDay: "2026-10-02" }, NOW)).toBe(true);
  });

  it("confirmação pendente da rodada anterior ⇒ roda", () => {
    expect(shouldRunTick({ ...SETTLED, pendingConfirm: true }, NOW)).toBe(true);
  });

  it("rede de segurança: rodada completa velha demais ⇒ roda", () => {
    expect(
      shouldRunTick({ ...SETTLED, lastFullAt: NOW.ms - 61 * 60_000 }, NOW)
    ).toBe(true);
    expect(shouldRunTick({ ...SETTLED, lastFullAt: null }, NOW)).toBe(true);
  });

  it("sem estado gravado ⇒ roda", () => {
    expect(shouldRunTick(null, NOW)).toBe(true);
  });
});

describe("beginTickGate / commitTickGate", () => {
  it("RPC ausente ⇒ FAIL-OPEN (roda, sem seq para gravar)", async () => {
    const { db } = fakeSupabase({}); // fail-closed: rpc sem handler lança
    const gate = await beginTickGate(db, TICK_GATE_KEYS.kanbanAutomations);
    expect(gate.run).toBe(true);
    expect(gate.seq).toBeNull();
  });

  it("RPC com erro ⇒ FAIL-OPEN", async () => {
    const { db } = fakeSupabase({
      rpc: { tick_gate_begin: () => ({ data: null, error: { message: "x" } }) },
    });
    const gate = await beginTickGate(db, TICK_GATE_KEYS.kanbanAutomations);
    expect(gate.run).toBe(true);
  });

  it("decide pelo banco e grava a seq LIDA NO INÍCIO", async () => {
    const { db, rpcCalls } = fakeSupabase({
      rpc: {
        tick_gate_begin: () => ({ data: { run: true, seq: 7 }, error: null }),
        tick_gate_commit: () => ({ data: null, error: null }),
      },
    });
    const gate = await beginTickGate(
      db,
      TICK_GATE_KEYS.mirrorSweep,
      new Date("2026-10-03T02:30:00Z") // ainda dia 02 em Brasília
    );
    expect(gate).toMatchObject({ run: true, seq: 7, today: "2026-10-02" });
    await commitTickGate(db, gate);
    expect(rpcCalls.at(-1)).toEqual({
      fn: "tick_gate_commit",
      args: { p_key: "sync-mirror-sweep", p_seq: 7, p_today: "2026-10-02" },
    });
  });

  it("nada a fazer ⇒ run=false", async () => {
    const { db } = fakeSupabase({
      rpc: { tick_gate_begin: () => ({ data: { run: false, seq: 7 }, error: null }) },
    });
    const gate = await beginTickGate(db, TICK_GATE_KEYS.kanbanAutomations);
    expect(gate.run).toBe(false);
  });

  it("sem seq conhecida o commit não grava nada", async () => {
    const { db, rpcCalls } = fakeSupabase({});
    await commitTickGate(db, {
      key: TICK_GATE_KEYS.kanbanAutomations,
      run: true,
      seq: null,
      today: "2026-10-03",
    });
    expect(rpcCalls).toHaveLength(0);
  });
});

describe("Última execução (withTickCheck)", () => {
  const row = {
    enabled: true,
    last_run_at: "2026-10-03T10:00:00.000Z",
    last_moved_count: 3,
  };

  it("verificação mais nova ⇒ instante dela e 0 ações (minuto sem mudança)", () => {
    expect(withTickCheck(row, "2026-10-03T10:05:00.000Z")).toEqual({
      enabled: true,
      last_run_at: "2026-10-03T10:05:00.000Z",
      last_moved_count: 0,
    });
  });

  it("rodada mais nova que a verificação ⇒ intacta", () => {
    expect(withTickCheck(row, "2026-10-03T09:00:00.000Z")).toBe(row);
  });

  it("regra desligada ou nunca rodada ⇒ intacta", () => {
    const off = { ...row, enabled: false };
    expect(withTickCheck(off, "2026-10-03T10:05:00.000Z")).toBe(off);
    const never = { ...row, last_run_at: null };
    expect(withTickCheck(never, "2026-10-03T10:05:00.000Z")).toBe(never);
  });

  it("latestIso é null-safe", () => {
    expect(latestIso(null, null)).toBeNull();
    expect(latestIso("2026-01-01T00:00:00Z", null)).toBe("2026-01-01T00:00:00Z");
    expect(latestIso(null, "2026-01-01T00:00:00Z")).toBe("2026-01-01T00:00:00Z");
  });
});

describe("guarda estática: trigger da 0151 ↔ TICK_GATE_TABLES", () => {
  const sql = readFileSync(
    join(process.cwd(), "supabase/migrations/0151_tick_change_gate.sql"),
    "utf8"
  );
  const block = sql.match(/foreach t in array array\[([\s\S]*?)\]/)?.[1] ?? "";
  const tables = [...block.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);

  it("as duas listas são a mesma (tabela nova lida pelo tick DEVE ter o trigger)", () => {
    expect([...tables].sort()).toEqual([...TICK_GATE_TABLES].sort());
  });

  it("automation_rules só acorda o tick por coluna de CONFIGURAÇÃO", () => {
    const rules = sql.match(
      /create trigger trg_bump_data_change_seq\s+after insert or delete\s+or update of ([^\n]+)\s+on public\.automation_rules/
    );
    expect(rules).not.toBeNull();
    const cols = rules![1].split(",").map((c) => c.trim());
    expect(cols).not.toContain("last_run_at");
    expect(cols).not.toContain("last_error");
    expect(cols).not.toContain("last_moved_count");
    expect(cols).toEqual(
      expect.arrayContaining(["rule", "enabled", "widget_id", "board_id", "source_key"])
    );
  });
});
