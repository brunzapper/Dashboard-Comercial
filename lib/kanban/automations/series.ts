// Versão: 1.3 | Data: 10/09/2026
// v1.3 (10/09/2026): `executeSeriesRevocations` — registro que sai do recorte
//   da regra devolve as ocorrências ainda não concluídas (e a atividade delas
//   no CRM). E o espelho da criação passa a respeitar a ANTECEDÊNCIA
//   (`mirrorLeadDays`): a tarefa nasce aqui, mas só vira atividade lá quando o
//   vencimento se aproxima — o varredor do tick cuida disso.
// v1.2 (10/09/2026): só vocabulário — o substantivo da ocorrência
//   da série saiu do código e virou dado (SeriesConfig.noun, e
//   tasks.occurrence_noun por tarefa).
// v1.1 (09/09/2026): a tarefa criada entra na fila do espelho no Bitrix
//   (0136) quando a Base (e a regra) mandam. Best-effort: o espelho nunca
//   derruba a criação da tarefa.
// Executor da ação `create_task_series` (0132): cria a tarefa devida hoje e
// concede o atributo a quem entrou na série.
//
// Irmão de `task.ts`, com uma diferença que é o desenho inteiro: lá a trava é
// "uma tarefa ABERTA por regra × registro" (a regra só abre outra depois que
// a anterior é concluída); aqui é uma tarefa por OCORRÊNCIA, e a 3ª quinzena
// vence tenha ou não a 2ª sido feita. É ver as duas em aberto lado a lado que
// mostra como o vendedor está conduzindo o lead.
//
// A escrita NÃO usa `createTask` (action `(prevState, formData)` que depende de
// `getSessionInfo()`, inexistente num tick): reusa o padrão de
// `lib/mappings/notify.ts` — service role, org EXPLÍCITA, webhook
// `task.created` à mão. Autoria = quem salvou a regra; execução = autoridade de
// sistema; responsável = o DO REGISTRO.
import type { SupabaseClient } from "@supabase/supabase-js";

import { addDaysIso } from "@/lib/date/days";
import { todayBrasiliaIso } from "@/lib/date/today";
import { emitWebhookEvent } from "@/lib/webhooks/emit";
import {
  enqueueTaskMirrorMany,
  loadMirrorOwners,
  mirrorTaskAfterWrite,
} from "@/lib/sync/bitrix/task-mirror";

import type {
  PlannedSeriesRevoke,
  PlannedSeriesTask,
  SeriesOccurrenceFact,
} from "./evaluate";

export interface SeriesBatch {
  series: PlannedSeriesTask[];
  orgId: string | null;
  /** Autoria no histórico: quem salvou a regra. */
  createdBy: string | null;
}

export interface SeriesOutcome {
  okIds: string[];
  /** Ocorrências que a trava do banco já tinha — nem sucesso, nem falha. */
  skipped: number;
  createdByRule: Map<string, number>;
  failed: { recordId: string; message: string }[];
}

/**
 * O vencimento já entrou na janela de antecedência do espelho?
 *
 * Puro e compartilhado com o varredor do tick — duas contas de "faltam N dias"
 * em lugares diferentes é como uma tarefa acabaria espelhada duas vezes, ou
 * nenhuma. Vencido conta como dentro da janela: se está atrasado, o CRM
 * precisa saber ainda mais.
 */
export function mirrorDueNow(
  dueDate: string | null,
  leadDays: number,
  todayIso: string
): boolean {
  if (!dueDate) return true;
  const lead = Math.max(0, Math.floor(leadDays));
  return dueDate.slice(0, 10) <= addDaysIso(todayIso.slice(0, 10), lead);
}

/** Violação do índice único parcial (23505) = a ocorrência já existe. */
function isDuplicate(err: { code?: string; message?: string } | null): boolean {
  if (!err) return false;
  return (
    err.code === "23505" || /duplicate key|already exists/i.test(err.message ?? "")
  );
}

export async function executeAutomationSeries(
  db: SupabaseClient,
  batch: SeriesBatch
): Promise<SeriesOutcome> {
  const okIds: string[] = [];
  const createdByRule = new Map<string, number>();
  const failed: SeriesOutcome["failed"] = [];
  let skipped = 0;
  if (batch.series.length === 0) {
    return { okIds, skipped, createdByRule, failed };
  }
  const todayIso = todayBrasiliaIso();

  for (const plan of batch.series) {
    const row: Record<string, unknown> = {
      title: plan.title,
      description: plan.description,
      record_id: plan.recordId,
      due_date: plan.dueDate,
      responsible_id: plan.responsibleId,
      created_by: batch.createdBy,
      automation_rule_id: plan.ruleId,
      series_key: plan.seriesKey,
      series_occurrence: plan.occurrence,
    };
    if (batch.orgId) row.organization_id = batch.orgId;

    const { data, error } = await db
      .from("tasks")
      .insert(row)
      .select("id")
      .single();

    if (error) {
      // A corrida entre o tick e o "Executar agora" bate aqui. É o resultado
      // desejado — poluir o last_error com "duplicate key" esconderia os erros
      // de verdade (precedente literal do create_task na 0129).
      if (isDuplicate(error)) {
        skipped += 1;
        continue;
      }
      failed.push({ recordId: plan.recordId, message: error.message });
      continue;
    }

    okIds.push(plan.recordId);
    createdByRule.set(plan.ruleId, (createdByRule.get(plan.ruleId) ?? 0) + 1);

    const taskId = (data?.id as string | undefined) ?? null;
    if (taskId) {
      await emitWebhookEvent(
        "task.created",
        { taskId, recordId: plan.recordId, seriesKey: plan.seriesKey },
        batch.orgId
      );
      // v1.3: o espelho só quando o vencimento entra na janela de
      // antecedência. A ocorrência de daqui a dois meses existe AQUI desde já
      // (é o que o vendedor precisa ver e remarcar), mas mandá-la agora para o
      // CRM encheria a timeline do negócio de tarefa futura. Quem cria as
      // que amadurecem depois é `enqueueDueTaskMirrors`, no tick.
      // Aqui o `db` JÁ é service role (o tick não tem sessão), então serve
      // para os dois papéis.
      if (mirrorDueNow(plan.dueDate, plan.mirrorLeadDays, todayIso)) {
        await mirrorTaskAfterWrite(db, db, {
          taskId,
          recordId: plan.recordId,
          orgId: batch.orgId,
          op: "create",
          ruleChoice: plan.mirrorBitrix,
          createdBy: batch.createdBy,
        });
      }
    }

    // O atributo entra JUNTO com a primeira tarefa — é o que faz a linha da
    // tabela virar clicável e a Tree existir. Ensure-if-absent: conceder de
    // novo nunca reativa um atributo que alguém pausou de propósito.
    if (plan.grantAttribute && batch.orgId) {
      await db.from("record_attributes").upsert(
        {
          organization_id: batch.orgId,
          record_id: plan.recordId,
          attribute_key: plan.grantAttribute,
          granted_by_rule_id: plan.ruleId,
          created_by: batch.createdBy,
        },
        { onConflict: "record_id,attribute_key", ignoreDuplicates: true }
      );
    }
  }

  return { okIds, skipped, createdByRule, failed };
}

/**
 * Devolve as ocorrências ABERTAS de séries cujo registro saiu do recorte.
 *
 * v1.3 (10/09/2026). Só as não concluídas: o que o vendedor fez é histórico e
 * fica, inclusive na Tree. O atributo do registro também fica — pausar ≠
 * excluir (0131), e a árvore de acompanhamento continua legível depois de o
 * deal mudar de etapa.
 *
 * A ordem do espelho vai DEPOIS do delete, como nas ações em massa: enfileirar
 * antes apagaria no portal a atividade de uma tarefa que continuou existindo
 * aqui, se a exclusão falhasse. A ordem sobrevive à linha porque a FK da fila é
 * `on delete set null` (0137) e ela carrega o `activity_id`.
 */
export async function executeSeriesRevocations(
  db: SupabaseClient,
  batch: {
    revoked: PlannedSeriesRevoke[];
    orgId: string | null;
    createdBy: string | null;
  }
): Promise<{ deleted: number; failed: SeriesOutcome["failed"] }> {
  const failed: SeriesOutcome["failed"] = [];
  let deleted = 0;
  if (batch.revoked.length === 0) return { deleted, failed };

  for (const item of batch.revoked) {
    // Uma consulta por par (regra, registro): a lista de revogação é curta por
    // natureza — são os registros que MUDARAM de recorte nesta rodada.
    let q = db
      .from("tasks")
      .select("id, title, record_id, bitrix_activity_id")
      .eq("automation_rule_id", item.ruleId)
      .eq("record_id", item.recordId)
      .is("completed_at", null)
      .not("series_occurrence", "is", null);
    if (batch.orgId) q = q.eq("organization_id", batch.orgId);
    const { data: doomed, error: readError } = await q;
    if (readError) {
      failed.push({ recordId: item.recordId, message: readError.message });
      continue;
    }
    if (!doomed || doomed.length === 0) continue;

    const ids = doomed.map((t) => t.id as string);
    const { error } = await db.from("tasks").delete().in("id", ids);
    if (error) {
      failed.push({ recordId: item.recordId, message: error.message });
      continue;
    }
    deleted += ids.length;

    for (const t of doomed) {
      await emitWebhookEvent(
        "task.deleted",
        {
          taskId: t.id as string,
          title: (t.title as string) ?? null,
          recordId: (t.record_id as string | null) ?? null,
          origin: "automation",
        },
        batch.orgId
      );
    }
    await mirrorRevoked(db, doomed, batch.orgId, batch.createdBy);
  }

  return { deleted, failed };
}

/** Enfileira o `delete` no CRM das revogadas que tinham atividade lá. */
async function mirrorRevoked(
  db: SupabaseClient,
  doomed: Record<string, unknown>[],
  orgId: string | null,
  createdBy: string | null
): Promise<void> {
  try {
    if (!orgId) return;
    const mirrored = doomed.filter((t) => t.bitrix_activity_id);
    if (mirrored.length === 0) return;
    const owners = await loadMirrorOwners(
      db,
      mirrored.map((t) => t.record_id as string)
    );
    await enqueueTaskMirrorMany(
      db,
      mirrored.flatMap((t) => {
        const owner = owners.get(t.record_id as string);
        if (!owner) return [];
        return [
          {
            orgId,
            op: "delete" as const,
            ownerEntity: owner.entity,
            ownerSourceId: owner.sourceId,
            activityId: String(t.bitrix_activity_id),
            createdBy,
          },
        ];
      })
    );
  } catch (e) {
    console.error("[series] espelho da revogação falhou:", (e as Error).message);
  }
}

/**
 * Ocorrências de série JÁ criadas para estes registros, com o estado de cada
 * uma. A trava de verdade continua sendo o índice único da 0132; este fato é o
 * que permite decidir a janela SEM ir ao banco por ocorrência.
 *
 * v1.2 (10/09/2026): traz `completed_at`. A janela deixou de ser "as N
 * seguintes do calendário" e virou "manter N futuras ABERTAS" — sem o estado,
 * não há como saber quantas repor.
 */
export async function loadSeriesOccurrences(
  db: SupabaseClient,
  orgId: string | null,
  ruleIds: string[],
  recordIds: string[]
): Promise<Map<string, SeriesOccurrenceFact[]>> {
  const out = new Map<string, SeriesOccurrenceFact[]>();
  if (ruleIds.length === 0 || recordIds.length === 0) return out;

  const CHUNK = 200;
  for (let i = 0; i < recordIds.length; i += CHUNK) {
    let q = db
      .from("tasks")
      .select("record_id, automation_rule_id, series_occurrence, completed_at")
      .in("automation_rule_id", ruleIds)
      .in("record_id", recordIds.slice(i, i + CHUNK))
      .not("series_occurrence", "is", null);
    if (orgId) q = q.eq("organization_id", orgId);
    const { data } = await q;
    for (const t of data ?? []) {
      const recordId = t.record_id as string;
      const fact: SeriesOccurrenceFact = {
        ruleId: t.automation_rule_id as string,
        occurrence: t.series_occurrence as number,
        open: !t.completed_at,
      };
      const list = out.get(recordId);
      if (list) list.push(fact);
      else out.set(recordId, [fact]);
    }
  }
  return out;
}
