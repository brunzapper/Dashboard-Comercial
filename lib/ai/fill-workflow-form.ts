// Versão: 1.0 | Data: 12/09/2026
// "Preencher com IA" um formulário do Workflow: o usuário descreve o lead em
// texto livre e este core devolve as RESPOSTAS que vão para as caixas da tela.
//
// Ele NÃO escreve nada, e não existe um "apply" irmão: quem lança é a pessoa
// clicando em Lançar, pelo `runWorkflow` que já existia, intocado. É a forma
// mais forte da invariante 25 — não há caminho de escrita novo para auditar,
// porque não há caminho de escrita nenhum.
//
// Gate igual ao do lançamento (sessão + área `workflow` + `edit_record_values`):
// quem não pode lançar não pode pedir à IA que prepare um lançamento.
//
// As OPÇÕES dos campos de seleção saem de `loadWorkflowOptions` — o mesmo que a
// tela usa — e entram no enunciado. Campo de seleção com lista VAZIA (o sync não
// rodou) é OMITIDO do catálogo: oferecê-lo garantiria um valor inventado, e o
// validador o recusaria depois de gastar o turno.
import "server-only";

import { checkSettingsArea } from "@/lib/auth/access";
import { getActiveOrgId } from "@/lib/auth/org";
import { getSessionInfo } from "@/lib/auth/session";
import { todayBrasiliaIso } from "@/lib/date/today";
import { buildFormFillPromptText } from "@/lib/import/workflow-form/instructions";
import type {
  FormFillContext,
  FormFillFieldSpec,
  FormFillValues,
} from "@/lib/import/workflow-form/types";
import { validateFormFill } from "@/lib/import/workflow-form/validate";
import { createClient } from "@/lib/supabase/server";
import { loadWorkflowOptions } from "@/lib/workflow/options";
import { loadWorkflowSchemaByKey } from "@/lib/workflow/schemas";
import { visibleFields } from "@/lib/workflow/types";

import { aiSection, runJsonGenerationLoop } from "./json-loop";
import { loadOrgAiConfig } from "./config";

export interface FillFormInput {
  schemaKey: string;
  /** O texto desta rodada. */
  description: string;
  /** Turnos anteriores (a conversa vive no cliente — não há tabela). */
  priorTurns?: string[];
  /** Prévia AINDA não aplicada, para a IA saber o que está na tela. */
  pendingJson?: string;
  /** Raciocínio ao vivo, quando o provedor já o emite por padrão. */
  onThought?: (chunk: string) => void;
}

export interface FillFormState {
  ok: boolean;
  message?: string;
  errors?: string[];
  /** Respostas propostas — chave do campo → valor de texto. */
  values?: FormFillValues;
  warnings?: string[];
}

/** Catálogo dos campos que a IA pode preencher, do esquema + options vivas. */
function buildContext(
  schemaKey: string,
  schemaLabel: string,
  fields: ReturnType<typeof visibleFields>,
  options: Record<string, string[]>
): FormFillContext {
  const specs: FormFillFieldSpec[] = [];
  for (const f of fields) {
    if (f.type === "selecao") {
      const opts = options[f.key] ?? [];
      // Sem lista não há valor legítimo a propor: fora do catálogo.
      if (opts.length === 0) continue;
      specs.push({
        key: f.key,
        label: f.label,
        type: f.type,
        required: f.required,
        options: opts,
        placeholder: f.placeholder,
        help: f.help,
      });
      continue;
    }
    specs.push({
      key: f.key,
      label: f.label,
      type: f.type,
      required: f.required,
      placeholder: f.placeholder,
      help: f.help,
    });
  }
  return { schemaKey, schemaLabel, fields: specs };
}

/** JSON do catálogo para o enunciado (só o que a IA precisa para decidir). */
function catalogJson(ctx: FormFillContext): string {
  return JSON.stringify(
    {
      formulario: ctx.schemaLabel,
      campos: ctx.fields.map((f) => ({
        chave: f.key,
        rotulo: f.label,
        tipo: f.type,
        obrigatorio: f.required,
        ...(f.options ? { opcoes: f.options } : {}),
        ...(f.help ? { ajuda: f.help } : {}),
        ...(f.placeholder ? { exemplo: f.placeholder } : {}),
      })),
    },
    null,
    2
  );
}

export async function fillWorkflowFormCore(
  input: FillFormInput
): Promise<FillFormState> {
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
  const description = input.description.trim();
  if (!description) {
    return { ok: false, message: "Descreva o que quer lançar." };
  }
  const orgId = await getActiveOrgId();
  if (!orgId) {
    return { ok: false, message: "Organização ativa não identificada." };
  }

  const supabase = await createClient();
  const schema = await loadWorkflowSchemaByKey(supabase, orgId, input.schemaKey);
  if (!schema?.definition || schema.triggerKind !== "form" || !schema.enabled) {
    return { ok: false, message: "Formulário não encontrado." };
  }

  const aiConfig = await loadOrgAiConfig(orgId);
  if (!aiConfig) {
    return {
      ok: false,
      message:
        "IA não configurada para a organização — um administrador define o provedor em Configurações → Integrações.",
    };
  }

  const options = await loadWorkflowOptions(supabase, orgId, schema.definition);
  const ctx = buildContext(
    schema.key,
    schema.label,
    visibleFields(schema.definition),
    options
  );
  if (ctx.fields.length === 0) {
    return { ok: false, message: "Este formulário não tem campos a preencher." };
  }

  let system = buildFormFillPromptText({
    schemaLabel: ctx.schemaLabel,
    todayIso: todayBrasiliaIso(),
    catalogJson: catalogJson(ctx),
  });
  if (input.pendingJson) {
    system += aiSection(
      "PROPOSTA ATUAL NA TELA (ainda não lançada)",
      `${input.pendingJson}\n\nSua resposta SUBSTITUI esta proposta INTEIRA.`
    );
  }

  // O laço devolve valores E avisos juntos: as "notas" da IA só existem na
  // saída do validador, e re-validar depois para recuperá-las as perderia (a
  // serialização canônica não carrega notas).
  const result = await runJsonGenerationLoop<{
    values: FormFillValues;
    warnings: string[];
  }>({
    config: aiConfig,
    system,
    priorTurns: input.priorTurns ?? [],
    description,
    onThought: input.onThought,
    validate: (raw) => {
      const v = validateFormFill(raw, ctx);
      return v.ok
        ? { ok: true, value: { values: v.values, warnings: v.warnings } }
        : { ok: false, errors: v.errors };
    },
  });
  if (!result.ok) {
    return { ok: false, message: result.message, errors: result.errors };
  }

  const { values, warnings } = result.value;
  const labelOf = new Map(ctx.fields.map((f) => [f.key, f.label]));
  const filled = Object.keys(values)
    .map((k) => labelOf.get(k) ?? k)
    .join(", ");

  return {
    ok: true,
    message: filled
      ? `Preenchi: ${filled}. Revise e clique em Lançar.`
      : "Não encontrei nada para preencher.",
    values,
    warnings,
  };
}
