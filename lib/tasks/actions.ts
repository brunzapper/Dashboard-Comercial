// Versão: 1.0 | Data: 16/07/2026
// Server Actions de TAREFAS (tabela tasks, 0063). Gravação com o client do
// usuário — a RLS decide visibilidade/edição/exclusão (vendedor só as suas;
// `locked` bloqueia exclusão de não-admin/gestor e a flag é protegida pelo
// trigger enforce_task_lock). Sem view_all_records, o responsável é coagido a
// um vinculado ao próprio usuário (espelha a policy de INSERT).
"use server";

import { revalidatePath } from "next/cache";

import { getSessionInfo } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { addDaysIso, DEFAULT_DUE_SOON_DAYS } from "./alerts";
import { todayBrasiliaIso } from "@/lib/date/today";
import { TASK_COLS_WITH_RECORD, type TaskRow } from "./types";

export interface TaskActionState {
  ok?: boolean;
  message?: string;
  id?: string;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}(:\d{2})?$/;

function cleanStr(v: FormDataEntryValue | null, max = 4000): string {
  return String(v ?? "")
    .trim()
    .slice(0, max);
}

// Responsáveis vinculados ao usuário (ativos) — visibilidade e notificações.
async function ownResponsibleIds(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string
): Promise<string[]> {
  const { data } = await supabase
    .from("responsibles")
    .select("id")
    .eq("user_id", userId)
    .eq("active", true);
  return (data ?? []).map((r) => r.id as string);
}

// Filtro "notifica-me" (sino): tarefa GLOBAL, criada por mim ou atribuída a um
// responsável meu. Uma tarefa é UMA linha — criador=responsável não duplica.
// Também vale p/ quem tem view_all_records: o sino mostra só o que notifica a
// pessoa (a visibilidade ampla continua em /tarefas e nos quadros).
function notifyMeFilter(userId: string, respIds: string[]): string {
  const legs = ["is_global.eq.true", `created_by.eq.${userId}`];
  if (respIds.length > 0) legs.push(`responsible_id.in.(${respIds.join(",")})`);
  return legs.join(",");
}

// Coage o responsável de quem NÃO vê tudo (vendedor) a um responsável do
// próprio usuário. Null é permitido (tarefa sem atribuição — visível ao criador).
async function coerceResponsible(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  viewAll: boolean,
  responsibleId: string | null
): Promise<string | null> {
  if (viewAll || responsibleId == null) return responsibleId;
  const ownIds = await ownResponsibleIds(supabase, userId);
  if (ownIds.includes(responsibleId)) return responsibleId;
  return ownIds[0] ?? null;
}

function readTaskForm(formData: FormData): {
  title: string;
  description: string | null;
  due_date: string | null;
  due_time: string | null;
  responsible_id: string | null;
  record_id: string | null;
  error?: string;
} {
  const title = cleanStr(formData.get("title"), 300);
  const description = cleanStr(formData.get("description")) || null;
  const dueDateRaw = cleanStr(formData.get("due_date"), 10);
  const dueTimeRaw = cleanStr(formData.get("due_time"), 8);
  const responsible = cleanStr(formData.get("responsible_id"), 40) || null;
  const record = cleanStr(formData.get("record_id"), 40) || null;
  if (!title) {
    return {
      title,
      description,
      due_date: null,
      due_time: null,
      responsible_id: responsible,
      record_id: record,
      error: "Informe o título da tarefa.",
    };
  }
  return {
    title,
    description,
    due_date: DATE_RE.test(dueDateRaw) ? dueDateRaw : null,
    due_time: TIME_RE.test(dueTimeRaw) ? dueTimeRaw : null,
    responsible_id: responsible,
    record_id: record,
  };
}

function revalidateTasks() {
  revalidatePath("/tarefas");
}

/** Cria uma tarefa (standalone, vinculada a registro e/ou a um board). */
export async function createTask(
  _prev: TaskActionState,
  formData: FormData
): Promise<TaskActionState> {
  const session = await getSessionInfo();
  if (!session) return { ok: false, message: "Sessão expirada." };
  const viewAll = session.permissions.includes("view_all_records");

  const parsed = readTaskForm(formData);
  if (parsed.error) return { ok: false, message: parsed.error };

  const supabase = await createClient();
  const responsibleId = await coerceResponsible(
    supabase,
    session.user.id,
    viewAll,
    parsed.responsible_id
  );

  const boardId = cleanStr(formData.get("board_id"), 40) || null;
  const phase = cleanStr(formData.get("phase"), 80) || "a_fazer";
  // `locked` na criação vale para qualquer papel (default do board / escolha):
  // o trigger só protege ALTERAÇÕES da flag.
  const locked = String(formData.get("locked") ?? "") === "1";
  // Subtarefa: vive no feed da tarefa pai (não vira card de quadro).
  const parentTaskId = cleanStr(formData.get("parent_task_id"), 40) || null;
  // Global (notifica/aparece a todos): só admin/gestor — o trigger
  // enforce_task_global reforça no banco.
  const isManager =
    session.roles.includes("admin") || session.roles.includes("gestor");
  const isGlobal = isManager && String(formData.get("is_global") ?? "") === "1";

  const { data, error } = await supabase
    .from("tasks")
    .insert({
      title: parsed.title,
      description: parsed.description,
      record_id: parsed.record_id,
      board_id: boardId,
      phase,
      due_date: parsed.due_date,
      due_time: parsed.due_time,
      responsible_id: responsibleId,
      created_by: session.user.id,
      // Ordenação fracionária: novas tarefas no topo da coluna (posição
      // decrescente no tempo; ordenamos por position ASC).
      position: -Date.now(),
      locked,
      parent_task_id: parentTaskId,
      is_global: isGlobal,
    })
    .select("id")
    .single();
  if (error) return { ok: false, message: `Falha ao criar: ${error.message}` };
  revalidateTasks();
  return { ok: true, message: "Tarefa criada.", id: data.id as string };
}

/** Edita uma tarefa (título, descrição, prazo, responsável, vínculo). */
export async function updateTask(
  _prev: TaskActionState,
  formData: FormData
): Promise<TaskActionState> {
  const session = await getSessionInfo();
  if (!session) return { ok: false, message: "Sessão expirada." };
  const viewAll = session.permissions.includes("view_all_records");
  const isManager =
    session.roles.includes("admin") || session.roles.includes("gestor");

  const id = cleanStr(formData.get("id"), 40);
  if (!id) return { ok: false, message: "Tarefa não identificada." };
  const parsed = readTaskForm(formData);
  if (parsed.error) return { ok: false, message: parsed.error };

  const supabase = await createClient();
  const responsibleId = await coerceResponsible(
    supabase,
    session.user.id,
    viewAll,
    parsed.responsible_id
  );

  const updates: Record<string, unknown> = {
    title: parsed.title,
    description: parsed.description,
    due_date: parsed.due_date,
    due_time: parsed.due_time,
    responsible_id: responsibleId,
    record_id: parsed.record_id,
  };
  // Trava de exclusão: só admin/gestor mudam (o trigger reforça no banco).
  if (isManager && formData.has("locked")) {
    updates.locked = String(formData.get("locked")) === "1";
  }
  // Global: input hidden sempre presente quando o form permite (admin/gestor);
  // o trigger enforce_task_global reforça no banco.
  if (isManager && formData.has("is_global")) {
    updates.is_global = String(formData.get("is_global")) === "1";
  }
  // Reatribuição de responsável carimba assigned_at — a tarefa reaparece na
  // seção "Novas" do sino do novo responsável.
  const { data: prev } = await supabase
    .from("tasks")
    .select("responsible_id")
    .eq("id", id)
    .maybeSingle();
  if (prev && (prev.responsible_id ?? null) !== (responsibleId ?? null)) {
    updates.assigned_at = new Date().toISOString();
  }

  const { data, error } = await supabase
    .from("tasks")
    .update(updates)
    .eq("id", id)
    .select("id");
  if (error) return { ok: false, message: `Falha ao salvar: ${error.message}` };
  if (!data || data.length === 0) {
    return { ok: false, message: "Sem permissão para editar esta tarefa." };
  }
  revalidateTasks();
  return { ok: true, message: "Tarefa atualizada." };
}

/** Conclui uma tarefa (carimba completed_at/by). */
export async function completeTask(id: string): Promise<TaskActionState> {
  const session = await getSessionInfo();
  if (!session) return { ok: false, message: "Sessão expirada." };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("tasks")
    .update({
      completed_at: new Date().toISOString(),
      completed_by: session.user.id,
    })
    .eq("id", id)
    .select("id");
  if (error) return { ok: false, message: error.message };
  if (!data || data.length === 0) {
    return { ok: false, message: "Sem permissão para concluir esta tarefa." };
  }
  revalidateTasks();
  return { ok: true };
}

/** Reabre uma tarefa concluída. */
export async function reopenTask(id: string): Promise<TaskActionState> {
  const session = await getSessionInfo();
  if (!session) return { ok: false, message: "Sessão expirada." };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("tasks")
    .update({ completed_at: null, completed_by: null })
    .eq("id", id)
    .select("id");
  if (error) return { ok: false, message: error.message };
  if (!data || data.length === 0) {
    return { ok: false, message: "Sem permissão para reabrir esta tarefa." };
  }
  revalidateTasks();
  return { ok: true };
}

/**
 * Move a tarefa de fase (coluna do kanban de tarefas). Coluna com
 * `completesTask` conclui ao soltar; sair dela reabre.
 */
export async function moveTaskPhase(
  id: string,
  phase: string,
  completes: boolean
): Promise<TaskActionState> {
  const session = await getSessionInfo();
  if (!session) return { ok: false, message: "Sessão expirada." };
  const supabase = await createClient();
  const updates: Record<string, unknown> = {
    phase,
    position: -Date.now(), // topo da coluna destino
    completed_at: completes ? new Date().toISOString() : null,
    completed_by: completes ? session.user.id : null,
  };
  const { data, error } = await supabase
    .from("tasks")
    .update(updates)
    .eq("id", id)
    .select("id");
  if (error) return { ok: false, message: error.message };
  if (!data || data.length === 0) {
    return { ok: false, message: "Sem permissão para mover esta tarefa." };
  }
  revalidateTasks();
  return { ok: true };
}

/** Exclui uma tarefa (RLS: admin/gestor sempre; envolvidos se não travada). */
export async function deleteTask(id: string): Promise<TaskActionState> {
  const session = await getSessionInfo();
  if (!session) return { ok: false, message: "Sessão expirada." };
  const supabase = await createClient();
  // .select() no delete: sem linha retornada = RLS bloqueou (tarefa travada
  // ou de outro usuário) — devolve mensagem em vez de sucesso silencioso.
  const { data, error } = await supabase
    .from("tasks")
    .delete()
    .eq("id", id)
    .select("id");
  if (error) return { ok: false, message: error.message };
  if (!data || data.length === 0) {
    return {
      ok: false,
      message:
        "Sem permissão para excluir — a tarefa está travada ou pertence a outro usuário.",
    };
  }
  revalidateTasks();
  return { ok: true };
}

/** Fixa/desafixa a tarefa no feed do card (RLS: envolvidos/gestão). */
export async function setTaskPinned(
  id: string,
  pinned: boolean
): Promise<TaskActionState> {
  const session = await getSessionInfo();
  if (!session) return { ok: false, message: "Sessão expirada." };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("tasks")
    .update({ pinned })
    .eq("id", id)
    .select("id");
  if (error) return { ok: false, message: error.message };
  if (!data || data.length === 0) {
    return { ok: false, message: "Sem permissão para fixar esta tarefa." };
  }
  return { ok: true };
}

/** Reordena a tarefa no FEED (feed_position; `position` é a do quadro). */
export async function setTaskFeedPosition(
  id: string,
  position: number
): Promise<TaskActionState> {
  const session = await getSessionInfo();
  if (!session) return { ok: false, message: "Sessão expirada." };
  if (!Number.isFinite(position)) return { ok: false, message: "Posição inválida." };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("tasks")
    .update({ feed_position: position })
    .eq("id", id)
    .select("id");
  if (error) return { ok: false, message: error.message };
  if (!data || data.length === 0) {
    return { ok: false, message: "Sem permissão para mover esta tarefa." };
  }
  return { ok: true };
}

/** Tarefas de um registro (seção do painel de edição). RLS escopa. */
export async function listRecordTasks(recordId: string): Promise<TaskRow[]> {
  const session = await getSessionInfo();
  if (!session) return [];
  const supabase = await createClient();
  const { data } = await supabase
    .from("tasks")
    .select(TASK_COLS_WITH_RECORD)
    .eq("record_id", recordId)
    .order("completed_at", { ascending: true, nullsFirst: true })
    .order("due_date", { ascending: true, nullsFirst: false })
    .limit(100);
  return (data ?? []) as unknown as TaskRow[];
}

// Marca d'água da seção "Novas": tasksSeenAt de user_settings; sem registro,
// janela de 7 dias (não inundar o sino de quem nunca abriu).
async function tasksSeenSince(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string
): Promise<string> {
  const { data } = await supabase
    .from("user_settings")
    .select("settings")
    .eq("user_id", userId)
    .maybeSingle();
  const seen = (data?.settings as { tasksSeenAt?: string } | null)?.tasksSeenAt;
  if (seen) return seen;
  return new Date(Date.now() - 7 * 24 * 3600_000).toISOString();
}

export interface TaskAlerts {
  // Vencidas/próximas do prazo (janela dueSoonDays), abertas.
  due: TaskRow[];
  // Criadas/reatribuídas para mim desde a última visualização (sem as que já
  // estão em `due` — badge = due + fresh sem duplicar).
  fresh: TaskRow[];
}

/**
 * Alertas do sino: tarefas que NOTIFICAM o usuário (global / criador /
 * responsável — notifyMeFilter), em duas seções. RLS ainda se aplica por baixo.
 */
export async function listTaskAlerts(
  dueSoonDays: number = DEFAULT_DUE_SOON_DAYS
): Promise<TaskAlerts> {
  const session = await getSessionInfo();
  if (!session) return { due: [], fresh: [] };
  const supabase = await createClient();
  const respIds = await ownResponsibleIds(supabase, session.user.id);
  const notify = notifyMeFilter(session.user.id, respIds);
  const limitIso = addDaysIso(todayBrasiliaIso(), Math.max(0, dueSoonDays));
  const since = await tasksSeenSince(supabase, session.user.id);

  const [{ data: due }, { data: fresh }] = await Promise.all([
    supabase
      .from("tasks")
      .select(TASK_COLS_WITH_RECORD)
      .is("completed_at", null)
      .not("due_date", "is", null)
      .lte("due_date", limitIso)
      .or(notify)
      .order("due_date", { ascending: true })
      .limit(50),
    supabase
      .from("tasks")
      .select(TASK_COLS_WITH_RECORD)
      .is("completed_at", null)
      .is("parent_task_id", null)
      .or(notify)
      .or(`created_at.gt.${since},assigned_at.gt.${since}`)
      .order("created_at", { ascending: false })
      .limit(50),
  ]);

  const dueRows = (due ?? []) as unknown as TaskRow[];
  const dueIds = new Set(dueRows.map((t) => t.id));
  const freshRows = ((fresh ?? []) as unknown as TaskRow[]).filter(
    (t) => !dueIds.has(t.id)
  );
  return { due: dueRows, fresh: freshRows };
}

/** Contagem p/ o badge do sino (novas + com prazo, sem duplicar). */
export async function countTaskAlerts(): Promise<number> {
  const { due, fresh } = await listTaskAlerts();
  return due.length + fresh.length;
}

/** Carimba a marca d'água das "Novas" (abrir o sino marca como visto). */
export async function markTasksSeen(): Promise<void> {
  const session = await getSessionInfo();
  if (!session) return;
  const supabase = await createClient();
  const { data } = await supabase
    .from("user_settings")
    .select("settings")
    .eq("user_id", session.user.id)
    .maybeSingle();
  const current = (data?.settings as Record<string, unknown> | null) ?? {};
  await supabase.from("user_settings").upsert(
    {
      user_id: session.user.id,
      settings: { ...current, tasksSeenAt: new Date().toISOString() },
    },
    { onConflict: "user_id" }
  );
}

/**
 * Tarefas ABERTAS com prazo vencido ou próximo (sino de alertas), filtradas
 * pela regra de notificação (global / criador / responsável).
 */
export async function listDueTasks(
  dueSoonDays: number = DEFAULT_DUE_SOON_DAYS
): Promise<TaskRow[]> {
  const session = await getSessionInfo();
  if (!session) return [];
  const supabase = await createClient();
  const respIds = await ownResponsibleIds(supabase, session.user.id);
  const limitIso = addDaysIso(todayBrasiliaIso(), Math.max(0, dueSoonDays));
  const { data } = await supabase
    .from("tasks")
    .select(TASK_COLS_WITH_RECORD)
    .is("completed_at", null)
    .not("due_date", "is", null)
    .lte("due_date", limitIso)
    .or(notifyMeFilter(session.user.id, respIds))
    .order("due_date", { ascending: true })
    .limit(50);
  return (data ?? []) as unknown as TaskRow[];
}
