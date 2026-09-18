// Versão: 1.2 | Data: 17/09/2026
// v1.2 (17/09/2026): as duas entradas de IA EXTERNA do painel —
//   `copyDashboardAiPrompt` (o prompt COM o estado atual do board) e
//   `pasteDashboardAiJson` (confere o JSON colado e o guarda como PRÉVIA).
//   A colagem grava `pending` na linha da sessão, então o "Aplicar" existente
//   serve às duas origens sem mudar nada: ele já lê o JSON do BANCO. Com isso
//   a colagem herda o Desfazer, o Descartar e a sobrevivência a um F5.
// Versão: 1.1 | Data: 26/07/2026
// Sessão PERSISTIDA da edição com IA dentro do dashboard (painel "Editar com
// IA"). Uma linha por (usuário, dashboard) em `dashboard_ai_sessions` (0098):
//   - O SERVIDOR é a fonte de verdade dos turnos: o cliente envia só a mensagem
//     nova; os turnos anteriores saem do banco e alimentam o mesmo núcleo de
//     geração (stateless, cap MAX_PRIOR_TURNS) — o fluxo da Home
//     (ImportDashboardSheet) segue intocado.
//   - A prévia pendente (auto-aplicar OFF) também persiste: applyAiEditPending
//     lê o JSON do banco (nada bruto viaja do cliente) e a prévia sobrevive a F5.
//   - O snapshot pré-turno do último apply é o "Desfazer edição da IA",
//     DB-backed: undoAiEditSession restaura e limpa. Recomeçar zera
//     turns/chat/pending mas MANTÉM o undo (a última edição continua no board —
//     apagar o snapshot deixaria o usuário sem como desfazê-la).
//   - Toda action devolve o estado canônico completo (chat/pendingSummary/
//     hasUndo) — o cliente substitui o estado inteiro, sem merge.
// Gate (antes de qualquer leitura/escrita): permissão create_dashboards +
// dono/admin do board (espelho do núcleo de geração/applyDashboardEditJson;
// RLS own-row + org como muralha).
// v1.1 (26/07/2026): gate/linha da sessão/corpo do turno extraídos para
//   lib/ai/edit-session.ts (runAiEditTurnCore + helpers) SEM mudança de
//   comportamento — o route handler de streaming ai-turn (raciocínio ao vivo)
//   roda o MESMO turno pelos mesmos choke points; o turno do painel passa a
//   entrar por lá, e runAiEditTurn permanece como wrapper equivalente
//   não-streaming.
"use server";

import {
  gateAiEdit,
  gateError,
  loadRow,
  runAiEditTurnCore,
  saveRow,
  stateFrom,
  // NÃO re-exportar estes tipos daqui: o compilador de módulos "use server"
  // (Turbopack) emite `export type {...}` como re-export de VALOR e TODAS as
  // actions da página quebram em runtime. Consumidores importam de
  // @/lib/ai/edit-session (import type é apagado no build).
  type AiEditSessionState,
  type SessionRow,
} from "@/lib/ai/edit-session";
import { restoreDashboardSnapshot } from "@/app/(app)/dashboards/actions";
import { applyGeneratedDashboard } from "@/app/(app)/dashboards/ai-generate-actions";
import {
  buildDashboardPromptCore,
  previewDashboardJsonCore,
} from "@/lib/ai/generate-dashboard";
import type { ImportPromptVariant } from "@/app/(app)/dashboards/import-prompt-actions";

/** Estado persistido da sessão (abre o painel / F5). */
export async function loadAiEditSession(
  dashboardId: string
): Promise<AiEditSessionState> {
  const gate = await gateAiEdit(dashboardId);
  if (!gate.ok) return gateError(gate.message);
  const row = await loadRow(gate.supabase, gate.userId, dashboardId);
  return stateFrom(row);
}

/**
 * Um turno da conversa (wrapper não-streaming de runAiEditTurnCore — o painel
 * usa a rota ai-turn para ver o raciocínio ao vivo; o resultado é o mesmo).
 */
export async function runAiEditTurn(
  dashboardId: string,
  message: string,
  autoApply: boolean
): Promise<AiEditSessionState> {
  return runAiEditTurnCore(dashboardId, message, autoApply);
}

/**
 * Prompt para IA EXTERNA, deste board. Mesmo SPEC/modelo/estado do turno ao
 * vivo — uma entrada, um contrato. Não exige IA configurada.
 */
export async function copyDashboardAiPrompt(
  dashboardId: string,
  variant: ImportPromptVariant
): Promise<{ ok: boolean; prompt?: string; message?: string }> {
  const gate = await gateAiEdit(dashboardId);
  if (!gate.ok) return { ok: false, message: gate.message };
  return buildDashboardPromptCore({
    mode: "edit",
    targetDashboardId: dashboardId,
    variant,
  });
}

/**
 * Confere um JSON COLADO de IA externa e o guarda como PRÉVIA da sessão.
 *
 * A colagem entra pela MESMA porta da prévia da IA interna: gravando `pending`
 * na linha, o "Aplicar" existente (que lê o JSON do BANCO) serve aos dois sem
 * mudar uma linha — e a colagem herda de graça o Desfazer, o Descartar e a
 * sobrevivência a um F5. Nunca respeita auto-aplicar: quem cola de fora
 * precisa ver o que vai entrar.
 */
export async function pasteDashboardAiJson(
  dashboardId: string,
  raw: string
): Promise<AiEditSessionState> {
  const gate = await gateAiEdit(dashboardId);
  if (!gate.ok) return gateError(gate.message);
  const row = await loadRow(gate.supabase, gate.userId, dashboardId);

  const res = await previewDashboardJsonCore(raw, {
    mode: "edit",
    targetDashboardId: dashboardId,
  });

  const next: SessionRow = { ...row, chat: [...row.chat] };
  next.chat.push({ kind: "user", text: "(JSON colado de IA externa)" });
  if (res.ok && res.pendingJson) {
    next.pending = { json: res.pendingJson, summary: res.summary ?? [] };
    next.chat.push({
      kind: "ok",
      text: res.message,
      summary: res.summary,
    });
  } else {
    next.chat.push({ kind: "error", text: res.message, errors: res.errors });
  }

  const saveErr = await saveRow(
    gate.supabase,
    gate.orgId,
    gate.userId,
    dashboardId,
    next
  );
  if (saveErr) {
    return {
      ...stateFrom(next),
      ok: false,
      message: `Falha ao salvar a sessão: ${saveErr}`,
    };
  }
  return { ...stateFrom(next), ok: res.ok, message: res.message };
}

/** Aplica a prévia pendente lendo o JSON do BANCO (nada confiado do cliente). */
export async function applyAiEditPending(
  dashboardId: string
): Promise<AiEditSessionState> {
  const gate = await gateAiEdit(dashboardId);
  if (!gate.ok) return gateError(gate.message);
  const row = await loadRow(gate.supabase, gate.userId, dashboardId);
  if (!row.pending) {
    return { ...stateFrom(row), ok: false, message: "Nenhuma prévia pendente." };
  }

  const res = await applyGeneratedDashboard(row.pending.json, {
    mode: "edit",
    targetDashboardId: dashboardId,
  });

  // Igual ao sheet: a prévia é consumida no Aplicar, com sucesso ou não.
  const next: SessionRow = { ...row, pending: null, chat: [...row.chat] };
  let applied = false;
  if (res.ok) {
    applied = true;
    next.chat.push({
      kind: "ok",
      text: res.message ?? "Aplicado.",
      summary: res.summary ?? row.pending.summary,
    });
    if (res.snapshot) {
      next.undo_snapshot = res.snapshot;
      next.undo_saved_at = new Date().toISOString();
    }
  } else {
    next.chat.push({
      kind: "error",
      text: res.message ?? "Falha ao aplicar.",
      errors: res.errors,
    });
  }

  const saveErr = await saveRow(
    gate.supabase,
    gate.orgId,
    gate.userId,
    dashboardId,
    next
  );
  if (saveErr) {
    return { ...stateFrom(next, applied), message: `Falha ao salvar a sessão: ${saveErr}` };
  }
  return stateFrom(next, applied);
}

/** Descarta a prévia pendente sem aplicar. */
export async function discardAiEditPending(
  dashboardId: string
): Promise<AiEditSessionState> {
  const gate = await gateAiEdit(dashboardId);
  if (!gate.ok) return gateError(gate.message);
  const { error } = await gate.supabase
    .from("dashboard_ai_sessions")
    .update({ pending: null })
    .eq("user_id", gate.userId)
    .eq("dashboard_id", dashboardId);
  if (error) return gateError(`Falha ao descartar a prévia: ${error.message}`);
  const row = await loadRow(gate.supabase, gate.userId, dashboardId);
  return stateFrom(row);
}

/** Desfaz a ÚLTIMA edição inteira da IA (snapshot pré-turno persistido). */
export async function undoAiEditSession(
  dashboardId: string
): Promise<AiEditSessionState> {
  const gate = await gateAiEdit(dashboardId);
  if (!gate.ok) return gateError(gate.message);
  const row = await loadRow(gate.supabase, gate.userId, dashboardId);
  if (!row.undo_snapshot) {
    return { ...stateFrom(row), ok: false, message: "Nada para desfazer." };
  }

  const res = await restoreDashboardSnapshot(dashboardId, row.undo_snapshot);
  const next: SessionRow = { ...row, chat: [...row.chat] };
  let applied = false;
  if (res.ok) {
    applied = true;
    next.undo_snapshot = null;
    next.undo_saved_at = null;
    next.chat.push({
      kind: "ok",
      text: "Edição da IA desfeita — dashboard restaurado.",
    });
  } else {
    next.chat.push({
      kind: "error",
      text: res.message ?? "Falha ao desfazer.",
    });
  }

  const saveErr = await saveRow(
    gate.supabase,
    gate.orgId,
    gate.userId,
    dashboardId,
    next
  );
  if (saveErr) {
    return { ...stateFrom(next, applied), message: `Falha ao salvar a sessão: ${saveErr}` };
  }
  return stateFrom(next, applied);
}

/**
 * Recomeçar: zera conversa (turns/chat/pending) mas MANTÉM o snapshot do
 * Desfazer — a última edição da IA continua aplicada no board e ainda pode ser
 * desfeita. Linha ausente = no-op ok.
 */
export async function resetAiEditSession(
  dashboardId: string
): Promise<AiEditSessionState> {
  const gate = await gateAiEdit(dashboardId);
  if (!gate.ok) return gateError(gate.message);
  const { error } = await gate.supabase
    .from("dashboard_ai_sessions")
    .update({ turns: [], chat: [], pending: null })
    .eq("user_id", gate.userId)
    .eq("dashboard_id", dashboardId);
  if (error) return gateError(`Falha ao recomeçar: ${error.message}`);
  const row = await loadRow(gate.supabase, gate.userId, dashboardId);
  return stateFrom(row);
}
