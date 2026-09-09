// Versão: 1.1 | Data: 09/09/2026
// v1.1 (09/09/2026): o passo passa a ALTERAR também (`bitrix.entity.update`) e
//   a saber ensaiar (`dryRun`). Um executor só para os dois: muda o método
//   (`crm.<entity>.update`) e o `id` do alvo — o resto (schema vivo dos campos,
//   toBitrixValue, campo que não converte é pulado e reportado) é idêntico, e é
//   a mesma chamada que o `drainWritebackQueue` já faz. No `dryRun` a LEITURA do
//   schema continua (é read-only e é ela que torna a prévia fiel ao que seria
//   enviado); o que não acontece é a escrita.
// Passo `bitrix.entity.add`/`bitrix.entity.update` do Workflow (0125): cria ou
// altera uma entidade no CRM
// (crm.company.add / crm.contact.add / crm.lead.add / crm.deal.add) com o
// payload montado a partir do formulário.
//
// Generaliza o que lib/sync/bitrix/create.ts faz para o checkbox "Criar também
// no Bitrix" de /registros: lá a entidade e o conjunto de campos são fixos no
// código (DEAL_CORE/LEAD_CORE); aqui vêm do ESQUEMA. A mecânica é a mesma e
// reusa as mesmas peças — BitrixClient para falar, `crm.<entity>.fields` para
// o schema vivo e `toBitrixValue` para converter cada valor. Campo que não
// converte (somente-leitura, opção inexistente) é PULADO e reportado, nunca
// derruba o passo: o lead ir para o CRM sem um campo é melhor que não ir.
import { BitrixClient } from "@/lib/sync/bitrix/client";
import type { BitrixFieldMeta } from "@/lib/sync/bitrix/lookups";
import {
  toBitrixValue,
  WriteBackFatal,
  type BitrixStatusCodes,
} from "@/lib/sync/bitrix/writeback";

import { resolveTemplate, resolvesEmpty, type WorkflowRefContext } from "../refs";
import type {
  WorkflowBitrixAddStep,
  WorkflowBitrixUpdateStep,
} from "../types";

interface RawFieldDef {
  type: string;
  title?: string;
  listLabel?: string;
  formLabel?: string;
  isMultiple?: boolean;
  isReadOnly?: boolean;
  items?: { ID: string; VALUE: string }[];
}

/**
 * Cliente mínimo que o passo precisa — a interface existe para o teste injetar
 * um duplo sem rede, e é satisfeita pelo BitrixClient real.
 */
export interface BitrixCallable {
  call<T>(method: string, params?: Record<string, unknown>): Promise<{
    result: T;
  }>;
}

export interface BitrixStepDeps {
  /** Fábrica do cliente a partir da credencial já resolvida. */
  makeClient?: (webhookUrl: string) => BitrixCallable;
  statusCodes?: BitrixStatusCodes;
}

export interface BitrixStepResult {
  id: string | null;
  skipped: boolean;
  skippedFields: string[];
  warnings: string[];
  /** Ensaio: o payload que TERIA sido enviado (undefined fora do dryRun). */
  payload?: Record<string, unknown>;
}

export type WorkflowBitrixStep = WorkflowBitrixAddStep | WorkflowBitrixUpdateStep;

/**
 * Separa "Maria Silva Souza" em { first: "Maria", last: "Silva Souza" }.
 * O Bitrix guarda NAME e LAST_NAME separados e o formulário pergunta um nome
 * só — perguntar dois campos para um dado que as pessoas escrevem junto seria
 * pior. Nome de uma palavra fica sem sobrenome (não inventa).
 */
export function splitPersonName(full: string): { first: string; last: string } {
  const parts = full.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { first: "", last: "" };
  if (parts.length === 1) return { first: parts[0], last: "" };
  return { first: parts[0], last: parts.slice(1).join(" ") };
}

/** Formato de comunicação multi-valor do Bitrix (EMAIL/PHONE). */
function commValue(value: string): { VALUE: string; VALUE_TYPE: string }[] {
  return [{ VALUE: value, VALUE_TYPE: "WORK" }];
}

function toMetaMap(raw: Record<string, RawFieldDef>): Map<string, BitrixFieldMeta> {
  const metas = new Map<string, BitrixFieldMeta>();
  for (const [fieldId, def] of Object.entries(raw ?? {})) {
    if (!def || typeof def !== "object") continue;
    metas.set(fieldId, {
      fieldId,
      title: def.title || def.listLabel || def.formLabel || fieldId,
      type: def.type,
      isMultiple: Boolean(def.isMultiple),
      isReadOnly: Boolean(def.isReadOnly),
      items: def.items,
    });
  }
  return metas;
}

export async function runBitrixEntityStep(
  step: WorkflowBitrixStep,
  context: WorkflowRefContext,
  webhookUrl: string,
  deps: BitrixStepDeps = {},
  opts: { dryRun?: boolean } = {}
): Promise<BitrixStepResult> {
  const warnings: string[] = [];
  const isUpdate = step.type === "bitrix.entity.update";

  // Passo condicional: sem o insumo, PULA sem erro. É como o esquema diz "não
  // crie a empresa quando o formulário não trouxe o nome dela" — e a ref para
  // a saída deste passo resolve vazia nos seguintes.
  if (step.params.skipIfEmpty && resolvesEmpty(step.params.skipIfEmpty, context)) {
    return { id: null, skipped: true, skippedFields: [], warnings };
  }

  const client = deps.makeClient
    ? deps.makeClient(webhookUrl)
    : (new BitrixClient(webhookUrl) as BitrixCallable);

  // Só o schema de campos (mais barato que o preload completo dos lookups, que
  // também puxaria status/categorias) — mesma escolha de create.ts.
  const raw = (
    await client.call<Record<string, RawFieldDef>>(
      `crm.${step.params.entity}.fields`
    )
  ).result;
  const metas = toMetaMap(raw ?? {});

  const fields: Record<string, unknown> = {};
  const skippedFields: string[] = [];

  for (const [fieldId, spec] of Object.entries(step.params.fields)) {
    const resolved = resolveTemplate(spec.value, context);
    warnings.push(...resolved.warnings);
    const value = resolved.value.trim();
    // Vazio não vai: mandar "" limparia um campo com default do pipeline.
    if (value === "") continue;

    const meta = metas.get(fieldId);
    if (!meta) {
      // Campo que não existe no portal deste cliente. O esquema pode ter vindo
      // de outro portal — reporta e segue.
      skippedFields.push(fieldId);
      continue;
    }
    try {
      const converted = toBitrixValue(meta, value, deps.statusCodes);
      fields[fieldId] =
        spec.shape === "comm" ? commValue(String(converted)) : converted;
    } catch (e) {
      if (e instanceof WriteBackFatal) {
        skippedFields.push(meta.title || fieldId);
        continue;
      }
      throw e;
    }
  }

  // Alvo do update, resolvido DEPOIS dos campos (as refs são as mesmas).
  let entityId = "";
  if (step.type === "bitrix.entity.update") {
    const resolvedId = resolveTemplate(step.params.entityId.value, context);
    warnings.push(...resolvedId.warnings);
    entityId = resolvedId.value.trim();
    if (entityId === "") {
      // Sem `skipIfEmpty` o esquema afirmou que o alvo SEMPRE existe. Falhar
      // alto é melhor que um update silencioso em entidade nenhuma.
      throw new Error(
        `O passo "${step.label}" não resolveu o id da entidade a atualizar.`
      );
    }
  }

  if (opts.dryRun) {
    // Ensaio: nada sai daqui. O id de um passo anterior ainda não existe, então
    // o sentinela do executor já está dentro de `fields` — nunca um id
    // inventado que alguém possa confundir com real.
    return {
      id: null,
      skipped: false,
      skippedFields,
      warnings,
      payload: isUpdate ? { id: entityId, fields } : { fields },
    };
  }

  if (step.type === "bitrix.entity.update") {
    await client.call(`crm.${step.params.entity}.update`, {
      id: entityId,
      fields,
    });
    // Update devolve boolean; o id útil para os passos seguintes é o do ALVO.
    return { id: entityId, skipped: false, skippedFields, warnings };
  }

  const res = await client.call<number | string>(
    `crm.${step.params.entity}.add`,
    { fields }
  );
  if (res.result == null || res.result === "") {
    throw new Error(`crm.${step.params.entity}.add não retornou um ID.`);
  }
  return {
    id: String(res.result),
    skipped: false,
    skippedFields,
    warnings,
  };
}

/** Nome anterior do executor (só `add`) — mantido para não quebrar chamador. */
export const runBitrixAddStep = runBitrixEntityStep;

/**
 * URL amigável da entidade no portal, derivada da base do webhook
 * (https://portal.bitrix24.com.br/rest/89/token/ → https://portal…/crm/lead/
 * details/<id>/). Só para EXIBIR o resultado — nunca vai para o banco.
 */
export function bitrixEntityUrl(
  webhookUrl: string,
  entity: string,
  id: string
): string {
  const m = webhookUrl.match(/^(https?:\/\/[^/]+)/);
  if (!m || !id) return "";
  return `${m[1]}/crm/${entity}/details/${id}/`;
}
