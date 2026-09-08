// Versão: 1.0 | Data: 07/09/2026
// NÚCLEO do assistente de IA do QUADRO KANBAN ("Configurar com IA" das páginas
// /kanbans/[id] e /kanbans/w/[widgetId]). Padrão §4.17 — a IA NUNCA escreve:
// os cores VALIDAM e devolvem prévia; o apply RE-VALIDA com contexto FRESCO e
// escreve SÓ pelos choke points que já existiam:
//   quadro     → updateBoardSettings / saveWidgetSettings (que já normalizam a
//                alocação-como-campo — invariante 24);
//   automações → saveAutomation (parse fail-closed + gate lá dentro).
// O ALVO (widget ou board) vem SEMPRE da UI, nunca do JSON. Quatro entradas
// sobre o MESMO contrato, como em manage-operations/classify-mappings:
// generate (chat) · preview (colar JSON, sem IA) · buildPrompt (copiar) ·
// apply.
import "server-only";
import { automationSummary } from "@/lib/kanban/automations/summary";

import { getSessionInfo } from "@/lib/auth/session";
import { getActiveOrgId } from "@/lib/auth/org";
import { createClient } from "@/lib/supabase/server";
import { loadOrgAiConfig } from "@/lib/ai/config";
import {
  saveWidgetSettings,
  updateBoardSettings,
} from "@/app/(app)/dashboards/actions";
import { aiSection, runJsonGenerationLoop } from "@/lib/ai/json-loop";
import {
  getAutomationFieldOptions,
  listAutomations,
  saveAutomation,
} from "@/lib/kanban/automations/actions";
import { ensureKanbanConfigGate } from "@/lib/kanban/config-gate";
import type { KanbanOwner } from "@/lib/kanban/data";
import {
  KANBAN_AGG_LABELS,
  type KanbanSettings,
} from "@/lib/kanban/types";
import { buildKanbanPromptText } from "@/lib/import/kanban/instructions";
import {
  serializeKanbanConfig,
  validateKanbanConfig,
} from "@/lib/import/kanban/validate";
import type {
  KanbanConfigContext,
  ParsedKanbanConfig,
} from "@/lib/import/kanban/types";
import type { DashboardSettings, WidgetSettings } from "@/lib/widgets/types";

/** Colunas derivadas do quadro, passadas pela UI (que já rodou o board).
 *  Mesmo arranjo do `columns` que o AutomationsSheet recebe: recomputá-las
 *  aqui exigiria rodar o quadro inteiro só para montar um prompt. */
export interface KanbanColumnHint {
  key: string;
  label: string;
}

export interface GenerateKanbanInput {
  owner: KanbanOwner;
  columns: KanbanColumnHint[];
  description: string;
  priorTurns?: string[];
  /** Prévia pendente — a resposta SUBSTITUI a proposta inteira. */
  pendingJson?: string;
}

export interface GenerateKanbanState {
  ok: boolean;
  message?: string;
  errors?: string[];
  /** JSON canônico da proposta (alimenta o apply e o turno seguinte). */
  json?: string;
  summary?: string[];
  warnings?: string[];
}

export interface ApplyKanbanState {
  ok: boolean;
  message?: string;
  errors?: string[];
  appliedCount?: number;
  failed?: { item: string; message: string }[];
}

interface Loaded {
  ctx: KanbanConfigContext;
  catalogJson: string;
  dashboardId: string;
}

/** Contexto FRESCO (geração E apply), pelo client RLS do usuário. */
async function loadKanbanConfigContext(
  owner: KanbanOwner,
  columns: KanbanColumnHint[]
): Promise<Loaded | { error: string }> {
  const supabase = await createClient();

  let atual: KanbanSettings | undefined;
  let quadroLabel = "";
  let dashboardId = owner.id;
  if (owner.kind === "widget") {
    const { data: w } = await supabase
      .from("widgets")
      .select("id, title, dashboard_id, settings")
      .eq("id", owner.id)
      .maybeSingle();
    if (!w) return { error: "Widget não encontrado." };
    dashboardId = w.dashboard_id as string;
    atual = (w.settings as WidgetSettings | null)?.kanban;
    quadroLabel = (w.title as string | null) ?? "Kanban";
  } else {
    const { data: d } = await supabase
      .from("dashboards")
      .select("id, name, settings, status")
      .eq("id", owner.id)
      .maybeSingle();
    if (!d || d.status === "trashed") return { error: "Quadro indisponível." };
    atual = (d.settings as DashboardSettings | null)?.kanban;
    quadroLabel = (d.name as string | null) ?? "Kanban";
  }
  if (!atual) return { error: "Este quadro ainda não tem configuração de kanban." };

  const [catalogRes, automacoesRes] = await Promise.all([
    getAutomationFieldOptions(atual.source, owner),
    listAutomations(owner),
  ]);
  if (!catalogRes.ok || !catalogRes.catalog) {
    return { error: catalogRes.message ?? "Falha ao carregar o catálogo do quadro." };
  }
  const cat = catalogRes.catalog;
  const rootSourceKeys = cat.sources.map((s) => s.value);

  const ctx: KanbanConfigContext = {
    atual,
    quadroLabel,
    // `fieldsBySource` cobre o universo de Bases oferecidas ao quadro; a Base
    // do quadro entra sempre (pode ser sub-base, fora de `sources`).
    sourceKeys: [...new Set([...(atual.source ? [atual.source] : []), ...rootSourceKeys])],
    rootSourceKeys,
    fields: cat.fields.map((f) => ({ ref: f.value, label: f.label })),
    settableFields: cat.settableFields.map((f) => ({ ref: f.value, label: f.label })),
    selectOptionsByField: cat.selectOptionsByField,
    columns,
    automacoes: (automacoesRes.rows ?? []).map((r) => ({
      nome: r.name,
      ativa: r.enabled,
    })),
  };

  const catalogJson = JSON.stringify(
    {
      quadro: quadroLabel,
      configuracao_atual: atual,
      colunas_atuais: columns,
      bases: ctx.sourceKeys,
      bases_raiz: ctx.rootSourceKeys,
      campos: ctx.fields,
      campos_gravaveis: ctx.settableFields,
      opcoes_por_campo: ctx.selectOptionsByField,
      agregacoes: Object.keys(KANBAN_AGG_LABELS),
      automacoes_atuais: ctx.automacoes,
    },
    null,
    2
  );

  return { ctx, catalogJson, dashboardId };
}

function summarize(value: ParsedKanbanConfig): string[] {
  const out: string[] = [];
  if (value.quadro) {
    const cols = value.quadro.columns?.length;
    out.push(
      `Quadro: ${value.quadro.mode === "tarefas" ? "modo tarefas" : `base "${value.quadro.source}"`}` +
        (cols ? `, ${cols} coluna${cols === 1 ? "" : "s"}` : "")
    );
  }
  for (const a of value.automacoes ?? []) {
    // Frase única (lib/kanban/automations/summary.ts) — repetir a montagem
    // aqui era o que fazia a prévia esquecer de uma ação nova.
    out.push(
      `Automação "${a.nome}"${a.ativa ? "" : " (desativada)"}: ${automationSummary(a.rule)}`
    );
  }
  return out;
}

export async function generateKanbanConfigCore(
  input: GenerateKanbanInput
): Promise<GenerateKanbanState> {
  const gate = await ensureKanbanConfigGate(input.owner);
  if (!gate.ok) return { ok: false, message: gate.message };

  const orgId = await getActiveOrgId();
  const aiConfig = orgId ? await loadOrgAiConfig(orgId) : null;
  if (!aiConfig) {
    return {
      ok: false,
      message:
        "IA não configurada para a organização — um administrador define o provedor em Configurações → Integrações. Você ainda pode usar 'Copiar prompt' e colar a resposta.",
    };
  }

  const loaded = await loadKanbanConfigContext(input.owner, input.columns);
  if ("error" in loaded) return { ok: false, message: loaded.error };

  let system = buildKanbanPromptText({ catalogJson: loaded.catalogJson });
  const pending = (input.pendingJson ?? "").trim();
  if (pending) {
    system += aiSection(
      "PRÉVIA PENDENTE (AINDA NÃO APLICADA)",
      "No turno anterior você propôs a configuração abaixo e o usuário AINDA " +
        "NÃO aplicou. Sua resposta deste turno SUBSTITUI a proposta INTEIRA: " +
        "re-inclua o que continuar desejado.\n\n" +
        pending
    );
  }

  const description =
    input.description.trim() || "Sugira melhorias para este quadro.";
  const result = await runJsonGenerationLoop<{
    value: ParsedKanbanConfig;
    warnings: string[];
  }>({
    config: aiConfig,
    system,
    priorTurns: input.priorTurns ?? [],
    description,
    validate: (raw) => {
      const v = validateKanbanConfig(raw, loaded.ctx);
      if (!v.ok) return { ok: false, errors: v.errors };
      return { ok: true, value: { value: v.value, warnings: v.warnings } };
    },
  });
  if (!result.ok) {
    return { ok: false, message: result.message, errors: result.errors };
  }
  return {
    ok: true,
    message: "Prévia pronta — revise e clique em Aplicar.",
    json: serializeKanbanConfig(result.value.value),
    summary: summarize(result.value.value),
    warnings: result.value.warnings,
  };
}

/** Valida uma resposta COLADA (fluxo de IA externa) — mesma prévia, sem IA. */
export async function previewKanbanConfigCore(
  owner: KanbanOwner,
  columns: KanbanColumnHint[],
  raw: string
): Promise<GenerateKanbanState> {
  const gate = await ensureKanbanConfigGate(owner);
  if (!gate.ok) return { ok: false, message: gate.message };
  const loaded = await loadKanbanConfigContext(owner, columns);
  if ("error" in loaded) return { ok: false, message: loaded.error };

  const v = validateKanbanConfig(raw, loaded.ctx);
  if (!v.ok) {
    return { ok: false, message: "O JSON colado não passou na validação.", errors: v.errors };
  }
  return {
    ok: true,
    message: "Prévia pronta — revise e clique em Aplicar.",
    json: serializeKanbanConfig(v.value),
    summary: summarize(v.value),
    warnings: v.warnings,
  };
}

/** Texto do "Copiar prompt" — o MESMO system do chat interno. */
export async function buildKanbanPromptCore(
  owner: KanbanOwner,
  columns: KanbanColumnHint[]
): Promise<{ ok: boolean; prompt?: string; message?: string }> {
  const gate = await ensureKanbanConfigGate(owner);
  if (!gate.ok) return { ok: false, message: gate.message };
  const loaded = await loadKanbanConfigContext(owner, columns);
  if ("error" in loaded) return { ok: false, message: loaded.error };
  return { ok: true, prompt: buildKanbanPromptText({ catalogJson: loaded.catalogJson }) };
}

/**
 * Aplica a proposta. RE-VALIDA com contexto FRESCO e escreve só pelos choke
 * points. Resultado POR ITEM: falha parcial não desfaz o que já entrou
 * (precedente do apply de registros).
 */
export async function applyKanbanConfigCore(
  owner: KanbanOwner,
  columns: KanbanColumnHint[],
  raw: string
): Promise<ApplyKanbanState> {
  const gate = await ensureKanbanConfigGate(owner);
  if (!gate.ok) return { ok: false, message: gate.message };
  const session = await getSessionInfo();
  if (!session) return { ok: false, message: "Sessão expirada." };

  const loaded = await loadKanbanConfigContext(owner, columns);
  if ("error" in loaded) return { ok: false, message: loaded.error };

  const v = validateKanbanConfig(raw, loaded.ctx);
  if (!v.ok) {
    return { ok: false, message: "A proposta não é mais válida.", errors: v.errors };
  }

  const supabase = await createClient();
  const failed: { item: string; message: string }[] = [];
  let applied = 0;

  // ---- Quadro: substitui SÓ a chave `kanban` do settings vigente.
  if (v.value.quadro) {
    if (owner.kind === "board") {
      const { data: d } = await supabase
        .from("dashboards")
        .select("settings")
        .eq("id", owner.id)
        .maybeSingle();
      const settings = (d?.settings ?? {}) as DashboardSettings;
      const res = await updateBoardSettings(owner.id, {
        ...settings,
        kanban: v.value.quadro,
      });
      if (res.ok) applied += 1;
      else failed.push({ item: "Quadro", message: res.message ?? "Falha ao salvar." });
    } else {
      const { data: w } = await supabase
        .from("widgets")
        .select("settings")
        .eq("id", owner.id)
        .maybeSingle();
      const settings = (w?.settings ?? {}) as WidgetSettings;
      const res = await saveWidgetSettings(owner.id, loaded.dashboardId, {
        ...settings,
        kanban: v.value.quadro,
      });
      if (res.ok) applied += 1;
      else failed.push({ item: "Quadro", message: res.message ?? "Falha ao salvar." });
    }
  }

  // ---- Automações: a lista é a desejada INTEIRA. Casamento por NOME
  // (case-insensitive); o que sumiu é DESATIVADO, nunca excluído — excluir
  // fica na tela, precedente do contrato de operações.
  if (v.value.automacoes) {
    const existing = (await listAutomations(owner)).rows ?? [];
    const byName = new Map(
      existing.map((r) => [r.name.trim().toLocaleLowerCase("pt-BR"), r])
    );
    const keep = new Set<string>();

    for (const a of v.value.automacoes) {
      const key = a.nome.toLocaleLowerCase("pt-BR");
      const prev = byName.get(key);
      if (prev) keep.add(prev.id);
      const res = await saveAutomation(owner, {
        id: prev?.id ?? null,
        name: a.nome,
        enabled: a.ativa,
        position: a.posicao,
        rule: a.rule,
      });
      if (res.ok) applied += 1;
      else
        failed.push({
          item: `Automação "${a.nome}"`,
          message: res.message ?? "Falha ao salvar.",
        });
    }

    let tail = v.value.automacoes.length;
    for (const prev of existing) {
      if (keep.has(prev.id) || !prev.enabled) continue;
      const res = await saveAutomation(owner, {
        id: prev.id,
        name: prev.name,
        enabled: false,
        position: tail++,
        rule: prev.rule,
      });
      if (res.ok) applied += 1;
      else
        failed.push({
          item: `Desativar "${prev.name}"`,
          message: res.message ?? "Falha ao desativar.",
        });
    }
  }

  if (applied === 0 && failed.length > 0) {
    return { ok: false, message: "Nada foi aplicado.", appliedCount: 0, failed };
  }
  return {
    ok: true,
    message:
      failed.length > 0
        ? `${applied} item(ns) aplicado(s); ${failed.length} falhou(ram).`
        : `${applied} item(ns) aplicado(s).`,
    appliedCount: applied,
    ...(failed.length > 0 ? { failed } : {}),
  };
}
