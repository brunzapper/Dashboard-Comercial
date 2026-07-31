// Versão: 1.2 | Data: 31/07/2026
// v1.2: membros por operação — savePlan valida a existência dos ids de
// config.memberOperationIds (RLS recorta a org); a resolução de membros
// segue nos callers (engine/page), nunca aqui.
// Server Actions da tela de Remuneração (0112). Escrita SEMPRE admin (guard +
// RLS); leitura do vendedor é da page (RLS entrega só o próprio grupo).
// v1.1: comissão por faixas — bounds das faixas no savePlan, override
// overrides.commission no patch de célula e responsible_id como memberId nos
// computeEntry (tabela do membro vence a do plano).
// - savePlan valida cada fator pelo MESMO caminho do servidor de fórmulas
//   (buildAggOperandCatalog + validateFormulaForContext kind "aggregate" +
//   validateFkCondNames) e a fórmula LIVRE de total com kind "record" sobre o
//   catálogo comp:* (compOperandCatalog — módulo único, nunca lista paralela);
//   metricKey vazio ganha chave automática registrada no registry goal_metrics.
// - saveTarget grava o alvo como LINHA de goals (scope responsible, id
//   CANÔNICO) via lib/metas/upsert.ts — célula limpa EXCLUI a meta (nunca
//   target=0) — e re-deriva o total efetivo da entry.
// - saveEntryInputs edita overrides/bônus/base (efetivo = manual ?? calculado;
//   limpar = deletar a chave) e re-deriva o total SEM re-consultar.
// - recomputeMonth delega ao engine (runCalculatedWidget por membro×fator).
// - publishMonth materializa o espelho SÓ por createRecord/updateRecord
//   (invariante 25), dedup por mirror_record_id.
"use server";

import { revalidatePath } from "next/cache";

import { getSessionInfo } from "@/lib/auth/session";
import { isSettingsAreaDenied } from "@/lib/auth/access";
import { getActiveOrgId } from "@/lib/auth/org";
import { createClient } from "@/lib/supabase/server";
import { loadSources } from "@/lib/config/sources";
import { loadCorrespondences } from "@/lib/correspondences";
import {
  canonicalOf,
  loadResponsibleCanon,
} from "@/lib/config/responsible-canon";
import {
  createRecord,
  updateRecord,
} from "@/lib/records/actions";
import { validateFormulaForContext } from "@/lib/records/formula-validate";
import { validateFkCondNames } from "@/lib/records/formula-server";
import { formulaUsesCondAgg } from "@/lib/records/formulas";
import type { FieldDefinition } from "@/lib/records/types";
import { goalMetricKeyFromLabel } from "@/lib/metas/metrics";
import {
  deleteGoalTarget,
  registerGoalMetrics,
  upsertGoalTarget,
} from "@/lib/metas/upsert";
import { loadGoalMetrics } from "@/lib/config/goal-metrics";
import {
  availableAggCatalogInput,
  buildAggOperandCatalog,
} from "@/lib/widgets/agg-catalog";
import { buildAvailableFields } from "@/lib/widgets/fields";
import { withRpcTtlCache } from "@/lib/widgets/rpc-cache";
import { withRpcMemo } from "@/lib/widgets/rpc-memo";
import {
  loadTargetsByMember,
  recomputePlanMonth,
  type CompEntryRow,
  type CompPlanRow,
  type RecomputeResult,
} from "@/lib/comp/engine";
import {
  compOperandCatalog,
  computeEntry,
  lastDayOfMonth,
  parseCompEntryInputs,
  parseCompPlanConfig,
  type CompComputedRaw,
  type CompEntryInputs,
  type CompPlanConfig,
} from "@/lib/comp/model";
import { ensureMirrorSource, mirrorFormValues } from "@/lib/comp/mirror";

export interface CompActionState {
  ok?: boolean;
  message?: string;
  planId?: string;
}

// Sanidade dos valores digitados (overrides/bônus/base/alvo).
const MAX_ABS_VALUE = 1e12;

async function ensureAdmin(): Promise<string | null> {
  const s = await getSessionInfo();
  if (!s) return "Sessão expirada.";
  if (!s.roles.includes("admin")) return "Apenas administradores.";
  if (await isSettingsAreaDenied("remuneracao"))
    return "Acesso a esta área foi bloqueado.";
  return null;
}

function cleanNumber(v: unknown): number | null {
  if (typeof v !== "number" || !Number.isFinite(v)) return null;
  if (Math.abs(v) >= MAX_ABS_VALUE) return null;
  return v;
}

function periodOk(year: number, month: number): boolean {
  return (
    Number.isInteger(year) &&
    year >= 2000 &&
    year <= 2100 &&
    Number.isInteger(month) &&
    month >= 1 &&
    month <= 12
  );
}

// ===================== Plano =====================

export interface SavePlanInput {
  planId?: string | null;
  name: string;
  active: boolean;
  baseAmountDefault: number | null;
  // CompPlanConfig cru (o cliente monta; o servidor re-parseia fail-closed).
  config: unknown;
}

export async function savePlan(input: SavePlanInput): Promise<CompActionState> {
  const err = await ensureAdmin();
  if (err) return { ok: false, message: err };
  const name = String(input.name ?? "").trim();
  if (!name) return { ok: false, message: "Informe o nome do plano." };

  const config = parseCompPlanConfig(input.config);
  if (!config) return { ok: false, message: "Configuração do plano inválida." };
  if (config.factors.length === 0)
    return { ok: false, message: "Adicione ao menos um fator." };

  // Rótulos únicos (case-insensitive): o FormulaEditor referencia operandos por
  // rótulo — duplicata quebraria o round-trip da fórmula livre.
  const labels = new Set<string>();
  for (const f of config.factors) {
    const k = f.label.toLocaleLowerCase("pt-BR");
    if (labels.has(k))
      return {
        ok: false,
        message: `Dois fatores com o mesmo nome ("${f.label}") — renomeie um.`,
      };
    labels.add(k);
    if (f.weightPct < 0 || f.weightPct > 1000)
      return { ok: false, message: `Peso inválido no fator "${f.label}".` };
  }

  // Faixas de comissão: bounds amigáveis pós-parse (estrutura/ordenação/refs
  // já são muralha do parse fail-closed — espelho do check de peso acima).
  if (config.commission) {
    const tables = [
      config.commission.tiers,
      ...Object.values(config.commission.memberTiers ?? {}),
    ];
    for (const table of tables) {
      for (const t of table) {
        if (t.ratePct > 1000 || t.fromPct > 100000)
          return {
            ok: false,
            message: "Faixa de comissão inválida (percentual acima do limite).",
          };
      }
    }
  }

  const supabase = await createClient();
  const orgId = await getActiveOrgId();

  // Operações vinculadas ao plano devem existir (RLS recorta a org — id de
  // outra org conta como "não encontrada"); mensagem acionável em vez do
  // silêncio de uma operação fantasma contribuindo zero membros.
  if (config.memberOperationIds?.length) {
    const { data: opRows } = await supabase
      .from("operations")
      .select("id")
      .in("id", config.memberOperationIds);
    const found = new Set(((opRows ?? []) as { id: string }[]).map((o) => o.id));
    if (config.memberOperationIds.some((id) => !found.has(id)))
      return {
        ok: false,
        message:
          "Operação vinculada ao plano não encontrada (removida?) — reabra o seletor de operações e salve novamente.",
      };
  }

  const [sources, correspondences, { data: fieldsData }, registry] =
    await Promise.all([
      loadSources(supabase, orgId),
      loadCorrespondences(supabase, orgId),
      supabase
        .from("field_definitions")
        .select(
          "field_key, label, data_type, formula, applies_to, currency_code, currency_mode, allow_negative, show_as_percent"
        ),
      loadGoalMetrics(supabase),
    ]);
  const allFields = (fieldsData ?? []) as FieldDefinition[];
  const available = buildAvailableFields(allFields, correspondences, sources);
  const sourceKeys = new Set(sources.map((s) => s.key));

  // Fórmula do realizado: MESMO catálogo/validação do servidor de fórmulas
  // agregadas (nunca montar catálogo paralelo).
  const aggCatalog = buildAggOperandCatalog(
    availableAggCatalogInput(available, allFields, sources, { withNested: true })
  );
  for (const f of config.factors) {
    for (const s of f.sources) {
      if (!sourceKeys.has(s))
        return {
          ok: false,
          message: `Fonte desconhecida ("${s}") no fator "${f.label}".`,
        };
    }
    const v = validateFormulaForContext(f.formula, {
      kind: "aggregate",
      catalog: aggCatalog,
      sources,
    });
    if (!v.ok)
      return {
        ok: false,
        message: `Fórmula do fator "${f.label}": ${v.error ?? "inválida."}`,
      };
    const fk = await validateFkCondNames(supabase, f.formula);
    if (!fk.ok)
      return { ok: false, message: `Fórmula do fator "${f.label}": ${fk.message}` };
  }

  // Chave de métrica de meta: vazia ⇒ automática a partir do rótulo (sufixo em
  // colisão com o registry OU com outro fator do próprio plano).
  const usedKeys = new Set(registry.map((m) => m.key));
  for (const f of config.factors) {
    if (f.metricKey !== "__auto__") {
      usedKeys.add(f.metricKey);
      continue;
    }
    const base = `comp_${goalMetricKeyFromLabel(f.label) || "fator"}`.slice(0, 40);
    let candidate = base;
    for (let n = 2; usedKeys.has(candidate) && n <= 20; n++) {
      const suffix = `_${n}`;
      candidate = `${base.slice(0, 40 - suffix.length)}${suffix}`;
    }
    if (usedKeys.has(candidate))
      return { ok: false, message: `Não foi possível gerar a chave de meta do fator "${f.label}".` };
    f.metricKey = candidate;
    usedKeys.add(candidate);
  }

  // Fórmula LIVRE de total: catálogo comp:* derivado do config (aparece/some
  // em sincronia com os fatores) — kind "record" (variáveis escalares; nada de
  // agg:/SOMASE aqui — as variáveis JÁ são totais).
  if (config.totalFormula) {
    if (formulaUsesCondAgg(config.totalFormula))
      return {
        ok: false,
        message:
          "SOMASE/CONTASE não funcionam na fórmula do total — as variáveis já são totais; condicione com SE(...).",
      };
    const v = validateFormulaForContext(config.totalFormula, {
      kind: "record",
      catalog: compOperandCatalog(config),
    });
    if (!v.ok)
      return {
        ok: false,
        message: `Fórmula do total: ${v.error ?? "inválida."}`,
      };
  }

  // Registra as chaves novas no registry (rótulo "Plano — Fator"; existentes
  // são puladas — nunca sobrescreve métrica em uso).
  const { error: regError } = await registerGoalMetrics(
    supabase,
    orgId,
    config.factors.map((f) => ({
      key: f.metricKey,
      label: `${name} — ${f.label}`.slice(0, 60),
      money: f.money,
    }))
  );
  if (regError) return { ok: false, message: regError };

  const row = {
    name,
    active: input.active !== false,
    base_amount_default: cleanNumber(input.baseAmountDefault),
    config,
    ...(orgId ? { organization_id: orgId } : {}),
  };
  if (input.planId) {
    const { error } = await supabase
      .from("comp_plans")
      .update({
        name: row.name,
        active: row.active,
        base_amount_default: row.base_amount_default,
        config,
      })
      .eq("id", input.planId);
    if (error) return { ok: false, message: error.message };
    revalidatePath("/configuracoes/remuneracao");
    return { ok: true, message: "Plano salvo.", planId: input.planId };
  }
  const { data: inserted, error } = await supabase
    .from("comp_plans")
    .insert(row)
    .select("id")
    .maybeSingle();
  if (error) return { ok: false, message: error.message };
  revalidatePath("/configuracoes/remuneracao");
  return {
    ok: true,
    message: "Plano criado.",
    planId: (inserted?.id as string | undefined) ?? undefined,
  };
}

export async function deletePlan(planId: string): Promise<CompActionState> {
  const err = await ensureAdmin();
  if (err) return { ok: false, message: err };
  const supabase = await createClient();
  // Cascade apaga as entries; registros já PUBLICADOS ficam na Base espelho
  // (histórico — o dialog do cliente avisa; limpeza manual em /registros).
  const { error } = await supabase.from("comp_plans").delete().eq("id", planId);
  if (error) return { ok: false, message: error.message };
  revalidatePath("/configuracoes/remuneracao");
  return { ok: true, message: "Plano excluído." };
}

// ===================== Célula: alvo (linha de goals) =====================

export async function saveTarget(input: {
  planId: string;
  responsibleId: string;
  year: number;
  month: number;
  factorId: string;
  value: number | null;
}): Promise<CompActionState> {
  const err = await ensureAdmin();
  if (err) return { ok: false, message: err };
  if (!periodOk(input.year, input.month))
    return { ok: false, message: "Período inválido." };
  const supabase = await createClient();
  const orgId = await getActiveOrgId();
  const { plan, config, message } = await loadPlanConfig(supabase, input.planId);
  if (!plan || !config) return { ok: false, message };
  const factor = config.factors.find((f) => f.id === input.factorId);
  if (!factor) return { ok: false, message: "Fator desconhecido." };

  // Sempre no id CANÔNICO (as linhas da grade já são canônicas — cinto extra).
  const canon = await loadResponsibleCanon(supabase);
  const responsibleId = canonicalOf(input.responsibleId, canon);
  const key = {
    year: input.year,
    month: input.month,
    scope: "responsible",
    responsibleId,
    metric: factor.metricKey,
  };
  const value = cleanNumber(input.value);
  const gErr =
    value == null
      ? await deleteGoalTarget(supabase, key)
      : await upsertGoalTarget(supabase, orgId, key, value);
  if (gErr) return { ok: false, message: gErr };

  // Total efetivo da entry depende do alvo — re-deriva sem re-consultar RPC.
  const totalErr = await rederiveEntryTotal(supabase, orgId, {
    plan,
    config,
    responsibleId,
    year: input.year,
    month: input.month,
  });
  if (totalErr) return { ok: false, message: totalErr };
  revalidatePath("/configuracoes/remuneracao");
  revalidatePath("/configuracoes/metas");
  return { ok: true };
}

// ===================== Célula: overrides/bônus/base =====================

export interface EntryPatch {
  // undefined = não mexe; null = limpa (volta ao calculado/default).
  baseAmount?: number | null;
  overrides?: {
    factors?: Record<
      string,
      {
        realized?: number | null;
        attainmentPct?: number | null;
        payout?: number | null;
      }
    >;
    commission?: number | null;
    total?: number | null;
  };
  bonuses?: { id: string; label: string; amount: number }[];
  note?: string | null;
}

export async function saveEntryInputs(input: {
  planId: string;
  responsibleId: string;
  year: number;
  month: number;
  patch: EntryPatch;
}): Promise<CompActionState> {
  const err = await ensureAdmin();
  if (err) return { ok: false, message: err };
  if (!periodOk(input.year, input.month))
    return { ok: false, message: "Período inválido." };
  const supabase = await createClient();
  const orgId = await getActiveOrgId();
  const { plan, config, message } = await loadPlanConfig(supabase, input.planId);
  if (!plan || !config) return { ok: false, message };
  const canon = await loadResponsibleCanon(supabase);
  const responsibleId = canonicalOf(input.responsibleId, canon);

  const { data: entryData } = await supabase
    .from("comp_entries")
    .select("id, responsible_id, base_amount, inputs, computed, total")
    .eq("plan_id", input.planId)
    .eq("period_year", input.year)
    .eq("period_month", input.month)
    .eq("responsible_id", responsibleId)
    .maybeSingle();
  const entry = entryData as CompEntryRow | null;

  const inputs = parseCompEntryInputs(entry?.inputs);
  const patch = input.patch ?? {};
  applyEntryPatch(inputs, config, patch);

  let baseAmount = entry?.base_amount ?? null;
  if ("baseAmount" in patch) baseAmount = cleanNumber(patch.baseAmount);

  const total = await deriveTotal(supabase, {
    plan,
    config,
    responsibleId,
    year: input.year,
    month: input.month,
    inputs,
    baseAmount,
    computed: entry?.computed,
  });

  const { error } = entry
    ? await supabase
        .from("comp_entries")
        .update({ inputs, base_amount: baseAmount, total })
        .eq("id", entry.id)
    : await supabase.from("comp_entries").insert({
        plan_id: input.planId,
        responsible_id: responsibleId,
        period_year: input.year,
        period_month: input.month,
        inputs,
        base_amount: baseAmount,
        total,
        ...(orgId ? { organization_id: orgId } : {}),
      });
  if (error) return { ok: false, message: error.message };
  revalidatePath("/configuracoes/remuneracao");
  return { ok: true };
}

// Aplica o patch sobre os inputs parseados: número saneado entra; null deleta
// a chave (volta ao calculado); undefined não mexe.
function applyEntryPatch(
  inputs: CompEntryInputs,
  config: CompPlanConfig,
  patch: EntryPatch
): void {
  const factorIds = new Set(config.factors.map((f) => f.id));
  const ovPatch = patch.overrides ?? {};
  for (const [fid, o] of Object.entries(ovPatch.factors ?? {})) {
    if (!factorIds.has(fid)) continue;
    const target = inputs.overrides.factors[fid] ?? {};
    for (const k of ["realized", "attainmentPct", "payout"] as const) {
      if (!(k in o)) continue;
      const v = cleanNumber(o[k]);
      if (v == null) delete target[k];
      else target[k] = v;
    }
    if (Object.keys(target).length === 0) delete inputs.overrides.factors[fid];
    else inputs.overrides.factors[fid] = target;
  }
  if (ovPatch && "commission" in ovPatch) {
    const v = cleanNumber(ovPatch.commission);
    if (v == null) delete inputs.overrides.commission;
    else inputs.overrides.commission = v;
  }
  if (ovPatch && "total" in ovPatch) {
    const v = cleanNumber(ovPatch.total);
    if (v == null) delete inputs.overrides.total;
    else inputs.overrides.total = v;
  }
  if (patch.bonuses) {
    inputs.bonuses = patch.bonuses
      .filter(
        (b) =>
          typeof b.id === "string" &&
          b.id !== "" &&
          typeof b.label === "string" &&
          cleanNumber(b.amount) != null
      )
      .slice(0, 20)
      .map((b) => ({ id: b.id, label: b.label.slice(0, 120), amount: b.amount }));
  }
  if ("note" in patch) {
    const note = typeof patch.note === "string" ? patch.note.trim() : "";
    if (note) inputs.note = note.slice(0, 2000);
    else delete inputs.note;
  }
}

// ===================== Recalcular / Publicar =====================

export async function recomputeMonth(
  planId: string,
  year: number,
  month: number
): Promise<RecomputeResult> {
  const err = await ensureAdmin();
  if (err) return { ok: false, message: err };
  if (!periodOk(year, month)) return { ok: false, message: "Período inválido." };
  const session = await getSessionInfo();
  if (!session) return { ok: false, message: "Sessão expirada." };
  const supabase = await createClient();
  const orgId = await getActiveOrgId();
  const { plan, message } = await loadPlanConfig(supabase, planId);
  if (!plan) return { ok: false, message };
  // Mesmas duas camadas dos widgets deferidos: memo por lote + cache TTL por
  // usuário (RPC SECURITY INVOKER).
  const rpcClient = withRpcMemo(withRpcTtlCache(supabase, `u:${session.user.id}`));
  const result = await recomputePlanMonth(supabase, rpcClient, {
    plan,
    year,
    month,
    orgId,
  });
  if (result.ok) revalidatePath("/configuracoes/remuneracao");
  return result;
}

export async function publishMonth(
  planId: string,
  year: number,
  month: number
): Promise<CompActionState> {
  const err = await ensureAdmin();
  if (err) return { ok: false, message: err };
  if (!periodOk(year, month)) return { ok: false, message: "Período inválido." };
  const supabase = await createClient();
  const orgId = await getActiveOrgId();
  const { plan, config, message } = await loadPlanConfig(supabase, planId);
  if (!plan || !config) return { ok: false, message };

  const mirror = await ensureMirrorSource(supabase, orgId);
  if (!mirror.ok || !mirror.sourceKey)
    return { ok: false, message: mirror.message ?? "Falha ao preparar a base." };

  const [{ data: entriesData }, { data: respData }, canon] = await Promise.all([
    supabase
      .from("comp_entries")
      .select(
        "id, responsible_id, base_amount, inputs, computed, total, mirror_record_id, published_at"
      )
      .eq("plan_id", planId)
      .eq("period_year", year)
      .eq("period_month", month),
    supabase.from("responsibles").select("id, display_name"),
    loadResponsibleCanon(supabase),
  ]);
  const entries = (entriesData ?? []) as CompEntryRow[];
  const nameById = new Map(
    ((respData ?? []) as { id: string; display_name: string | null }[]).map(
      (r) => [r.id, r.display_name ?? "—"]
    )
  );
  const targetsByMember = await loadTargetsByMember(supabase, {
    year,
    month,
    config,
    memberIds: entries.map((e) => e.responsible_id),
    canon,
  });

  let published = 0;
  let skipped = 0;
  const nowIso = new Date().toISOString();
  for (const entry of entries) {
    const computed = entry.computed as CompComputedRaw | null;
    if (!computed || typeof computed !== "object") {
      skipped += 1;
      continue;
    }
    const inputs = parseCompEntryInputs(entry.inputs);
    const breakdown = computeEntry(
      config,
      entry.base_amount ?? plan.base_amount_default,
      inputs,
      computed.realized ?? {},
      targetsByMember.get(entry.responsible_id) ?? {},
      entry.responsible_id
    );
    if (breakdown.total == null) {
      skipped += 1; // fórmula livre inválida — corrija antes de publicar
      continue;
    }
    const values = mirrorFormValues({
      config,
      breakdown,
      planName: plan.name,
      memberName: nameById.get(entry.responsible_id) ?? "—",
      responsibleId: entry.responsible_id,
      year,
      month,
      lastDay: lastDayOfMonth(year, month),
    });

    // Registro apagado à mão ⇒ FK on delete set null limpou mirror_record_id
    // — recria; senão atualiza in-place (dedup).
    if (entry.mirror_record_id) {
      const fd = new FormData();
      fd.set("record_id", entry.mirror_record_id);
      fd.set("no_revalidate", "1");
      for (const [k, v] of Object.entries(values)) fd.set(k, v);
      const res = await updateRecord({}, fd);
      if (!res.ok)
        return {
          ok: false,
          message: `Falha ao republicar ${values.core__title}: ${res.message}`,
        };
      const { error } = await supabase
        .from("comp_entries")
        .update({ published_at: nowIso })
        .eq("id", entry.id);
      if (error) return { ok: false, message: error.message };
    } else {
      const fd = new FormData();
      fd.set("source", mirror.sourceKey);
      for (const [k, v] of Object.entries(values)) fd.set(k, v);
      const res = await createRecord({}, fd);
      if (!res.ok || !res.id)
        return {
          ok: false,
          message: `Falha ao publicar ${values.core__title}: ${res.message ?? "erro"}`,
        };
      const { error } = await supabase
        .from("comp_entries")
        .update({ mirror_record_id: res.id, published_at: nowIso })
        .eq("id", entry.id);
      if (error) return { ok: false, message: error.message };
    }
    published += 1;
  }

  // Base nova entra em todos os catálogos (pickers/builder) — revalida geral.
  if (mirror.created) revalidatePath("/", "layout");
  else revalidatePath("/configuracoes/remuneracao");
  return {
    ok: true,
    message:
      `${published} registro(s) publicado(s) na base "Remuneração"` +
      (skipped > 0 ? ` — ${skipped} linha(s) sem cálculo pulada(s) (recalcule).` : "."),
  };
}

// ===================== Helpers =====================

async function loadPlanConfig(
  supabase: Awaited<ReturnType<typeof createClient>>,
  planId: string
): Promise<{
  plan: CompPlanRow | null;
  config: CompPlanConfig | null;
  message?: string;
}> {
  const { data, error } = await supabase
    .from("comp_plans")
    .select("id, name, active, base_amount_default, config")
    .eq("id", planId)
    .maybeSingle();
  if (error) return { plan: null, config: null, message: error.message };
  if (!data) return { plan: null, config: null, message: "Plano não encontrado." };
  const plan = data as CompPlanRow;
  const config = parseCompPlanConfig(plan.config);
  if (!config)
    return {
      plan,
      config: null,
      message: "Configuração do plano inválida — reabra e salve o plano.",
    };
  return { plan, config };
}

// Total efetivo derivado (computeEntry) com os alvos atuais de goals — usado
// pelos saves de célula (nunca re-consulta RPC; realized vem do snapshot).
async function deriveTotal(
  supabase: Awaited<ReturnType<typeof createClient>>,
  opts: {
    plan: CompPlanRow;
    config: CompPlanConfig;
    responsibleId: string;
    year: number;
    month: number;
    inputs: CompEntryInputs;
    baseAmount: number | null;
    computed: unknown;
  }
): Promise<number | null> {
  const canon = await loadResponsibleCanon(supabase);
  const targets = await loadTargetsByMember(supabase, {
    year: opts.year,
    month: opts.month,
    config: opts.config,
    memberIds: [opts.responsibleId],
    canon,
  });
  const computed = (opts.computed ?? null) as CompComputedRaw | null;
  const breakdown = computeEntry(
    opts.config,
    opts.baseAmount ?? opts.plan.base_amount_default,
    opts.inputs,
    computed?.realized ?? {},
    targets.get(opts.responsibleId) ?? {},
    opts.responsibleId
  );
  return breakdown.total;
}

async function rederiveEntryTotal(
  supabase: Awaited<ReturnType<typeof createClient>>,
  orgId: string | null,
  opts: {
    plan: CompPlanRow;
    config: CompPlanConfig;
    responsibleId: string;
    year: number;
    month: number;
  }
): Promise<string | null> {
  const { data } = await supabase
    .from("comp_entries")
    .select("id, responsible_id, base_amount, inputs, computed, total")
    .eq("plan_id", opts.plan.id)
    .eq("period_year", opts.year)
    .eq("period_month", opts.month)
    .eq("responsible_id", opts.responsibleId)
    .maybeSingle();
  const entry = data as CompEntryRow | null;
  if (!entry) return null; // sem entry ainda — o total nasce no 1º save/recompute
  const total = await deriveTotal(supabase, {
    plan: opts.plan,
    config: opts.config,
    responsibleId: opts.responsibleId,
    year: opts.year,
    month: opts.month,
    inputs: parseCompEntryInputs(entry.inputs),
    baseAmount: entry.base_amount,
    computed: entry.computed,
  });
  const { error } = await supabase
    .from("comp_entries")
    .update({ total })
    .eq("id", entry.id);
  return error ? error.message : null;
}
