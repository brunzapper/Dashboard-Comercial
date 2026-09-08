// Versão: 1.0 | Data: 08/09/2026
// EXECUTOR de um esquema de Workflow (0125).
//
// Percorre os passos habilitados em ORDEM, resolvendo os templates contra
// { form, steps, ctx } e acumulando a saída de cada passo — é assim que o id
// da empresa chega ao contato e os dois chegam ao lead, sem que nenhum passo
// conheça os outros. Não há transação: cada `crm.*.add` é uma chamada isolada
// (o CRM não oferece nada melhor), e é justamente por isso que o resultado é
// POR PASSO e fica gravado em `workflow_runs`. Uma execução pode terminar
// 'partial' — empresa criada, lead falhou — e quem for consertar precisa saber
// o que já existe lá.
//
// O executor NÃO faz gate: quem chama (a server action) já resolveu sessão,
// área, permissão e responsável. Aqui só roda o que foi mandado rodar.
import type { SupabaseClient } from "@supabase/supabase-js";

import { resolveWorkflowConnection } from "./connections";
import type { WorkflowRefContext } from "./refs";
import {
  runBitrixAddStep,
  bitrixEntityUrl,
  type BitrixStepDeps,
} from "./steps/bitrix";
import {
  runRecordCreateStep,
  type RecordStepDeps,
  type RecordStepSource,
} from "./steps/record";
import type { WorkflowDefinition, WorkflowStep } from "./types";

export interface WorkflowStepOutcome {
  id: string;
  type: string;
  label: string;
  ok: boolean;
  /** Passo condicional que não tinha insumo (skipIfEmpty) ou estava desligado. */
  skipped: boolean;
  /** Id devolvido pelo destino (entidade do CRM), quando houver. */
  outputId: string | null;
  /** URL de exibição, quando o destino tem uma. */
  url?: string;
  /** Campos que o destino não aceitou — o resto foi enviado. */
  skippedFields: string[];
  error: string | null;
}

export interface WorkflowRunResult {
  status: "ok" | "partial" | "error";
  steps: WorkflowStepOutcome[];
  recordId: string | null;
  /** Primeiro erro fatal, se houve. */
  error: string | null;
  warnings: string[];
}

export interface WorkflowExecuteDeps {
  /** Client RLS do usuário — o passo de registro local escreve com ele. */
  db: SupabaseClient;
  /** Contexto montado pelo SERVIDOR (responsável do Bitrix, etc). */
  ctx: Record<string, string | null>;
  record: RecordStepDeps;
  /** Base de destino do passo `record.create`, já validada pelo chamador. */
  recordSource?: RecordStepSource;
  bitrix?: BitrixStepDeps;
  /** Injetável para teste; o padrão é o registry de conexões. */
  resolveConnection?: (key: string) => string;
}

function outcomeFor(step: WorkflowStep): WorkflowStepOutcome {
  return {
    id: step.id,
    type: step.type,
    label: step.label,
    ok: false,
    skipped: false,
    outputId: null,
    skippedFields: [],
    error: null,
  };
}

export async function executeWorkflow(
  def: WorkflowDefinition,
  form: Record<string, string>,
  deps: WorkflowExecuteDeps
): Promise<WorkflowRunResult> {
  const resolveConnection = deps.resolveConnection ?? resolveWorkflowConnection;
  const context: WorkflowRefContext = {
    form,
    steps: {},
    ctx: deps.ctx,
  };

  const steps: WorkflowStepOutcome[] = [];
  const warnings: string[] = [];
  let recordId: string | null = null;
  let fatal: string | null = null;

  for (const step of def.steps) {
    if (!step.enabled) {
      // Passo desligado nem entra no relatório: para quem executa, ele não
      // existe. A ref para a saída dele resolve vazia (o lead sai sem
      // COMPANY_ID), que é o efeito pretendido de desligá-lo.
      continue;
    }

    const outcome = outcomeFor(step);
    try {
      if (step.type === "bitrix.entity.add") {
        const webhookUrl = resolveConnection(step.connection);
        const res = await runBitrixAddStep(step, context, webhookUrl, deps.bitrix);
        warnings.push(...res.warnings);
        outcome.skipped = res.skipped;
        outcome.outputId = res.id;
        outcome.skippedFields = res.skippedFields;
        outcome.ok = true;
        if (res.id) {
          outcome.url = bitrixEntityUrl(webhookUrl, step.params.entity, res.id);
        }
        // Registra a saída MESMO quando pulado (id null): a diferença entre
        // "passo pulado" e "passo inexistente" importa em refs.ts — pulado
        // resolve vazio sem aviso, inexistente vira warning.
        context.steps[step.id] = { id: res.id };
      } else {
        if (!deps.recordSource) {
          throw new Error(
            `A base "${step.params.sourceKey}" do passo "${step.label}" não existe ou não aceita criação manual.`
          );
        }
        const res = await runRecordCreateStep(
          step,
          context,
          deps.db,
          deps.recordSource,
          deps.record
        );
        warnings.push(...res.warnings);
        outcome.outputId = res.recordId;
        outcome.skippedFields = res.skippedFields;
        outcome.ok = true;
        recordId = res.recordId;
        context.steps[step.id] = { id: res.recordId };
      }
    } catch (e) {
      outcome.error = (e as Error).message;
      steps.push(outcome);
      fatal = outcome.error;
      // Para no primeiro erro: os passos seguintes dependem deste (o lead
      // precisa do contato) e insistir só produziria entidades órfãs no CRM.
      break;
    }
    steps.push(outcome);
  }

  const anyDone = steps.some((s) => s.ok && !s.skipped);
  const status: WorkflowRunResult["status"] = fatal
    ? anyDone
      ? "partial"
      : "error"
    : "ok";

  return {
    status,
    steps,
    recordId,
    error: fatal,
    warnings: [...new Set(warnings)],
  };
}
