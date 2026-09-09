// Versão: 1.0 | Data: 09/09/2026
// NÚCLEO de execução de um esquema de Workflow — o que a server action fazia e
// o tick das automações precisa igual.
//
// Por que existe: `runWorkflow` (a action) montava o contexto, resolvia a base
// de destino, chamava o executor, gravava em `workflow_runs`, recalculava os
// campos e emitia o webhook. A ação `run_schema` das automações precisa das
// MESMAS sete linhas com outra identidade (sistema, não sessão) e outro client
// (service role, não RLS do usuário). Copiar isso seria a régua paralela que a
// invariante 25 proíbe — então o miolo mora aqui e a action virou wrapper, no
// precedente literal de runAiEditTurnCore/generateDashboardCore.
//
// O núcleo NÃO faz gate: sessão, área, permissão e responsável são do chamador.
// O que ele é dono é do CONTRATO da execução — o `ctx`, o histórico e, quando a
// execução vem de uma regra, a TRAVA.
import { createHash } from "crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

import { recalcFormulaFieldsForRecords } from "@/lib/records/recalc";
import { BITRIX_STATUS_CODES_KEY } from "@/lib/sync/bitrix/catalog";
import type { BitrixStatusCodes } from "@/lib/sync/bitrix/writeback";
import { emitWebhookEvent } from "@/lib/webhooks/emit";

import { executeWorkflow, type WorkflowRunResult } from "./execute";
import { schemaIsIrreversible } from "./registry";
import type { WorkflowSchemaRow } from "./schemas";
import { splitPersonName } from "./steps/bitrix";
import type { RecordStepSource, RecordUpdateStepDeps } from "./steps/record";
import type { WorkflowDefinition } from "./types";

/**
 * Campo do formulário de onde sai o nome da pessoa que os passos separam em
 * NAME/LAST_NAME (refs {{ctx.contatoPrimeiroNome}}/{{ctx.contatoSobrenome}}).
 * Convenção do esquema, não hardcode do fluxo: um esquema sem esse campo
 * simplesmente deixa as duas refs vazias.
 */
export const PERSON_NAME_FIELD = "contato_nome";

/**
 * Mapa rótulo→código das famílias de crm_status, gravado a cada sync do
 * catálogo. É ele que faz o passo mandar "UC_EN7PZM" onde o formulário mostrou
 * "CEO-Led Outbound". Ausente (sync ainda não rodou desde a atualização)
 * degrada para o comportamento anterior — manda o rótulo — em vez de recusar.
 */
export async function loadStatusCodes(
  service: SupabaseClient,
  orgId: string | null
): Promise<BitrixStatusCodes> {
  let q = service
    .from("sync_config")
    .select("value")
    .eq("key", BITRIX_STATUS_CODES_KEY);
  if (orgId) q = q.eq("organization_id", orgId);
  const { data } = await q.maybeSingle();
  const v = data?.value;
  if (!v || typeof v !== "object" || Array.isArray(v)) return {};
  return v as BitrixStatusCodes;
}

/** Quem executa, do ponto de vista dos passos. */
export interface WorkflowActor {
  /** Autor no histórico. Numa execução de sistema é quem salvou a regra. */
  userId: string | null;
  /** Papéis para o gating de `editable_by_roles` (como em createRecord). */
  roles: string[];
  responsibleId: string | null;
  /** Operação principal do responsável (o registro local nasce com ela). */
  operationId?: string | null;
  bitrixUserId: string | null;
  email?: string | null;
}

export interface WorkflowRunCoreInput {
  /** Quem ESCREVE: client RLS do usuário (formulário) ou service (tick). */
  db: SupabaseClient;
  orgId: string;
  schema: WorkflowSchemaRow;
  def: WorkflowDefinition;
  form: Record<string, string>;
  actor: WorkflowActor;
  recordSource?: RecordStepSource;
  recordUpdate?: RecordUpdateStepDeps;
  statusCodes?: BitrixStatusCodes;
  /** Ensaio: resolve tudo, grava o que FARIA e não escreve em lugar nenhum. */
  dryRun?: boolean;
  /** Execução disparada por uma regra — liga a TRAVA. */
  trigger?: { recordId: string; ruleId: string };
}

export interface WorkflowRunCoreResult extends WorkflowRunResult {
  runId: string | null;
  /**
   * A trava já estava tomada: este registro já foi executado por esta regra
   * (ou, em esquema repetível, com este mesmo payload). NADA rodou — é o
   * resultado desejado, não uma falha.
   */
  duplicate: boolean;
}

/**
 * Contexto do SERVIDOR: o que o formulário não pergunta mas os passos usam.
 * Único, para os dois chamadores — um esquema não pode se comportar diferente
 * conforme quem o disparou.
 */
export function buildWorkflowCtx(
  form: Record<string, string>,
  actor: WorkflowActor,
  trigger?: { recordId: string }
): Record<string, string | null> {
  const person = splitPersonName(form[PERSON_NAME_FIELD] ?? "");
  return {
    responsibleBitrixId: actor.bitrixUserId,
    contatoPrimeiroNome: person.first,
    contatoSobrenome: person.last,
    usuarioEmail: actor.email ?? "",
    // Só existe quando quem disparou foi uma regra — é o alvo natural de um
    // passo `record.update`.
    triggerRecordId: trigger?.recordId ?? null,
  };
}

/**
 * Chave de comparação de um esquema REPETÍVEL: o payload de cada passo é função
 * pura de (definição do esquema, respostas, contexto), então hashear a ENTRADA
 * responde "o que eu mandaria mudou?" sem precisar montar o payload antes de
 * decidir se vai mandar. `updatedAt` entra porque editar o esquema muda o que
 * seria enviado com as mesmas respostas.
 *
 * Esquema IRREVERSÍVEL devolve '' — todas as execuções colapsam numa linha só e
 * o registro é consumido uma vez, para sempre.
 */
export function runPayloadHash(
  schema: WorkflowSchemaRow,
  def: WorkflowDefinition,
  form: Record<string, string>,
  ctx: Record<string, string | null>
): string {
  if (schemaIsIrreversible(def)) return "";
  const stable = JSON.stringify([
    schema.key,
    schema.updatedAt ?? "",
    Object.entries(form).sort(([a], [b]) => a.localeCompare(b)),
    Object.entries(ctx).sort(([a], [b]) => a.localeCompare(b)),
  ]);
  return createHash("sha256").update(stable).digest("hex").slice(0, 32);
}

/** Violação do índice único parcial (23505) = a trava já estava tomada. */
function isDuplicate(err: { code?: string; message?: string } | null): boolean {
  if (!err) return false;
  return err.code === "23505" || /duplicate key|already exists/i.test(err.message ?? "");
}

const EMPTY: WorkflowRunResult = {
  status: "error",
  steps: [],
  recordId: null,
  error: null,
  warnings: [],
};

export async function runWorkflowCore(
  input: WorkflowRunCoreInput
): Promise<WorkflowRunCoreResult> {
  const { db, orgId, schema, def, form, actor, trigger } = input;
  const ctx = buildWorkflowCtx(form, actor, trigger);
  const mode = input.dryRun ? "simulado" : "real";

  // 1) REIVINDICA antes de executar (só quando veio de uma regra). A linha
  // nasce 'iniciado': se o processo morrer no meio, ela SEGURA a trava — não se
  // sabe o que chegou ao destino, e repetir às cegas é o que a trava impede.
  let runId: string | null = null;
  if (trigger) {
    const { data, error } = await db
      .from("workflow_runs")
      .insert({
        organization_id: orgId,
        schema_id: schema.id,
        schema_key: schema.key,
        status: "iniciado",
        input: form,
        steps: [],
        created_by: actor.userId,
        trigger_record_id: trigger.recordId,
        automation_rule_id: trigger.ruleId,
        mode,
        payload_hash: runPayloadHash(schema, def, form, ctx),
      })
      .select("id")
      .single();
    if (error) {
      if (isDuplicate(error)) {
        return { ...EMPTY, status: "ok", runId: null, duplicate: true };
      }
      throw new Error(error.message);
    }
    runId = (data?.id as string | undefined) ?? null;
  }

  const result = await executeWorkflow(def, form, {
    db,
    ctx,
    record: {
      userId: actor.userId ?? "",
      responsibleId: actor.responsibleId,
      operationId: actor.operationId ?? null,
      roles: actor.roles,
      orgId,
    },
    recordSource: input.recordSource,
    recordUpdate: input.recordUpdate,
    bitrix: { statusCodes: input.statusCodes ?? {} },
    dryRun: input.dryRun,
  });

  // 2) Histórico: SEMPRE, inclusive no erro — é o que diz o que sobrou no
  // sistema externo quando a execução morre no meio.
  const row = {
    status: result.status,
    steps: result.steps,
    error: result.error,
    record_id: result.recordId,
  };
  if (runId) {
    await db.from("workflow_runs").update(row).eq("id", runId);
  } else {
    const { data } = await db
      .from("workflow_runs")
      .insert({
        organization_id: orgId,
        schema_id: schema.id,
        schema_key: schema.key,
        input: form,
        created_by: actor.userId,
        mode,
        ...row,
      })
      .select("id")
      .maybeSingle();
    runId = (data?.id as string | undefined) ?? null;
  }

  // 3) Efeitos do registro criado — pelo choke point único de recálculo (mesmo
  // caminho do auto-match pós-sync e da inserção por IA).
  if (result.recordId && !input.dryRun) {
    try {
      await recalcFormulaFieldsForRecords([result.recordId]);
    } catch {
      /* best-effort: o recalc geral cobre depois. */
    }
    await emitWebhookEvent(
      "record.created",
      { recordId: result.recordId, source: input.recordSource?.key ?? null },
      orgId
    );
  }

  return { ...result, runId, duplicate: false };
}
