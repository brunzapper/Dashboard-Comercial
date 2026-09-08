// Versão: 1.0 | Data: 08/09/2026
// NÚCLEO do assistente de IA de REMUNERAÇÃO (escopo `remuneracao` do painel da
// Operação). Padrão §4.17 — a IA NUNCA escreve: o core valida e devolve
// prévia; o apply RE-VALIDA com contexto FRESCO e escreve SÓ pelos choke
// points que já existiam:
//   plano → savePlan  (que roda validateCompPlanSave, a MURALHA)
//   metas → saveTarget (que canonicaliza o responsável e aplica o
//           deslocamento da apuração — chamar upsertGoalTarget cru gravaria
//           no mês errado num plano "mes_anterior")
//
// O PLANO e o MÊS vêm SEMPRE da UI. O validador do contrato só TRADUZ nomes e
// texto de fórmula para um config completo; a régua de validade é o módulo
// compartilhado com o savePlan — nunca uma cópia aqui.
import "server-only";

import { randomUUID } from "node:crypto";

import { getSessionInfo } from "@/lib/auth/session";
import { isSettingsAreaDenied } from "@/lib/auth/access";
import { getActiveOrgId } from "@/lib/auth/org";
import { createClient } from "@/lib/supabase/server";
import { loadOrgAiConfig } from "@/lib/ai/config";
import { aiSection, runJsonGenerationLoop } from "@/lib/ai/json-loop";
import { loadSources } from "@/lib/config/sources";
import { loadCorrespondences } from "@/lib/correspondences";
import { loadGoalMetrics } from "@/lib/config/goal-metrics";
import {
  canonicalOf,
  loadResponsibleCanon,
} from "@/lib/config/responsible-canon";
import { formulaToSource } from "@/lib/records/formula-text";
import type { FieldDefinition } from "@/lib/records/types";
import {
  availableAggCatalogInput,
  buildAggOperandCatalog,
} from "@/lib/widgets/agg-catalog";
import { buildAvailableFields } from "@/lib/widgets/fields";
import {
  compOperandCatalog,
  parseCompPlanConfig,
  type CompPlanConfig,
} from "@/lib/comp/model";
import { savePlan, saveTarget } from "@/app/(app)/operacao/remuneracao/actions";
import { buildCompPromptText } from "@/lib/import/comp/instructions";
import {
  serializeCompEdit,
  validateCompEdit,
  type CompEditDeps,
  type CompEditResolved,
} from "@/lib/import/comp/validate";
import type { CompEditContext } from "@/lib/import/comp/types";

/** Recorte que a UI tem aberto — o alvo da conversa. */
export interface CompAiTarget {
  planId: string;
  ano: number;
  mes: number;
}

/** `target` do painel serializa como "<planId>:<ano>-<mes>". */
export function parseCompTarget(raw: string): CompAiTarget | null {
  const m = /^([0-9a-f-]{36}):(\d{4})-(\d{1,2})$/i.exec(raw.trim());
  if (!m) return null;
  const ano = Number(m[2]);
  const mes = Number(m[3]);
  if (mes < 1 || mes > 12) return null;
  return { planId: m[1], ano, mes };
}

export function formatCompTarget(t: CompAiTarget): string {
  return `${t.planId}:${t.ano}-${t.mes}`;
}

export interface GenerateCompState {
  ok: boolean;
  message?: string;
  errors?: string[];
  json?: string;
  summary?: string[];
  warnings?: string[];
}

export interface ApplyCompState {
  ok: boolean;
  message?: string;
  errors?: string[];
  appliedCount?: number;
  /** Snapshot pré-apply para o Desfazer. */
  snapshot?: CompUndoSnapshot;
}

/** O que o Desfazer precisa para restaurar — pelos MESMOS choke points. */
export interface CompUndoSnapshot {
  planId: string;
  ano: number;
  mes: number;
  plan?: {
    name: string;
    active: boolean;
    baseAmountDefault: number | null;
    config: CompPlanConfig;
  };
  /** `previous: null` = a meta NÃO existia ⇒ o undo a exclui. */
  targets?: {
    responsibleId: string;
    factorId: string;
    previous: number | null;
  }[];
}

async function gate(): Promise<string | null> {
  const s = await getSessionInfo();
  if (!s) return "Sessão expirada.";
  if (!s.roles.includes("admin")) return "Apenas administradores.";
  if (await isSettingsAreaDenied("remuneracao"))
    return "Acesso a esta área foi bloqueado.";
  return null;
}

interface Loaded {
  ctx: CompEditContext;
  deps: CompEditDeps;
  catalogJson: string;
  plan: {
    id: string;
    name: string;
    active: boolean;
    baseAmountDefault: number | null;
  };
  atual: CompPlanConfig;
}

/** Contexto FRESCO (geração E apply), pelo client RLS do usuário. */
async function loadCompEditContext(
  target: CompAiTarget
): Promise<Loaded | { error: string }> {
  const supabase = await createClient();
  const orgId = await getActiveOrgId();

  const { data: planRow } = await supabase
    .from("comp_plans")
    .select("id, name, active, base_amount_default, config")
    .eq("id", target.planId)
    .maybeSingle();
  if (!planRow) return { error: "Plano não encontrado." };
  const atual = parseCompPlanConfig(planRow.config);
  if (!atual) return { error: "A configuração deste plano está inválida." };

  const [sources, correspondences, { data: fieldsData }, registry, canon] =
    await Promise.all([
      loadSources(supabase, orgId),
      loadCorrespondences(supabase, orgId),
      supabase
        .from("field_definitions")
        .select(
          "field_key, label, data_type, formula, applies_to, currency_code, currency_mode, allow_negative, show_as_percent"
        ),
      loadGoalMetrics(supabase),
      loadResponsibleCanon(supabase),
    ]);
  const allFields = (fieldsData ?? []) as FieldDefinition[];
  const available = buildAvailableFields(allFields, correspondences, sources);
  const aggCatalog = buildAggOperandCatalog(
    availableAggCatalogInput(available, allFields, sources, registry, {
      withNested: true,
    })
  );

  const [{ data: respRows }, { data: opRows }, { data: curRows }] =
    await Promise.all([
      supabase
        .from("responsibles")
        .select("id, display_name, canonical_id")
        .eq("active", true)
        .order("display_name"),
      supabase.from("operations").select("id, name").eq("active", true),
      supabase.from("currencies").select("code").eq("enabled", true),
    ]);

  // Nome → id CANÔNICO: apelido resolve para o principal, como em todo o resto
  // do produto (o alvo de `goals` é sempre o id canônico).
  const respByName = new Map<string, string>();
  for (const r of (respRows ?? []) as {
    id: string;
    display_name: string | null;
  }[]) {
    const nome = (r.display_name ?? "").trim();
    if (nome) respByName.set(nome.toLocaleLowerCase("pt-BR"), r.id);
  }
  const opByName = new Map<string, string>();
  for (const o of (opRows ?? []) as { id: string; name: string | null }[]) {
    const nome = (o.name ?? "").trim();
    if (nome) opByName.set(nome.toLocaleLowerCase("pt-BR"), o.id);
  }

  const labelForRef = new Map(available.map((a) => [a.field, a.label]));
  // Nomes de EXIBIÇÃO (os mapas acima são case-insensitive, para o casamento).
  const membros = ((respRows ?? []) as { display_name: string | null }[])
    .map((r) => ({ nome: (r.display_name ?? "").trim() }))
    .filter((m) => m.nome !== "");
  const operacoes = ((opRows ?? []) as { name: string | null }[])
    .map((o) => (o.name ?? "").trim())
    .filter((n) => n !== "");
  const ctx: CompEditContext = {
    planId: planRow.id as string,
    planName: (planRow.name as string) ?? "",
    planActive: planRow.active !== false,
    atualJson: JSON.stringify(atual),
    fatores: atual.factors.map((f) => ({
      nome: f.label,
      pesoPct: f.weightPct,
      formulaTexto: formulaToSource(f.formula, (r) => labelForRef.get(r) ?? r),
    })),
    comissoes: (atual.commissions ?? []).map((b) => b.label ?? b.id),
    membros,
    operacoes,
    fontes: sources.map((s) => s.key),
    campos: available.map((a) => ({ ref: a.field, label: a.label })),
    moedas: ((curRows ?? []) as { code: string }[]).map((c) => c.code),
    ano: target.ano,
    mes: target.mes,
  };
  const deps: CompEditDeps = {
    aggCatalog,
    compCatalogFor: (config) => compOperandCatalog(config),
    atual,
    newId: (prefix) => `${prefix}_${randomUUID().slice(0, 8)}`,
    memberIdByName: (name) => {
      const id = respByName.get(name.trim().toLocaleLowerCase("pt-BR"));
      return id ? canonicalOf(id, canon) : null;
    },
    operationIdByName: (name) =>
      opByName.get(name.trim().toLocaleLowerCase("pt-BR")) ?? null,
  };

  const catalogJson = JSON.stringify(
    {
      plano: ctx.planName,
      mes_do_lancamento: `${target.ano}-${String(target.mes).padStart(2, "0")}`,
      apuracao: atual.apuracao ?? "mes_corrente",
      fatores_atuais: ctx.fatores,
      comissoes_atuais: ctx.comissoes,
      membros: ctx.membros.map((m) => m.nome),
      operacoes: ctx.operacoes,
      bases: ctx.fontes,
      campos: ctx.campos,
      moedas_habilitadas: ctx.moedas,
    },
    null,
    2
  );

  return {
    ctx,
    deps,
    catalogJson,
    plan: {
      id: planRow.id as string,
      name: (planRow.name as string) ?? "",
      active: planRow.active !== false,
      baseAmountDefault: (planRow.base_amount_default as number | null) ?? null,
    },
    atual,
  };
}

function summarize(resolved: CompEditResolved): string[] {
  const out: string[] = [];
  if (resolved.value.plano) {
    for (const f of resolved.config.factors) {
      out.push(`Fator "${f.label}": peso ${f.weightPct}%`);
    }
    for (const b of resolved.config.commissions ?? []) {
      out.push(
        `Comissão "${b.label ?? b.id}": ${b.tiers.length} faixa(s), por ${
          b.tierBy === "realized" ? "realizado" : "atingimento"
        }`
      );
    }
  }
  if (resolved.targets.length > 0) {
    const limpar = resolved.targets.filter((t) => t.value == null).length;
    out.push(
      `Metas: ${resolved.targets.length - limpar} definida(s)` +
        (limpar > 0 ? `, ${limpar} removida(s)` : "")
    );
  }
  return out;
}

export async function generateCompEditCore(input: {
  target: CompAiTarget;
  description: string;
  priorTurns?: string[];
  pendingJson?: string;
}): Promise<GenerateCompState> {
  const err = await gate();
  if (err) return { ok: false, message: err };

  const orgId = await getActiveOrgId();
  const aiConfig = orgId ? await loadOrgAiConfig(orgId) : null;
  if (!aiConfig) {
    return {
      ok: false,
      message:
        "IA não configurada para a organização — um administrador define o provedor em Configurações → Integrações.",
    };
  }

  const loaded = await loadCompEditContext(input.target);
  if ("error" in loaded) return { ok: false, message: loaded.error };

  let system = buildCompPromptText({ catalogJson: loaded.catalogJson });
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

  const result = await runJsonGenerationLoop<CompEditResolved>({
    config: aiConfig,
    system,
    priorTurns: input.priorTurns ?? [],
    description: input.description.trim() || "Sugira melhorias para este plano.",
    validate: (raw) => {
      const v = validateCompEdit(raw, loaded.ctx, loaded.deps);
      if (!v.ok) return { ok: false, errors: v.errors };
      if (!v.resolved) return { ok: false, errors: ["Proposta vazia."] };
      return { ok: true, value: v.resolved };
    },
  });
  if (!result.ok) {
    return { ok: false, message: result.message, errors: result.errors };
  }
  return {
    ok: true,
    message: "Prévia pronta — revise e clique em Aplicar.",
    json: serializeCompEdit(result.value.value),
    summary: summarize(result.value),
    warnings: result.value.warnings,
  };
}

/** Valida uma resposta COLADA (fluxo de IA externa) — mesma prévia, sem IA. */
export async function previewCompEditCore(
  target: CompAiTarget,
  raw: string
): Promise<GenerateCompState> {
  const err = await gate();
  if (err) return { ok: false, message: err };
  const loaded = await loadCompEditContext(target);
  if ("error" in loaded) return { ok: false, message: loaded.error };

  const v = validateCompEdit(raw, loaded.ctx, loaded.deps);
  if (!v.ok || !v.resolved) {
    return {
      ok: false,
      message: "O JSON colado não passou na validação.",
      errors: v.ok ? ["Proposta vazia."] : v.errors,
    };
  }
  return {
    ok: true,
    message: "Prévia pronta — revise e clique em Aplicar.",
    json: serializeCompEdit(v.resolved.value),
    summary: summarize(v.resolved),
    warnings: v.resolved.warnings,
  };
}

export async function buildCompPromptCore(
  target: CompAiTarget
): Promise<{ ok: boolean; prompt?: string; message?: string }> {
  const err = await gate();
  if (err) return { ok: false, message: err };
  const loaded = await loadCompEditContext(target);
  if ("error" in loaded) return { ok: false, message: loaded.error };
  return { ok: true, prompt: buildCompPromptText({ catalogJson: loaded.catalogJson }) };
}

/**
 * Aplica a proposta. RE-VALIDA sobre o config FRESCO (outro admin pode ter
 * mexido entre a prévia e o Aplicar) e escreve só pelos choke points.
 * Resultado POR ITEM: falha parcial não desfaz o que já entrou.
 */
export async function applyCompEditCore(
  target: CompAiTarget,
  raw: string
): Promise<ApplyCompState> {
  const err = await gate();
  if (err) return { ok: false, message: err };

  const loaded = await loadCompEditContext(target);
  if ("error" in loaded) return { ok: false, message: loaded.error };

  const v = validateCompEdit(raw, loaded.ctx, loaded.deps);
  if (!v.ok || !v.resolved) {
    return {
      ok: false,
      message: "A proposta não é mais válida sobre o plano atual.",
      errors: v.ok ? ["Proposta vazia."] : v.errors,
    };
  }
  const resolved = v.resolved;

  const snapshot: CompUndoSnapshot = {
    planId: target.planId,
    ano: target.ano,
    mes: target.mes,
  };
  const errors: string[] = [];
  let applied = 0;
  // Erro por meta fala o NOME de quem falhou; um uuid no chat não ajuda.
  const nameById = new Map<string, string>();
  for (const m of loaded.ctx.membros) {
    const id = loaded.deps.memberIdByName(m.nome);
    if (id && !nameById.has(id)) nameById.set(id, m.nome);
  }

  // ---- Plano: SEMPRE por savePlan (que roda a validação compartilhada).
  if (resolved.value.plano) {
    snapshot.plan = {
      name: loaded.plan.name,
      active: loaded.plan.active,
      baseAmountDefault: loaded.plan.baseAmountDefault,
      config: loaded.atual,
    };
    const res = await savePlan({
      planId: target.planId,
      name: resolved.nome,
      active: resolved.ativo,
      baseAmountDefault: loaded.plan.baseAmountDefault,
      config: resolved.config,
    });
    if (res.ok) applied += 1;
    else {
      // Sem plano gravado, as metas de fator NOVO não teriam onde pousar.
      return {
        ok: false,
        message: res.message ?? "Falha ao salvar o plano.",
        appliedCount: 0,
      };
    }
  }

  // ---- Metas: SEMPRE por saveTarget. Ele canonicaliza o responsável e
  // desloca para o mês APURADO (apuracaoRef) — o call site fala o mês do
  // LANÇAMENTO, e chamar upsertGoalTarget cru gravaria em M-2 num plano
  // "mes_anterior".
  if (resolved.targets.length > 0) {
    const supabase = await createClient();
    // Estado ANTERIOR das células tocadas, para o Desfazer. Lido pelo mesmo
    // caminho que a grade usa (linhas de `goals` do mês apurado).
    snapshot.targets = await readPreviousTargets(supabase, target, resolved);

    for (const t of resolved.targets) {
      const res = await saveTarget(
        {
          planId: target.planId,
          responsibleId: t.responsibleId,
          year: target.ano,
          month: target.mes,
          factorId: t.factorId,
          value: t.value,
        },
        { revalidate: false }
      );
      if (res.ok) applied += 1;
      else
        errors.push(
          `Meta de ${nameById.get(t.responsibleId) ?? t.responsibleId}: ${
            res.message ?? "falha."
          }`
        );
    }
  }

  if (applied === 0) {
    return { ok: false, message: "Nada foi aplicado.", appliedCount: 0, errors };
  }
  return {
    ok: true,
    message:
      errors.length > 0
        ? `${applied} item(ns) aplicado(s); ${errors.length} falhou(ram).`
        : `${applied} item(ns) aplicado(s).`,
    appliedCount: applied,
    snapshot,
    ...(errors.length > 0 ? { errors } : {}),
  };
}

/** Lê o valor ANTERIOR das metas tocadas (null = a linha não existia). */
async function readPreviousTargets(
  supabase: Awaited<ReturnType<typeof createClient>>,
  target: CompAiTarget,
  resolved: CompEditResolved
): Promise<CompUndoSnapshot["targets"]> {
  const { loadTargetsByMember } = await import("@/lib/comp/engine");
  const { loadResponsibleCanon } = await import(
    "@/lib/config/responsible-canon"
  );
  const memberIds = [...new Set(resolved.targets.map((t) => t.responsibleId))];
  const canon = await loadResponsibleCanon(supabase);
  // Mês do LANÇAMENTO: o deslocamento da apuração vive DENTRO do loader
  // (mesma regra do saveTarget) — deslocar aqui leria M-2.
  const byMember = await loadTargetsByMember(supabase, {
    year: target.ano,
    month: target.mes,
    config: resolved.config,
    memberIds,
    canon,
  });
  return resolved.targets.map((t) => ({
    responsibleId: t.responsibleId,
    factorId: t.factorId,
    previous: byMember.get(t.responsibleId)?.[t.factorId] ?? null,
  }));
}

/** Desfazer: restaura pelos MESMOS choke points, nunca por update direto. */
export async function restoreCompSnapshotCore(
  snapshot: CompUndoSnapshot
): Promise<{ ok: boolean; message?: string }> {
  const err = await gate();
  if (err) return { ok: false, message: err };

  if (snapshot.plan) {
    const res = await savePlan({
      planId: snapshot.planId,
      name: snapshot.plan.name,
      active: snapshot.plan.active,
      baseAmountDefault: snapshot.plan.baseAmountDefault,
      config: snapshot.plan.config,
    });
    if (!res.ok) {
      return {
        ok: false,
        message:
          res.message ??
          "Não foi possível restaurar o plano (ele pode ter sido excluído).",
      };
    }
  }
  for (const t of snapshot.targets ?? []) {
    // `previous: null` = a meta não existia ⇒ value null a EXCLUI (nunca 0).
    await saveTarget(
      {
        planId: snapshot.planId,
        responsibleId: t.responsibleId,
        year: snapshot.ano,
        month: snapshot.mes,
        factorId: t.factorId,
        value: t.previous,
      },
      { revalidate: false }
    );
  }
  return {
    ok: true,
    message: "Estado anterior restaurado. A métrica de meta de um fator novo, se houve, continua no catálogo.",
  };
}
