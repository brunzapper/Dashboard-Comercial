// Versão: 1.3 | Data: 09/09/2026
// v1.3 (09/09/2026): criar, duplicar e excluir esquema. Até aqui só existia
//   `saveWorkflowSchema` (editar o que já estava lá) — a fábrica não fabricava.
//   A `key` é DERIVADA do rótulo (o usuário nomeia o fluxo, não a identidade) e
//   segue imutável depois. Entra também `loadBitrixEntityFields`, que dá ao
//   construtor a lista de campos do portal em vez de pedir que alguém adivinhe
//   um `UF_CRM_1729887583805`.
// Versão: 1.2 | Data: 09/09/2026
// v1.2 (09/09/2026): o miolo da execução saiu para `runWorkflowCore`
//   (lib/workflow/run.ts) e esta action virou wrapper — a ação `run_schema` das
//   automações precisa das mesmas linhas com outra identidade, e duas cópias
//   seriam a régua paralela da invariante 25. Aqui ficam sessão, área,
//   permissão, responsável e base de destino; o contrato da execução (contexto,
//   histórico, recálculo, webhook) é do núcleo.
// Versão: 1.1 | Data: 08/09/2026
// v1.1 (08/09/2026): `showCard` entra no patch salvável (0126) — separa "o
//   formulário tem página" de "aparece no hub de todo mundo". `runWorkflow`
//   passa a exigir gatilho `form`: um esquema de automação não é executável
//   por envio de formulário, e aceitar o POST seria rodar um fluxo pela porta
//   errada.
// Server Actions de /operacao/workflow (esquemas de automação, 0125).
//
// Duas autoridades diferentes, de propósito:
//  - EXECUTAR um esquema (runWorkflow) é operação: qualquer usuário da área
//    com `edit_record_values`. Sem `view_all_records`, o registro nasce
//    atribuído ao responsável do PRÓPRIO usuário — a mesma correção silenciosa
//    que createRecord faz, espelhando a RLS records_insert.
//  - CONFIGURAR o esquema (saveWorkflowSchema) é administração: papel admin +
//    área não bloqueada, com a RLS de workflow_schemas como muralha.
//
// O executor não sabe de nada disso: aqui é onde sessão, área, permissão,
// responsável e base de destino são resolvidos, e só então o fluxo roda.
"use server";

import { revalidatePath } from "next/cache";

import { checkSettingsArea, isSettingsAreaDenied } from "@/lib/auth/access";
import { getActiveOrgId } from "@/lib/auth/org";
import { getSessionInfo } from "@/lib/auth/session";
import { loadSources } from "@/lib/config/sources";
import type { FieldDefinition } from "@/lib/records/types";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { primaryOperationId } from "@/lib/sync/shared";
import type { WorkflowStepOutcome } from "@/lib/workflow/execute";
import { loadStatusCodes, runWorkflowCore } from "@/lib/workflow/run";
import { BitrixClient } from "@/lib/sync/bitrix/client";
import { resolveWorkflowConnection } from "@/lib/workflow/connections";
import {
  loadWorkflowSchemaByKey,
  loadWorkflowSchemas,
  uniqueWorkflowKey,
  type WorkflowTriggerKind,
} from "@/lib/workflow/schemas";
import {
  parseWorkflowDefinition,
  type WorkflowDefinition,
} from "@/lib/workflow/types";

export interface WorkflowRunState {
  ok?: boolean;
  status?: "ok" | "partial" | "error";
  message?: string;
  steps?: WorkflowStepOutcome[];
  /** Link da entidade principal criada, para o usuário conferir no CRM. */
  url?: string;
  /** Só o admin vê a quebra por passo; o operador vê a confirmação única. */
  detailed?: boolean;
}

export interface WorkflowSchemaState {
  ok?: boolean;
  message?: string;
  /** Id do esquema criado — a UI abre o editor dele em seguida. */
  id?: string;
}

/** Lê e valida as respostas do formulário contra a definição. */
function readForm(
  def: WorkflowDefinition,
  formData: FormData
): { values: Record<string, string>; missing: string[] } {
  const values: Record<string, string> = {};
  const missing: string[] = [];
  for (const field of def.form.fields) {
    // Campo oculto não é perguntado — vale o default do esquema, e é assim que
    // um esquema fixa um valor sem poluir a tela de quem preenche.
    const raw = field.visible
      ? String(formData.get(`wf__${field.key}`) ?? "")
      : (field.defaultValue ?? "");
    const value = raw.trim();
    if (field.required && field.visible && value === "") {
      missing.push(field.label);
    }
    values[field.key] = value !== "" ? value : (field.defaultValue ?? "");
  }
  return { values, missing };
}

/** Responsável efetivo: o escolhido no form quando permitido; o próprio, senão. */
async function resolveResponsible(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  viewAll: boolean,
  chosenName: string
): Promise<{
  id: string | null;
  bitrixUserId: string | null;
  error: string | null;
}> {
  // Vínculo do próprio usuário — vale como default para todo mundo e como
  // ÚNICA opção para quem não tem view_all_records (espelha a RLS
  // records_insert, e corrige em silêncio se o form mandar outro valor).
  const { data: mineData } = await supabase
    .from("responsibles")
    .select("id, bitrix_user_id")
    .eq("user_id", userId)
    .eq("active", true);
  const mine = (mineData ?? [])[0] as
    | { id: string; bitrix_user_id: string | null }
    | undefined;

  if (!viewAll) {
    if (!mine) {
      return {
        id: null,
        bitrixUserId: null,
        error:
          "Seu usuário não está vinculado a um responsável — peça a um administrador (Configurações → Responsáveis).",
      };
    }
    return { id: mine.id, bitrixUserId: mine.bitrix_user_id, error: null };
  }

  // O formulário grava NOME (o dropdown sai de display_name — mesma convenção
  // dos filtros do construtor). Id de responsável nunca viaja pelo form.
  const chosen = chosenName.trim();
  if (chosen) {
    const { data } = await supabase
      .from("responsibles")
      .select("id, bitrix_user_id")
      .eq("display_name", chosen)
      .eq("active", true);
    const hit = (data ?? [])[0] as
      | { id: string; bitrix_user_id: string | null }
      | undefined;
    if (hit) {
      return { id: hit.id, bitrixUserId: hit.bitrix_user_id, error: null };
    }
  }

  // Sem escolha (ou nome desconhecido): o próprio vínculo; na falta dele, sem
  // responsável — o CRM aplica o dono padrão do funil.
  return {
    id: mine?.id ?? null,
    bitrixUserId: mine?.bitrix_user_id ?? null,
    error: null,
  };
}

export async function runWorkflow(
  _prev: WorkflowRunState,
  formData: FormData
): Promise<WorkflowRunState> {
  const session = await getSessionInfo();
  if (!session) return { ok: false, message: "Sessão expirada." };
  if (!(await checkSettingsArea("workflow"))) {
    return { ok: false, message: "Você não tem acesso a esta área." };
  }
  if (!session.permissions.includes("edit_record_values")) {
    return {
      ok: false,
      message: "Você não tem permissão para lançar registros.",
    };
  }
  const orgId = await getActiveOrgId();
  if (!orgId) {
    return { ok: false, message: "Organização ativa não identificada." };
  }

  const schemaKey = String(formData.get("schema_key") ?? "");
  const supabase = await createClient();
  const schema = await loadWorkflowSchemaByKey(supabase, orgId, schemaKey);
  if (!schema) return { ok: false, message: "Esquema não encontrado." };
  if (!schema.enabled) return { ok: false, message: "Este esquema está desligado." };
  if (schema.triggerKind !== "form") {
    // Esquema de automação não roda por envio de formulário — ele tem gatilho
    // próprio. Recusar aqui evita a porta dos fundos.
    return { ok: false, message: "Este esquema não é um formulário." };
  }
  if (!schema.definition) {
    return {
      ok: false,
      message:
        "A configuração deste esquema está inválida — um administrador precisa revisá-la em Esquemas.",
    };
  }
  const def = schema.definition;

  const { values, missing } = readForm(def, formData);
  if (missing.length > 0) {
    return { ok: false, message: `Preencha: ${missing.join(", ")}.` };
  }

  const isAdmin = session.roles.includes("admin");
  const viewAll = session.permissions.includes("view_all_records");
  const resp = await resolveResponsible(
    supabase,
    session.user.id,
    viewAll,
    values.responsavel ?? ""
  );
  if (resp.error) return { ok: false, message: resp.error };

  // Base de destino do passo de registro local, resolvida e validada AQUI (o
  // núcleo não consulta catálogo).
  const recordStep = def.steps.find(
    (s) => s.type === "record.create" && s.enabled
  );
  let recordSource;
  if (recordStep && recordStep.type === "record.create") {
    const sources = await loadSources(supabase, orgId);
    const found = sources.find((s) => s.key === recordStep.params.sourceKey);
    if (found?.manualEntry) {
      recordSource = {
        key: found.key,
        recordType: found.recordType,
        manualEntry: true,
      };
    }
  }

  // Catálogo de campos: só quando o esquema ALTERA registro (o passo precisa
  // dele para decidir alvo válido e coerção). Esquema que só cria não paga.
  const needsDefs = def.steps.some((s) => s.type === "record.update" && s.enabled);
  let defs: FieldDefinition[] = [];
  if (needsDefs) {
    const { data } = await supabase
      .from("field_definitions")
      .select("field_key, data_type, editable_by_roles, applies_to, source_system")
      .eq("organization_id", orgId);
    defs = (data ?? []) as unknown as FieldDefinition[];
  }

  const result = await runWorkflowCore({
    db: supabase,
    orgId,
    schema,
    def,
    form: values,
    actor: {
      userId: session.user.id,
      roles: session.roles,
      responsibleId: resp.id,
      operationId: resp.id ? await primaryOperationId(supabase, resp.id) : null,
      bitrixUserId: resp.bitrixUserId,
      email: session.user.email ?? "",
    },
    recordSource,
    recordUpdate: { defs, orgId },
    statusCodes: await loadStatusCodes(createServiceClient(), orgId),
  });

  if (result.recordId) revalidatePath("/registros");

  const created = result.steps.filter((s) => s.ok && !s.skipped && s.outputId);
  const main = created[created.length - 1];
  const skipped = [...new Set(result.steps.flatMap((s) => s.skippedFields))];
  const skippedNote =
    skipped.length > 0 ? ` Campos não enviados: ${skipped.join(", ")}.` : "";

  if (result.status === "error") {
    return {
      ok: false,
      status: "error",
      message: `Não consegui lançar: ${result.error}`,
      steps: isAdmin ? result.steps : undefined,
      detailed: isAdmin,
    };
  }
  if (result.status === "partial") {
    return {
      ok: false,
      status: "partial",
      // Parcial precisa ser dito a QUALQUER um: parte já foi para o sistema
      // externo e reenviar às cegas duplicaria.
      message: `Lançamento incompleto — parte já foi criada no destino. ${result.error}`,
      steps: result.steps,
      detailed: true,
    };
  }

  const leadStep = result.steps.find(
    (s) => s.type === "bitrix.entity.add" && s.outputId && s.url
  );
  return {
    ok: true,
    status: "ok",
    message: `Lançado com sucesso${main?.outputId ? ` — ID ${main.outputId}` : ""}.${skippedNote}`,
    url: leadStep?.url,
    steps: isAdmin ? result.steps : undefined,
    detailed: isAdmin,
  };
}

async function ensureCanConfigure(): Promise<string | null> {
  const session = await getSessionInfo();
  if (!session) return "Sessão expirada.";
  if (!session.roles.includes("admin")) {
    return "Apenas administradores podem configurar esquemas.";
  }
  if (await isSettingsAreaDenied("workflow")) {
    return "Acesso a esta área foi bloqueado.";
  }
  return null;
}

/**
 * Salva a definição de um esquema. A `key` NUNCA muda (é a identidade que
 * torna o seed de fábrica idempotente); o payload é revalidado pelo parse
 * fail-closed antes de tocar o banco — gravar um jsonb que o parse recusa
 * deixaria o esquema inutilizável e sem UI para consertar.
 */
export async function saveWorkflowSchema(
  schemaId: string,
  patch: {
    label?: string;
    description?: string;
    enabled?: boolean;
    showCard?: boolean;
    definition?: unknown;
  },
  opts: { revalidate?: boolean } = {}
): Promise<WorkflowSchemaState> {
  const denied = await ensureCanConfigure();
  if (denied) return { ok: false, message: denied };

  const update: Record<string, unknown> = {};
  if (typeof patch.label === "string") {
    const label = patch.label.trim();
    if (label === "") return { ok: false, message: "O nome não pode ficar vazio." };
    update.label = label;
  }
  if (typeof patch.description === "string") {
    const d = patch.description.trim();
    update.description = d === "" ? null : d;
  }
  if (typeof patch.enabled === "boolean") update.enabled = patch.enabled;
  if (typeof patch.showCard === "boolean") update.show_card = patch.showCard;
  if (patch.definition !== undefined) {
    const parsed = parseWorkflowDefinition(patch.definition);
    if (!parsed) {
      return {
        ok: false,
        message:
          "Configuração inválida — nada foi salvo. Confira os campos e os passos.",
      };
    }
    update.definition = parsed;
  }
  if (Object.keys(update).length === 0) return { ok: true };

  const supabase = await createClient();
  const { error } = await supabase
    .from("workflow_schemas")
    .update(update)
    .eq("id", schemaId);
  if (error) return { ok: false, message: `Falha ao salvar: ${error.message}` };

  if (opts.revalidate !== false) revalidatePath("/operacao/workflow");
  return { ok: true, message: "Esquema salvo." };
}

/**
 * Cria um esquema. Nasce DESLIGADO e com definição vazia mas VÁLIDA: um fluxo
 * sem passo nenhum não faz nada, e ligar antes de montar seria oferecer ao time
 * um formulário que não leva a lugar nenhum. `copyFrom` duplica a definição de
 * outro esquema (o caminho mais curto para um fluxo novo é partir de um que já
 * funciona).
 */
export async function createWorkflowSchema(input: {
  label: string;
  triggerKind: WorkflowTriggerKind;
  description?: string;
  copyFrom?: string;
}): Promise<WorkflowSchemaState> {
  const denied = await ensureCanConfigure();
  if (denied) return { ok: false, message: denied };
  const label = input.label.trim();
  if (label === "") return { ok: false, message: "Dê um nome ao fluxo." };
  const orgId = await getActiveOrgId();
  if (!orgId) return { ok: false, message: "Organização ativa não identificada." };

  const supabase = await createClient();
  const existing = await loadWorkflowSchemas(supabase, orgId);
  const key = uniqueWorkflowKey(label, new Set(existing.map((s) => s.key)));

  let definition: WorkflowDefinition = {
    version: 1,
    form: { fields: [] },
    steps: [],
  };
  if (input.copyFrom) {
    const origem = existing.find((s) => s.id === input.copyFrom);
    if (!origem?.definition) {
      return {
        ok: false,
        message: "O esquema de origem não existe ou está com a configuração inválida.",
      };
    }
    definition = origem.definition;
  }

  const { data, error } = await supabase
    .from("workflow_schemas")
    .insert({
      organization_id: orgId,
      key,
      label,
      description: input.description?.trim() || null,
      definition,
      trigger_kind: input.triggerKind,
      // Fluxo novo nasce desligado: ligar é o ato que diz "está pronto".
      enabled: false,
      show_card: input.triggerKind === "form",
    })
    .select("id")
    .single();
  if (error) return { ok: false, message: `Falha ao criar: ${error.message}` };

  revalidatePath("/operacao/workflow");
  return { ok: true, id: data.id as string, message: `Fluxo "${label}" criado.` };
}

/**
 * Exclui um esquema. O HISTÓRICO sobrevive: `workflow_runs.schema_id` é
 * `on delete set null` e a linha guarda `schema_key` (0125) — o que já rodou
 * continua explicável depois que o fluxo deixou de existir.
 */
export async function deleteWorkflowSchema(
  schemaId: string
): Promise<WorkflowSchemaState> {
  const denied = await ensureCanConfigure();
  if (denied) return { ok: false, message: denied };
  const supabase = await createClient();
  const { error } = await supabase
    .from("workflow_schemas")
    .delete()
    .eq("id", schemaId);
  if (error) return { ok: false, message: `Falha ao excluir: ${error.message}` };
  revalidatePath("/operacao/workflow");
  return { ok: true, message: "Fluxo excluído." };
}

export interface BitrixFieldOption {
  value: string;
  label: string;
  readOnly: boolean;
}

/**
 * Campos de uma entidade do CRM, para o construtor oferecer "Título" em vez de
 * exigir que alguém saiba de cor `UF_CRM_1729887583805`. Mesma chamada que o
 * passo faz na execução (`crm.<entity>.fields`).
 *
 * Sem conexão configurada devolve lista VAZIA e a UI cai em texto livre: o
 * construtor não pode ficar refém do portal estar no ar.
 */
export async function loadBitrixEntityFields(
  entity: string
): Promise<{ ok: boolean; fields: BitrixFieldOption[]; message?: string }> {
  const denied = await ensureCanConfigure();
  if (denied) return { ok: false, fields: [], message: denied };
  if (!BITRIX_ENTITIES.includes(entity)) {
    return { ok: false, fields: [], message: "Entidade desconhecida." };
  }
  let webhookUrl: string;
  try {
    webhookUrl = resolveWorkflowConnection("bitrix_webhook");
  } catch {
    return {
      ok: false,
      fields: [],
      message: "A conexão com o Bitrix não está configurada neste ambiente.",
    };
  }
  try {
    const client = new BitrixClient(webhookUrl);
    const raw = (
      await client.call<Record<string, RawBitrixField>>(`crm.${entity}.fields`)
    ).result;
    const fields = Object.entries(raw ?? {})
      .map(([fieldId, def]) => ({
        value: fieldId,
        label: def?.title || def?.listLabel || def?.formLabel || fieldId,
        readOnly: Boolean(def?.isReadOnly),
      }))
      // Somente-leitura não é alvo: oferecê-lo produziria um campo que o passo
      // pula em silêncio na execução.
      .filter((f) => !f.readOnly)
      .sort((a, b) => a.label.localeCompare(b.label, "pt-BR"));
    return { ok: true, fields };
  } catch (e) {
    return {
      ok: false,
      fields: [],
      message: e instanceof Error ? e.message : "Falha ao ler os campos do CRM.",
    };
  }
}

interface RawBitrixField {
  title?: string;
  listLabel?: string;
  formLabel?: string;
  isReadOnly?: boolean;
}

const BITRIX_ENTITIES: string[] = ["company", "contact", "lead", "deal"];
