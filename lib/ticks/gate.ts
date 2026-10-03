// Versão: 1.0 | Data: 03/10/2026
// PORTÃO DE MUDANÇA dos ticks de minuto (0151). Redução do log ingestion do
// Supabase SEM mudar comportamento: o tick de automações recarregava catálogo,
// universo e fatos (~60 requisições) a cada minuto, e só 20 dos 1.440 minutos
// do dia tinham qualquer mudança de dado. Como toda condição de automação,
// série e ritual tem granularidade de DIA, o resultado de uma rodada só muda
// se (a) algum dado mudar — `data_change_seq` avança por trigger em toda
// tabela listada em TICK_GATE_TABLES — ou (b) o dia de Brasília virar.
//
// Contrato:
//   - `beginTickGate` = UMA requisição (`tick_gate_begin`): carimba
//     `checked_at` (é o "Última execução" da UI) e diz se há o que fazer.
//   - `commitTickGate` SÓ depois de uma rodada COMPLETA (sem corte de
//     orçamento/teto e sem erro). Rodada incompleta não faz commit e o
//     minuto seguinte roda de novo — a retentativa de sempre.
//   - FAIL-OPEN: RPC ausente (migração não aplicada) ou com erro ⇒ roda, como
//     antes do portão. O portão economiza; nunca decide deixar de trabalhar.
import type { SupabaseClient } from "@supabase/supabase-js";

import { todayBrasiliaIso } from "@/lib/date/today";

/**
 * Tabelas cujo trigger `trg_bump_data_change_seq` (0151) acorda os ticks.
 * Tabela NOVA lida por uma rodada gated DEVE entrar aqui E na migração —
 * `lib/ticks/gate.test.ts` compara as duas listas. Sem o trigger, uma mudança
 * só seria vista pela rede de segurança (TICK_GATE_MAX_AGE_MINUTES).
 * `automation_rules` tem trigger próprio (row-level, só colunas de config).
 */
export const TICK_GATE_TABLES = [
  "records",
  "tasks",
  "kanban_placements",
  "record_attributes",
  "record_matches",
  "audit_log",
  "series_settings",
  "tree_nodes",
  "non_working_days",
  "workflow_runs",
  "widgets",
  "dashboards",
  "field_definitions",
  "field_correspondences",
  "field_correspondence_members",
  "data_sources",
  "sub_sources",
  "responsibles",
  "responsible_operations",
  "operations",
  "sync_config",
  "workflow_schemas",
] as const;

/** Rede de segurança: rodada completa ao menos a cada N minutos. */
export const TICK_GATE_MAX_AGE_MINUTES = 60;

/** Chaves de `tick_gates` — uma por rodada gated. */
export const TICK_GATE_KEYS = {
  kanbanAutomations: "kanban-automations",
  mirrorSweep: "sync-mirror-sweep",
} as const;
export type TickGateKey = (typeof TICK_GATE_KEYS)[keyof typeof TICK_GATE_KEYS];

export interface TickGate {
  key: TickGateKey;
  /** Há o que fazer (ou o portão falhou aberto). */
  run: boolean;
  /** Seq lida ANTES da rodada — é ela que o commit grava. null = fail-open. */
  seq: number | null;
  today: string;
}

/**
 * Decisão PURA (espelho da do `tick_gate_begin`) — documenta e testa a regra
 * sem banco.
 */
export function shouldRunTick(
  state: {
    seenSeq: number | null;
    seenDay: string | null;
    pendingConfirm: boolean;
    lastFullAt: number | null;
  } | null,
  now: { seq: number; today: string; ms: number },
  maxAgeMinutes = TICK_GATE_MAX_AGE_MINUTES
): boolean {
  if (!state) return true;
  if (state.seenSeq !== now.seq) return true;
  if (state.seenDay !== now.today) return true;
  if (state.pendingConfirm) return true;
  if (state.lastFullAt == null) return true;
  return now.ms - state.lastFullAt > Math.max(1, maxAgeMinutes) * 60_000;
}

export async function beginTickGate(
  db: SupabaseClient,
  key: TickGateKey,
  now: Date = new Date()
): Promise<TickGate> {
  const today = todayBrasiliaIso(now);
  try {
    const { data, error } = await db.rpc("tick_gate_begin", {
      p_key: key,
      p_today: today,
      p_max_age_minutes: TICK_GATE_MAX_AGE_MINUTES,
    });
    if (error || !data || typeof data !== "object") {
      return { key, run: true, seq: null, today };
    }
    const d = data as { run?: unknown; seq?: unknown };
    const seq = Number(d.seq);
    return {
      key,
      run: d.run !== false,
      seq: Number.isFinite(seq) ? seq : null,
      today,
    };
  } catch {
    return { key, run: true, seq: null, today };
  }
}

/** Grava a seq lida no begin — só após rodada COMPLETA. Best-effort. */
export async function commitTickGate(
  db: SupabaseClient,
  gate: TickGate
): Promise<void> {
  if (gate.seq == null) return;
  try {
    await db.rpc("tick_gate_commit", {
      p_key: gate.key,
      p_seq: gate.seq,
      p_today: gate.today,
    });
  } catch {
    // Sem commit o próximo tick só roda de novo — nunca perde trabalho.
  }
}

/**
 * Quando o tick VERIFICOU pela última vez (mesmo pulando a rodada). A UI usa
 * `max(regra.last_run_at, isto)` em "Última execução": com o portão, o
 * `last_run_at` da regra só anda quando houve rodada de fato. Service client.
 */
export async function loadTickCheckedAt(
  db: SupabaseClient,
  key: TickGateKey
): Promise<string | null> {
  try {
    const { data } = await db
      .from("tick_gates")
      .select("checked_at")
      .eq("key", key)
      .maybeSingle();
    return (data?.checked_at as string | null | undefined) ?? null;
  } catch {
    return null;
  }
}

/** O mais recente entre dois instantes ISO (null-safe). */
export function latestIso(
  a: string | null | undefined,
  b: string | null | undefined
): string | null {
  if (!a) return b ?? null;
  if (!b) return a;
  return Date.parse(b) > Date.parse(a) ? b : a;
}

/**
 * "Última execução" de uma regra vista pelo tick: o `last_run_at` gravado só
 * anda em rodada de fato, mas o tick VERIFICA todo minuto. Regra habilitada
 * que já rodou alguma vez exibe a verificação mais recente — e, se ela é mais
 * nova que a rodada, `0` ações (minuto sem mudança = nenhuma ação), que é
 * exatamente o que a tela mostrava antes do portão. Regra desligada ou nunca
 * rodada fica como está.
 */
export function withTickCheck<
  T extends {
    enabled: boolean;
    last_run_at: string | null;
    last_moved_count: number;
  },
>(row: T, checkedAt: string | null): T {
  if (!row.enabled || !row.last_run_at || !checkedAt) return row;
  const latest = latestIso(row.last_run_at, checkedAt);
  if (latest === row.last_run_at) return row;
  return { ...row, last_run_at: latest, last_moved_count: 0 };
}
