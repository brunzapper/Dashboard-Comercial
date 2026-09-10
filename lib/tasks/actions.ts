// Versão: 1.2 | Data: 10/09/2026
// v1.2 (10/09/2026): `endRecordSeries`/`resumeRecordSeries` — encerrar a
//   SEQUÊNCIA de uma série para UM registro, e voltar atrás. É o que a lista
//   de tarefas e a Tree passam a perguntar ao concluir ou excluir uma
//   ocorrência: apagar as ocorrências ABERTAS sem desligar a série faria o tick
//   recriá-las no minuto seguinte, e desligar sem apagar deixaria o vendedor
//   com tarefas abertas que ninguém mais quer. As duas metades, ou nenhuma.
//   Concluídas nunca são tocadas e o atributo do registro fica (pausar ≠
//   excluir, 0131): encerrar tira o PREVISTO, não o que aconteceu.
// Server Actions de TAREFAS (tabela tasks, 0063). Gravação com o client do
// usuário — a RLS decide visibilidade/edição/exclusão (vendedor só as suas;
// `locked` bloqueia exclusão de não-admin/gestor e a flag é protegida pelo
// trigger enforce_task_lock). Sem view_all_records, o responsável é coagido a
// um vinculado ao próprio usuário (espelha a policy de INSERT).
// v1.1 (28/07/2026, 0111): due_time_end (hora final do agendamento — exige
//   due_time; fim > início) + rescheduleTask (drag da agenda: só a DATA muda,
//   horas preservadas por omissão) + ordem secundária por due_time nas listas
//   (intra-dia cronológico em /tarefas, sino e painéis).
"use server";

import { revalidatePath } from "next/cache";

import { getSessionInfo } from "@/lib/auth/session";
import { getActiveOrgId } from "@/lib/auth/org";
import { createClient } from "@/lib/supabase/server";
import { emitWebhookEvent } from "@/lib/webhooks/emit";
import { loadUserSettings } from "@/lib/config/user-settings";
import { addDaysIso, DEFAULT_DUE_SOON_DAYS } from "./alerts";
import { todayBrasiliaIso } from "@/lib/date/today";
import { TASK_COLS_WITH_RECORD, type TaskRow } from "./types";
import { createServiceClient } from "@/lib/supabase/service";
import {
  enqueueTaskMirrorMany,
  loadMirrorOwners,
  mirrorTaskAfterWrite,
  mirrorTaskDeletion,
} from "@/lib/sync/bitrix/task-mirror";
import { parseSeriesNoun } from "@/lib/series/types";
import type { MirrorOwnerEntity } from "@/lib/tasks/mirror-config";
import { parseMirrorChoice } from "./mirror-config";

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
  due_time_end: string | null;
  responsible_id: string | null;
  record_id: string | null;
  error?: string;
} {
  const title = cleanStr(formData.get("title"), 300);
  const description = cleanStr(formData.get("description")) || null;
  const dueDateRaw = cleanStr(formData.get("due_date"), 10);
  const dueTimeRaw = cleanStr(formData.get("due_time"), 8);
  const dueTimeEndRaw = cleanStr(formData.get("due_time_end"), 8);
  const responsible = cleanStr(formData.get("responsible_id"), 40) || null;
  const record = cleanStr(formData.get("record_id"), 40) || null;
  const due_time = TIME_RE.test(dueTimeRaw) ? dueTimeRaw : null;
  // Hora final: exige hora inicial (CHECK 0111) e precisa ser depois dela.
  const due_time_end =
    due_time && TIME_RE.test(dueTimeEndRaw) ? dueTimeEndRaw : null;
  if (!title) {
    return {
      title,
      description,
      due_date: null,
      due_time: null,
      due_time_end: null,
      responsible_id: responsible,
      record_id: record,
      error: "Informe o título da tarefa.",
    };
  }
  if (due_time_end && due_time_end.slice(0, 5) <= due_time!.slice(0, 5)) {
    return {
      title,
      description,
      due_date: null,
      due_time: null,
      due_time_end: null,
      responsible_id: responsible,
      record_id: record,
      error: "A hora final deve ser depois da inicial.",
    };
  }
  return {
    title,
    description,
    due_date: DATE_RE.test(dueDateRaw) ? dueDateRaw : null,
    due_time,
    due_time_end,
    responsible_id: responsible,
    record_id: record,
  };
}

function revalidateTasks() {
  revalidatePath("/operacao/tarefas");
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
  // 10/09/2026: como ESTA ocorrência se chama na Tree. Só o formulário de uma
  // tarefa de série traz o campo; ausente = herda o da série.
  const occurrenceNoun =
    parseSeriesNoun(cleanStr(formData.get("occurrence_noun"), 40)) ?? null;
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

  // Carimbo de org (multi-org, 0090).
  const orgId = await getActiveOrgId();
  const { data, error } = await supabase
    .from("tasks")
    .insert({
      ...(orgId ? { organization_id: orgId } : {}),
      title: parsed.title,
      description: parsed.description,
      record_id: parsed.record_id,
      board_id: boardId,
      phase,
      due_date: parsed.due_date,
      due_time: parsed.due_time,
      due_time_end: parsed.due_time_end,
      responsible_id: responsibleId,
      created_by: session.user.id,
      // Ordenação fracionária: novas tarefas no topo da coluna (posição
      // decrescente no tempo; ordenamos por position ASC).
      position: -Date.now(),
      locked,
      parent_task_id: parentTaskId,
      is_global: isGlobal,
      ...(occurrenceNoun ? { occurrence_noun: occurrenceNoun } : {}),
    })
    .select("id")
    .single();
  if (error) return { ok: false, message: `Falha ao criar: ${error.message}` };
  await emitWebhookEvent(
    "task.created",
    {
      taskId: data.id as string,
      title: parsed.title,
      recordId: parsed.record_id,
    },
    await getActiveOrgId()
  );
  // Espelho no Bitrix (0136): a Base decide, e a caixa do formulário pode
  // sobrepor. Best-effort — nunca derruba a criação da tarefa.
  await mirrorTaskAfterWrite(supabase, createServiceClient(), {
    taskId: data.id as string,
    recordId: parsed.record_id,
    orgId,
    op: "create",
    taskChoice: parseMirrorChoice(formData.get("mirror_bitrix")),
    createdBy: session.user.id,
  });
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
    due_time_end: parsed.due_time_end,
    responsible_id: responsibleId,
    record_id: parsed.record_id,
  };
  // 10/09/2026: o substantivo só é tocado quando o CONTROLE veio no envio.
  // O `updates` daqui é o formulário INTEIRO, então uma chave ausente viraria
  // NULL — e o campo só aparece em tarefa de série (mesma guarda do `locked`).
  if (formData.has("occurrence_noun")) {
    updates.occurrence_noun =
      parseSeriesNoun(cleanStr(formData.get("occurrence_noun"), 40)) ?? null;
  }
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
  await emitWebhookEvent("task.updated", { taskId: id }, await getActiveOrgId());
  // Já espelhada? A atividade acompanha a edição (prazo, título, responsável).
  await mirrorTaskAfterWrite(supabase, createServiceClient(), {
    taskId: id,
    recordId: parsed.record_id,
    orgId: await getActiveOrgId(),
    op: "update",
    taskChoice: parseMirrorChoice(formData.get("mirror_bitrix")),
    createdBy: session.user.id,
  });
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
  await emitWebhookEvent("task.completed", { taskId: id }, await getActiveOrgId());
  // Concluir aqui FECHA a atividade lá (COMPLETED: 'Y'). É para isso que o
  // `bitrix_activity_id` existe — sem ele a atividade ficaria aberta no feed
  // do negócio para sempre.
  const { data: doneTask } = await supabase
    .from("tasks")
    .select("record_id")
    .eq("id", id)
    .maybeSingle();
  await mirrorTaskAfterWrite(supabase, createServiceClient(), {
    taskId: id,
    recordId: (doneTask?.record_id as string | null) ?? null,
    orgId: await getActiveOrgId(),
    op: "complete",
    createdBy: session.user.id,
  });
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
  await emitWebhookEvent(
    "task.updated",
    { taskId: id, reopened: true },
    await getActiveOrgId()
  );
  // 10/09/2026: reabrir TAMBÉM reabre a atividade lá (COMPLETED volta a 'N').
  // Sem isto a leitura de volta (0137) veria a atividade fechada e re-fecharia
  // a tarefa na rodada seguinte — reabrir aqui nunca duraria um minuto.
  const { data: openTask } = await supabase
    .from("tasks")
    .select("record_id")
    .eq("id", id)
    .maybeSingle();
  await mirrorTaskAfterWrite(supabase, createServiceClient(), {
    taskId: id,
    recordId: (openTask?.record_id as string | null) ?? null,
    orgId: await getActiveOrgId(),
    op: "update",
    createdBy: session.user.id,
  });
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
  await emitWebhookEvent(
    completes ? "task.completed" : "task.updated",
    {
      taskId: id,
      phase,
    },
    await getActiveOrgId()
  );
  // 10/09/2026: a coluna que conclui (ou a saída dela) mexe no MESMO estado
  // que `completeTask`/`reopenTask` — tem de espelhar pelo mesmo caminho.
  const { data: movedTask } = await supabase
    .from("tasks")
    .select("record_id")
    .eq("id", id)
    .maybeSingle();
  await mirrorTaskAfterWrite(supabase, createServiceClient(), {
    taskId: id,
    recordId: (movedTask?.record_id as string | null) ?? null,
    orgId: await getActiveOrgId(),
    op: completes ? "complete" : "update",
    createdBy: session.user.id,
  });
  revalidateTasks();
  return { ok: true };
}

/**
 * Remarca a DATA da tarefa (drag entre dias na agenda). Só `due_date` muda —
 * `due_time`/`due_time_end` ficam intactos por omissão (a hora acompanha a
 * tarefa, mesmo racional do withOriginalTime do kanban).
 */
export async function rescheduleTask(
  id: string,
  dueDateIso: string
): Promise<TaskActionState> {
  const session = await getSessionInfo();
  if (!session) return { ok: false, message: "Sessão expirada." };
  if (!DATE_RE.test(dueDateIso)) {
    return { ok: false, message: "Data inválida." };
  }
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("tasks")
    .update({ due_date: dueDateIso })
    .eq("id", id)
    .select("id");
  if (error) return { ok: false, message: error.message };
  if (!data || data.length === 0) {
    return { ok: false, message: "Sem permissão para mover esta tarefa." };
  }
  await emitWebhookEvent(
    "task.updated",
    { taskId: id, dueDate: dueDateIso },
    await getActiveOrgId()
  );
  // 10/09/2026: remarcar move o DEADLINE da atividade. É para isso que o
  // `bitrix_activity_id` existe — sem espelhar, o prazo lá fica no dia velho.
  const { data: movedTask } = await supabase
    .from("tasks")
    .select("record_id")
    .eq("id", id)
    .maybeSingle();
  await mirrorTaskAfterWrite(supabase, createServiceClient(), {
    taskId: id,
    recordId: (movedTask?.record_id as string | null) ?? null,
    orgId: await getActiveOrgId(),
    op: "update",
    createdBy: session.user.id,
  });
  revalidateTasks();
  return { ok: true };
}

/** Exclui uma tarefa (RLS: admin/gestor sempre; envolvidos se não travada). */
export async function deleteTask(id: string): Promise<TaskActionState> {
  const session = await getSessionInfo();
  if (!session) return { ok: false, message: "Sessão expirada." };
  const supabase = await createClient();

  // 10/09/2026: a ordem de exclusão no Bitrix é enfileirada ANTES do delete.
  // Depois seria tarde: a linha some, o `bitrix_activity_id` vai com ela e a
  // atividade fica órfã no feed do negócio — que a leitura de volta (0137)
  // reimportaria como tarefa nova, num ciclo sem fim. Resolver a Base aqui
  // (e não no dreno) é o mesmo princípio da 0136: a decisão é a vigente no
  // momento do ato.
  const { data: doomed } = await supabase
    .from("tasks")
    .select("record_id, bitrix_activity_id")
    .eq("id", id)
    .maybeSingle();
  const activityId = (doomed?.bitrix_activity_id as string | null) ?? null;
  let mirrorOwner: MirrorOwnerEntity | null = null;
  let mirrorSourceId: string | null = null;
  if (activityId && doomed?.record_id) {
    const { data: rec } = await supabase
      .from("records")
      .select("record_type, source_id")
      .eq("id", doomed.record_id as string)
      .maybeSingle();
    if (rec) {
      const { data: src } = await supabase
        .from("data_sources")
        .select("bitrix_activity_owner")
        .eq("record_type", rec.record_type as string)
        .maybeSingle();
      mirrorOwner =
        (src?.bitrix_activity_owner as MirrorOwnerEntity | null) ?? null;
      mirrorSourceId = (rec.source_id as string | null) ?? null;
    }
  }

  // .select() no delete: sem linha retornada = RLS bloqueou (tarefa travada
  // ou de outro usuário) — devolve mensagem em vez de sucesso silencioso.
  const { data, error } = await supabase
    .from("tasks")
    .delete()
    .eq("id", id)
    .select("id, title, record_id");
  if (error) return { ok: false, message: error.message };
  if (!data || data.length === 0) {
    return {
      ok: false,
      message:
        "Sem permissão para excluir — a tarefa está travada ou pertence a outro usuário.",
    };
  }
  await emitWebhookEvent(
    "task.deleted",
    {
      taskId: id,
      title: (data[0].title as string) ?? null,
      recordId: (data[0].record_id as string | null) ?? null,
    },
    await getActiveOrgId()
  );
  // Só depois de o delete PASSAR pela RLS: enfileirar antes apagaria lá uma
  // atividade cuja tarefa continuou existindo aqui.
  await mirrorTaskDeletion(createServiceClient(), {
    orgId: await getActiveOrgId(),
    activityId,
    ownerEntity: mirrorOwner,
    ownerSourceId: mirrorSourceId,
    createdBy: session.user.id,
  });
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
    .order("due_time", { ascending: true, nullsFirst: false })
    .limit(100);
  return (data ?? []) as unknown as TaskRow[];
}

// Marca d'água da seção "Novas": tasksSeenAt de user_settings; sem registro,
// janela de 7 dias (não inundar o sino de quem nunca abriu). Usa o loader
// cache()d — o layout lê a mesma linha (sidebarPinned) na mesma request.
async function tasksSeenSince(userId: string): Promise<string> {
  const settings = await loadUserSettings(userId);
  const seen = (settings as { tasksSeenAt?: string }).tasksSeenAt;
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
  const [respIds, since] = await Promise.all([
    ownResponsibleIds(supabase, session.user.id),
    tasksSeenSince(session.user.id),
  ]);
  const notify = notifyMeFilter(session.user.id, respIds);
  const limitIso = addDaysIso(todayBrasiliaIso(), Math.max(0, dueSoonDays));

  const [{ data: due }, { data: fresh }] = await Promise.all([
    supabase
      .from("tasks")
      .select(TASK_COLS_WITH_RECORD)
      .is("completed_at", null)
      .not("due_date", "is", null)
      .lte("due_date", limitIso)
      .or(notify)
      .order("due_date", { ascending: true })
      .order("due_time", { ascending: true, nullsFirst: false })
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
    .order("due_time", { ascending: true, nullsFirst: false })
    .limit(50);
  return (data ?? []) as unknown as TaskRow[];
}

/**
 * ENCERRA a sequência de uma série para UM registro.
 *
 * Duas coisas, e as duas são necessárias: apagar as ocorrências ABERTAS (senão
 * elas ficam na tela do vendedor pedindo o que já se decidiu abandonar) e
 * gravar `active:false` no escopo do registro (senão o tick reabre a próxima
 * no minuto seguinte). Fazer só a primeira metade seria um botão cujo efeito
 * some sozinho.
 *
 * O que NÃO acontece: concluídas ficam (o que o vendedor fez é histórico, e é
 * ele que a árvore mostra) e o atributo fica (pausar ≠ excluir, 0131) — o
 * registro continua com árvore, agora sem tronco vivo.
 *
 * Mesma sequência de `deleteTask`/`deleteTasksBulk`: lê o `bitrix_activity_id`
 * ANTES do delete (depois a linha some) e enfileira o `delete` DEPOIS de a RLS
 * deixar passar. O espelho é best-effort — nunca derruba a exclusão local.
 */
export async function endRecordSeries(
  seriesKey: string,
  recordId: string,
  opts: { revalidate?: boolean } = {}
): Promise<TaskActionState & { deleted?: number }> {
  const session = await getSessionInfo();
  if (!session) return { ok: false, message: "Sessão expirada." };
  const orgId = await getActiveOrgId();
  if (!orgId) return { ok: false, message: "Organização ativa não identificada." };

  const supabase = await createClient();
  const { data: doomed, error: readError } = await supabase
    .from("tasks")
    .select("id, title, record_id, bitrix_activity_id")
    .eq("record_id", recordId)
    .eq("series_key", seriesKey)
    .is("completed_at", null)
    .not("series_occurrence", "is", null);
  if (readError) {
    return { ok: false, message: `Falha ao ler a sequência: ${readError.message}` };
  }

  let deleted = 0;
  const ids = (doomed ?? []).map((t) => t.id as string);
  if (ids.length > 0) {
    // `.select()` no delete: o que voltar é o que a RLS deixou apagar.
    const { data: gone, error } = await supabase
      .from("tasks")
      .delete()
      .in("id", ids)
      .select("id");
    if (error) {
      return { ok: false, message: `Falha ao encerrar: ${error.message}` };
    }
    const goneIds = new Set((gone ?? []).map((t) => t.id as string));
    deleted = goneIds.size;
    for (const t of doomed ?? []) {
      if (!goneIds.has(t.id as string)) continue;
      await emitWebhookEvent(
        "task.deleted",
        {
          taskId: t.id as string,
          title: (t.title as string) ?? null,
          recordId: (t.record_id as string | null) ?? null,
          origin: "app",
        },
        orgId
      );
    }
    await mirrorEndedSeries(
      supabase,
      (doomed ?? []).flatMap((t) =>
        goneIds.has(t.id as string) &&
        t.bitrix_activity_id &&
        t.record_id
          ? [
              {
                recordId: t.record_id as string,
                activityId: String(t.bitrix_activity_id),
              },
            ]
          : []
      ),
      orgId,
      session.user.id
    );
  }

  const off = await setRecordSeriesActive(supabase, orgId, session.user.id, {
    seriesKey,
    recordId,
    active: false,
  });
  if (!off.ok) return off;
  if (opts.revalidate !== false) revalidatePath("/operacao/tarefas");
  return { ok: true, deleted };
}

/** Volta atrás: a série volta a valer para o registro (as apagadas não voltam). */
export async function resumeRecordSeries(
  seriesKey: string,
  recordId: string,
  opts: { revalidate?: boolean } = {}
): Promise<TaskActionState> {
  const session = await getSessionInfo();
  if (!session) return { ok: false, message: "Sessão expirada." };
  const orgId = await getActiveOrgId();
  if (!orgId) return { ok: false, message: "Organização ativa não identificada." };
  const supabase = await createClient();
  const res = await setRecordSeriesActive(supabase, orgId, session.user.id, {
    seriesKey,
    recordId,
    active: true,
  });
  if (!res.ok) return res;
  if (opts.revalidate !== false) revalidatePath("/operacao/tarefas");
  return { ok: true };
}

/**
 * O liga/desliga de uma série num registro — a MESMA linha de
 * `series_settings` que guarda a cadência. Preserva `cadence_days`: encerrar a
 * sequência não pode apagar a exceção de ritmo que alguém ajustou.
 */
async function setRecordSeriesActive(
  supabase: Awaited<ReturnType<typeof createClient>>,
  orgId: string,
  userId: string,
  input: { seriesKey: string; recordId: string; active: boolean }
): Promise<TaskActionState> {
  const { data: existing } = await supabase
    .from("series_settings")
    .select("cadence_days")
    .eq("organization_id", orgId)
    .eq("series_key", input.seriesKey)
    .eq("scope_kind", "record")
    .eq("scope_value", input.recordId)
    .maybeSingle();

  const { error } = await supabase.from("series_settings").upsert(
    {
      organization_id: orgId,
      series_key: input.seriesKey,
      scope_kind: "record",
      scope_value: input.recordId,
      cadence_days: (existing?.cadence_days as number | null) ?? null,
      active: input.active,
      updated_by: userId,
    },
    { onConflict: "organization_id,series_key,scope_kind,scope_value" }
  );
  if (error) {
    // A RLS da 0132 é admin/gestor — a mesma de `setRecordCadence`.
    return {
      ok: false,
      message: `Não foi possível alterar a sequência: ${error.message}`,
    };
  }
  return { ok: true };
}

/**
 * Enfileira o `delete` no CRM das ocorrências que tinham atividade lá.
 *
 * Molde de `mirrorDeletedBulk` (lib/kanban/bulk-actions.ts): sem `taskId` (a
 * linha já não existe — quem identifica a ordem é o `activityId`) e pelo client
 * de SERVIÇO, porque a fila é infra e não tem policy para o usuário.
 */
async function mirrorEndedSeries(
  db: Awaited<ReturnType<typeof createClient>>,
  doomed: { recordId: string; activityId: string }[],
  orgId: string,
  createdBy: string
): Promise<void> {
  try {
    if (doomed.length === 0) return;
    const owners = await loadMirrorOwners(
      db,
      doomed.map((t) => t.recordId)
    );
    await enqueueTaskMirrorMany(
      createServiceClient(),
      doomed.flatMap((t) => {
        const owner = owners.get(t.recordId);
        if (!owner) return [];
        return [
          {
            orgId,
            op: "delete" as const,
            ownerEntity: owner.entity,
            ownerSourceId: owner.sourceId,
            activityId: t.activityId,
            createdBy,
          },
        ];
      })
    );
  } catch (e) {
    // Best-effort, como em toda a fila do espelho: a exclusão local já
    // aconteceu, e o portal fora do ar não pode desfazê-la.
    console.error("[tree] espelho da sequência falhou:", (e as Error).message);
  }
}
