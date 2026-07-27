// Versão: 1.0 | Data: 27/07/2026
// Server Actions das automações do kanban: CRUD das regras (client do USUÁRIO
// — RLS de kanban_automations exige editor do board nos dois braços; a action
// espelha o gate p/ mensagens amigáveis), "Executar agora" (mesma engine do
// tick, com service role + deadline curto — a AUTORIA é gate de editor, a
// execução tem autoridade de sistema, como o sync) e o catálogo de campos p/ o
// editor de condições (buildAvailableFields + toFieldOptions — nunca listas
// paralelas). Todas retornam { ok, message } (nunca lançam).
"use server";

import { getSessionInfo } from "@/lib/auth/session";
import { getActiveOrgId } from "@/lib/auth/org";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import type { FieldDefinition } from "@/lib/records/types";
import { loadSources } from "@/lib/config/sources";
import { loadSourceLabels } from "@/lib/config/source-labels";
import { loadCorrespondences } from "@/lib/correspondences";
import { buildAvailableFields } from "@/lib/widgets/fields";
import { toFieldOptions, type FieldOption } from "@/lib/widgets/filter-ops";
import { KANBAN_OVERFLOW_KEY } from "../types";
import { runBoardAutomations } from "./engine";
import {
  parseAutomationRule,
  type AutomationOwner,
  type AutomationRow,
} from "./types";

const RUN_NOW_BUDGET_MS = 25_000;

export interface AutomationActionState {
  ok?: boolean;
  message?: string;
}

// Resolve o dashboard do dono e confere o gate de configuração (mesmo
// canConfig da page /kanbans/[id]: admin || dono || board_access 'edit').
// Leituras com o client do USUÁRIO — RLS prova a visibilidade.
async function ensureCanConfig(
  owner: AutomationOwner
): Promise<{ ok: true } | { ok: false; message: string }> {
  const session = await getSessionInfo();
  if (!session) return { ok: false, message: "Sessão expirada." };
  const supabase = await createClient();
  let dashboardId = owner.id;
  if (owner.kind === "widget") {
    const { data: w } = await supabase
      .from("widgets")
      .select("dashboard_id")
      .eq("id", owner.id)
      .maybeSingle();
    if (!w) return { ok: false, message: "Widget não encontrado." };
    dashboardId = w.dashboard_id as string;
  }
  if (session.roles.includes("admin")) return { ok: true };
  const { data: d } = await supabase
    .from("dashboards")
    .select("owner_user_id")
    .eq("id", dashboardId)
    .maybeSingle();
  if (!d) return { ok: false, message: "Quadro não encontrado." };
  if (d.owner_user_id === session.user.id) return { ok: true };
  const { data: access } = await supabase
    .from("board_access")
    .select("level")
    .eq("dashboard_id", dashboardId)
    .eq("user_id", session.user.id)
    .maybeSingle();
  if (access?.level === "edit") return { ok: true };
  return { ok: false, message: "Sem permissão para configurar este quadro." };
}

const ownerCol = (owner: AutomationOwner) =>
  owner.kind === "widget" ? "widget_id" : "board_id";

/** Regras do quadro, em ordem de avaliação. */
export async function listAutomations(
  owner: AutomationOwner
): Promise<AutomationActionState & { rows?: AutomationRow[] }> {
  const gate = await ensureCanConfig(owner);
  if (!gate.ok) return gate;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("kanban_automations")
    .select(
      "id, name, enabled, position, rule, last_run_at, last_error, last_moved_count"
    )
    .eq(ownerCol(owner), owner.id)
    .order("position", { ascending: true })
    .order("created_at", { ascending: true });
  if (error) return { ok: false, message: error.message };
  const rows: AutomationRow[] = [];
  for (const r of data ?? []) {
    const rule = parseAutomationRule(r.rule);
    if (!rule) continue; // linha corrompida fora da lista (não deve ocorrer)
    rows.push({
      id: r.id as string,
      name: (r.name as string) ?? "",
      enabled: Boolean(r.enabled),
      position: (r.position as number) ?? 0,
      rule,
      last_run_at: (r.last_run_at as string) ?? null,
      last_error: (r.last_error as string) ?? null,
      last_moved_count: (r.last_moved_count as number) ?? 0,
    });
  }
  return { ok: true, rows };
}

/** Cria/atualiza uma regra (id ausente = criação). */
export async function saveAutomation(
  owner: AutomationOwner,
  input: {
    id?: string | null;
    name: string;
    enabled: boolean;
    position: number;
    rule: unknown;
  }
): Promise<AutomationActionState & { id?: string }> {
  const gate = await ensureCanConfig(owner);
  if (!gate.ok) return gate;
  const rule = parseAutomationRule(input.rule);
  if (!rule) {
    return {
      ok: false,
      message: "Regra incompleta: confira as condições e a coluna de destino.",
    };
  }
  if (rule.action.targetKey === KANBAN_OVERFLOW_KEY) {
    return { ok: false, message: 'A coluna "Outros" não recebe cards.' };
  }
  const session = await getSessionInfo();
  const supabase = await createClient();
  const row = {
    name: input.name.trim().slice(0, 120),
    enabled: Boolean(input.enabled),
    position: Number.isFinite(input.position) ? input.position : 0,
    rule,
  };
  if (input.id) {
    const { data, error } = await supabase
      .from("kanban_automations")
      .update(row)
      .eq("id", input.id)
      .eq(ownerCol(owner), owner.id)
      .select("id");
    if (error) return { ok: false, message: error.message };
    if (!data || data.length === 0) {
      return { ok: false, message: "Regra não encontrada (ou sem permissão)." };
    }
    return { ok: true, id: input.id };
  }
  const { data, error } = await supabase
    .from("kanban_automations")
    .insert({
      ...row,
      [ownerCol(owner)]: owner.id,
      // Carimbo de org (0089): o trigger deriva do dashboard e vence; o valor
      // explícito cobre o caso de trigger ausente (nunca vaza p/ a default).
      organization_id: await getActiveOrgId(),
      created_by: session?.user.id ?? null,
    })
    .select("id")
    .single();
  if (error) return { ok: false, message: error.message };
  return { ok: true, id: data.id as string };
}

export async function deleteAutomation(
  owner: AutomationOwner,
  id: string
): Promise<AutomationActionState> {
  const gate = await ensureCanConfig(owner);
  if (!gate.ok) return gate;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("kanban_automations")
    .delete()
    .eq("id", id)
    .eq(ownerCol(owner), owner.id)
    .select("id");
  if (error) return { ok: false, message: error.message };
  if (!data || data.length === 0) {
    return { ok: false, message: "Regra não encontrada (ou sem permissão)." };
  }
  return { ok: true };
}

/** Reordena as regras (ordem do array = nova ordem de avaliação). */
export async function reorderAutomations(
  owner: AutomationOwner,
  orderedIds: string[]
): Promise<AutomationActionState> {
  const gate = await ensureCanConfig(owner);
  if (!gate.ok) return gate;
  const supabase = await createClient();
  for (let i = 0; i < orderedIds.length; i++) {
    const { error } = await supabase
      .from("kanban_automations")
      .update({ position: i })
      .eq("id", orderedIds[i])
      .eq(ownerCol(owner), owner.id);
    if (error) return { ok: false, message: error.message };
  }
  return { ok: true };
}

/** Roda as regras deste quadro AGORA (fora do tick), com deadline curto. */
export async function runAutomationsNow(
  owner: AutomationOwner
): Promise<AutomationActionState & { moved?: number }> {
  const gate = await ensureCanConfig(owner);
  if (!gate.ok) return gate;
  try {
    const summary = await runBoardAutomations(createServiceClient(), owner, {
      deadline: Date.now() + RUN_NOW_BUDGET_MS,
    });
    if (summary.fatal) return { ok: false, message: summary.fatal };
    const moved = summary.moved;
    const errs = summary.ruleErrors.length;
    return {
      ok: true,
      moved,
      message:
        (moved === 1 ? "1 card movido." : `${moved} cards movidos.`) +
        (errs > 0 ? ` ${errs} regra(s) com erro — veja o detalhe na lista.` : ""),
    };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}

export interface AutomationFieldCatalog {
  // Condição "Campo do registro" (base do quadro + gerais + registro casado ↪).
  fields: FieldOption[];
  // Bases oferecidas na condição "Registros conectados".
  sources: { value: string; label: string }[];
  // Campos p/ os filtros dos conectados, por base (sem match: — 1 nível só).
  fieldsBySource: Record<string, FieldOption[]>;
}

/** Catálogo de campos/bases p/ o editor de condições (por base do quadro). */
export async function getAutomationFieldOptions(
  source: string | undefined
): Promise<AutomationActionState & { catalog?: AutomationFieldCatalog }> {
  const session = await getSessionInfo();
  if (!session) return { ok: false, message: "Sessão expirada." };
  const supabase = await createClient();
  const orgId = await getActiveOrgId();
  const sources = await loadSources(supabase, orgId);
  const [correspondences, { data: fieldsData }, labels] = await Promise.all([
    loadCorrespondences(supabase, orgId),
    supabase
      .from("field_definitions")
      .select(
        "id, field_key, label, data_type, options, visible_to_roles, editable_by_roles, is_local, show_in_builder, formula, allow_negative, currency_code, currency_mode, show_as_percent, sort_order, applies_to, source_system, source_field_id, write_back"
      )
      .or("show_in_builder.eq.true,source_system.eq.core")
      .order("sort_order", { ascending: true }),
    loadSourceLabels(supabase, sources, orgId),
  ]);
  const available = buildAvailableFields(
    (fieldsData ?? []) as FieldDefinition[],
    correspondences,
    sources
  );
  // Condição de campo: sem sintéticos/agregados; campos da base do quadro +
  // gerais + registro casado (↪ — recordRawValue resolve via __match).
  const forBoard = available.filter(
    (f) =>
      !f.displayOnly &&
      !f.aggCalc &&
      (f.baseLabel != null || !f.source || !source || f.source === source)
  );
  const fieldsBySource: Record<string, FieldOption[]> = {};
  for (const s of sources) {
    fieldsBySource[s.key] = toFieldOptions(
      available.filter(
        (f) =>
          !f.displayOnly &&
          !f.aggCalc &&
          f.baseLabel == null &&
          (!f.source || f.source === s.key || f.source === s.parentKey)
      ),
      labels
    );
  }
  return {
    ok: true,
    catalog: {
      fields: toFieldOptions(forBoard, labels),
      sources: sources.map((s) => ({ value: s.key, label: s.label })),
      fieldsBySource,
    },
  };
}
