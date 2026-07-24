// Versão: 1.0 | Data: 24/07/2026
// Sessão PERSISTIDA da edição com IA dentro do dashboard (painel "Editar com
// IA"). Uma linha por (usuário, dashboard) em `dashboard_ai_sessions` (0098):
//   - O SERVIDOR é a fonte de verdade dos turnos: o cliente envia só a mensagem
//     nova; os turnos anteriores saem do banco e alimentam o mesmo
//     generateDashboardWithAi (stateless, cap MAX_PRIOR_TURNS) — o fluxo da
//     Home (ImportDashboardSheet) segue intocado.
//   - A prévia pendente (auto-aplicar OFF) também persiste: applyAiEditPending
//     lê o JSON do banco (nada bruto viaja do cliente) e a prévia sobrevive a F5.
//   - O snapshot pré-turno do último apply é o "Desfazer edição da IA",
//     DB-backed: undoAiEditSession restaura e limpa. Recomeçar zera
//     turns/chat/pending mas MANTÉM o undo (a última edição continua no board —
//     apagar o snapshot deixaria o usuário sem como desfazê-la).
//   - Toda action devolve o estado canônico completo (chat/pendingSummary/
//     hasUndo) — o cliente substitui o estado inteiro, sem merge.
// Gate (antes de qualquer leitura/escrita): permissão create_dashboards +
// dono/admin do board (espelho de generateDashboardWithAi/applyDashboardEditJson;
// RLS own-row + org como muralha).
"use server";

import { getSessionInfo } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import type { DashboardSnapshot } from "@/lib/widgets/history";
import { restoreDashboardSnapshot } from "@/app/(app)/dashboards/actions";
import {
  applyGeneratedDashboard,
  generateDashboardWithAi,
} from "@/app/(app)/dashboards/ai-generate-actions";
// Import só de TIPO (apagado no build — nada de módulo client no bundle server).
import type { AiChatEntry } from "@/components/dashboards/ai-chat-log";

export interface AiEditSessionState {
  ok: boolean;
  message?: string;
  chat: AiChatEntry[];
  /** Presença = há prévia aguardando Aplicar (auto-aplicar OFF). */
  pendingSummary?: string[];
  hasUndo: boolean;
  /** True quando o turno/Aplicar/Desfazer mudou o board (cliente dá refresh). */
  applied?: boolean;
}

// Caps de armazenamento: só os últimos MAX_PRIOR_TURNS (10) chegam ao modelo
// (generateDashboardWithAi já corta); guardamos mais p/ histórico de exibição.
const TURNS_STORED_CAP = 30;
const CHAT_STORED_CAP = 100;

interface SessionRow {
  turns: string[];
  chat: AiChatEntry[];
  pending: { json: string; summary: string[] } | null;
  undo_snapshot: DashboardSnapshot | null;
  undo_saved_at: string | null;
}

const EMPTY_ROW: SessionRow = {
  turns: [],
  chat: [],
  pending: null,
  undo_snapshot: null,
  undo_saved_at: null,
};

type Supabase = Awaited<ReturnType<typeof createClient>>;

type Gate =
  | { ok: true; supabase: Supabase; userId: string; orgId: string | null }
  | { ok: false; message: string };

async function gateAiEdit(dashboardId: string): Promise<Gate> {
  const session = await getSessionInfo();
  if (!session) return { ok: false, message: "Sessão expirada." };
  if (!session.permissions.includes("create_dashboards")) {
    return {
      ok: false,
      message: "Você não tem permissão para editar dashboards por IA.",
    };
  }
  const supabase = await createClient();
  const { data: dash } = await supabase
    .from("dashboards")
    .select("id, owner_user_id, organization_id, kind, status")
    .eq("id", dashboardId)
    .maybeSingle();
  if (!dash) return { ok: false, message: "Dashboard não encontrado." };
  if ((dash.kind as string) === "kanban") {
    return { ok: false, message: "Edição por IA é só para dashboards." };
  }
  if ((dash.status as string) === "trashed") {
    return { ok: false, message: "Restaure o dashboard antes de editar." };
  }
  const isAdmin = session.roles.includes("admin");
  if (!isAdmin && dash.owner_user_id !== session.user.id) {
    return {
      ok: false,
      message: "Apenas o dono ou um administrador podem editar por IA.",
    };
  }
  return {
    ok: true,
    supabase,
    userId: session.user.id,
    orgId: (dash.organization_id as string | null) ?? null,
  };
}

async function loadRow(
  supabase: Supabase,
  userId: string,
  dashboardId: string
): Promise<SessionRow> {
  const { data } = await supabase
    .from("dashboard_ai_sessions")
    .select("turns, chat, pending, undo_snapshot, undo_saved_at")
    .eq("user_id", userId)
    .eq("dashboard_id", dashboardId)
    .maybeSingle();
  if (!data) return EMPTY_ROW;
  return {
    turns: (data.turns as string[] | null) ?? [],
    chat: (data.chat as AiChatEntry[] | null) ?? [],
    pending:
      (data.pending as { json: string; summary: string[] } | null) ?? null,
    undo_snapshot: (data.undo_snapshot as DashboardSnapshot | null) ?? null,
    undo_saved_at: (data.undo_saved_at as string | null) ?? null,
  };
}

// Upsert único da linha da sessão (org carimbada explicitamente; o trigger
// dashboard_ai_sessions_set_org rederiva do board de toda forma). Se este
// upsert falhar logo após um apply ok, a edição fica no board sem snapshot
// salvo — janela rara e aceita (o upsert único a minimiza).
async function saveRow(
  supabase: Supabase,
  orgId: string | null,
  userId: string,
  dashboardId: string,
  row: SessionRow
): Promise<string | null> {
  const { error } = await supabase.from("dashboard_ai_sessions").upsert(
    {
      ...(orgId ? { organization_id: orgId } : {}),
      user_id: userId,
      dashboard_id: dashboardId,
      turns: row.turns.slice(-TURNS_STORED_CAP),
      chat: row.chat.slice(-CHAT_STORED_CAP),
      pending: row.pending,
      undo_snapshot: row.undo_snapshot,
      undo_saved_at: row.undo_saved_at,
    },
    { onConflict: "user_id,dashboard_id" }
  );
  return error ? error.message : null;
}

function stateFrom(row: SessionRow, applied?: boolean): AiEditSessionState {
  return {
    ok: true,
    chat: row.chat,
    pendingSummary: row.pending?.summary,
    hasUndo: row.undo_snapshot != null,
    ...(applied !== undefined ? { applied } : {}),
  };
}

function gateError(message: string): AiEditSessionState {
  return { ok: false, message, chat: [], hasUndo: false };
}

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
 * Um turno da conversa: envia a mensagem nova + turnos do BANCO ao mesmo
 * generateDashboardWithAi do fluxo da Home (mode: "edit" fixo) e persiste o
 * resultado (chat, prévia pendente e — em apply ok — o snapshot do Desfazer).
 * O turno entra em `turns` mesmo quando falha (igual ao sheet: contexto do
 * usuário não se perde por erro do modelo).
 */
export async function runAiEditTurn(
  dashboardId: string,
  message: string,
  autoApply: boolean
): Promise<AiEditSessionState> {
  const gate = await gateAiEdit(dashboardId);
  if (!gate.ok) return gateError(gate.message);
  const text = (message ?? "").trim();
  if (!text) return gateError("Descreva o que você quer.");

  const row = await loadRow(gate.supabase, gate.userId, dashboardId);

  const res = await generateDashboardWithAi({
    mode: "edit",
    targetDashboardId: dashboardId,
    description: text,
    priorTurns: row.turns,
    autoApply,
  });

  const next: SessionRow = {
    ...row,
    turns: [...row.turns, text],
    chat: [...row.chat, { kind: "user", text }],
  };
  let applied = false;

  if (res.pendingJson) {
    next.pending = { json: res.pendingJson, summary: res.summary ?? [] };
    next.chat.push({
      kind: "ok",
      text: res.message ?? "Prévia pronta — revise e clique em Aplicar.",
      summary: res.summary,
    });
  } else if (res.ok) {
    applied = true;
    next.pending = null; // turno aplicado invalida prévia antiga
    next.chat.push({
      kind: "ok",
      text: res.message ?? "Aplicado.",
      summary: res.summary,
    });
    if (res.snapshot) {
      next.undo_snapshot = res.snapshot;
      next.undo_saved_at = new Date().toISOString();
    }
  } else {
    next.chat.push({
      kind: "error",
      text: res.message ?? "Falha na geração.",
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
