// Versão: 1.0 | Data: 26/07/2026
// NÚCLEO da sessão do painel "Editar com IA" — gate, leitura/gravação da linha
// de `dashboard_ai_sessions` e o corpo do TURNO, extraídos de
// app/(app)/dashboards/ai-session-actions.ts SEM mudança de comportamento.
// Motivo: o route handler de streaming (app/(app)/dashboards/[id]/ai-turn)
// precisa rodar o MESMO turno passando `onThought` (raciocínio ao vivo), e
// server action não aceita função como argumento. As actions seguem como
// wrappers/consumidores destes helpers — nenhum caminho paralelo de gate ou
// persistência.
import "server-only";

import { getSessionInfo } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import type { DashboardSnapshot } from "@/lib/widgets/history";
import { generateDashboardCore } from "@/lib/ai/generate-dashboard";
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
// (generateDashboardCore já corta); guardamos mais p/ histórico de exibição.
const TURNS_STORED_CAP = 30;
const CHAT_STORED_CAP = 100;

export interface SessionRow {
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

export type AiEditGate =
  | { ok: true; supabase: Supabase; userId: string; orgId: string | null }
  | { ok: false; message: string };

export async function gateAiEdit(dashboardId: string): Promise<AiEditGate> {
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

export async function loadRow(
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
export async function saveRow(
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

export function stateFrom(
  row: SessionRow,
  applied?: boolean
): AiEditSessionState {
  return {
    ok: true,
    chat: row.chat,
    pendingSummary: row.pending?.summary,
    hasUndo: row.undo_snapshot != null,
    ...(applied !== undefined ? { applied } : {}),
  };
}

export function gateError(message: string): AiEditSessionState {
  return { ok: false, message, chat: [], hasUndo: false };
}

/**
 * Um turno da conversa: envia a mensagem nova + turnos do BANCO ao mesmo
 * núcleo de geração do fluxo da Home (mode: "edit" fixo) e persiste o
 * resultado (chat, prévia pendente e — em apply ok — o snapshot do Desfazer).
 * O turno entra em `turns` mesmo quando falha (igual ao sheet: contexto do
 * usuário não se perde por erro do modelo). `onThought` (opcional, via route
 * handler de streaming) recebe o raciocínio do modelo ao vivo — efêmero, nunca
 * persistido na linha da sessão.
 */
export async function runAiEditTurnCore(
  dashboardId: string,
  message: string,
  autoApply: boolean,
  onThought?: (chunk: string) => void
): Promise<AiEditSessionState> {
  const gate = await gateAiEdit(dashboardId);
  if (!gate.ok) return gateError(gate.message);
  const text = (message ?? "").trim();
  if (!text) return gateError("Descreva o que você quer.");

  const row = await loadRow(gate.supabase, gate.userId, dashboardId);

  const res = await generateDashboardCore(
    {
      mode: "edit",
      targetDashboardId: dashboardId,
      description: text,
      priorTurns: row.turns,
      autoApply,
      // Prévia não aplicada do turno anterior: a IA precisa vê-la (a resposta
      // nova SUBSTITUI a prévia — sem isso, "ajusta o que você propôs" falharia).
      pendingJson: row.pending?.json,
    },
    onThought
  );

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
    return {
      ...stateFrom(next, applied),
      message: `Falha ao salvar a sessão: ${saveErr}`,
    };
  }
  return stateFrom(next, applied);
}
