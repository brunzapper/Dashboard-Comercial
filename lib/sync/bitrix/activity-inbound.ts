// Versão: 1.0 | Data: 10/09/2026
// O BITRIX DE VOLTA (0137): atividade concluída, apagada ou criada LÁ vira
// tarefa concluída, apagada ou criada AQUI — e o comentário da timeline vira
// anotação do registro.
//
// O PROBLEMA QUE ESTE MÓDULO EXISTE PARA RESOLVER, e por que a solução não é
// a óbvia. Concluir uma atividade NÃO mexe no `DATE_MODIFY` do negócio. O
// reconcile inteiro é `">=DATE_MODIFY": since` (runner.ts), então o deal cuja
// única mudança foi "o vendedor fechou a tarefa" jamais volta na janela: a
// conclusão feita lá é invisível para o sync.
//
// A regra pedida — "os registros com atividade pendente são buscados
// independentemente de período" — está certa, mas o objeto a buscar não é o
// deal: reler o deal não diz nada sobre as atividades dele. O que se busca
// fora do período é a LISTA DE ATIVIDADES daqueles donos. E ela resolve duas
// coisas de uma vez, porque a exclusão só se detecta por AUSÊNCIA: a atividade
// apagada não emite nada, simplesmente não volta na lista do dono.
//
// Por isso este módulo NÃO é uma fase paginada do job (o runner é passo a
// passo e não guarda o que já viu entre páginas — não teria como saber se uma
// atividade "sumiu" ou só está na página seguinte). Ele lê o dono INTEIRO de
// uma vez, em lotes, com orçamento próprio, no molde dos outros ganchos
// pós-job (`runAutoMatchIncremental`, `reconcileAllKanbanAllocationFields`).
//
// QUEM ESCREVE O QUÊ — a linha que evita o cabo de guerra:
//
//   | Fato                                            | Dono   |
//   |-------------------------------------------------|--------|
//   | Título/descrição/prazo/responsável de tarefa     | DAQUI  |
//   |   já espelhada (o outbound leva)                 |        |
//   | COMPLETED de atividade existente                 | DE LÁ  |
//   | Atividade que sumiu do dono                      | DE LÁ  |
//   | Atividade CRM_TODO sem tarefa aqui               | DE LÁ  |
//
// O inbound NUNCA sobrescreve o conteúdo de uma tarefa que já tem
// `bitrix_activity_id`. Com isso não é preciso inventar um `isProtected` para
// `tasks` (invariante 36: `field_modified_at` é do sync de REGISTRO, e
// carimbá-lo aqui não teria sentido), e não há pingue-pongue — a escrita é
// direta, sem enfileirar de volta.
//
// ESCOPO, declarado: só `PROVIDER_ID = 'CRM_TODO'` (TYPE_ID 6) vira tarefa —
// o mesmo objeto que nós criamos. Ligação, e-mail e reunião TAMBÉM são
// atividades, e importá-las encheria a lista de tarefas de coisa que ninguém
// abriu. E só em Base com `bitrix_activity_owner` configurado: Base que não
// espelha não recebe.
//
// Service role com org EXPLÍCITA em toda escrita, `emitWebhookEvent` à mão —
// o padrão de todo escritor de sistema do projeto.
import type { SupabaseClient } from "@supabase/supabase-js";

import { emitWebhookEvent } from "@/lib/webhooks/emit";
import {
  BITRIX_OWNER_TYPE_ID,
  type MirrorOwnerEntity,
} from "@/lib/tasks/mirror-config";
import { BitrixClient } from "./client";
import type { BitrixCallable } from "./task-mirror";

/** Donos por chamada. O filtro `@OWNER_ID` do Bitrix aceita lista. */
const OWNER_BATCH = 40;
/** Teto de páginas por lote — cinto de segurança, não semântica. */
const MAX_PAGES = 20;
/** Teto de registros conferidos por rodada. */
const MAX_OWNERS = 400;
/** Timeline: uma chamada por registro, então o teto é mais apertado. */
const MAX_COMMENT_OWNERS = 60;

export interface InboundResult {
  completed: number;
  reopened: number;
  deleted: number;
  created: number;
  comments: number;
}

const EMPTY: InboundResult = {
  completed: 0,
  reopened: 0,
  deleted: 0,
  created: 0,
  comments: 0,
};

interface OwnerRef {
  recordId: string;
  orgId: string;
  entity: MirrorOwnerEntity;
  sourceId: string;
  /** Tem o atributo `tree` ativo — só esses puxam comentários. */
  tree: boolean;
}

interface BitrixActivity {
  ID: string | number;
  OWNER_ID?: string | number;
  OWNER_TYPE_ID?: string | number;
  SUBJECT?: string;
  DESCRIPTION?: string;
  COMPLETED?: string;
  DEADLINE?: string;
  PROVIDER_ID?: string;
  RESPONSIBLE_ID?: string | number;
}

const ACTIVITY_SELECT = [
  "ID",
  "OWNER_ID",
  "OWNER_TYPE_ID",
  "SUBJECT",
  "DESCRIPTION",
  "COMPLETED",
  "DEADLINE",
  "PROVIDER_ID",
  "RESPONSIBLE_ID",
];

/** O TODO da timeline — o único tipo que vira tarefa aqui. */
export function isTodoActivity(a: BitrixActivity): boolean {
  return String(a.PROVIDER_ID ?? "") === "CRM_TODO";
}

/**
 * O dia civil de um DEADLINE do Bitrix.
 *
 * O portal devolve com o offset DELE (Moscou). O prazo daqui é dia civil de
 * Brasília (0063), então converter é obrigatório: `2026-09-30T02:00:00+03:00`
 * é ainda dia 29 para quem lê aqui, e cortar os 10 primeiros caracteres da
 * string crua adiantaria a tarefa em um dia.
 */
export function deadlineToLocalDay(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.trim() === "") return null;
  const ts = Date.parse(raw);
  if (!Number.isFinite(ts)) return null;
  return new Date(ts).toLocaleDateString("en-CA", {
    timeZone: "America/Sao_Paulo",
  });
}

/**
 * Quais registros conferir FORA do período: os que têm tarefa aberta já
 * espelhada (a conclusão/exclusão feita lá é invisível de outro jeito) e os
 * que têm o atributo `tree` ativo (é neles que o acompanhamento é lido, e são
 * os únicos que puxam comentários — decisão do usuário).
 */
export async function pendingActivityOwners(
  db: SupabaseClient
): Promise<OwnerRef[]> {
  // As Bases que espelham dizem em que entidade do CRM a atividade mora.
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
  if (entityByType.size === 0) return [];

  const ids = new Set<string>();
  const { data: openTasks } = await db
    .from("tasks")
    .select("record_id")
    .not("bitrix_activity_id", "is", null)
    .is("completed_at", null)
    .limit(MAX_OWNERS * 4);
  for (const t of openTasks ?? []) {
    if (t.record_id) ids.add(t.record_id as string);
  }

  const treeIds = new Set<string>();
  const { data: attrs } = await db
    .from("record_attributes")
    .select("record_id")
    .eq("attribute_key", "tree")
    .eq("status", "ativo")
    .limit(MAX_OWNERS * 4);
  for (const a of attrs ?? []) {
    treeIds.add(a.record_id as string);
    ids.add(a.record_id as string);
  }
  if (ids.size === 0) return [];

  const out: OwnerRef[] = [];
  const list = [...ids].slice(0, MAX_OWNERS);
  for (let i = 0; i < list.length; i += 200) {
    const { data: recs } = await db
      .from("records")
      .select("id, organization_id, record_type, source_id")
      .in("id", list.slice(i, i + 200))
      .not("source_id", "is", null);
    for (const r of recs ?? []) {
      const entity = entityByType.get(r.record_type as string);
      if (!entity) continue;
      out.push({
        recordId: r.id as string,
        orgId: r.organization_id as string,
        entity,
        sourceId: String(r.source_id),
        tree: treeIds.has(r.id as string),
      });
    }
  }
  return out;
}

/** Lê TODAS as páginas de um filtro de atividade (dentro do teto). */
async function listActivities(
  api: BitrixCallable,
  filter: Record<string, unknown>,
  deadline: number
): Promise<BitrixActivity[]> {
  const out: BitrixActivity[] = [];
  let start = 0;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    if (Date.now() >= deadline) break;
    const res = (await api.call<BitrixActivity[]>("crm.activity.list", {
      filter,
      select: ACTIVITY_SELECT,
      order: { ID: "ASC" },
      start,
    })) as { result: BitrixActivity[]; next?: number };
    out.push(...(res.result ?? []));
    if (typeof res.next !== "number") break;
    start = res.next;
  }
  return out;
}

/**
 * Concilia um LOTE de donos com o que existe lá.
 *
 * Só aqui a exclusão é detectável: temos a lista COMPLETA das atividades de
 * cada dono do lote, então uma tarefa espelhada cujo id não voltou teve a
 * atividade apagada no portal.
 */
async function reconcileOwnerBatch(
  db: SupabaseClient,
  api: BitrixCallable,
  entity: MirrorOwnerEntity,
  owners: OwnerRef[],
  deadline: number
): Promise<InboundResult> {
  const res = { ...EMPTY };
  const bySourceId = new Map(owners.map((o) => [o.sourceId, o]));

  const activities = await listActivities(
    api,
    {
      OWNER_TYPE_ID: BITRIX_OWNER_TYPE_ID[entity],
      "@OWNER_ID": owners.map((o) => o.sourceId),
    },
    deadline
  );
  const byActivityId = new Map(
    activities.map((a) => [String(a.ID), a] as const)
  );

  const recordIds = owners.map((o) => o.recordId);
  const { data: taskRows } = await db
    .from("tasks")
    .select("id, record_id, title, completed_at, bitrix_activity_id")
    .in("record_id", recordIds)
    .not("bitrix_activity_id", "is", null);
  const tasks = taskRows ?? [];
  const knownActivityIds = new Set(
    tasks.map((t) => String(t.bitrix_activity_id))
  );

  const nowIso = new Date().toISOString();

  for (const task of tasks) {
    if (Date.now() >= deadline) return res;
    const activityId = String(task.bitrix_activity_id);
    const activity = byActivityId.get(activityId);
    const orgId =
      owners.find((o) => o.recordId === task.record_id)?.orgId ?? null;

    // Sumiu lá → some aqui. Definitivo, como o usuário pediu: a lixeira de
    // registros (0121) é de `records`, e uma tarefa apagada no CRM não deixa
    // nada para restaurar do outro lado.
    if (!activity) {
      await db.from("tasks").delete().eq("id", task.id as string);
      await emitWebhookEvent(
        "task.deleted",
        {
          taskId: task.id as string,
          title: (task.title as string) ?? null,
          recordId: (task.record_id as string | null) ?? null,
          origin: "bitrix",
        },
        orgId
      );
      res.deleted += 1;
      continue;
    }

    const doneThere = String(activity.COMPLETED ?? "") === "Y";
    const doneHere = Boolean(task.completed_at);
    if (doneThere === doneHere) continue;

    // O ESTADO de conclusão é de lá; o CONTEÚDO segue sendo daqui.
    await db
      .from("tasks")
      .update(
        doneThere
          ? { completed_at: nowIso, completed_by: null }
          : { completed_at: null, completed_by: null }
      )
      .eq("id", task.id as string);
    await emitWebhookEvent(
      doneThere ? "task.completed" : "task.updated",
      { taskId: task.id as string, origin: "bitrix" },
      orgId
    );
    if (doneThere) res.completed += 1;
    else res.reopened += 1;
  }

  // Atividade CRM_TODO que não conhecemos: nasceu lá, vira tarefa aqui.
  for (const activity of activities) {
    if (Date.now() >= deadline) return res;
    if (!isTodoActivity(activity)) continue;
    if (knownActivityIds.has(String(activity.ID))) continue;
    const owner = bySourceId.get(String(activity.OWNER_ID ?? ""));
    if (!owner) continue;
    res.created += (await createTaskFromActivity(db, owner, activity)) ? 1 : 0;
  }

  return res;
}

/** O responsável local do usuário do Bitrix — o único mapa que existe. */
async function localResponsible(
  db: SupabaseClient,
  bitrixUserId: unknown
): Promise<string | null> {
  const id = bitrixUserId == null ? "" : String(bitrixUserId);
  if (id === "") return null;
  const { data } = await db
    .from("responsibles")
    .select("id")
    .eq("bitrix_user_id", id)
    .maybeSingle();
  return (data?.id as string | null) ?? null;
}

async function createTaskFromActivity(
  db: SupabaseClient,
  owner: OwnerRef,
  activity: BitrixActivity
): Promise<boolean> {
  const title = String(activity.SUBJECT ?? "").trim() || "Atividade do Bitrix";
  const { data, error } = await db
    .from("tasks")
    .insert({
      organization_id: owner.orgId,
      title: title.slice(0, 300),
      description: String(activity.DESCRIPTION ?? "").trim() || null,
      record_id: owner.recordId,
      due_date: deadlineToLocalDay(activity.DEADLINE),
      completed_at:
        String(activity.COMPLETED ?? "") === "Y" ? new Date().toISOString() : null,
      responsible_id: await localResponsible(db, activity.RESPONSIBLE_ID),
      // Autoria de SISTEMA: ninguém daqui a criou.
      created_by: null,
      position: -Date.now(),
      bitrix_activity_id: String(activity.ID),
    })
    .select("id")
    .maybeSingle();
  // 23505 = o índice único da 0136 pegou uma corrida com o dreno de saída. É o
  // resultado desejado (uma tarefa por atividade), não uma falha.
  if (error) return false;
  if (!data) return false;
  await emitWebhookEvent(
    "task.created",
    {
      taskId: data.id as string,
      title,
      recordId: owner.recordId,
      origin: "bitrix",
    },
    owner.orgId
  );
  return true;
}

interface BitrixComment {
  ID: string | number;
  COMMENT?: string;
  CREATED?: string;
}

/**
 * Comentário da timeline vira ANOTAÇÃO do registro.
 *
 * Só nos registros com o atributo `tree` ativo (decisão do usuário): é uma
 * chamada por registro, e é neles que o acompanhamento é lido. Comentário que
 * NÓS criamos volta aqui e é ignorado pelo `bitrix_comment_id` — sem isso ele
 * viraria uma segunda anotação a cada rodada.
 */
async function pullComments(
  db: SupabaseClient,
  api: BitrixCallable,
  owners: OwnerRef[],
  deadline: number
): Promise<number> {
  let created = 0;
  for (const owner of owners.slice(0, MAX_COMMENT_OWNERS)) {
    if (Date.now() >= deadline) break;
    let comments: BitrixComment[] = [];
    try {
      const res = await api.call<BitrixComment[]>("crm.timeline.comment.list", {
        filter: { ENTITY_ID: owner.sourceId, ENTITY_TYPE: owner.entity },
        order: { ID: "DESC" },
      });
      comments = res.result ?? [];
    } catch {
      continue; // um registro sem timeline não derruba os outros
    }
    if (comments.length === 0) continue;

    const ids = comments.map((c) => String(c.ID));
    const { data: known } = await db
      .from("comments")
      .select("bitrix_comment_id")
      .in("bitrix_comment_id", ids);
    const seen = new Set((known ?? []).map((k) => String(k.bitrix_comment_id)));

    for (const c of comments) {
      const id = String(c.ID);
      if (seen.has(id)) continue;
      const body = String(c.COMMENT ?? "").trim();
      if (body === "") continue;
      const { data, error } = await db
        .from("comments")
        .insert({
          record_id: owner.recordId,
          body: body.slice(0, 4000),
          created_by: null,
          position: -Date.now(),
          bitrix_comment_id: id,
        })
        .select("id")
        .maybeSingle();
      if (error || !data) continue; // 23505 = corrida; no-op
      await emitWebhookEvent(
        "comment.created",
        {
          commentId: data.id as string,
          recordId: owner.recordId,
          taskId: null,
          origin: "bitrix",
        },
        owner.orgId
      );
      created += 1;
    }
  }
  return created;
}

/**
 * A rodada inteira de leitura. Best-effort por desenho: uma falha do portal
 * não pode derrubar o job de sync que acabou de terminar.
 */
export async function syncBitrixActivitiesInbound(
  db: SupabaseClient,
  deadline: number,
  client?: BitrixCallable
): Promise<InboundResult> {
  const owners = await pendingActivityOwners(db);
  if (owners.length === 0) return { ...EMPTY };

  const api: BitrixCallable = client ?? new BitrixClient();
  const total = { ...EMPTY };

  for (const entity of ["deal", "lead"] as MirrorOwnerEntity[]) {
    const ofEntity = owners.filter((o) => o.entity === entity);
    for (let i = 0; i < ofEntity.length; i += OWNER_BATCH) {
      if (Date.now() >= deadline) return total;
      const batch = ofEntity.slice(i, i + OWNER_BATCH);
      const res = await reconcileOwnerBatch(db, api, entity, batch, deadline);
      total.completed += res.completed;
      total.reopened += res.reopened;
      total.deleted += res.deleted;
      total.created += res.created;
    }
  }

  total.comments = await pullComments(
    db,
    api,
    owners.filter((o) => o.tree),
    deadline
  );
  return total;
}
