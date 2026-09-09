// Versão: 1.0 | Data: 09/09/2026
// Executor da ação `run_schema`: roda os passos de um ESQUEMA do Workflow para
// cada registro que a regra selecionou.
//
// É a única ação de automação cujo efeito sai do sistema sem ninguém olhando, e
// o tick roda a cada minuto. O que a protege NÃO está aqui: está no índice único
// parcial da 0130, reivindicado por `runWorkflowCore` ANTES de executar. Este
// módulo é a casca de I/O — resolve identidade, base de destino e catálogo,
// chama o núcleo (o MESMO que a tela do formulário usa) e conta o resultado.
//
// Duas escolhas deliberadas:
//  - execução SEQUENCIAL. As outras ações vão em paralelo limitado porque
//    escrevem no banco; esta fala com um sistema de terceiros, e cinco
//    chamadas em fila são mais fáceis de explicar do que cinco simultâneas.
//  - `duplicate` (a trava já estava tomada) NÃO é falha nem sucesso: é o
//    resultado desejado. Poluir o `last_error` com "já executado" esconderia os
//    erros de verdade — mesma decisão do 23505 em task.ts.
import type { SupabaseClient } from "@supabase/supabase-js";

import type { loadSources } from "@/lib/config/sources";
import type { FieldDefinition, RecordRow } from "@/lib/records/types";
import { loadStatusCodes, runWorkflowCore } from "@/lib/workflow/run";
import type { WorkflowSchemaRow } from "@/lib/workflow/schemas";

import type { PlannedSchemaRun } from "./evaluate";

/**
 * Teto PRÓPRIO, muito abaixo do MAX_ACTIONS_PER_RUN (200) das ações internas:
 * efeito fora do sistema merece um limite que caiba num engano. O que sobrar
 * fica para o próximo tick — a trava garante que ninguém executa duas vezes.
 */
export const MAX_SCHEMA_RUNS_PER_RUN = 5;

export interface SchemaRunBatch {
  runs: PlannedSchemaRun[];
  /** Esquemas elegíveis da rodada (definição já validada pelo engine). */
  schemas: Map<string, WorkflowSchemaRow>;
  recordById: Map<string, RecordRow>;
  orgId: string;
  /** Autoria no histórico: quem salvou a regra. A execução é de sistema. */
  createdBy: string | null;
  defs: FieldDefinition[];
  catalog: Awaited<ReturnType<typeof loadSources>>;
}

export interface SchemaRunOutcome {
  /** Registros cujo esquema rodou (ou foi simulado) com sucesso. */
  okIds: string[];
  /** Execuções que a trava já tinha consumido — nada rodou, e está certo. */
  skipped: number;
  runsByRule: Map<string, number>;
  failed: { recordId: string; message: string }[];
}

/** bitrix_user_id dos responsáveis dos registros em jogo, numa consulta só. */
async function loadBitrixUserIds(
  db: SupabaseClient,
  orgId: string,
  ids: string[]
): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>();
  if (ids.length === 0) return out;
  let q = db
    .from("responsibles")
    .select("id, bitrix_user_id")
    .in("id", ids);
  if (orgId) q = q.eq("organization_id", orgId);
  const { data } = await q;
  for (const r of data ?? []) {
    out.set(r.id as string, (r.bitrix_user_id as string | null) ?? null);
  }
  return out;
}

export async function executeAutomationSchemaRuns(
  db: SupabaseClient,
  batch: SchemaRunBatch
): Promise<SchemaRunOutcome> {
  const okIds: string[] = [];
  const runsByRule = new Map<string, number>();
  const failed: SchemaRunOutcome["failed"] = [];
  let skipped = 0;
  if (batch.runs.length === 0) {
    return { okIds, skipped, runsByRule, failed };
  }

  const responsibleIds = [
    ...new Set(
      batch.runs
        .map((r) => batch.recordById.get(r.recordId)?.responsible_id)
        .filter((v): v is string => typeof v === "string" && v !== "")
    ),
  ];
  const [bitrixByResponsible, statusCodes] = await Promise.all([
    loadBitrixUserIds(db, batch.orgId, responsibleIds),
    loadStatusCodes(db, batch.orgId),
  ]);

  for (const run of batch.runs) {
    const schema = batch.schemas.get(run.schemaKey);
    const def = schema?.definition;
    // O engine já filtrou; se sumiu daqui é bug de montagem, não silêncio.
    if (!schema || !def) {
      failed.push({
        recordId: run.recordId,
        message: `Esquema "${run.schemaKey}" indisponível.`,
      });
      continue;
    }
    const record = batch.recordById.get(run.recordId);
    const responsibleId = (record?.responsible_id as string | null) ?? null;

    // Base de destino do passo de registro local, resolvida AQUI (o núcleo não
    // consulta catálogo) — mesma régua da action do formulário.
    const createStep = def.steps.find(
      (s) => s.type === "record.create" && s.enabled
    );
    let recordSource;
    if (createStep && createStep.type === "record.create") {
      const found = batch.catalog.find(
        (s) => s.key === createStep.params.sourceKey
      );
      if (found?.manualEntry) {
        recordSource = {
          key: found.key,
          recordType: found.recordType,
          manualEntry: true,
        };
      }
    }

    try {
      const result = await runWorkflowCore({
        db,
        orgId: batch.orgId,
        schema,
        def,
        form: run.form,
        actor: {
          userId: batch.createdBy,
          // Autoridade de SISTEMA (mesma escolha do loadKanbanServiceContext):
          // o gating por papel existe para a tela de quem digita, e aqui não há
          // ninguém digitando. A muralha é a regra ter sido salva por um editor.
          roles: ["admin"],
          responsibleId,
          bitrixUserId: responsibleId
            ? (bitrixByResponsible.get(responsibleId) ?? null)
            : null,
          email: null,
        },
        recordSource,
        recordUpdate: { defs: batch.defs, orgId: batch.orgId },
        statusCodes,
        dryRun: run.simulate,
        trigger: { recordId: run.recordId, ruleId: run.ruleId },
      });

      if (result.duplicate) {
        skipped += 1;
        continue;
      }
      if (result.status === "error") {
        failed.push({
          recordId: run.recordId,
          message: result.error ?? "Falha ao executar o esquema.",
        });
        continue;
      }
      if (result.status === "partial") {
        // Parcial precisa ser DITO: parte já foi para o destino e a trava
        // segura o registro de propósito — reenviar às cegas duplicaria.
        failed.push({
          recordId: run.recordId,
          message: `Execução incompleta — parte já foi para o destino. ${result.error ?? ""}`.trim(),
        });
        continue;
      }
      okIds.push(run.recordId);
      runsByRule.set(run.ruleId, (runsByRule.get(run.ruleId) ?? 0) + 1);
    } catch (e) {
      failed.push({
        recordId: run.recordId,
        message: e instanceof Error ? e.message : String(e),
      });
    }
  }

  return { okIds, skipped, runsByRule, failed };
}
