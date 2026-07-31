// Versão: 1.0 | Data: 31/07/2026
// NÚCLEO do assistente de IA de OPERAÇÕES (Configurações → Operações →
// "Gerir com IA"). A IA NUNCA escreve: generateOperationsCore valida o lote
// (lib/import/operations/validate — nomes resolvidos, automáticas barradas,
// ciclo/prioridade pré-checados) e devolve a prévia; applyOperationsCore
// RE-VALIDA com contexto FRESCO e aplica item a item SÓ pelos choke points
// existentes (createOperation/updateOperation/updateOperationFilter +
// addResponsibleOperation/removeResponsibleOperation — gates e RLS re-rodam
// lá; falha parcial não desfaz, resultado por item). previewOperationsCore
// valida JSON colado SEM IA (fluxo copiar-prompt → colar-JSON de IA externa)
// e buildOperationsPromptCore monta o MESMO prompt do chat interno.
// Vincular/desvincular passam pelo gate da área "responsaveis" dos próprios
// choke points — deny individual falha por item, nunca silencioso.
import "server-only";

import { getSessionInfo } from "@/lib/auth/session";
import { isSettingsAreaDenied } from "@/lib/auth/access";
import { getActiveOrgId } from "@/lib/auth/org";
import { createClient } from "@/lib/supabase/server";
import { loadOrgAiConfig } from "@/lib/ai/config";
import { aiSection, runJsonGenerationLoop } from "@/lib/ai/json-loop";
import { loadSources } from "@/lib/config/sources";
import { CORE_FIELDS } from "@/lib/widgets/fields";
import type { WidgetFilter } from "@/lib/widgets/types";
import { buildOperationsPromptText } from "@/lib/import/operations/instructions";
import { validateOperationsEdit } from "@/lib/import/operations/validate";
import type {
  OperationsEditContext,
  OperationTargetRef,
  ParsedOperationAction,
} from "@/lib/import/operations/types";
import {
  createOperation,
  updateOperation,
  updateOperationFilter,
} from "@/app/(app)/configuracoes/operacoes/actions";
import {
  addResponsibleOperation,
  removeResponsibleOperation,
} from "@/app/(app)/configuracoes/responsaveis/actions";

export interface GenerateOperationsInput {
  description: string;
  priorTurns?: string[];
  /** Prévia pendente — a resposta SUBSTITUI a proposta inteira. */
  pendingJson?: string;
}

export interface GenerateOperationsState {
  ok: boolean;
  message?: string;
  errors?: string[];
  /** Ações validadas — a prévia renderiza daqui. */
  actions?: ParsedOperationAction[];
  summary?: string[];
  warnings?: string[];
}

export interface ApplyOperationsResultItem {
  index: number;
  titulo: string;
  ok: boolean;
  message?: string;
}

export interface ApplyOperationsState {
  ok: boolean;
  message?: string;
  errors?: string[];
  results?: ApplyOperationsResultItem[];
  appliedCount?: number;
}

// Mesmo gate do ensureAdmin de configuracoes/operacoes/actions.ts.
async function gate(): Promise<string | null> {
  const s = await getSessionInfo();
  if (!s) return "Sessão expirada.";
  if (!s.roles.includes("admin")) return "Apenas administradores.";
  if (await isSettingsAreaDenied("operacoes"))
    return "Acesso a esta área foi bloqueado.";
  return null;
}

type Supabase = Awaited<ReturnType<typeof createClient>>;

interface LoadedContext {
  ctx: OperationsEditContext;
  catalogJson: string;
}

// Contexto FRESCO (geração E apply): catálogo de operações com hierarquia/
// perfil/flag automática + vínculos, responsáveis ativos, refs de perfil
// (CORE_FIELDS + custom:) e fontes.
async function loadOperationsEditContext(
  supabase: Supabase
): Promise<LoadedContext> {
  const [{ data: opsData }, { data: respData }, { data: linksData }, { data: fieldsData }, sources] =
    await Promise.all([
      supabase
        .from("operations")
        .select("id, name, parent_operation_id, active, auto_source_record_id, filter")
        .order("name"),
      supabase
        .from("responsibles")
        .select("id, display_name, active")
        .eq("active", true)
        .order("display_name"),
      supabase
        .from("responsible_operations")
        .select("responsible_id, operation_id, priority"),
      supabase
        .from("field_definitions")
        .select("field_key, label")
        .order("sort_order", { ascending: true })
        .order("label", { ascending: true }),
      loadSources(supabase),
    ]);
  const ops = (opsData ?? []) as {
    id: string;
    name: string;
    parent_operation_id: string | null;
    active: boolean;
    auto_source_record_id: string | null;
    filter: unknown;
  }[];
  const responsibles = ((respData ?? []) as {
    id: string;
    display_name: string | null;
    active: boolean;
  }[]).map((r) => ({ id: r.id, name: r.display_name ?? "—", active: r.active }));
  const links = ((linksData ?? []) as {
    responsible_id: string;
    operation_id: string;
    priority: number;
  }[]).map((l) => ({
    responsibleId: l.responsible_id,
    operationId: l.operation_id,
    priority: l.priority,
  }));
  const customFields = ((fieldsData ?? []) as {
    field_key: string;
    label: string | null;
  }[]).map((f) => ({
    ref: `custom:${f.field_key}`,
    rotulo: f.label || f.field_key,
  }));
  const camposParaPerfil = [
    ...CORE_FIELDS.map((f) => ({ ref: f.field, rotulo: f.label })),
    ...customFields,
  ];

  const ctx: OperationsEditContext = {
    operations: ops.map((o) => ({
      id: o.id,
      name: o.name,
      parentId: o.parent_operation_id,
      active: o.active,
      auto: o.auto_source_record_id != null,
    })),
    responsibles,
    links,
    profileFields: camposParaPerfil.map((c) => c.ref),
    sourceKeys: sources.map((s) => s.key),
  };

  const nameById = new Map(ops.map((o) => [o.id, o.name]));
  const respNameById = new Map(responsibles.map((r) => [r.id, r.name]));
  const linksByOp = new Map<string, { nome: string; prioridade: number }[]>();
  for (const l of links) {
    const nome = respNameById.get(l.responsibleId);
    if (!nome) continue; // vínculo de responsável inativo fica fora do catálogo
    linksByOp.set(l.operationId, [
      ...(linksByOp.get(l.operationId) ?? []),
      { nome, prioridade: l.priority },
    ]);
  }
  const catalogJson = JSON.stringify(
    {
      operacoes: ops.map((o) => ({
        nome: o.name,
        pai: o.parent_operation_id
          ? (nameById.get(o.parent_operation_id) ?? null)
          : null,
        ativa: o.active,
        automatica: o.auto_source_record_id != null,
        perfil: Array.isArray(o.filter) ? o.filter : [],
        responsaveis: linksByOp.get(o.id) ?? [],
      })),
      responsaveis_ativos: responsibles.map((r) => r.name),
      campos_para_perfil: camposParaPerfil,
      fontes: sources.map((s) => ({ key: s.key, label: s.label })),
    },
    null,
    2
  );
  return { ctx, catalogJson };
}

function summaryOf(a: ParsedOperationAction): string {
  if (a.acao === "criar") {
    const parts = [`criar · "${a.nome}"`];
    if (a.pai) parts.push(`pai: ${a.pai.nome}`);
    if (a.perfil) parts.push(`perfil com ${a.perfil.length} condição(ões)`);
    return parts.join(" · ");
  }
  if (a.acao === "editar") {
    const parts = [`editar · "${a.alvo.nome}"`];
    if (a.novoNome !== undefined) parts.push(`renomear p/ "${a.novoNome}"`);
    if (a.novoPai !== undefined)
      parts.push(a.novoPai === null ? "vira raiz" : `mover p/ ${a.novoPai.nome}`);
    if (a.ativa !== undefined) parts.push(a.ativa ? "ativar" : "desativar");
    if (a.perfil !== undefined)
      parts.push(
        a.perfil === null
          ? "limpar perfil"
          : `perfil com ${a.perfil.length} condição(ões)`
      );
    return parts.join(" · ");
  }
  if (a.acao === "vincular")
    return `vincular · ${a.responsavel.nome} → "${a.operacao.nome}" (prioridade ${a.prioridade})`;
  return `desvincular · ${a.responsavel.nome} ✕ "${a.operacao.nome}"`;
}

function tituloOf(a: ParsedOperationAction): string {
  if (a.acao === "criar") return a.nome;
  if (a.acao === "editar") return a.alvo.nome;
  return `${a.responsavel.nome} × ${a.operacao.nome}`;
}

export async function generateOperationsCore(
  input: GenerateOperationsInput
): Promise<GenerateOperationsState> {
  const err = await gate();
  if (err) return { ok: false, message: err };
  const description = input.description.trim();
  if (!description) return { ok: false, message: "Descreva o que quer mudar nas operações." };

  const orgId = await getActiveOrgId();
  const aiConfig = orgId ? await loadOrgAiConfig(orgId) : null;
  if (!aiConfig) {
    return {
      ok: false,
      message:
        "IA não configurada para a organização — um administrador define o provedor em Configurações → Integrações.",
    };
  }

  const supabase = await createClient();
  const { ctx, catalogJson } = await loadOperationsEditContext(supabase);

  let system = buildOperationsPromptText({ catalogJson });
  const pending = (input.pendingJson ?? "").trim();
  if (pending) {
    system += aiSection(
      "PRÉVIA PENDENTE (AINDA NÃO APLICADA)",
      "No turno anterior você propôs as ações abaixo e o usuário AINDA NÃO " +
        "confirmou. Sua resposta deste turno SUBSTITUI a proposta INTEIRA: " +
        "re-inclua as ações que continuarem desejadas.\n\n" +
        pending
    );
  }

  const result = await runJsonGenerationLoop<{
    actions: ParsedOperationAction[];
    warnings: string[];
  }>({
    config: aiConfig,
    system,
    priorTurns: input.priorTurns ?? [],
    description,
    validate: (raw) => {
      const v = validateOperationsEdit(raw, ctx);
      if (!v.ok) return { ok: false, errors: v.errors };
      return { ok: true, value: { actions: v.actions, warnings: v.warnings } };
    },
  });
  if (!result.ok) {
    return { ok: false, message: result.message, errors: result.errors };
  }
  const { actions, warnings } = result.value;
  return {
    ok: true,
    message: "Prévia pronta — revise as ações e confirme a aplicação.",
    actions,
    summary: actions.map((a, i) => `${i + 1}. ${summaryOf(a)}`),
    warnings,
  };
}

/** Valida um JSON COLADO (fluxo de IA externa) — mesma prévia, sem IA. */
export async function previewOperationsCore(
  raw: string
): Promise<GenerateOperationsState> {
  const err = await gate();
  if (err) return { ok: false, message: err };
  if (!raw.trim()) return { ok: false, message: "Cole o JSON devolvido pela IA." };
  const supabase = await createClient();
  const { ctx } = await loadOperationsEditContext(supabase);
  const v = validateOperationsEdit(raw, ctx);
  if (!v.ok) {
    return {
      ok: false,
      message: "O JSON tem problemas — corrija na IA externa e cole de novo.",
      errors: v.errors,
    };
  }
  return {
    ok: true,
    message: "Prévia pronta — revise as ações e confirme a aplicação.",
    actions: v.actions,
    summary: v.actions.map((a, i) => `${i + 1}. ${summaryOf(a)}`),
    warnings: v.warnings,
  };
}

/** Prompt completo p/ IA externa: MESMO SPEC do chat + catálogo atual. */
export async function buildOperationsPromptCore(): Promise<{
  ok: boolean;
  prompt?: string;
  message?: string;
}> {
  const err = await gate();
  if (err) return { ok: false, message: err };
  const supabase = await createClient();
  const { catalogJson } = await loadOperationsEditContext(supabase);
  return { ok: true, prompt: buildOperationsPromptText({ catalogJson }) };
}

export async function applyOperationsCore(
  raw: string
): Promise<ApplyOperationsState> {
  const err = await gate();
  if (err) return { ok: false, message: err };

  const supabase = await createClient();
  const { ctx } = await loadOperationsEditContext(supabase);
  const validation = validateOperationsEdit(raw, ctx);
  if (!validation.ok) {
    return {
      ok: false,
      message: "A proposta tem problemas — peça um ajuste e tente de novo.",
      errors: validation.errors,
    };
  }
  const actions = validation.actions;

  // Ids das operações criadas neste apply, por índice da ação `criar` — as
  // refs `nova` de ações posteriores resolvem aqui (criação que falhou derruba
  // só os dependentes, com mensagem apontando o item).
  const newIds = new Map<number, string>();
  const results: ApplyOperationsResultItem[] = [];
  let appliedCount = 0;

  const opIdOf = (ref: OperationTargetRef): string | { error: string } => {
    if (ref.kind === "existente") return ref.id;
    const id = newIds.get(ref.index);
    if (!id)
      return {
        error: `depende do item ${ref.index + 1} ("${ref.nome}"), cuja criação falhou.`,
      };
    return id;
  };

  for (let i = 0; i < actions.length; i++) {
    const a = actions[i];
    const item: ApplyOperationsResultItem = {
      index: i,
      titulo: tituloOf(a),
      ok: false,
    };
    results.push(item);

    if (a.acao === "criar") {
      const parent = a.pai ? opIdOf(a.pai) : null;
      if (parent && typeof parent !== "string") {
        item.message = parent.error;
        continue;
      }
      const fd = new FormData();
      fd.set("name", a.nome);
      fd.set("parent_operation_id", typeof parent === "string" ? parent : "");
      const res = await createOperation({}, fd);
      if (!res.ok || !res.id) {
        item.message = res.message ?? "Falha ao criar.";
        continue;
      }
      newIds.set(i, res.id);
      if (a.perfil && a.perfil.length > 0) {
        const pf = await updateOperationFilter(res.id, a.perfil);
        if (!pf.ok) {
          // Criada mas sem perfil — parcial explícito, nunca silencioso.
          item.message = `Operação criada, mas o perfil falhou: ${pf.message}`;
          continue;
        }
      }
      item.ok = true;
      appliedCount += 1;
      continue;
    }

    if (a.acao === "editar") {
      const patch: {
        name?: string;
        active?: boolean;
        parent_operation_id?: string | null;
      } = {};
      if (a.novoNome !== undefined) patch.name = a.novoNome;
      if (a.ativa !== undefined) patch.active = a.ativa;
      if (a.novoPai !== undefined) {
        if (a.novoPai === null) patch.parent_operation_id = null;
        else {
          const pid = opIdOf(a.novoPai);
          if (typeof pid !== "string") {
            item.message = pid.error;
            continue;
          }
          patch.parent_operation_id = pid;
        }
      }
      if (Object.keys(patch).length > 0) {
        const res = await updateOperation(a.alvo.id, patch);
        if (!res.ok) {
          item.message = res.message ?? "Falha ao editar.";
          continue;
        }
      }
      if (a.perfil !== undefined) {
        const filter: WidgetFilter[] = a.perfil === null ? [] : a.perfil;
        const pf = await updateOperationFilter(a.alvo.id, filter);
        if (!pf.ok) {
          item.message = pf.message ?? "Falha ao salvar o perfil.";
          continue;
        }
      }
      item.ok = true;
      appliedCount += 1;
      continue;
    }

    if (a.acao === "vincular") {
      const oid = opIdOf(a.operacao);
      if (typeof oid !== "string") {
        item.message = oid.error;
        continue;
      }
      const res = await addResponsibleOperation(a.responsavel.id, oid, a.prioridade);
      if (!res.ok) {
        item.message = res.message ?? "Falha ao vincular.";
        continue;
      }
      item.ok = true;
      appliedCount += 1;
      continue;
    }

    // desvincular
    const res = await removeResponsibleOperation(a.responsavel.id, a.operacao.id);
    if (!res.ok) {
      item.message = res.message ?? "Falha ao desvincular.";
      continue;
    }
    item.ok = true;
    appliedCount += 1;
  }

  const total = actions.length;
  const message =
    appliedCount === total
      ? `${appliedCount} ação(ões) aplicada(s).`
      : appliedCount > 0
        ? `${appliedCount} de ${total} ações aplicadas — veja os erros por item.`
        : "Nenhuma ação aplicada — veja os erros por item.";
  return { ok: appliedCount === total, message, results, appliedCount };
}
