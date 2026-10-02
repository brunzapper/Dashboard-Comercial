// Versão: 1.3 | Data: 02/10/2026
// v1.3 (02/10/2026): `runGoalTable`/`saveGoalCell` SAÍRAM — a Tabela de metas
//   virou Tabela Livre com colunas de meta (quick-table-actions:
//   `runQuickTable` + `saveQuickTableGoal`). Ficam os valores dos nós de
//   indicador da Tree.
// v1.2 (02/10/2026): Tree — (a) nó de indicador é pedido POR NÓ: o servidor
//   lê o payload no banco (indicador, responsável e a FONTE DO REALIZADO —
//   métrica própria, recortes, quebra) e nunca aceita fórmula do navegador;
//   (b) a série devolve o texto da fórmula do catálogo (o editor do nó explica
//   de onde vem o realizado) e a quebra por dimensão; (c)
//   `saveTreeIndicatorGoal` grava a meta do mês pelo próprio nó (mesmos
//   upsert/delete da tabela; admin).
// v1.1 (01/10/2026): `loadTreeIndicatorValues` respeita os meses FIXOS da
//   Tree (`settings.tree.months`, saneados por `cleanMonthKeys`).
// Server Actions da TABELA DE METAS (visual_type 'metas', 0149) e dos valores
// de indicador da Tree.
//
// Escopo SEMPRE pelo widget-scope (invariante 12): o período efetivo da aba e
// do card sai de `loadWidgetScope`, nunca remontado aqui. Os valores saem do
// dono único `resolveIndicatorValues` (lib/indicators/values.ts) — meta por
// `resolveGoal`, realizado por `runCalculatedWidget`; RPCs intocadas.
//
// Edição de célula: SÓ por `upsertGoalTarget`/`deleteGoalTarget`
// (lib/metas/upsert.ts — a dança find-then-update única). Célula vazia EXCLUI
// a meta (nunca target = 0). Gate = admin (a RLS de goals já exige) + o widget
// ter `editable` ligado.
"use server";

import { getActiveOrgId } from "@/lib/auth/org";
import { getSessionInfo } from "@/lib/auth/session";
import { todayBrasiliaIso } from "@/lib/date/today";
import { createClient } from "@/lib/supabase/server";
import { loadGoalMetrics } from "@/lib/config/goal-metrics";
import {
  loadResponsibleNameIndex,
  responsibleIdForName,
} from "@/lib/config/responsible-names";
import { indicatorsByKey, loadIndicators } from "@/lib/indicators/load";
import {
  cleanMonthKeys,
  monthsOfRange,
  parseMonthKey,
  type IndicatorRollup,
  type IndicatorUnit,
} from "@/lib/indicators/model";
import {
  resolveIndicatorValues,
  type IndicatorCell,
} from "@/lib/indicators/values";
import { deleteGoalTarget, upsertGoalTarget } from "@/lib/metas/upsert";
import { withRpcMemo } from "@/lib/widgets/rpc-memo";
import { normalizeMapKey } from "@/lib/tree/model";
import { parseIndicatorPayload } from "@/lib/tree/payload";
import type { RealizedSource } from "@/lib/indicators/realized-source";
import type { IndicatorBreakdownRow } from "@/lib/indicators/values";
import { withRpcTtlCache } from "@/lib/widgets/rpc-cache";
import { loadWidgetScope } from "@/lib/widgets/widget-scope";

// ============================================================================
// Valores dos nós de INDICADOR da Tree (0149). Mesmo escopo (widget-scope) e
// mesmo dono dos números (resolveIndicatorValues) da Tabela de metas — a Tree
// não tem caminho próprio de consulta.
// ============================================================================

export interface TreeIndicatorSeries {
  key: string;
  /** v1.2: id lógico do nó (`note:<uuid>`) — pedido por nó. */
  nodeId?: string;
  responsible: string | null;
  label: string;
  unit: IndicatorUnit;
  rollup: IndicatorRollup;
  direction: "maior_melhor" | "menor_melhor";
  hasRealized: boolean;
  /** v1.2: o realizado é uma métrica PRÓPRIA do nó (não a do catálogo). */
  ownRealized?: boolean;
  /** v1.2: a fórmula do realizado do catálogo, por extenso (explicação). */
  formulaText?: string | null;
  responsibleMissing: boolean;
  cells: IndicatorCell[];
  total: { target: number | null; realized: number | null; attainment: number | null };
  /** v1.2: quebra do realizado por dimensão (quando o nó a pede). */
  breakdown?: IndicatorBreakdownRow[];
  errors?: Record<string, string>;
}

export interface TreeIndicatorValues {
  ok: boolean;
  message?: string;
  months: string[];
  series: TreeIndicatorSeries[];
}

const MAX_TREE_INDICATOR_REQUESTS = 60;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** v1.2: o uuid de um id lógico de nó próprio (`note:<uuid>`). */
function ownNodeUuid(nodeId: unknown): string | null {
  if (typeof nodeId !== "string" || !nodeId.startsWith("note:")) return null;
  const id = nodeId.slice(5);
  return UUID_RE.test(id) ? id : null;
}

export async function loadTreeIndicatorValues(
  dashboardId: string,
  widgetId: string,
  requests: { key: string; responsible: string | null; nodeId?: string }[],
  search: string
): Promise<TreeIndicatorValues> {
  const empty: TreeIndicatorValues = { ok: false, months: [], series: [] };
  const session = await getSessionInfo();
  if (!session) return { ...empty, message: "Sessão expirada." };
  const supabase = await createClient();
  const scoped = await loadWidgetScope(supabase, session, dashboardId, widgetId, search);
  if (!scoped.ok) return { ...empty, message: scoped.message };
  if (scoped.scope.widget.visual_type !== "tree")
    return { ...empty, message: "Widget não encontrado." };
  const { period } = scoped.scope;
  const orgId = await getActiveOrgId();
  const tree = scoped.scope.widget.settings?.tree;
  const mapKey = tree?.source === "livre" ? normalizeMapKey(tree.mapKey) : null;
  const list = (Array.isArray(requests) ? requests : []).slice(0, MAX_TREE_INDICATOR_REQUESTS);

  // v1.2: os nós pedidos são lidos NO BANCO (RLS do usuário, mesmo mapa do
  // widget) — indicador, responsável e a fonte do realizado saem dali.
  const nodeUuids = [...new Set(list.map((r) => ownNodeUuid(r?.nodeId)).filter(Boolean))] as string[];
  const payloadById = new Map<string, ReturnType<typeof parseIndicatorPayload>>();
  if (nodeUuids.length > 0 && mapKey) {
    const { data: rows } = await supabase
      .from("tree_nodes")
      .select("id, payload")
      .eq("scope_kind", "livre")
      .eq("scope_id", mapKey)
      .eq("kind", "indicator")
      .in("id", nodeUuids);
    for (const r of (rows ?? []) as { id: string; payload: unknown }[]) {
      payloadById.set(`note:${r.id}`, parseIndicatorPayload(r.payload));
    }
  }

  const [registry, indicators, names] = await Promise.all([
    loadGoalMetrics(supabase),
    loadIndicators(supabase, orgId),
    loadResponsibleNameIndex(supabase),
  ]);
  const known = new Set(registry.map((m) => m.key));
  const byKey = indicatorsByKey(indicators);
  const wanted = list
    .map((r) => {
      let key = typeof r?.key === "string" ? r.key : "";
      let responsibleRaw: string | null = typeof r?.responsible === "string" ? r.responsible : null;
      let realized: RealizedSource | null = null;
      let nodeId: string | undefined;
      if (r?.nodeId) {
        const p = payloadById.get(r.nodeId);
        if (!p) return null;
        nodeId = r.nodeId;
        key = p.indicator ?? "";
        responsibleRaw = p.responsible ?? null;
        realized = p.realized ?? null;
      }
      if (key && !known.has(key)) return null;
      if (!key && !realized?.override) return null;
      const responsible = responsibleRaw?.trim() || null;
      const responsibleId = responsible ? responsibleIdForName(names, responsible) : null;
      return {
        key,
        nodeId,
        realized,
        responsible,
        responsibleId,
        missing: Boolean(responsible) && !responsibleId,
      };
    })
    .filter((w): w is NonNullable<typeof w> => w != null);
  const today = todayBrasiliaIso();
  // v1.1: meses fixos da Tree vencem o período do painel.
  const fixedMonths = cleanMonthKeys(tree?.months);
  const months =
    fixedMonths.length > 0
      ? fixedMonths
      : monthsOfRange(period?.from ?? null, period?.to ?? null, today);
  const rpcClient = withRpcMemo(withRpcTtlCache(supabase, `u:${session.user.id}`));
  const resolved = await resolveIndicatorValues(supabase, rpcClient, {
    orgId,
    indicators: byKey,
    requests: wanted
      .filter((w) => !w.missing)
      .map((w) => ({
        key: w.key,
        responsibleId: w.responsibleId,
        realized: w.realized,
      })),
    months,
    todayIso: today,
  });
  let i = 0;
  const series: TreeIndicatorSeries[] = wanted.map((w) => {
    const s = w.missing ? null : resolved[i++];
    const def = byKey.get(w.key);
    const metric = registry.find((m) => m.key === w.key);
    return {
      key: w.key,
      ...(w.nodeId ? { nodeId: w.nodeId } : {}),
      responsible: w.responsible,
      label: def?.label ?? metric?.label ?? (w.key || "Métrica própria"),
      unit: def?.unit ?? (metric?.money ? "moeda" : "quantidade"),
      rollup: def?.rollup ?? "soma",
      direction: def?.direction ?? "maior_melhor",
      hasRealized: s?.hasRealized ?? false,
      ...(w.realized?.override ? { ownRealized: true } : {}),
      formulaText: def?.realized
        ? (def.realized.formulaText ?? def.realized.formula.source ?? null)
        : null,
      responsibleMissing: w.missing,
      cells: s?.cells ?? [],
      total: s?.total ?? { target: null, realized: null, attainment: null },
      ...(s?.breakdown ? { breakdown: s.breakdown } : {}),
      ...(s?.errors ? { errors: s.errors } : {}),
    };
  });
  return { ok: true, months, series };
}

/**
 * v1.2: meta do mês de um NÓ de indicador, editada no próprio nó (o editor
 * da Tree). O indicador e o responsável saem do payload GRAVADO do nó — nunca
 * do navegador. Admin (a RLS de goals já exige); vazio EXCLUI a meta.
 */
export async function saveTreeIndicatorGoal(
  dashboardId: string,
  widgetId: string,
  nodeId: string,
  month: string,
  target: number | null
): Promise<{ ok: boolean; message?: string }> {
  const session = await getSessionInfo();
  if (!session) return { ok: false, message: "Sessão expirada." };
  if (!session.roles.includes("admin"))
    return { ok: false, message: "Apenas administradores editam metas." };
  const ym = parseMonthKey(month);
  if (!ym) return { ok: false, message: "Mês inválido." };
  if (target != null && !Number.isFinite(target)) return { ok: false, message: "Valor inválido." };
  const uuid = ownNodeUuid(nodeId);
  if (!uuid) return { ok: false, message: "Nó inválido." };
  const supabase = await createClient();
  const { data: w } = await supabase
    .from("widgets")
    .select("id, visual_type, settings")
    .eq("id", widgetId)
    .eq("dashboard_id", dashboardId)
    .maybeSingle();
  const tree = (w?.settings as { tree?: { source?: string; mapKey?: string } } | null)?.tree;
  const mapKey = tree?.source === "livre" ? normalizeMapKey(tree.mapKey) : null;
  if (!w || w.visual_type !== "tree" || !mapKey) return { ok: false, message: "Widget não encontrado." };
  const { data: node } = await supabase
    .from("tree_nodes")
    .select("payload")
    .eq("id", uuid)
    .eq("scope_kind", "livre")
    .eq("scope_id", mapKey)
    .eq("kind", "indicator")
    .maybeSingle();
  const p = parseIndicatorPayload(node?.payload);
  if (!p?.indicator) return { ok: false, message: "O nó não tem indicador com meta." };
  const orgId = await getActiveOrgId();
  if (!orgId) return { ok: false, message: "Organização ativa não encontrada." };
  let responsibleId: string | null = null;
  if (p.responsible) {
    responsibleId = responsibleIdForName(await loadResponsibleNameIndex(supabase), p.responsible);
    if (!responsibleId) return { ok: false, message: `Responsável "${p.responsible}" não encontrado.` };
  }
  const slot = {
    year: ym.year,
    month: ym.month,
    scope: (responsibleId ? "responsible" : "global") as "responsible" | "global",
    responsibleId,
    metric: p.indicator,
  };
  const error =
    target == null
      ? await deleteGoalTarget(supabase, slot)
      : await upsertGoalTarget(supabase, orgId, slot, target);
  return error ? { ok: false, message: error } : { ok: true };
}
