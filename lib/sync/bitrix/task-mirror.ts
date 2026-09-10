// Versão: 1.2 | Data: 10/09/2026
// v1.2 (10/09/2026): resolução de dono EM LOTE (`loadMirrorOwners` +
// `enqueueTaskMirrorMany`). As ações em massa concluem/excluem até 200 tarefas
// numa chamada, e `mirrorTaskAfterWrite` resolve Base + registro POR TAREFA —
// seriam 400 consultas. O caminho unitário fica intocado.
// v1.1 (10/09/2026): o sentido de SAÍDA ficou completo (0137).
//   - `delete`: excluir aqui apaga a atividade lá. A ordem é enfileirada ANTES
//     do delete da linha (a FK vira `set null`, não cascade) — enfileirar
//     depois sumiria com a própria ordem, e a atividade ficaria órfã no feed.
//   - `comment_add`: a anotação daqui vira comentário da timeline.
//   - reabrir, mover de fase e remarcar passaram a enfileirar `update`. Sem
//     isso a leitura de volta (0137) re-fecharia a tarefa reaberta na rodada
//     seguinte, para sempre — a assimetria virava laço.
// A TAREFA DAQUI VIRA ATIVIDADE NO BITRIX (0136).
//
// O objeto do outro lado é `crm.activity` com TYPE_ID 6 / PROVIDER_ID CRM_TODO,
// amarrada ao negócio — a mesma coisa que o time já lê no feed do deal, ao lado
// dos comentários e das mudanças de etapa. Não é o módulo Tasks do Bitrix: uma
// tarefa de acompanhamento pertence à conversa do negócio, não a uma lista de
// tarefas paralela.
//
// Fila + dreno no tick, no molde do write-back (0032): a chamada externa não
// pode ficar no caminho de quem salva a tarefa, senão o portal fora do ar vira
// tarefa não criada AQUI. O dreno tem orçamento de tempo, tentativas e erro
// visível.
//
// IDEMPOTÊNCIA em duas camadas, como manda o precedente das 0129/0130/0132:
//   - `uq_task_queue_pending` (task_id, op) where status='pending' — salvar a
//     mesma tarefa três vezes enfileira UMA atualização;
//   - `tasks.bitrix_activity_id` — o dreno só cria quando ainda não há id, e
//     23505 é NO-OP, nunca `last_error`.
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  BITRIX_OWNER_TYPE_ID,
  resolveMirror,
  type MirrorChoice,
  type MirrorOwnerEntity,
} from "@/lib/tasks/mirror-config";
import { BitrixClient } from "./client";
import { WriteBackFatal } from "./writeback";

/** Lote por rodada e teto de tentativas — os mesmos números da 0032. */
const BATCH = 25;
const MAX_ATTEMPTS = 5;

export type TaskMirrorOp =
  | "create"
  | "update"
  | "complete"
  // v1.1: apagar lá o que se apagou aqui. Não carrega tarefa — ela já não
  // existe quando o dreno roda; quem identifica a ordem é o `activityId`.
  | "delete"
  // v1.1: a anotação daqui vira comentário na timeline do negócio.
  | "comment_add";

export interface EnqueueTaskMirrorInput {
  orgId: string;
  /** Ausente em `delete` (a tarefa já não existe) e em `comment_add`. */
  taskId?: string | null;
  /** Só em `comment_add`: a anotação a espelhar. */
  commentId?: string | null;
  op: TaskMirrorOp;
  ownerEntity: MirrorOwnerEntity;
  ownerSourceId: string;
  /** Já espelhada: o id da atividade a alterar (ou a apagar). */
  activityId?: string | null;
  createdBy?: string | null;
}

/**
 * Enfileira uma operação de espelho. NUNCA lança: espelhar é um efeito
 * colateral desejável, e derrubar o salvamento da tarefa por causa dele
 * inverteria a prioridade (o mesmo princípio do auto-match pós-sync).
 */
export async function enqueueTaskMirror(
  db: SupabaseClient,
  input: EnqueueTaskMirrorInput
): Promise<void> {
  try {
    const { error } = await db.from("bitrix_task_queue").insert({
      organization_id: input.orgId,
      task_id: input.taskId ?? null,
      comment_id: input.commentId ?? null,
      target: input.op === "comment_add" ? "comment" : "task",
      op: input.op,
      owner_entity: input.ownerEntity,
      owner_source_id: input.ownerSourceId,
      activity_id: input.activityId ?? null,
      created_by: input.createdBy ?? null,
    });
    // 23505 = já existe uma pendente da mesma (tarefa, op). É o resultado
    // desejado, não uma falha — poluir o log com "duplicate key" esconderia
    // os erros de verdade (precedente literal do create_task na 0129).
    if (error && error.code !== "23505") {
      console.error("[task-mirror] enfileirar falhou:", error.message);
    }
  } catch (e) {
    console.error("[task-mirror] enfileirar falhou:", (e as Error).message);
  }
}

interface QueueRow {
  id: string;
  task_id: string | null;
  comment_id: string | null;
  target: "task" | "comment";
  op: TaskMirrorOp;
  owner_entity: MirrorOwnerEntity;
  owner_source_id: string;
  activity_id: string | null;
  attempts: number;
}

interface TaskRowForMirror {
  id: string;
  title: string;
  description: string | null;
  due_date: string | null;
  due_time: string | null;
  completed_at: string | null;
  responsible_id: string | null;
  bitrix_activity_id: string | null;
}

/**
 * DEADLINE da atividade no formato do Bitrix.
 *
 * A tarefa guarda dia civil + hora de parede de Brasília (0063), fora do
 * regime de ancoragem dos `records`. Sem hora, meio-dia: 00:00 no fuso do
 * portal costuma cair no dia ANTERIOR na visualização de quem está em Moscou.
 */
export function activityDeadline(
  dueDate: string | null,
  dueTime: string | null
): string | null {
  if (!dueDate) return null;
  const time = dueTime ? dueTime.slice(0, 5) : "12:00";
  return `${dueDate}T${time}:00-03:00`;
}

/** O payload de `fields` da atividade — puro, para o teste conferir. */
export function activityFields(
  task: TaskRowForMirror,
  ownerEntity: MirrorOwnerEntity,
  ownerSourceId: string,
  responsibleBitrixId: string | null
): Record<string, unknown> {
  const ownerTypeId = BITRIX_OWNER_TYPE_ID[ownerEntity];
  const fields: Record<string, unknown> = {
    OWNER_ID: ownerSourceId,
    OWNER_TYPE_ID: ownerTypeId,
    TYPE_ID: 6,
    PROVIDER_ID: "CRM_TODO",
    PROVIDER_TYPE_ID: "TODO",
    SUBJECT: task.title,
    COMPLETED: task.completed_at ? "Y" : "N",
    BINDINGS: [{ OWNER_ID: ownerSourceId, OWNER_TYPE_ID: ownerTypeId }],
  };
  if (task.description) fields.DESCRIPTION = task.description;
  if (responsibleBitrixId) fields.RESPONSIBLE_ID = responsibleBitrixId;
  const deadline = activityDeadline(task.due_date, task.due_time);
  if (deadline) {
    fields.DEADLINE = deadline;
    fields.START_TIME = deadline;
    fields.END_TIME = deadline;
  }
  return fields;
}

/**
 * O portal diz "não achei" de várias formas. Apagar o que já não existe é o
 * resultado desejado — repetir cinco vezes só enche a fila de erro.
 */
function activityGone(e: unknown): boolean {
  const msg = (e as Error)?.message ?? "";
  return /NOT_FOUND|not found|não encontrad|does not exist/i.test(msg);
}

/** Só o que o dreno usa do cliente — para o teste injetar um dublê. */
export interface BitrixCallable {
  call<T>(method: string, params?: Record<string, unknown>): Promise<{ result: T }>;
}

/**
 * Drena a fila de espelho. Chamado pelo tick que já existe, logo depois do
 * write-back e com o MESMO deadline: os dois competem pelo mesmo orçamento, e
 * é o write-back que tem prioridade (ele carrega edição de dado do usuário).
 */
export async function drainTaskMirrorQueue(
  db: SupabaseClient,
  deadline: number,
  client?: BitrixCallable
): Promise<{ done: number; errors: number }> {
  const { data } = await db
    .from("bitrix_task_queue")
    .select(
      "id, task_id, comment_id, target, op, owner_entity, owner_source_id, activity_id, attempts"
    )
    .eq("status", "pending")
    .order("created_at", { ascending: true })
    .limit(BATCH);
  const rows = (data ?? []) as QueueRow[];
  if (rows.length === 0) return { done: 0, errors: 0 };

  const api: BitrixCallable = client ?? new BitrixClient();
  let done = 0;
  let errors = 0;
  const now = () => new Date().toISOString();

  for (const row of rows) {
    if (Date.now() >= deadline) break;

    try {
      // --- ramo 1: apagar a atividade lá ---
      // Sem tarefa, de propósito: quem chega aqui é a ordem enfileirada ANTES
      // do delete da linha. Só o `activity_id` importa.
      if (row.op === "delete") {
        if (!row.activity_id) {
          throw new WriteBackFatal("Ordem de exclusão sem id da atividade.");
        }
        try {
          await api.call("crm.activity.delete", { id: row.activity_id });
        } catch (e) {
          // Já não existe lá: é o resultado desejado, não uma falha a repetir.
          if (activityGone(e)) {
            // segue para marcar 'done'
          } else throw e;
        }
        await db
          .from("bitrix_task_queue")
          .update({ status: "done", processed_at: now(), last_error: null })
          .eq("id", row.id);
        done += 1;
        continue;
      }

      // --- ramo 2: a anotação daqui vira comentário na timeline ---
      if (row.op === "comment_add") {
        if (!row.comment_id) {
          throw new WriteBackFatal("Ordem de comentário sem a anotação.");
        }
        const { data: cmt } = await db
          .from("comments")
          .select("id, body, bitrix_comment_id")
          .eq("id", row.comment_id)
          .maybeSingle();
        if (!cmt) throw new WriteBackFatal("Anotação não existe mais.");
        // Já espelhada: nada a fazer. É a idempotência do lado de cá — sem
        // ela, uma retentativa duplicaria o comentário no feed do negócio.
        if (!cmt.bitrix_comment_id) {
          const res = await api.call<number | string>(
            "crm.timeline.comment.add",
            {
              fields: {
                ENTITY_ID: row.owner_source_id,
                ENTITY_TYPE: row.owner_entity,
                COMMENT: String(cmt.body ?? ""),
              },
            }
          );
          const newId = res.result != null ? String(res.result) : "";
          if (newId === "") {
            throw new Error("O Bitrix não devolveu o id do comentário.");
          }
          await db
            .from("comments")
            .update({ bitrix_comment_id: newId })
            .eq("id", cmt.id as string);
        }
        await db
          .from("bitrix_task_queue")
          .update({ status: "done", processed_at: now(), last_error: null })
          .eq("id", row.id);
        done += 1;
        continue;
      }

      // --- ramo 3: criar/atualizar/concluir a atividade da tarefa ---
      if (!row.task_id) throw new WriteBackFatal("Ordem sem tarefa.");
      const { data: taskData } = await db
        .from("tasks")
        .select(
          "id, title, description, due_date, due_time, completed_at, responsible_id, bitrix_activity_id"
        )
        .eq("id", row.task_id)
        .maybeSingle();
      const task = taskData as TaskRowForMirror | null;
      if (!task) {
        // Tarefa apagada entre enfileirar e drenar: nada a espelhar, e isso
        // não é erro. Marca como feita para a linha sair da fila.
        throw new WriteBackFatal("Tarefa não existe mais.");
      }

      // O responsável do Bitrix é o único mapa local→portal de usuário.
      let responsibleBitrixId: string | null = null;
      if (task.responsible_id) {
        const { data: resp } = await db
          .from("responsibles")
          .select("bitrix_user_id")
          .eq("id", task.responsible_id)
          .maybeSingle();
        responsibleBitrixId = (resp?.bitrix_user_id as string | null) ?? null;
      }

      const fields = activityFields(
        task,
        row.owner_entity,
        row.owner_source_id,
        responsibleBitrixId
      );

      // O id gravado na TAREFA vence o da linha da fila: entre enfileirar um
      // 'create' e drená-lo, outra rodada pode já tê-la criado.
      const activityId = task.bitrix_activity_id ?? row.activity_id;

      if (row.op === "create" && !activityId) {
        const res = await api.call<number | string>("crm.activity.add", {
          fields,
        });
        const newId = res.result != null ? String(res.result) : "";
        if (newId === "") {
          throw new Error("O Bitrix não devolveu o id da atividade.");
        }
        // Sem isto, a próxima rodada criaria a MESMA atividade de novo.
        await db
          .from("tasks")
          .update({ bitrix_activity_id: newId })
          .eq("id", task.id);
      } else if (activityId) {
        // 'update' e 'complete' são a mesma chamada: o COMPLETED já saiu do
        // estado da tarefa em `activityFields`. Um 'create' cuja atividade já
        // existe também cai aqui — é a idempotência.
        await api.call("crm.activity.update", { id: activityId, fields });
      }
      // 'create' sem id e sem resposta não chega aqui (lança acima).

      await db
        .from("bitrix_task_queue")
        .update({ status: "done", processed_at: now(), last_error: null })
        .eq("id", row.id);
      done += 1;
    } catch (e) {
      const msg = (e as Error).message;
      const attempts = row.attempts + 1;
      const terminal = e instanceof WriteBackFatal || attempts >= MAX_ATTEMPTS;
      await db
        .from("bitrix_task_queue")
        .update({
          attempts,
          last_error: msg,
          status: terminal ? "error" : "pending",
          processed_at: terminal ? now() : null,
        })
        .eq("id", row.id);
      errors += 1;
    }
  }

  return { done, errors };
}

/**
 * Resolve os três níveis para UMA tarefa e enfileira, se for o caso.
 *
 * Chamado dos choke points de tarefa (criar, editar, concluir) e do executor
 * das automações. Best-effort por desenho: espelhar é efeito colateral, e
 * derrubar o salvamento por causa dele inverteria a prioridade.
 *
 * Usa service role para ESCREVER na fila (a tabela não tem policy de insert,
 * como a 0032) — mas a leitura do registro e da Base pode vir do client do
 * usuário, que é quem tem o recorte certo.
 */
export async function mirrorTaskAfterWrite(
  db: SupabaseClient,
  serviceDb: SupabaseClient,
  input: {
    taskId: string;
    recordId: string | null;
    orgId: string | null;
    op: TaskMirrorOp;
    /** Nível 2: a escolha da regra que criou a tarefa. */
    ruleChoice?: MirrorChoice;
    /** Nível 3: a caixa do formulário. */
    taskChoice?: MirrorChoice;
    createdBy?: string | null;
  }
): Promise<void> {
  try {
    if (!input.recordId || !input.orgId) return;

    const { data: record } = await db
      .from("records")
      .select("record_type, source_id")
      .eq("id", input.recordId)
      .maybeSingle();
    if (!record) return;

    const { data: source } = await db
      .from("data_sources")
      .select("bitrix_activity_owner")
      .eq("record_type", record.record_type as string)
      .maybeSingle();

    const decision = resolveMirror({
      baseOwner:
        (source?.bitrix_activity_owner as MirrorOwnerEntity | null) ?? null,
      sourceId: (record.source_id as string | null) ?? null,
      ruleChoice: input.ruleChoice,
      taskChoice: input.taskChoice,
    });
    if (!decision.mirror) return;

    // Já espelhada? Então a operação é sempre uma ATUALIZAÇÃO, mesmo que o
    // chamador tenha pedido 'create' — é a idempotência do lado de cá.
    const { data: task } = await db
      .from("tasks")
      .select("bitrix_activity_id")
      .eq("id", input.taskId)
      .maybeSingle();
    const activityId = (task?.bitrix_activity_id as string | null) ?? null;

    await enqueueTaskMirror(serviceDb, {
      orgId: input.orgId,
      taskId: input.taskId,
      op: activityId && input.op === "create" ? "update" : input.op,
      ownerEntity: decision.ownerEntity!,
      ownerSourceId: decision.ownerSourceId!,
      activityId,
      createdBy: input.createdBy ?? null,
    });
  } catch (e) {
    console.error("[task-mirror] espelho falhou:", (e as Error).message);
  }
}

/** Onde a atividade de um registro fica pendurada, já resolvido. */
export interface MirrorOwner {
  entity: MirrorOwnerEntity;
  sourceId: string;
}

/**
 * Resolve o dono da atividade para VÁRIOS registros de uma vez.
 *
 * Duas consultas no total (as Bases que espelham + os registros), em vez de
 * duas por tarefa. Registro cuja Base não espelha, ou sem par no CRM, fica
 * FORA do mapa — é o mesmo piso do `resolveMirror`, só que em lote.
 */
export async function loadMirrorOwners(
  db: SupabaseClient,
  recordIds: string[]
): Promise<Map<string, MirrorOwner>> {
  const out = new Map<string, MirrorOwner>();
  const ids = [...new Set(recordIds)].filter(Boolean);
  if (ids.length === 0) return out;

  const { data: sources } = await db
    .from("data_sources")
    .select("record_type, bitrix_activity_owner")
    .not("bitrix_activity_owner", "is", null);
  const entityByType = new Map<string, MirrorOwnerEntity>();
  for (const s of sources ?? []) {
    entityByType.set(
      s.record_type as string,
      s.bitrix_activity_owner as MirrorOwnerEntity
    );
  }
  // Nenhuma Base espelha (o estado padrão): nem vale ler os registros.
  if (entityByType.size === 0) return out;

  for (let i = 0; i < ids.length; i += 200) {
    const { data: recs } = await db
      .from("records")
      .select("id, record_type, source_id")
      .in("id", ids.slice(i, i + 200))
      .not("source_id", "is", null);
    for (const r of recs ?? []) {
      const entity = entityByType.get(r.record_type as string);
      if (!entity) continue;
      out.set(r.id as string, { entity, sourceId: String(r.source_id) });
    }
  }
  return out;
}

/**
 * Enfileira VÁRIAS operações de espelho.
 *
 * Tenta o insert em lote e cai para linha a linha se ele falhar — o índice
 * `uq_task_queue_pending` é parcial, e o PostgREST não sabe expressar o
 * `on conflict … where`, então um único 23505 derrubaria o lote inteiro. O
 * caminho por linha trata 23505 como NO-OP, que é o resultado desejado.
 */
export async function enqueueTaskMirrorMany(
  db: SupabaseClient,
  rows: EnqueueTaskMirrorInput[]
): Promise<void> {
  if (rows.length === 0) return;
  const payload = rows.map((input) => ({
    organization_id: input.orgId,
    task_id: input.taskId ?? null,
    comment_id: input.commentId ?? null,
    target: input.op === "comment_add" ? "comment" : "task",
    op: input.op,
    owner_entity: input.ownerEntity,
    owner_source_id: input.ownerSourceId,
    activity_id: input.activityId ?? null,
    created_by: input.createdBy ?? null,
  }));
  try {
    const { error } = await db.from("bitrix_task_queue").insert(payload);
    if (!error) return;
  } catch {
    // cai no caminho por linha
  }
  for (const input of rows) await enqueueTaskMirror(db, input);
}

/**
 * Enfileira a EXCLUSÃO da atividade — chamada ANTES de apagar a tarefa.
 *
 * A ordem tem de existir antes porque a linha da tarefa some: a FK da fila é
 * `on delete set null` (0137) justamente para a ordem sobreviver. Enfileirar
 * depois do delete não teria de onde ler o `bitrix_activity_id`, e a atividade
 * ficaria aberta no feed do negócio para sempre.
 *
 * Sem `activityId` não há o que apagar lá — e isso é o caso normal (a esmagadora
 * maioria das tarefas nunca foi espelhada), não um erro.
 */
export async function mirrorTaskDeletion(
  serviceDb: SupabaseClient,
  input: {
    orgId: string | null;
    activityId: string | null;
    ownerEntity: MirrorOwnerEntity | null;
    ownerSourceId: string | null;
    createdBy?: string | null;
  }
): Promise<void> {
  if (
    !input.orgId ||
    !input.activityId ||
    !input.ownerEntity ||
    !input.ownerSourceId
  ) {
    return;
  }
  await enqueueTaskMirror(serviceDb, {
    orgId: input.orgId,
    op: "delete",
    ownerEntity: input.ownerEntity,
    ownerSourceId: input.ownerSourceId,
    activityId: input.activityId,
    createdBy: input.createdBy ?? null,
  });
}

/**
 * A ANOTAÇÃO daqui vira comentário na timeline do negócio.
 *
 * Mesma cascata do espelho de tarefa (Base → registro com par no CRM), sem os
 * níveis 2 e 3: a anotação não nasce de regra nem tem caixa própria — quem
 * decide é a Base. Best-effort, como todo espelho.
 */
export async function mirrorCommentAfterWrite(
  db: SupabaseClient,
  serviceDb: SupabaseClient,
  input: {
    commentId: string;
    recordId: string | null;
    orgId: string | null;
    createdBy?: string | null;
  }
): Promise<void> {
  try {
    if (!input.recordId || !input.orgId) return;

    const { data: record } = await db
      .from("records")
      .select("record_type, source_id")
      .eq("id", input.recordId)
      .maybeSingle();
    if (!record) return;

    const { data: source } = await db
      .from("data_sources")
      .select("bitrix_activity_owner")
      .eq("record_type", record.record_type as string)
      .maybeSingle();

    const decision = resolveMirror({
      baseOwner:
        (source?.bitrix_activity_owner as MirrorOwnerEntity | null) ?? null,
      sourceId: (record.source_id as string | null) ?? null,
    });
    if (!decision.mirror) return;

    await enqueueTaskMirror(serviceDb, {
      orgId: input.orgId,
      commentId: input.commentId,
      op: "comment_add",
      ownerEntity: decision.ownerEntity!,
      ownerSourceId: decision.ownerSourceId!,
      createdBy: input.createdBy ?? null,
    });
  } catch (e) {
    console.error("[task-mirror] espelho de anotação falhou:", (e as Error).message);
  }
}
