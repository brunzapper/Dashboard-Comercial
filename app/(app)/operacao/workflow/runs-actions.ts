// Versão: 1.0 | Data: 09/09/2026
// Retentativa MANUAL de uma execução de esquema (0130).
//
// A regra de produto: falha NÃO se repete sozinha. Uma entidade duplicada num
// sistema externo é sujeira que alguém limpa à mão; um registro que faltou
// aparece no erro da regra e na tarefa de notificação. O caminho de volta é
// esta action — um humano decide, carimba `released_at` e a próxima rodada
// reconsidera aquele registro.
//
// Não reexecuta na hora de propósito: o motor é o tick, e reexecutar aqui seria
// um segundo caminho de execução para manter em pé.
"use server";

import { revalidatePath } from "next/cache";

import { isSettingsAreaDenied } from "@/lib/auth/access";
import { getSessionInfo } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

export interface RetryRunState {
  ok?: boolean;
  message?: string;
}

export async function retryWorkflowRun(
  runId: string,
  opts: { revalidate?: boolean } = {}
): Promise<RetryRunState> {
  const session = await getSessionInfo();
  if (!session) return { ok: false, message: "Sessão expirada." };
  if (!session.roles.includes("admin")) {
    return { ok: false, message: "Apenas administradores podem liberar uma execução." };
  }
  if (await isSettingsAreaDenied("workflow")) {
    return { ok: false, message: "Acesso a esta área foi bloqueado." };
  }

  const supabase = await createClient();
  // O filtro É a guarda: execução de formulário, já liberada, simulada ou que
  // terminou bem não tem trava para soltar — e o update não acha linha.
  const { data, error } = await supabase
    .from("workflow_runs")
    .update({ released_at: new Date().toISOString() })
    .eq("id", runId)
    .eq("mode", "real")
    .is("released_at", null)
    .not("automation_rule_id", "is", null)
    .not("trigger_record_id", "is", null)
    .in("status", ["error", "partial", "iniciado"])
    .select("id")
    .maybeSingle();
  if (error) return { ok: false, message: `Falha ao liberar: ${error.message}` };
  if (!data) {
    return {
      ok: false,
      message: "Esta execução não pode ser liberada (já foi, ou não veio de uma regra).",
    };
  }

  if (opts.revalidate !== false) revalidatePath("/operacao/workflow");
  return { ok: true, message: "Registro devolvido à fila — a próxima rodada tenta de novo." };
}
