// Versão: 1.2 | Data: 31/07/2026
// v1.2 (31/07/2026): ação set_field — saveAutomation valida o campo alvo no
//   SAVE (setFieldTargetError, mesma régua da avaliação — mensagem imediata;
//   a guarda definitiva segue no evaluate) e o catálogo ganha settableFields
//   (alvos graváveis: deriva de buildAvailableFields — nunca lista paralela).
// v1.1 (31/07/2026): o catálogo do editor ganha selectOptionsByField (options
//   dos campos seleção, ref = coluna crua p/ overrides core — 0086) p/ o
//   picker de VALOR das condições (FilterValuePicker).
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
import { isCoreDef } from "@/lib/records/core-defs";
import { EDITABLE_CORE_COLUMNS } from "@/lib/config/core-writeback";
import { loadSources } from "@/lib/config/sources";
import { loadSourceLabels } from "@/lib/config/source-labels";
import { loadCorrespondences } from "@/lib/correspondences";
import { buildAvailableFields } from "@/lib/widgets/fields";
import { toFieldOptions, type FieldOption } from "@/lib/widgets/filter-ops";
import { ensureKanbanConfigGate } from "../config-gate";
import { KANBAN_OVERFLOW_KEY } from "../types";
import { loadKanbanOwnerContext, runBoardAutomations } from "./engine";
import { setFieldTargetError } from "./evaluate";
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

// Gate de configuração do quadro: extraído p/ lib/kanban/config-gate.ts
// (compartilhado com a alocação-como-campo). Alias local mantém os call sites.
const ensureCanConfig = ensureKanbanConfigGate;

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
      message: "Regra incompleta: confira as condições e a ação.",
    };
  }
  if (
    rule.action.type === "move_to_column" &&
    rule.action.targetKey === KANBAN_OVERFLOW_KEY
  ) {
    return { ok: false, message: 'A coluna "Outros" não recebe cards.' };
  }
  const session = await getSessionInfo();
  const supabase = await createClient();
  if (rule.action.type === "set_field") {
    // Validação de SAVE (mensagem imediata) com a MESMA régua da avaliação —
    // que segue sendo a guarda definitiva (campo pode sumir/alocação pode
    // nascer depois). Client do usuário: RLS recorta o que ele enxerga.
    const orgId = await getActiveOrgId();
    const sources = await loadSources(supabase, orgId);
    const [correspondences, { data: fieldsData }, ownerCtx] = await Promise.all([
      loadCorrespondences(supabase, orgId),
      supabase
        .from("field_definitions")
        .select(
          "id, field_key, label, data_type, options, visible_to_roles, editable_by_roles, is_local, show_in_builder, formula, allow_negative, currency_code, currency_mode, show_as_percent, sort_order, applies_to, source_system, source_field_id, write_back"
        )
        .or("show_in_builder.eq.true,source_system.eq.core")
        .order("sort_order", { ascending: true }),
      loadKanbanOwnerContext(supabase, owner),
    ]);
    const available = buildAvailableFields(
      (fieldsData ?? []) as FieldDefinition[],
      correspondences,
      sources
    );
    const err = setFieldTargetError(rule.action.field, {
      available,
      allocationFieldKey:
        typeof ownerCtx === "string"
          ? null
          : (ownerCtx.settings.allocationFieldKey ?? null),
    });
    if (err) return { ok: false, message: err };
  }
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
      // "Ações" cobre as duas famílias (mover + definir campo).
      message:
        (moved === 1 ? "1 ação executada." : `${moved} ações executadas.`) +
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
  // Options dos campos seleção (picker de VALOR das condições): ref → options.
  // Overrides core (0086) entram pela coluna CRUA (ex. "pipeline").
  selectOptionsByField: Record<string, string[]>;
  // Alvos da ação "Definir campo": campos GRAVÁVEIS da base do quadro + gerais
  // (sem data/calculado/relação/match:/unified:/espelho da alocação — mesma
  // régua de setFieldTargetError). Deriva de buildAvailableFields.
  settableFields: FieldOption[];
  // Tipo booleano do alvo (o editor de valor vira Sim/Não): refs booleanos.
  booleanFields: string[];
  numericFields: string[];
}

/** Catálogo de campos/bases p/ o editor de condições (por base do quadro).
 *  `owner` (opcional) resolve o allocationFieldKey do quadro — filtra o
 *  espelho da alocação do picker de "Definir campo" (oferta; a guarda real é
 *  save + avaliação). */
export async function getAutomationFieldOptions(
  source: string | undefined,
  owner?: AutomationOwner
): Promise<AutomationActionState & { catalog?: AutomationFieldCatalog }> {
  const session = await getSessionInfo();
  if (!session) return { ok: false, message: "Sessão expirada." };
  const supabase = await createClient();
  const orgId = await getActiveOrgId();
  const sources = await loadSources(supabase, orgId);
  const [correspondences, { data: fieldsData }, labels, ownerCtx] =
    await Promise.all([
      loadCorrespondences(supabase, orgId),
      supabase
        .from("field_definitions")
        .select(
          "id, field_key, label, data_type, options, visible_to_roles, editable_by_roles, is_local, show_in_builder, formula, allow_negative, currency_code, currency_mode, show_as_percent, sort_order, applies_to, source_system, source_field_id, write_back"
        )
        .or("show_in_builder.eq.true,source_system.eq.core")
        .order("sort_order", { ascending: true }),
      loadSourceLabels(supabase, sources, orgId),
      owner ? loadKanbanOwnerContext(supabase, owner) : Promise.resolve(null),
    ]);
  const allocationFieldKey =
    ownerCtx && typeof ownerCtx !== "string"
      ? (ownerCtx.settings.allocationFieldKey ?? null)
      : null;
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
  const selectOptionsByField: Record<string, string[]> = {};
  for (const f of (fieldsData ?? []) as FieldDefinition[]) {
    if (f.data_type !== "selecao") continue;
    const opts = (f.options ?? []).map((o) => String(o)).filter(Boolean);
    if (opts.length === 0) continue;
    selectOptionsByField[isCoreDef(f) ? f.field_key : `custom:${f.field_key}`] =
      opts;
  }
  // Alvos de "Definir campo": base do quadro + gerais, aprovados pela MESMA
  // régua da avaliação (setFieldTargetError) — nunca uma lista paralela.
  const settable = available.filter(
    (f) =>
      f.baseLabel == null &&
      (!f.source || !source || f.source === source) &&
      setFieldTargetError(f.field, { available, allocationFieldKey }) == null
  );
  const booleanFields: string[] = [];
  const numericFields: string[] = [];
  for (const [col, dt] of Object.entries(EDITABLE_CORE_COLUMNS)) {
    if (dt === "booleano") booleanFields.push(col);
    else if (dt === "numero" || dt === "moeda") numericFields.push(col);
  }
  for (const f of (fieldsData ?? []) as FieldDefinition[]) {
    if (isCoreDef(f)) continue;
    if (f.data_type === "booleano") booleanFields.push(`custom:${f.field_key}`);
    else if (f.data_type === "numero" || f.data_type === "moeda")
      numericFields.push(`custom:${f.field_key}`);
  }
  return {
    ok: true,
    catalog: {
      fields: toFieldOptions(forBoard, labels),
      sources: sources.map((s) => ({ value: s.key, label: s.label })),
      fieldsBySource,
      selectOptionsByField,
      settableFields: toFieldOptions(settable, labels),
      booleanFields,
      numericFields,
    },
  };
}
