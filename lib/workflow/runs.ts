// Versão: 1.0 | Data: 09/09/2026
// Leitura do HISTÓRICO de execuções (workflow_runs, 0125/0130).
//
// A tabela existe desde a 0125 e ninguém a via: o executor faz chamadas
// irreversíveis, o resultado é POR PASSO e uma execução pode terminar 'partial'
// (empresa criada, lead falhou). Com a ação `run_schema` isso deixou de ser
// diagnóstico e virou operação — é aqui que se vê o que a simulação FARIA e é
// daqui que sai o "Tentar de novo" que solta a trava de um registro.
//
// Leitura com o client RLS do usuário: a policy da 0125 já recorta (admin vê a
// org, quem executou vê as próprias).
import type { SupabaseClient } from "@supabase/supabase-js";

import type { WorkflowStepOutcome } from "./execute";

export interface WorkflowRunRow {
  id: string;
  schemaKey: string;
  status: "iniciado" | "ok" | "partial" | "error";
  /** 'simulado' = ensaio; nada saiu para o destino. */
  mode: "real" | "simulado";
  error: string | null;
  createdAt: string;
  recordId: string | null;
  /** Registro que DISPAROU (só execução por regra). */
  triggerRecordId: string | null;
  automationRuleId: string | null;
  /** Carimbo do "Tentar de novo": a trava daquele registro foi solta. */
  releasedAt: string | null;
  steps: WorkflowStepOutcome[];
}

const SELECT =
  "id, schema_key, status, mode, error, created_at, record_id, trigger_record_id, automation_rule_id, released_at, steps";

export async function loadWorkflowRuns(
  db: SupabaseClient,
  orgId: string | null,
  limit = 40
): Promise<WorkflowRunRow[]> {
  let q = db
    .from("workflow_runs")
    .select(SELECT)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (orgId) q = q.eq("organization_id", orgId);
  const { data, error } = await q;
  if (error || !data) return [];
  return data.map((r) => ({
    id: r.id as string,
    schemaKey: r.schema_key as string,
    status: (r.status as WorkflowRunRow["status"]) ?? "error",
    mode: r.mode === "simulado" ? "simulado" : "real",
    error: (r.error as string | null) ?? null,
    createdAt: r.created_at as string,
    recordId: (r.record_id as string | null) ?? null,
    triggerRecordId: (r.trigger_record_id as string | null) ?? null,
    automationRuleId: (r.automation_rule_id as string | null) ?? null,
    releasedAt: (r.released_at as string | null) ?? null,
    steps: Array.isArray(r.steps) ? (r.steps as WorkflowStepOutcome[]) : [],
  }));
}

/**
 * A execução pode voltar para a fila? Só o que veio de uma REGRA (o formulário
 * é reenviado pela própria tela), só o que não terminou bem e só uma vez — já
 * liberada, a trava não está mais lá para soltar.
 */
export function runCanRetry(run: WorkflowRunRow): boolean {
  return (
    run.automationRuleId != null &&
    run.triggerRecordId != null &&
    run.releasedAt == null &&
    run.mode === "real" &&
    (run.status === "error" || run.status === "partial" || run.status === "iniciado")
  );
}
