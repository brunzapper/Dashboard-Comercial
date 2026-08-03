// Versão: 1.11 | Data: 25/07/2026
// v1.11 (25/07/2026): espaço de grid v2 (grade fina — lib/widgets/grid-space):
//   ensureFineGrid (migração lazy CAS no write-path) chamado por todo escritor
//   de geometria (saveLayout/saveShapeLine/createWidget/updateDashboardSettings/
//   applyPresetDefinition); captureDashboardSnapshot normaliza a leitura;
//   presets/JSONs legados convertidos na entrada (normalizePresetGridSpace,
//   canvas gerido só quando o preset ORIGINAL o definia); createDashboard
//   carimba gridVersion (board novo nasce fino, linha quadrada); clamps de
//   linha divisória nos tetos finos (480×800).
// v1.10 (25/07/2026): saveShapeLine aceita o novo visual_type
//   'linha_divisoria' (0100) além da identidade legada forma+kind linha.
// v1.9 (23/07/2026): FIX RETURNING × policy 0088 — `.insert(...).select()` em
//   `dashboards` falha com 42501: a policy de SELECT (auth_board_visible)
//   consulta a própria tabela via função STABLE e não enxerga a linha do
//   próprio comando. createBoard e applyPresetDefinition passam ao padrão do
//   duplicateBoard (id gerado no app + insert sem RETURNING); o insert do
//   preset/import ganha carimbo de organization_id (0090) e
//   applyPresetDefinition devolve { error } com a mensagem real do banco
//   (antes retornava null e os chamadores exibiam falha genérica).
// v1.8 (23/07/2026): importDashboardJson — modo "Importar dashboard via JSON
//   (IA)": valida o JSON colado (lib/import/dashboard/validate.ts, erros
//   legíveis p/ devolver à IA) e o aplica pelo MESMO motor idempotente dos
//   presets (applyPresetDefinition, identidade "import:<chave>" — reimportar
//   atualiza em vez de duplicar). applyPresetDefinition ganha opts
//   includeSupportFields (o import NÃO cria os campos de apoio PRESET_FIELDS).
// v1.7 (23/07/2026): saveSharedFieldFilter — valor COMPARTILHADO do "Filtro
//   por campo" (settings.valueScope 'all') na célula __ff__/sel de
//   dashboard_table_cells (mesma semântica do __qf__; fora do Desfazer/Refazer).
// v1.6 (23/07/2026): escopo de BASES do board (⋮ → "Bases") —
//   getBoardSourcesState (catálogo completo + escopo + referenciadas, lazy no
//   open do dialog) e saveBoardSourceScope (merge server-side SÓ da chave
//   sourceScope — o dialog pode abrir do hub com settings defasados).
// v1.5 (22/07/2026): ciclo de vida de boards (0087) — trashBoard/archiveBoard/
//   restoreBoard/deleteBoardPermanently substituem o hard delete direto
//   (deleteDashboard), e duplicateBoard clona board + widgets + células +
//   placements com REMAP de ids em settings e remoção da identidade de preset.
// v1.4 (22/07/2026): listFilterOptionCandidates — opções candidatas p/ o
//   picker "Opções visíveis" do construtor (filtro_campo/filtros rápidos),
//   espelhando as consultas de opções da page (responsáveis/operações ativos;
//   etapas distintas via RPC existente). Nenhum RPC novo.
// v1.3 (16/07/2026): kanbans dedicados (dashboards.kind 'kanban', 0062) —
//   createBoard (seed de settings.kanban), updateBoardSettings (revalida
//   /kanbans/[id]) e listWidgetLinkTargets filtra kind 'dashboard'.
// v1.2 (15/07/2026): Tabela Livre — saveQuickTableCells (lote de células com
//   validação de bloqueio por papel via settings.quickTable.editableRoles).
// v1.1 (15/07/2026): widgets calculadora/nota/forma — saveCalcExpression
//   (expressão compartilhada da calculadora, row __calc__), listWidgetLinkTargets
//   (catálogo de destinos de atalho: dashboards→abas→widgets), deleteWidget
//   limpa conectores órfãos, e __calc__ fica fora do histórico (como __qf__).
// Server Actions de dashboards e widgets (client do usuário → RLS:
// dashboards/widgets exigem create_dashboards p/ criar; owner/admin p/ editar).
"use server";

import { revalidatePath } from "next/cache";

import { getSessionInfo } from "@/lib/auth/session";
import { getActiveOrgId } from "@/lib/auth/org";
import { loadOrgFeatures } from "@/lib/config/org-features";
import { createClient } from "@/lib/supabase/server";
import {
  PRESETS,
  PRESET_FIELDS,
  type PresetCompPlan,
  type PresetCorrespondence,
  type PresetOperation,
  type PresetDashboard,
  type PresetField,
  type PresetSubSource,
} from "@/lib/presets/definitions";
import { GOAL_METRICS_CONFIG_KEY } from "@/lib/config/goal-metrics";
import { mergeGoalMetrics } from "@/lib/metas/metrics";
import { registerGoalMetrics } from "@/lib/metas/upsert";
import { parseCompPlanConfig } from "@/lib/comp/model";
import { ensureMirrorSource, MIRROR_SOURCE_KEY } from "@/lib/comp/mirror";
import { refreshResponsibleOptionFields } from "@/lib/config/responsible-options";
import { loadSources } from "@/lib/config/sources";
import { loadSourceFolders } from "@/lib/config/source-folders";
import type { SourceFolder } from "@/lib/source-folders";
import {
  buildResponsibleCanon,
  collapseResponsibleOptions,
} from "@/lib/config/responsible-canon";
import {
  collectBoardSourceKeys,
  type ScopeWidgetLike,
} from "@/lib/config/source-scope";
import { recordTypeOf } from "@/lib/sources";
import { isCoreDef } from "@/lib/records/core-defs";
import type { FieldDefinition } from "@/lib/records/types";
import { recalcAllFormulaFields } from "@/lib/records/recalc";
import type { SourceKey } from "@/lib/sources";
import type { SavedPeriod } from "@/lib/widgets/period";
import {
  FF_COL_KEY,
  FF_ROW_KEY,
  parsePeriodWindowChoice,
  PW_COL_KEY,
  PW_ROW_KEY,
  QF_ROW_KEY,
  type PeriodWindowChoice,
  type QuickFilterValue,
} from "@/lib/widgets/quick-filters";
import { CALC_COL_KEY, CALC_ROW_KEY } from "@/lib/widgets/calculator";
import {
  DEFAULT_CUSTOM_COLUMNS,
  DEFAULT_TASK_PHASES,
  type KanbanSettings,
} from "@/lib/kanban/types";
import { normalizeKanbanAllocationOnSave } from "@/lib/kanban/allocation-field";
import { reconcileKanbanAllocationField } from "@/lib/kanban/allocation-reconcile";
import { createServiceClient } from "@/lib/supabase/service";
import { baseColId, canTypeInColumn } from "@/lib/widgets/quick-table/model";
import type {
  DashboardSettings,
  Dimension,
  GridPosition,
  Metric,
  ShapeLine,
  VisualType,
  Widget,
  WidgetFilter,
  WidgetSettings,
} from "@/lib/widgets/types";
import {
  axisLock,
  clampLine,
  lineGridBBox,
  roundLine,
} from "@/lib/widgets/lines";
import {
  BASE_COLS,
  GRID_MAX_COLS,
  GRID_MAX_ROWS,
  GRID_VERSION,
  convertLegacyCanvas,
  convertLegacyWidget,
  isFineGrid,
  normalizeGridSpace,
  normalizePresetGridSpace,
} from "@/lib/widgets/grid-space";
import {
  canBePage,
  collectPageMembers,
  isPageHost,
  pageMembersOf,
} from "@/lib/widgets/pages";
import { findFreePosition, posOf } from "@/lib/widgets/grid-placement";
import {
  buildDashboardSnapshot,
  type DashboardSnapshot,
} from "@/lib/widgets/history";
import { sanitizeImageSettings } from "@/lib/widgets/image-url";
import { validateDashboardImport } from "@/lib/import/dashboard/validate";
import { loadImportContext } from "@/lib/import/dashboard/context";
import { IMPORT_PRESET_PREFIX } from "@/lib/import/dashboard/types";
import {
  assignWidgetKeys,
  importChaveForDashboard,
  exportDashboardJson,
  type ExportDashRow,
  type ExportWidgetRow,
} from "@/lib/import/dashboard/export";
import { loadExportFkNames } from "@/lib/import/dashboard/export-fk-names";
import { normalizeImportRaw } from "@/lib/import/dashboard/rewrite";

export interface ActionState {
  ok?: boolean;
  message?: string;
}

export interface WidgetInput {
  title: string | null;
  visual_type: VisualType;
  sources?: SourceKey[];
  splitBySource?: boolean;
  dimensions: Dimension[];
  metrics: Metric[];
  filters: WidgetFilter[];
  settings?: WidgetSettings;
  grid_position?: GridPosition;
}

// ---------------- Dashboards ----------------

export async function createDashboard(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const session = await getSessionInfo();
  if (!session) return { ok: false, message: "Sessão expirada." };
  if (!session.permissions.includes("create_dashboards")) {
    return { ok: false, message: "Você não tem permissão para criar dashboards." };
  }
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { ok: false, message: "Informe um nome." };
  const visible = formData.getAll("visible_to_roles").map(String).filter(Boolean);

  // Carimbo de org (multi-org, 0090): sem ele, o default (Zapper) faria o
  // insert de um usuário de OUTRA org falhar no WITH CHECK da RLS.
  const orgId = await getActiveOrgId();
  const supabase = await createClient();
  const { error } = await supabase.from("dashboards").insert({
    name,
    owner_user_id: session.user.id,
    visible_to_roles: visible,
    is_shared: visible.length > 0,
    // Dashboard novo nasce no espaço FINO nativo (sem rowHeight = linha
    // quadrada) — sem o carimbo, a leitura o trataria como legado e gravaria o
    // rowHeight de conversão 10.5 na primeira edição de settings.
    settings: { canvas: { gridVersion: GRID_VERSION } },
    ...(orgId ? { organization_id: orgId } : {}),
  });
  if (error) return { ok: false, message: error.message };
  revalidatePath("/");
  return { ok: true, message: `Dashboard "${name}" criado.` };
}

// ---------------- Kanbans dedicados (dashboards.kind 'kanban') ----------------

export interface CreateBoardState {
  ok?: boolean;
  message?: string;
  // id do kanban criado (o cliente navega p/ /kanbans/[id]).
  id?: string;
}

// Cria um kanban dedicado: mesma tabela/permissão de dashboards (RLS exige
// create_dashboards), kind 'kanban' e o seed de settings.kanban a partir do
// formulário (modo, fonte, agrupamento por campo OU bucket de data).
export async function createBoard(
  _prev: CreateBoardState,
  formData: FormData
): Promise<CreateBoardState> {
  const session = await getSessionInfo();
  if (!session) return { ok: false, message: "Sessão expirada." };
  if (!session.permissions.includes("create_dashboards")) {
    return { ok: false, message: "Você não tem permissão para criar kanbans." };
  }
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { ok: false, message: "Informe um nome." };
  const visible = formData.getAll("visible_to_roles").map(String).filter(Boolean);

  const mode = String(formData.get("mode") ?? "registros");
  const kanban: KanbanSettings = { mode: mode === "tarefas" ? "tarefas" : "registros" };
  if (kanban.mode === "tarefas") {
    // Fases default editáveis depois (config de colunas do quadro).
    kanban.columns = DEFAULT_TASK_PHASES;
  } else {
    const source = String(formData.get("source") ?? "").trim();
    if (!source) return { ok: false, message: "Escolha a base dos registros." };
    kanban.source = source;
    const groupKind = String(formData.get("group_kind") ?? "field");
    if (groupKind === "custom") {
      // "Personalizar": colunas livres do usuário; posição do card é dado da
      // visão (kanban_placements) — mover não altera o registro.
      kanban.columnSource = "custom";
      kanban.columns = DEFAULT_CUSTOM_COLUMNS;
    } else if (groupKind === "date") {
      const bucketRaw = String(formData.get("date_bucket") ?? "weekday");
      kanban.dateBucket =
        bucketRaw === "month_name" || bucketRaw === "month_year"
          ? bucketRaw
          : "weekday";
      const dateField = String(formData.get("date_field") ?? "").trim();
      if (!dateField) {
        return { ok: false, message: "Escolha o campo de data das colunas." };
      }
      kanban.dateField = dateField;
    } else {
      const groupField = String(formData.get("group_field") ?? "").trim();
      if (!groupField) {
        return { ok: false, message: "Escolha o campo que define as colunas." };
      }
      kanban.groupField = groupField;
    }
    kanban.card = { titleField: "title" };
  }

  // Carimbo de org (multi-org, 0090) — ver createDashboard.
  const orgId = await getActiveOrgId();
  const supabase = await createClient();
  // Id gerado no APP + insert SEM RETURNING (padrão duplicateBoard): a policy
  // de SELECT de dashboards (auth_board_visible, 0088) consulta a própria
  // tabela via função STABLE, que não enxerga a linha do PRÓPRIO comando —
  // `.insert(...).select()` falharia com 42501 mesmo para o dono.
  const boardId = crypto.randomUUID();
  const { error } = await supabase.from("dashboards").insert({
    id: boardId,
    name,
    kind: "kanban",
    owner_user_id: session.user.id,
    visible_to_roles: visible,
    is_shared: visible.length > 0,
    settings: { kanban },
    ...(orgId ? { organization_id: orgId } : {}),
  });
  if (error) return { ok: false, message: error.message };
  revalidatePath("/");
  return { ok: true, message: `Kanban "${name}" criado.`, id: boardId };
}

// Alocação como campo (invariante 24): reconcile best-effort pós-save quando
// as colunas visíveis mudaram (rename/reorder/hide/remoção reescrevem valores
// e options do campo). Deadline curto — sobras curam no tick por minuto.
const ALLOCATION_SAVE_BUDGET_MS = 8_000;

async function reconcileAllocationBestEffort(owner: {
  kind: "widget" | "board";
  id: string;
}): Promise<void> {
  try {
    await reconcileKanbanAllocationField(createServiceClient(), owner, {
      deadline: Date.now() + ALLOCATION_SAVE_BUDGET_MS,
    });
  } catch (e) {
    console.warn("[kanban] reconcile da alocação pós-save falhou:", e);
  }
}

// Settings de um kanban dedicado. Mesma semântica de updateDashboardSettings
// (sobrescreve `settings` INTEIRO — enviar { ...settings, kanban: novo }), mas
// revalida a rota do kanban. RLS restringe a owner/admin.
export async function updateBoardSettings(
  boardId: string,
  settings: DashboardSettings
): Promise<ActionState> {
  const session = await getSessionInfo();
  if (!session) return { ok: false, message: "Sessão expirada." };
  const supabase = await createClient();
  // Alocação como campo: normaliza a chave no save (gate barato — só roda
  // quando o payload novo carrega o vínculo).
  let next = settings;
  let maintenance = false;
  if (settings.kanban?.allocationFieldKey) {
    const { data: prevRow } = await supabase
      .from("dashboards")
      .select("settings")
      .eq("id", boardId)
      .maybeSingle();
    const prevKanban =
      ((prevRow?.settings as DashboardSettings | null) ?? null)?.kanban ?? null;
    const norm = normalizeKanbanAllocationOnSave(prevKanban, settings.kanban);
    next = { ...settings, kanban: norm.kanban };
    maintenance = norm.maintenance;
  }
  const { error } = await supabase
    .from("dashboards")
    .update({ settings: next })
    .eq("id", boardId)
    .eq("kind", "kanban");
  if (error) return { ok: false, message: error.message };
  if (maintenance) {
    await reconcileAllocationBestEffort({ kind: "board", id: boardId });
  }
  revalidatePath(`/kanbans/${boardId}`);
  return { ok: true };
}

// ---------------- Ciclo de vida: Lixeira / Arquivar / Duplicar (0087) ----------------

// "Excluir" do hub agora é SOFT: o board (dashboard ou kanban) vai para a
// Lixeira (status 'trashed'), de onde pode ser restaurado ou excluído em
// definitivo; a purga automática remove itens com mais de 14 dias
// (apply/pg-cron-purge-trash.sql). Na Lixeira o board NÃO abre (404 nas rotas
// e fora dos pickers). RLS (dashboards_update) restringe a owner/admin.
export async function trashBoard(id: string): Promise<ActionState> {
  const session = await getSessionInfo();
  if (!session) return { ok: false, message: "Sessão expirada." };
  if (!id) return { ok: false, message: "Board inválido." };
  const supabase = await createClient();
  const { error } = await supabase
    .from("dashboards")
    .update({ status: "trashed", trashed_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return { ok: false, message: error.message };
  revalidatePath("/");
  return { ok: true };
}

// Arquiva: sai da tela principal do hub (seção "Arquivados"), mas segue
// abrindo normalmente, por tempo indeterminado. RLS: owner/admin.
export async function archiveBoard(id: string): Promise<ActionState> {
  const session = await getSessionInfo();
  if (!session) return { ok: false, message: "Sessão expirada." };
  if (!id) return { ok: false, message: "Board inválido." };
  const supabase = await createClient();
  const { error } = await supabase
    .from("dashboards")
    .update({
      status: "archived",
      archived_at: new Date().toISOString(),
      trashed_at: null,
    })
    .eq("id", id);
  if (error) return { ok: false, message: error.message };
  revalidatePath("/");
  return { ok: true };
}

// Volta ao hub: serve o "Restaurar" da Lixeira E o "Desarquivar". RLS: owner/admin.
export async function restoreBoard(id: string): Promise<ActionState> {
  const session = await getSessionInfo();
  if (!session) return { ok: false, message: "Sessão expirada." };
  if (!id) return { ok: false, message: "Board inválido." };
  const supabase = await createClient();
  const { error } = await supabase
    .from("dashboards")
    .update({ status: "active", archived_at: null, trashed_at: null })
    .eq("id", id);
  if (error) return { ok: false, message: error.message };
  revalidatePath("/");
  return { ok: true };
}

// Exclusão DEFINITIVA — só de dentro da Lixeira (o predicado por status
// garante: board ativo/arquivado nunca é apagado por esta action). O DELETE
// cascateia widgets/células/snapshots/placements. RLS: owner/admin.
export async function deleteBoardPermanently(id: string): Promise<ActionState> {
  const session = await getSessionInfo();
  if (!session) return { ok: false, message: "Sessão expirada." };
  if (!id) return { ok: false, message: "Board inválido." };
  const supabase = await createClient();
  const { error } = await supabase
    .from("dashboards")
    .delete()
    .eq("id", id)
    .eq("status", "trashed");
  if (error) return { ok: false, message: error.message };
  revalidatePath("/");
  return { ok: true };
}

// Troca ids antigos → novos em QUALQUER string JSON de settings. Substituição
// literal de substrings: uuids são colisão-seguros, e é o que cobre TODAS as
// referências a widget conhecidas de uma vez — connectors[].from/to.widgetId,
// shape.link.widgetId/dashboardId, links de nota "[rótulo](@<uuid>)"
// (note-template.ts) e targets/excludedTargets dos widgets de filtro.
function remapJsonIds(json: string, map: Map<string, string>): string {
  let out = json;
  for (const [oldId, newId] of map) out = out.split(oldId).join(newId);
  return out;
}

// Duplica um board (dashboard ou kanban) para o USUÁRIO ATUAL: qualquer um que
// enxerga o board (RLS no SELECT) e tem create_dashboards pode duplicar — a
// cópia nasce PRIVADA (visible_to_roles vazio) e ativa. Copia widgets (ids
// novos, settings remapeados), células das tabelas editáveis e
// kanban_placements; NÃO copia snapshots (links públicos ficam no original),
// user_preferences (por usuário) nem tasks (kanban de tarefas duplicado leva a
// estrutura de colunas, não as tarefas). Remove a identidade de preset
// (settings.preset / settings.presetKey) para o applyPreset nunca adotar nem
// sobrescrever a cópia. Sem transação (PostgREST): falha após o insert do
// dashboard faz cleanup best-effort da cópia parcial.
export async function duplicateBoard(
  id: string
): Promise<ActionState & { id?: string }> {
  const session = await getSessionInfo();
  if (!session) return { ok: false, message: "Sessão expirada." };
  if (!session.permissions.includes("create_dashboards")) {
    return { ok: false, message: "Você não tem permissão para duplicar." };
  }
  if (!id) return { ok: false, message: "Board inválido." };
  const supabase = await createClient();

  const { data: src } = await supabase
    .from("dashboards")
    .select("id, name, kind, settings, status, organization_id")
    .eq("id", id)
    .maybeSingle();
  if (!src) return { ok: false, message: "Board não encontrado." };
  if ((src.status as string) === "trashed") {
    return { ok: false, message: "Restaure o board antes de duplicar." };
  }

  const { data: widgetsData } = await supabase
    .from("widgets")
    .select(
      "id, title, visual_type, source, sources, split_by_source, dimensions, metrics, filters, settings, grid_position, sort_order"
    )
    .eq("dashboard_id", id)
    .order("sort_order", { ascending: true });
  const srcWidgets = widgetsData ?? [];

  // Ids novos gerados aqui (insert com id explícito é padrão — ver
  // restoreDashboardSnapshot) para remapear settings ANTES dos inserts.
  const newDashId = crypto.randomUUID();
  const idMap = new Map<string, string>([[id, newDashId]]);
  for (const w of srcWidgets) idMap.set(w.id as string, crypto.randomUUID());

  const dashSettings = JSON.parse(
    remapJsonIds(JSON.stringify(src.settings ?? {}), idMap)
  ) as DashboardSettings;
  delete dashSettings.preset;
  // Alocação como campo (invariante 24): a cópia nunca herda o vínculo — os
  // placements copiados são OUTRA visão; manter a chave faria dois quadros
  // escreverem no mesmo campo.
  if (dashSettings.kanban) delete dashSettings.kanban.allocationFieldKey;

  // Nome único entre os boards que o usuário enxerga: "X (cópia)", "X (cópia 2)"…
  const { data: nameRows } = await supabase.from("dashboards").select("name");
  const names = new Set((nameRows ?? []).map((r) => r.name as string));
  let copyName = `${src.name} (cópia)`;
  for (let n = 2; names.has(copyName); n++) {
    copyName = `${src.name} (cópia ${n})`;
  }

  const { error: dashErr } = await supabase.from("dashboards").insert({
    id: newDashId,
    name: copyName,
    kind: src.kind,
    owner_user_id: session.user.id,
    visible_to_roles: [],
    is_shared: false,
    settings: dashSettings,
    // A cópia herda a org do ORIGINAL (multi-org, 0090).
    ...(src.organization_id
      ? { organization_id: src.organization_id }
      : {}),
  });
  if (dashErr) return { ok: false, message: dashErr.message };

  // A partir daqui qualquer falha desfaz a cópia (delete cascateia os filhos).
  const fail = async (message: string): Promise<ActionState> => {
    await supabase.from("dashboards").delete().eq("id", newDashId);
    return { ok: false, message };
  };

  if (srcWidgets.length > 0) {
    const { error } = await supabase.from("widgets").insert(
      srcWidgets.map((w) => {
        const settings = JSON.parse(
          remapJsonIds(JSON.stringify(w.settings ?? {}), idMap)
        ) as WidgetSettings;
        delete settings.presetKey;
        // Alocação como campo: idem ao board — a cópia não herda o vínculo.
        if (settings.kanban) delete settings.kanban.allocationFieldKey;
        return {
          id: idMap.get(w.id as string),
          dashboard_id: newDashId,
          title: w.title,
          visual_type: w.visual_type,
          source: w.source,
          sources: w.sources,
          split_by_source: w.split_by_source,
          dimensions: w.dimensions,
          metrics: w.metrics,
          filters: w.filters,
          settings,
          grid_position: w.grid_position,
          sort_order: w.sort_order,
        };
      })
    );
    if (error) return fail(error.message);

    // Células das tabelas editáveis/filtros rápidos/calculadora: cópia fiel
    // (na cópia, o estado compartilhado nasce igual ao do original).
    const oldIds = srcWidgets.map((w) => w.id as string);
    const { data: cells } = await supabase
      .from("dashboard_table_cells")
      .select("widget_id, row_key, col_key, value")
      .in("widget_id", oldIds);
    if (cells && cells.length > 0) {
      const { error: cellErr } = await supabase
        .from("dashboard_table_cells")
        .insert(
          cells.map((c) => ({
            widget_id: idMap.get(c.widget_id as string),
            row_key: c.row_key,
            col_key: c.col_key,
            value: c.value,
            updated_by: session.user.id,
          }))
        );
      if (cellErr) return fail(cellErr.message);
    }

    // Posições de kanban "Personalizar" em WIDGETS kanban do dashboard.
    const { data: widgetPlacements } = await supabase
      .from("kanban_placements")
      .select("widget_id, record_id, column_key, position")
      .in("widget_id", oldIds);
    if (widgetPlacements && widgetPlacements.length > 0) {
      const { error: plErr } = await supabase.from("kanban_placements").insert(
        widgetPlacements.map((p) => ({
          widget_id: idMap.get(p.widget_id as string),
          record_id: p.record_id,
          column_key: p.column_key,
          position: p.position,
          updated_by: session.user.id,
        }))
      );
      if (plErr) return fail(plErr.message);
    }
  }

  // Posições de um kanban DEDICADO (board_id).
  if ((src.kind as string) === "kanban") {
    const { data: boardPlacements } = await supabase
      .from("kanban_placements")
      .select("record_id, column_key, position")
      .eq("board_id", id);
    if (boardPlacements && boardPlacements.length > 0) {
      const { error: plErr } = await supabase.from("kanban_placements").insert(
        boardPlacements.map((p) => ({
          board_id: newDashId,
          record_id: p.record_id,
          column_key: p.column_key,
          position: p.position,
          updated_by: session.user.id,
        }))
      );
      if (plErr) return fail(plErr.message);
    }
  }

  revalidatePath("/");
  return { ok: true, id: newDashId, message: `"${copyName}" criado.` };
}

// Config por dashboard (settings jsonb). ATENÇÃO: sobrescreve a coluna `settings`
// INTEIRA — os callers DEVEM enviar o objeto completo (`{ ...settings, ...mudança }`),
// senão apagam as demais chaves (tabs/background/canvas/periodBar). Não fazemos
// merge no servidor de propósito: remover uma chave (ex.: background) depende de
// omiti-la, e um merge a manteria. RLS restringe update a owner/admin.
export async function updateDashboardSettings(
  dashboardId: string,
  settings: DashboardSettings
): Promise<ActionState> {
  const session = await getSessionInfo();
  if (!session) return { ok: false, message: "Sessão expirada." };
  const supabase = await createClient();
  // O cliente envia settings NORMALIZADOS (espaço fino, gridVersion 2) — os
  // widgets do board precisam estar na mesma escala antes do carimbo entrar.
  await ensureFineGrid(supabase, dashboardId);
  const { error } = await supabase
    .from("dashboards")
    .update({ settings })
    .eq("id", dashboardId);
  if (error) return { ok: false, message: error.message };
  revalidatePath(`/dashboards/${dashboardId}`);
  return { ok: true };
}

// Atualiza a visibilidade (papéis) de um dashboard já criado. `is_shared` é
// derivado (compartilhado quando há ao menos um papel). RLS restringe a owner/admin.
export async function updateDashboardVisibility(
  dashboardId: string,
  roles: string[]
): Promise<ActionState> {
  const session = await getSessionInfo();
  if (!session) return { ok: false, message: "Sessão expirada." };
  const clean = roles.map(String).filter(Boolean);
  const supabase = await createClient();
  const { error } = await supabase
    .from("dashboards")
    .update({ visible_to_roles: clean, is_shared: clean.length > 0 })
    .eq("id", dashboardId);
  if (error) return { ok: false, message: error.message };
  revalidatePath("/");
  revalidatePath(`/dashboards/${dashboardId}`);
  return { ok: true };
}

// ---------------- Escopo de BASES do board (⋮ → "Bases") ----------------

export interface BoardSourcesState {
  ok: boolean;
  message?: string;
  // Catálogo COMPLETO (o dialog oferece tudo, mesmo dentro de um board já
  // escopado — o provider da page é o catálogo EFETIVO, que esconderia as
  // bases removíveis/adicionáveis).
  catalog: {
    key: string;
    label: string;
    parentKey?: string;
    folderId?: string | null;
  }[];
  // Pastas (0107) — pelo MESMO canal do catálogo completo (o provider de
  // pastas do layout serve o catálogo efetivo, não este dialog).
  folders: SourceFolder[];
  // Escopo atual (settings.sourceScope.keys; vazio = todas as bases).
  scopeKeys: string[];
  // Bases referenciadas pela config atual (widgets/kanban) — o dialog as marca
  // como "em uso" (continuam no catálogo efetivo mesmo fora do escopo).
  referencedKeys: string[];
}

// Estado do dialog "Bases" (lazy, no open): catálogo completo + escopo atual +
// referenciadas. RLS de dashboards/widgets decide o que o caller enxerga.
export async function getBoardSourcesState(
  boardId: string
): Promise<BoardSourcesState> {
  const empty: BoardSourcesState = {
    ok: false,
    catalog: [],
    folders: [],
    scopeKeys: [],
    referencedKeys: [],
  };
  const session = await getSessionInfo();
  if (!session) return { ...empty, message: "Sessão expirada." };
  const supabase = await createClient();
  const [
    { data: dash },
    { data: widgetsData },
    catalog,
    folders,
    { data: fieldsData },
  ] = await Promise.all([
    supabase
      .from("dashboards")
      .select("id, settings")
      .eq("id", boardId)
      .maybeSingle(),
    supabase
      .from("widgets")
      .select("sources, metrics, filters, settings")
      .eq("dashboard_id", boardId),
    loadSources(supabase),
    loadSourceFolders(supabase),
    supabase
      .from("field_definitions")
      .select("field_key, data_type, formula, source_system")
      .or("show_in_builder.eq.true,source_system.eq.core"),
  ]);
  if (!dash) return { ...empty, message: "Board não encontrado." };
  const settings = (dash.settings ?? {}) as DashboardSettings;
  const fields = ((fieldsData ?? []) as FieldDefinition[]).filter(
    (f) => !isCoreDef(f)
  );
  const referenced = collectBoardSourceKeys(
    (widgetsData ?? []) as ScopeWidgetLike[],
    settings,
    new Map(fields.map((f) => [f.field_key, f]))
  );
  return {
    ok: true,
    catalog: catalog.map((s) => ({
      key: s.key,
      label: s.label,
      parentKey: s.parentKey,
      folderId: s.folderId ?? null,
    })),
    folders,
    scopeKeys: settings.sourceScope?.keys ?? [],
    referencedKeys: [...referenced],
  };
}

// Grava o escopo de bases com MERGE server-side (lê o settings vigente e troca
// só a chave sourceScope) — o dialog pode abrir do hub com props defasadas e
// um overwrite total apagaria tabs/canvas/periodBar. keys vazio = remove o
// escopo (todas as bases). RLS restringe a owner/admin.
export async function saveBoardSourceScope(
  boardId: string,
  keys: string[]
): Promise<ActionState> {
  const session = await getSessionInfo();
  if (!session) return { ok: false, message: "Sessão expirada." };
  const supabase = await createClient();
  const { data: dash } = await supabase
    .from("dashboards")
    .select("id, kind, settings")
    .eq("id", boardId)
    .maybeSingle();
  if (!dash) return { ok: false, message: "Board não encontrado." };
  const catalog = await loadSources(supabase);
  const known = new Set(catalog.map((s) => s.key));
  const clean = [...new Set(keys.map(String).filter((k) => known.has(k)))];
  const settings = (dash.settings ?? {}) as DashboardSettings;
  const next: DashboardSettings = { ...settings };
  if (clean.length > 0) next.sourceScope = { keys: clean };
  else delete next.sourceScope;
  const { error } = await supabase
    .from("dashboards")
    .update({ settings: next })
    .eq("id", boardId);
  if (error) return { ok: false, message: error.message };
  revalidatePath("/");
  revalidatePath(
    dash.kind === "kanban" ? `/kanbans/${boardId}` : `/dashboards/${boardId}`
  );
  return { ok: true };
}

// Renomeia um dashboard já criado. Valida nome não-vazio (como createDashboard)
// para não apagar o título. RLS restringe a owner/admin.
export async function renameDashboard(
  dashboardId: string,
  rawName: string
): Promise<ActionState> {
  const session = await getSessionInfo();
  if (!session) return { ok: false, message: "Sessão expirada." };
  const name = String(rawName ?? "").trim();
  if (!name) return { ok: false, message: "Informe um nome." };
  const supabase = await createClient();
  const { error } = await supabase
    .from("dashboards")
    .update({ name })
    .eq("id", dashboardId);
  if (error) return { ok: false, message: error.message };
  revalidatePath("/");
  revalidatePath(`/dashboards/${dashboardId}`);
  return { ok: true };
}

// Salva o último período consultado do usuário NESTE dashboard (user_preferences).
// Chamado (fire-and-forget) quando a barra de período navega. Não revalida —
// só persiste para reidratar o default na próxima visita.
export async function saveLastPeriod(
  dashboardId: string,
  period: SavedPeriod,
  tabId?: string
): Promise<void> {
  const session = await getSessionInfo();
  if (!session) return;
  const supabase = await createClient();
  // Remove chaves vazias para não poluir o jsonb.
  const clean: SavedPeriod = {};
  if (period.periodo) clean.periodo = period.periodo;
  if (period.de) clean.de = period.de;
  if (period.ate) clean.ate = period.ate;
  if (period.campo) clean.campo = period.campo;

  // Read-modify-write para preservar as demais chaves: no modo global grava em
  // `lastPeriod`; no modo por aba, em `lastPeriodByTab[tabId]` (sem apagar o
  // período global nem o das outras abas).
  const { data } = await supabase
    .from("user_preferences")
    .select("settings")
    .eq("user_id", session.user.id)
    .eq("dashboard_id", dashboardId)
    .maybeSingle();
  const current = (data?.settings ?? {}) as {
    lastPeriod?: SavedPeriod;
    lastPeriodByTab?: Record<string, SavedPeriod>;
  };
  const next: typeof current = { ...current };
  if (tabId) {
    next.lastPeriodByTab = { ...(current.lastPeriodByTab ?? {}), [tabId]: clean };
  } else {
    next.lastPeriod = clean;
  }
  await supabase.from("user_preferences").upsert(
    {
      user_id: session.user.id,
      dashboard_id: dashboardId,
      settings: next,
    },
    { onConflict: "user_id,dashboard_id" }
  );
}

// Salva o último estado do widget "Filtro por campo" (ff_<widgetId>) do
// usuário NESTE dashboard (user_preferences.settings.lastFieldFilters).
// Fire-and-forget no debounce do FieldFilterControls; a page/widget-scope
// reidratam quando a URL não traz o parâmetro (URL sempre vence). `null`
// LIMPA a chave — o usuário removeu o filtro e a preferência não pode
// ressuscitá-lo na próxima visita.
export async function saveLastFieldFilter(
  dashboardId: string,
  widgetId: string,
  encoded: string | null
): Promise<void> {
  const session = await getSessionInfo();
  if (!session) return;
  const supabase = await createClient();
  // Read-modify-write para preservar as demais chaves (lastPeriod etc.).
  const { data } = await supabase
    .from("user_preferences")
    .select("settings")
    .eq("user_id", session.user.id)
    .eq("dashboard_id", dashboardId)
    .maybeSingle();
  const current = (data?.settings ?? {}) as {
    lastFieldFilters?: Record<string, string>;
  };
  const map = { ...(current.lastFieldFilters ?? {}) };
  if (encoded) map[widgetId] = encoded;
  else delete map[widgetId];
  await supabase.from("user_preferences").upsert(
    {
      user_id: session.user.id,
      dashboard_id: dashboardId,
      settings: { ...current, lastFieldFilters: map },
    },
    { onConflict: "user_id,dashboard_id" }
  );
}

// Preferências GLOBAIS do usuário (user_settings), não por dashboard.
// Read-modify-write para preservar chaves futuras. RLS garante que cada
// usuário só toca a própria linha. Fire-and-forget no cliente.
export interface UserAppSettings {
  sidebarPinned?: boolean;
  // Marca d'água da seção "Novas" do sino de tarefas (ISO): tarefas
  // criadas/reatribuídas depois disso contam como novas.
  tasksSeenAt?: string;
  // Última rota de board visitada (/dashboards/<id> ou /kanbans/<id>, com
  // ?tab= se houver), para restaurar ao reabrir o app (RestoreLastView na
  // Home); null = limpou (fechou na Home). Período fica de fora (lastPeriod).
  lastView?: string | null;
  // Tema visual (Configurações → Tema): null/ausente herda o padrão da org
  // (organizations.theme) e, sem org, o padrão do app (claro + #7431B3).
  // Resolução/sanitização em lib/theme.ts (resolveTheme).
  theme?: "light" | "dark" | "system" | null;
  accentColor?: string | null;
  // Cor do Ponteiro Laser (Configurações → Tema): null/ausente = vermelho
  // padrão (DEFAULT_LASER, lib/theme.ts). Pessoal — sem padrão de org.
  laserColor?: string | null;
  // Controles da Agenda do Workspace (/agenda): conteúdo ("todas" | "propria"
  // | "widget:<id>"), recortes e visão — a página reabre como ficou.
  agendaHub?: {
    content?: string;
    responsibleId?: string | null;
    operationId?: string | null;
    view?: "month" | "week";
  };
}

export async function updateUserSettings(
  patch: UserAppSettings
): Promise<void> {
  const session = await getSessionInfo();
  if (!session) return;
  const supabase = await createClient();
  const { data } = await supabase
    .from("user_settings")
    .select("settings")
    .eq("user_id", session.user.id)
    .maybeSingle();
  const current = (data?.settings as UserAppSettings | null) ?? {};
  await supabase.from("user_settings").upsert(
    {
      user_id: session.user.id,
      settings: { ...current, ...patch },
    },
    { onConflict: "user_id" }
  );
}

// ---------------- Espaço de grid v2 (grade fina) ----------------

// Migração LAZY do write-path: converte um board legado (base 12) para o
// espaço fino (base 120) ANTES de qualquer escrita de geometria. TODA action
// que grava grid_position/shape.line/settings de dashboard chama isto primeiro
// — sem a conversão, uma escrita em unidades finas misturaria escalas no banco
// (o cliente opera SEMPRE no espaço fino, via normalizeGridSpace na page).
//
// Anti-corrida: os widgets são LIDOS antes do carimbo CAS. Toda escrita fina
// de outro ator é precedida do ensureFineGrid dele, que ou venceu o CAS (então
// NÓS perdemos e pulamos a conversão) ou perdeu (o que exige um carimbo já
// commitado — posterior à nossa leitura). Logo o vencedor nunca lê valor já
// fino e a dupla conversão é impossível; o pior caso residual é sobrescrever
// uma posição recém-gravada com a conversão da anterior (stale, unidades
// corretas — o próximo arraste corrige). Crash entre carimbo e conversão:
// re-rodar supabase/apply/backfill-grid-v2.sql (runbook).
async function ensureFineGrid(
  supabase: Awaited<ReturnType<typeof createClient>>,
  dashboardId: string
): Promise<void> {
  const { data: dash } = await supabase
    .from("dashboards")
    .select("settings")
    .eq("id", dashboardId)
    .maybeSingle();
  if (!dash) return;
  const settings = (dash.settings ?? {}) as DashboardSettings;
  if (isFineGrid(settings)) return;

  // Leitura ANTES do carimbo (prova de ordem acima).
  const { data: rows } = await supabase
    .from("widgets")
    .select("id, visual_type, settings, grid_position")
    .eq("dashboard_id", dashboardId);

  // Carimbo CAS: só quem transicionar o gridVersion converte as linhas.
  const stamped: DashboardSettings = {
    ...settings,
    canvas: convertLegacyCanvas(settings.canvas),
  };
  const { count, error } = await supabase
    .from("dashboards")
    .update({ settings: stamped }, { count: "exact" })
    .eq("id", dashboardId)
    .is("settings->canvas->>gridVersion", null);
  if (error || !count) return;

  for (const r of rows ?? []) {
    const w = r as unknown as Widget;
    const conv = convertLegacyWidget(w);
    if (conv === w) continue;
    await supabase
      .from("widgets")
      .update({
        grid_position: conv.grid_position,
        ...(conv.settings !== w.settings ? { settings: conv.settings } : {}),
      })
      .eq("id", r.id as string)
      .eq("dashboard_id", dashboardId);
  }
}

// ---------------- Widgets ----------------

export async function createWidget(
  dashboardId: string,
  input: WidgetInput,
  // revalidate: false = criação "rápida" (menu de contexto): o await retorna
  // logo após o INSERT, sem esperar o re-render RSC do dashboard inteiro; o
  // cliente mostra o widget otimista e dispara router.refresh() por fora.
  opts?: { revalidate?: boolean }
): Promise<ActionState & { id?: string }> {
  const session = await getSessionInfo();
  if (!session) return { ok: false, message: "Sessão expirada." };
  const supabase = await createClient();
  // O input chega em unidades FINAS (cliente normalizado) — converte o board
  // legado antes para não misturar escalas.
  await ensureFineGrid(supabase, dashboardId);
  // Fallback de posição (o builder normalmente já envia grid_position): logo
  // abaixo do widget mais fundo do dashboard, em vez de um y fixo lá no fim da
  // página. Sem noção de abas aqui — o cliente cobre o caso comum.
  let position = input.grid_position;
  if (!position) {
    const { data: existing } = await supabase
      .from("widgets")
      .select("grid_position")
      .eq("dashboard_id", dashboardId);
    const maxBottom = (existing ?? []).reduce((m, r) => {
      const p = r.grid_position as { y?: number; h?: number } | null;
      return typeof p?.y === "number" && typeof p?.h === "number"
        ? Math.max(m, p.y + p.h)
        : m;
    }, 0);
    position = { x: 0, y: maxBottom, w: 59, h: 31 };
  }
  // Alocação como campo (invariante 24): widget NOVO nunca herda o vínculo
  // (duplicar/copiar um kanban escreveria no campo do quadro original).
  let createSettings = input.settings;
  if (createSettings?.kanban?.allocationFieldKey) {
    const { allocationFieldKey: _drop, ...kanban } = createSettings.kanban;
    createSettings = { ...createSettings, kanban };
  }
  const { data, error } = await supabase
    .from("widgets")
    .insert({
      dashboard_id: dashboardId,
      title: input.title,
      visual_type: input.visual_type,
      source: "records",
      sources: input.sources ?? [],
      split_by_source: input.splitBySource ?? false,
      dimensions: input.dimensions,
      metrics: input.metrics,
      filters: input.filters,
      // Widget Imagem: URLs não-https nunca são persistidas (o settings
      // congelado chega ao viewer público de snapshots).
      settings: sanitizeImageSettings(createSettings),
      grid_position: position,
    })
    .select("id")
    .maybeSingle();
  if (error) return { ok: false, message: error.message };
  if (opts?.revalidate !== false) revalidatePath(`/dashboards/${dashboardId}`);
  return { ok: true, id: (data?.id as string) ?? undefined };
}

export async function updateWidget(
  widgetId: string,
  dashboardId: string,
  input: WidgetInput
): Promise<ActionState> {
  const session = await getSessionInfo();
  if (!session) return { ok: false, message: "Sessão expirada." };
  const supabase = await createClient();
  // Alocação como campo (invariante 24): o builder pode trocar a base ou o
  // modo de colunas — normaliza a chave contra o estado anterior.
  let nextSettings = input.settings;
  let maintenance = false;
  if (input.settings?.kanban?.allocationFieldKey) {
    const { data: prevRow } = await supabase
      .from("widgets")
      .select("settings")
      .eq("id", widgetId)
      .maybeSingle();
    const prevKanban =
      ((prevRow?.settings as WidgetSettings | null) ?? null)?.kanban ?? null;
    const norm = normalizeKanbanAllocationOnSave(
      prevKanban,
      input.settings.kanban
    );
    nextSettings = { ...input.settings, kanban: norm.kanban };
    maintenance = norm.maintenance;
  }
  const { error } = await supabase
    .from("widgets")
    .update({
      title: input.title,
      visual_type: input.visual_type,
      sources: input.sources ?? [],
      split_by_source: input.splitBySource ?? false,
      dimensions: input.dimensions,
      metrics: input.metrics,
      filters: input.filters,
      settings: sanitizeImageSettings(nextSettings),
    })
    .eq("id", widgetId);
  if (error) return { ok: false, message: error.message };
  if (maintenance) {
    await reconcileAllocationBestEffort({ kind: "widget", id: widgetId });
  }
  revalidatePath(`/dashboards/${dashboardId}`);
  return { ok: true };
}

// Grava uma célula de um widget "Tabela editável" (Fase 2). Editável por
// qualquer visualizador do dashboard — a RLS de dashboard_table_cells reforça.
// value vazio (null/"") apaga a célula; senão faz upsert. router.refresh() no
// cliente recomputa o widget; revalida por garantia para outros caminhos.
export async function saveTableCell(
  dashboardId: string,
  widgetId: string,
  rowKey: string,
  colKey: string,
  value: number | string | null
): Promise<ActionState> {
  const session = await getSessionInfo();
  if (!session) return { ok: false, message: "Sessão expirada." };
  const supabase = await createClient();

  const empty = value == null || value === "";
  if (empty) {
    const { error } = await supabase
      .from("dashboard_table_cells")
      .delete()
      .eq("widget_id", widgetId)
      .eq("row_key", rowKey)
      .eq("col_key", colKey);
    if (error) return { ok: false, message: error.message };
  } else {
    const { error } = await supabase.from("dashboard_table_cells").upsert(
      {
        widget_id: widgetId,
        row_key: rowKey,
        col_key: colKey,
        value,
        updated_by: session.user.id,
      },
      { onConflict: "widget_id,row_key,col_key" }
    );
    if (error) return { ok: false, message: error.message };
  }
  revalidatePath(`/dashboards/${dashboardId}`);
  return { ok: true };
}

// Grava um LOTE de células de um widget "Tabela Livre" (digitação, colar TSV,
// limpar seleção). Além da RLS de dashboard_table_cells (qualquer visualizador
// do dashboard), valida por coluna o bloqueio por papel (editableRoles em
// settings.quickTable) — a RLS não distingue coluna, então o reforço fica aqui
// (mesmo padrão do updateEntityField). Valor vazio (null/"") apaga a célula.
export async function saveQuickTableCells(
  dashboardId: string,
  widgetId: string,
  cells: { rowKey: string; colKey: string; value: number | string | null }[]
): Promise<ActionState> {
  const session = await getSessionInfo();
  if (!session) return { ok: false, message: "Sessão expirada." };
  if (cells.length === 0) return { ok: true };
  if (cells.length > 2000) {
    return { ok: false, message: "Lote de células grande demais." };
  }
  // Rows reservadas (__qf__/__calc__) nunca passam por aqui.
  if (cells.some((c) => c.rowKey.startsWith("__"))) {
    return { ok: false, message: "Chave de linha inválida." };
  }
  const supabase = await createClient();

  const { data: w } = await supabase
    .from("widgets")
    .select("settings")
    .eq("id", widgetId)
    .eq("dashboard_id", dashboardId)
    .maybeSingle();
  if (!w) return { ok: false, message: "Widget não encontrado." };
  const qt = ((w.settings ?? {}) as WidgetSettings).quickTable;
  if (!qt) return { ok: false, message: "Este widget não é uma Tabela Livre." };

  // Toda célula digitável pertence a uma coluna LIVRE existente cuja
  // allowlist de papéis (se houver) inclui o usuário. Rejeita o lote inteiro
  // em qualquer violação (sem gravação parcial silenciosa).
  const colById = new Map(qt.columns.map((c) => [c.id, c]));
  for (const c of cells) {
    const col = colById.get(baseColId(c.colKey));
    if (!col) {
      return { ok: false, message: "Coluna não encontrada (estrutura mudou)." };
    }
    if (!canTypeInColumn(col, session.roles)) {
      return { ok: false, message: "Coluna bloqueada para o seu papel." };
    }
  }

  const empty = cells.filter((c) => c.value == null || c.value === "");
  const filled = cells.filter((c) => !(c.value == null || c.value === ""));

  // Apaga células esvaziadas agrupando por linha (1 delete por linha, todos em
  // PARALELO — antes eram aguardados em série).
  const emptyByRow = new Map<string, string[]>();
  for (const c of empty) {
    (emptyByRow.get(c.rowKey) ?? emptyByRow.set(c.rowKey, []).get(c.rowKey)!)
      .push(c.colKey);
  }
  if (emptyByRow.size > 0) {
    const results = await Promise.all(
      [...emptyByRow.entries()].map(([rowKey, colKeys]) =>
        supabase
          .from("dashboard_table_cells")
          .delete()
          .eq("widget_id", widgetId)
          .eq("row_key", rowKey)
          .in("col_key", colKeys)
      )
    );
    const failed = results.find((r) => r.error);
    if (failed?.error) return { ok: false, message: failed.error.message };
  }

  // Upsert das preenchidas em blocos.
  for (let i = 0; i < filled.length; i += 500) {
    const chunk = filled.slice(i, i + 500);
    const { error } = await supabase.from("dashboard_table_cells").upsert(
      chunk.map((c) => ({
        widget_id: widgetId,
        row_key: c.rowKey,
        col_key: c.colKey,
        value: c.value,
        updated_by: session.user.id,
      })),
      { onConflict: "widget_id,row_key,col_key" }
    );
    if (error) return { ok: false, message: error.message };
  }

  // SEM revalidatePath de propósito (digitação fluida): o cliente reconcilia
  // com router.refresh() debounced — que também alimenta o Desfazer/Refazer.
  return { ok: true };
}

// ---------------- Filtros rápidos (valores compartilhados) ----------------

// Grava a SELEÇÃO de um filtro rápido de widget. Os valores vivem em
// dashboard_table_cells (row_key '__qf__', col_key = id do entry) de propósito:
// a RLS dessa tabela permite escrita por QUALQUER visualizador do dashboard
// (0026), então a seleção persiste entre usuários e reloads — a regra pedida.
// value null/vazio apaga a célula (volta ao "sem filtro").
export async function saveQuickFilterValue(
  dashboardId: string,
  widgetId: string,
  entryId: string,
  value: QuickFilterValue | null
): Promise<ActionState> {
  const session = await getSessionInfo();
  if (!session) return { ok: false, message: "Sessão expirada." };
  const supabase = await createClient();

  const empty =
    value == null ||
    (value.kind === "options" && value.values.length === 0) ||
    (value.kind === "period" && !value.preset && !value.de && !value.ate);
  if (empty) {
    const { error } = await supabase
      .from("dashboard_table_cells")
      .delete()
      .eq("widget_id", widgetId)
      .eq("row_key", QF_ROW_KEY)
      .eq("col_key", entryId);
    if (error) return { ok: false, message: error.message };
  } else {
    const { error } = await supabase.from("dashboard_table_cells").upsert(
      {
        widget_id: widgetId,
        row_key: QF_ROW_KEY,
        col_key: entryId,
        value,
        updated_by: session.user.id,
      },
      { onConflict: "widget_id,row_key,col_key" }
    );
    if (error) return { ok: false, message: error.message };
  }
  revalidatePath(`/dashboards/${dashboardId}`);
  return { ok: true };
}

// Opções candidatas p/ o picker "Opções visíveis" do construtor (blacklist
// hiddenOptions do filtro_campo/filtros rápidos). Espelha as consultas de
// opções da page: responsáveis/operações ATIVOS; etapas = pares distintos
// record_type × stage do RPC run_widget_query existente, recortados pelas
// fontes do widget quando informadas (subs resolvem para o record_type da
// pai via catálogo). Chamado lazy, só quando o autor abre o picker.
export async function listFilterOptionCandidates(
  kind: "responsible" | "operation" | "stage",
  sources?: SourceKey[]
): Promise<{ value: string; label: string }[]> {
  const session = await getSessionInfo();
  if (!session) return [];
  const supabase = await createClient();
  if (kind === "responsible") {
    const { data } = await supabase
      .from("responsibles")
      .select("id, display_name, canonical_id")
      .eq("active", true)
      .order("display_name");
    // Agrupamento (0101): apelidos colapsam no principal (mesma lista que os
    // dropdowns exibem).
    const rows = (data ?? []) as {
      id: string;
      display_name: string;
      canonical_id?: string | null;
    }[];
    return collapseResponsibleOptions(
      rows.map((r) => ({ value: r.id, label: r.display_name ?? "—" })),
      buildResponsibleCanon(rows)
    );
  }
  if (kind === "operation") {
    const { data } = await supabase
      .from("operations")
      .select("id, name")
      .eq("active", true)
      .order("name");
    return (data ?? []).map((o) => ({
      value: o.id as string,
      label: (o.name as string) ?? "—",
    }));
  }
  const [{ data }, catalog] = await Promise.all([
    supabase.rpc("run_widget_query", {
      p_source: "records",
      p_dimensions: [{ field: "record_type" }, { field: "stage" }],
      p_metrics: [],
      p_filters: [],
      p_correspondences: {},
    }),
    loadSources(supabase),
  ]);
  const wanted =
    sources && sources.length > 0
      ? new Set(sources.map((s) => recordTypeOf(s, catalog)))
      : null;
  const set = new Set<string>();
  for (const row of (Array.isArray(data) ? data : []) as Record<
    string,
    unknown
  >[]) {
    const rt = String(row.dim_1 ?? "");
    const st = row.dim_2 == null ? "" : String(row.dim_2);
    if (!rt || !st) continue;
    if (wanted && !wanted.has(rt)) continue;
    set.add(st);
  }
  return [...set]
    .sort((a, b) => a.localeCompare(b, "pt-BR"))
    .map((s) => ({ value: s, label: s }));
}

// Grava a seleção da JANELA DE PERÍODOS do widget (settings.periodWindow —
// dropdown de meses + toggle dia útil no card). Mesma tabela/semântica dos
// filtros rápidos: compartilhada entre usuários (RLS 0026). null/vazio apaga
// (volta ao default do widget).
export async function savePeriodWindowChoice(
  dashboardId: string,
  widgetId: string,
  choice: PeriodWindowChoice | null
): Promise<ActionState> {
  const session = await getSessionInfo();
  if (!session) return { ok: false, message: "Sessão expirada." };
  const supabase = await createClient();
  const clean = parsePeriodWindowChoice(choice);
  if (!clean) {
    const { error } = await supabase
      .from("dashboard_table_cells")
      .delete()
      .eq("widget_id", widgetId)
      .eq("row_key", PW_ROW_KEY)
      .eq("col_key", PW_COL_KEY);
    if (error) return { ok: false, message: error.message };
  } else {
    const { error } = await supabase.from("dashboard_table_cells").upsert(
      {
        widget_id: widgetId,
        row_key: PW_ROW_KEY,
        col_key: PW_COL_KEY,
        value: clean,
        updated_by: session.user.id,
      },
      { onConflict: "widget_id,row_key,col_key" }
    );
    if (error) return { ok: false, message: error.message };
  }
  revalidatePath(`/dashboards/${dashboardId}`);
  return { ok: true };
}

// Grava o valor COMPARTILHADO de um widget "Filtro por campo" com
// settings.valueScope 'all' (célula __ff__/sel; value = a mesma string
// codificada de ff_<id>/lastFieldFilters). Mesma tabela/semântica dos filtros
// rápidos: a RLS (0026/0088/0091) permite escrita por QUALQUER visualizador
// efetivo do dashboard — é a feature (quem muda o filtro muda para todos);
// auth aqui é só a sessão. encoded null/vazio apaga a célula.
export async function saveSharedFieldFilter(
  dashboardId: string,
  widgetId: string,
  encoded: string | null
): Promise<ActionState> {
  const session = await getSessionInfo();
  if (!session) return { ok: false, message: "Sessão expirada." };
  const supabase = await createClient();
  if (!encoded) {
    const { error } = await supabase
      .from("dashboard_table_cells")
      .delete()
      .eq("widget_id", widgetId)
      .eq("row_key", FF_ROW_KEY)
      .eq("col_key", FF_COL_KEY);
    if (error) return { ok: false, message: error.message };
  } else {
    const { error } = await supabase.from("dashboard_table_cells").upsert(
      {
        widget_id: widgetId,
        row_key: FF_ROW_KEY,
        col_key: FF_COL_KEY,
        value: encoded,
        updated_by: session.user.id,
      },
      { onConflict: "widget_id,row_key,col_key" }
    );
    if (error) return { ok: false, message: error.message };
  }
  revalidatePath(`/dashboards/${dashboardId}`);
  return { ok: true };
}

// ---------------- Calculadora (expressão compartilhada) ----------------

// Grava a expressão corrente do widget Calculadora. Vive em
// dashboard_table_cells (row_key '__calc__') pelo mesmo motivo dos filtros
// rápidos: a RLS permite escrita por QUALQUER visualizador (0026), então o
// último cálculo persiste entre usuários e reloads. Sem revalidatePath: o
// estado do cliente manda (avaliação é local); o valor só semeia o próximo
// carregamento da página. Expressão vazia apaga a célula.
export async function saveCalcExpression(
  dashboardId: string,
  widgetId: string,
  expr: string
): Promise<ActionState> {
  const session = await getSessionInfo();
  if (!session) return { ok: false, message: "Sessão expirada." };
  const supabase = await createClient();

  if (!expr.trim()) {
    const { error } = await supabase
      .from("dashboard_table_cells")
      .delete()
      .eq("widget_id", widgetId)
      .eq("row_key", CALC_ROW_KEY)
      .eq("col_key", CALC_COL_KEY);
    if (error) return { ok: false, message: error.message };
  } else {
    const { error } = await supabase.from("dashboard_table_cells").upsert(
      {
        widget_id: widgetId,
        row_key: CALC_ROW_KEY,
        col_key: CALC_COL_KEY,
        value: expr,
        updated_by: session.user.id,
      },
      { onConflict: "widget_id,row_key,col_key" }
    );
    if (error) return { ok: false, message: error.message };
  }
  return { ok: true };
}

// ---------------- Atalhos para widgets (links) ----------------

// Catálogo de destinos de atalho (formas e links de nota): dashboards visíveis
// ao usuário (RLS filtra) com suas abas e widgets ("Título (Tipo)"). Chamado
// sob demanda pelo picker (components/dashboards/widget-link-picker.tsx).
export interface LinkTargetsCatalog {
  dashboards: {
    id: string;
    name: string;
    tabs: { id: string; name: string }[];
    widgets: {
      id: string;
      title: string | null;
      visual_type: VisualType;
      tab?: string;
    }[];
  }[];
}

export async function listWidgetLinkTargets(): Promise<LinkTargetsCatalog> {
  const session = await getSessionInfo();
  if (!session) return { dashboards: [] };
  const supabase = await createClient();

  const [{ data: dashData }, { data: widgetData }] = await Promise.all([
    // Kanbans (kind 'kanban') não têm widgets/abas — fora do catálogo de atalhos.
    // Board na Lixeira (0087) não abre — fora dos destinos (arquivado segue).
    supabase
      .from("dashboards")
      .select("id, name, settings")
      .eq("kind", "dashboard")
      .neq("status", "trashed"),
    supabase.from("widgets").select("id, dashboard_id, title, visual_type, settings"),
  ]);

  const byDash = new Map<string, LinkTargetsCatalog["dashboards"][number]>();
  for (const d of dashData ?? []) {
    const settings = (d.settings ?? {}) as DashboardSettings;
    byDash.set(d.id as string, {
      id: d.id as string,
      name: d.name as string,
      tabs: (settings.tabs ?? []).map((t) => ({ id: t.id, name: t.name })),
      widgets: [],
    });
  }
  for (const w of widgetData ?? []) {
    const dash = byDash.get(w.dashboard_id as string);
    if (!dash) continue;
    const settings = (w.settings ?? {}) as WidgetSettings;
    dash.widgets.push({
      id: w.id as string,
      title: (w.title as string | null) ?? null,
      visual_type: w.visual_type as VisualType,
      tab: settings.tab,
    });
  }
  return {
    dashboards: [...byDash.values()].sort((a, b) =>
      a.name.localeCompare(b.name, "pt-BR")
    ),
  };
}

// Sincronização UNIDIRECIONAL barra global → filtros rápidos de período: quando
// a barra de período navega, os filtros rápidos de data no formato padrão cujo
// campo é o MESMO da barra recebem a mesma seleção (persistida p/ todos). O
// caminho inverso não existe — mudar o filtro do widget nunca toca a barra.
// `tab` (escopo por aba): restringe aos widgets da aba ativa; widgets sem
// etiqueta pertencem à primeira aba (isFirst).
export async function syncGlobalPeriodQuickFilters(
  dashboardId: string,
  campo: string,
  sel: { preset?: string; de?: string; ate?: string },
  tab?: { tabId: string; isFirst: boolean }
): Promise<void> {
  const session = await getSessionInfo();
  if (!session || !campo) return;
  const supabase = await createClient();

  const { data: widgetsData } = await supabase
    .from("widgets")
    .select("id, settings")
    .eq("dashboard_id", dashboardId);

  const value: QuickFilterValue = {
    kind: "period",
    preset: sel.preset ?? "",
    de: sel.de ?? "",
    ate: sel.ate ?? "",
  };
  const rows: {
    widget_id: string;
    row_key: string;
    col_key: string;
    value: QuickFilterValue;
    updated_by: string;
  }[] = [];
  for (const w of (widgetsData ?? []) as Pick<Widget, "id" | "settings">[]) {
    if (tab) {
      const wTab = w.settings?.tab;
      const inTab = wTab ? wTab === tab.tabId : tab.isFirst;
      if (!inTab) continue;
    }
    for (const entry of w.settings?.quickFilters ?? []) {
      // Só datas no formato padrão (dropdown de período) do mesmo campo da
      // barra. Formatos com transform não são espelho do período geral.
      if (entry.transform && entry.transform !== "none") continue;
      if (entry.field !== campo) continue;
      rows.push({
        widget_id: w.id,
        row_key: QF_ROW_KEY,
        col_key: entry.id,
        value,
        updated_by: session.user.id,
      });
    }
  }
  if (rows.length === 0) return;
  await supabase
    .from("dashboard_table_cells")
    .upsert(rows, { onConflict: "widget_id,row_key,col_key" });
  // Revalida ao FINAL: cobre a corrida com o router.replace da barra (que pode
  // ter recomputado antes do upsert terminar).
  revalidatePath(`/dashboards/${dashboardId}`);
}

// Coage o valor cru (string do input) para o tipo do campo antes de gravar em
// entity_custom_values. Espelha a coerção de lib/records/actions.ts (numero/moeda,
// booleano, e texto/data/seleção como string). '' → null (apaga a célula).
function coerceEntityValue(
  dataType: string,
  raw: string
): number | string | boolean | null {
  const s = raw.trim();
  if (s === "") return null;
  if (dataType === "numero" || dataType === "moeda") {
    const n = Number(s.replace(/\./g, "").replace(",", "."));
    return Number.isNaN(Number(s)) ? (Number.isNaN(n) ? null : n) : Number(s);
  }
  if (dataType === "booleano") {
    return s === "true" ? true : s === "false" ? false : null;
  }
  return s; // texto, data (ISO), seleção
}

// Grava um valor de campo personalizado ligado a uma ENTIDADE (responsável ou
// operação), usado pelas tabelas de dashboard em modo lista por entidade. Valida
// a permissão global (edit_record_values) e a editabilidade do campo por papel
// (editable_by_roles); campos calculados nunca são graváveis. value vazio apaga.
export async function updateEntityField(
  entityType: "responsible" | "operation",
  entityId: string,
  fieldKey: string,
  rawValue: string,
  // Dashboard de origem: revalida SÓ ele (outros dashboards que exibem o mesmo
  // valor global atualizam na próxima navegação — páginas dinâmicas). Ausente
  // (compat) = revalida todos, como antes.
  dashboardId?: string
): Promise<ActionState> {
  const session = await getSessionInfo();
  if (!session) return { ok: false, message: "Sessão expirada." };
  if (!session.permissions.includes("edit_record_values")) {
    return { ok: false, message: "Você não tem permissão para editar valores." };
  }
  const supabase = await createClient();

  // Confere o campo: existe, não é calculado e é editável pelo papel do usuário.
  const { data: def } = await supabase
    .from("field_definitions")
    .select("data_type, editable_by_roles")
    .eq("field_key", fieldKey)
    .maybeSingle();
  if (!def) return { ok: false, message: "Campo não encontrado." };
  if (
    (def.data_type as string) === "calculado" ||
    (def.data_type as string) === "calculado_agg"
  ) {
    return { ok: false, message: "Campo calculado não é editável." };
  }
  const editable = ((def.editable_by_roles as string[]) ?? []).some((r) =>
    session.roles.includes(r)
  );
  if (!editable) {
    return { ok: false, message: "Você não pode editar este campo." };
  }

  const value = coerceEntityValue(def.data_type as string, rawValue);
  if (value == null) {
    const { error } = await supabase
      .from("entity_custom_values")
      .delete()
      .eq("entity_type", entityType)
      .eq("entity_id", entityId)
      .eq("field_key", fieldKey);
    if (error) return { ok: false, message: error.message };
  } else {
    const { error } = await supabase.from("entity_custom_values").upsert(
      {
        entity_type: entityType,
        entity_id: entityId,
        field_key: fieldKey,
        value,
        updated_by: session.user.id,
      },
      { onConflict: "entity_type,entity_id,field_key" }
    );
    if (error) return { ok: false, message: error.message };
  }
  if (dashboardId) revalidatePath(`/dashboards/${dashboardId}`);
  else revalidatePath("/dashboards/[id]", "page");
  return { ok: true };
}

// Atualiza só a coluna `settings` de um widget (usado pelas edições de aparência
// in-loco: reordenar/ordenar/colorir direto na tabela ou no gráfico). O cliente
// envia o settings completo já mesclado ({ ...widget.settings, appearance }).
// RLS restringe a owner/admin (widgets_write). router.refresh() no cliente
// recomputa; não revalidamos aqui p/ manter a edição fluida.
export async function saveWidgetSettings(
  widgetId: string,
  dashboardId: string,
  settings: WidgetSettings
): Promise<ActionState> {
  const session = await getSessionInfo();
  if (!session) return { ok: false, message: "Sessão expirada." };
  const supabase = await createClient();
  // Alocação como campo (invariante 24): normaliza a chave no save (gate
  // barato — hot path de aparência segue sem custo quando não há vínculo).
  let next = settings;
  let maintenance = false;
  if (settings.kanban?.allocationFieldKey) {
    const { data: prevRow } = await supabase
      .from("widgets")
      .select("settings")
      .eq("id", widgetId)
      .maybeSingle();
    const prevKanban =
      ((prevRow?.settings as WidgetSettings | null) ?? null)?.kanban ?? null;
    const norm = normalizeKanbanAllocationOnSave(prevKanban, settings.kanban);
    next = { ...settings, kanban: norm.kanban };
    maintenance = norm.maintenance;
  }
  const { error } = await supabase
    .from("widgets")
    .update({ settings: sanitizeImageSettings(next) })
    .eq("id", widgetId)
    .eq("dashboard_id", dashboardId);
  if (error) return { ok: false, message: error.message };
  if (maintenance) {
    await reconcileAllocationBestEffort({ kind: "widget", id: widgetId });
  }
  return { ok: true };
}

// ---------------- Páginas de widget (mescla) ----------------
// Ver lib/widgets/pages.ts (módulo puro) e docs/arquitetura.md. O vínculo vive
// em `settings.pages` do HOST; membros são linhas normais ocultadas do grid.

// Devolve membros recém-liberados ao canvas: posição livre na aba EFETIVA de
// cada um (findFreePosition), considerando só os widgets VISÍVEIS da mesma aba
// (membros ocultos não ocupam espaço) e os já-reposicionados desta leva.
// Chamar SEMPRE depois de atualizar/excluir o host — o cálculo de "oculto"
// relê o banco.
async function freePageMembers(
  supabase: Awaited<ReturnType<typeof createClient>>,
  dashboardId: string,
  memberIds: string[]
): Promise<string | null> {
  if (memberIds.length === 0) return null;
  const [{ data: dashRow }, { data: rows }] = await Promise.all([
    supabase
      .from("dashboards")
      .select("settings")
      .eq("id", dashboardId)
      .maybeSingle(),
    supabase
      .from("widgets")
      .select("id, visual_type, settings, grid_position")
      .eq("dashboard_id", dashboardId),
  ]);
  const dashSettings = (dashRow?.settings ?? {}) as DashboardSettings;
  const widgets = (rows ?? []) as Widget[];
  const hidden = collectPageMembers(widgets);
  const tabs = dashSettings.tabs ?? [];
  const tabIds = new Set(tabs.map((t) => t.id));
  const firstTab = tabs[0]?.id ?? "";
  const effTab = (w: Widget) => {
    const t = w.settings?.tab;
    return t && tabIds.has(t) ? t : firstTab;
  };
  const cols = Math.max(
    dashSettings.canvas?.cols ?? 0,
    dashSettings.canvas?.baseCols ?? 0,
    BASE_COLS
  );
  const placed: { tab: string; pos: GridPosition }[] = [];
  for (const id of memberIds) {
    const idx = widgets.findIndex((w) => w.id === id);
    if (idx < 0) continue;
    const member = widgets[idx];
    const tab = effTab(member);
    const size = posOf(member, idx);
    const occupied: GridPosition[] = [];
    widgets.forEach((w2, i) => {
      if (w2.id === id || hidden.has(w2.id) || effTab(w2) !== tab) return;
      occupied.push(posOf(w2, i));
    });
    for (const p of placed) if (p.tab === tab) occupied.push(p.pos);
    const pos = findFreePosition(occupied, cols, size.w, size.h);
    placed.push({ tab, pos });
    const { error } = await supabase
      .from("widgets")
      .update({ grid_position: pos })
      .eq("id", id)
      .eq("dashboard_id", dashboardId);
    if (error) return error.message;
  }
  return null;
}

// Mescla: os widgets de `memberIds` viram PÁGINAS do host (ocultos do grid,
// alternados pelas setinhas). Disparada pelo drop quase-em-cima (diálogo
// "Adicionar página?") e pelo ⋮ → "Adicionar página". RLS (widgets_write)
// restringe a dono/admin.
export async function mergeWidgetPages(
  dashboardId: string,
  hostId: string,
  memberIds: string[]
): Promise<ActionState> {
  const session = await getSessionInfo();
  if (!session) return { ok: false, message: "Sessão expirada." };
  const clean = [...new Set(memberIds.map(String).filter(Boolean))];
  if (!hostId || clean.length === 0) {
    return { ok: false, message: "Seleção inválida." };
  }
  const supabase = await createClient();
  await ensureFineGrid(supabase, dashboardId);
  const { data: rows } = await supabase
    .from("widgets")
    .select("id, visual_type, settings")
    .eq("dashboard_id", dashboardId);
  const widgets = (rows ?? []) as Widget[];
  const byId = new Map(widgets.map((w) => [w.id, w]));
  const host = byId.get(hostId);
  if (!host) return { ok: false, message: "Widget não encontrado." };
  if (!canBePage(host)) {
    return { ok: false, message: "Este tipo de widget não aceita páginas." };
  }
  const memberOf = collectPageMembers(widgets);
  const existing = pageMembersOf(host);
  const additions: string[] = [];
  for (const id of clean) {
    if (id === hostId) {
      return { ok: false, message: "Um widget não pode ser página dele mesmo." };
    }
    const m = byId.get(id);
    if (!m) return { ok: false, message: "Widget não encontrado." };
    if (!canBePage(m)) {
      return { ok: false, message: "Este tipo de widget não pode virar página." };
    }
    if (isPageHost(m)) {
      return {
        ok: false,
        message:
          "O widget escolhido já tem páginas — desfaça a mescla dele antes.",
      };
    }
    if (memberOf.has(id)) {
      return {
        ok: false,
        message: "O widget escolhido já é página de outro widget.",
      };
    }
    if (!existing.includes(id)) additions.push(id);
  }
  if (additions.length === 0) return { ok: true };

  // Aba efetiva do host: membros são puxados para ela — o refresh de snapshot
  // congela POR ABA (membro em outra aba ficaria fora do config) e o desfazer
  // mescla devolve o membro na aba onde o host está.
  const { data: dashRow } = await supabase
    .from("dashboards")
    .select("settings")
    .eq("id", dashboardId)
    .maybeSingle();
  const dashSettings = (dashRow?.settings ?? {}) as DashboardSettings;
  const tabs = dashSettings.tabs ?? [];
  const tabIds = new Set(tabs.map((t) => t.id));
  const hostTabRaw = host.settings?.tab;
  const hostTab =
    hostTabRaw && tabIds.has(hostTabRaw) ? hostTabRaw : tabs[0]?.id;
  for (const id of additions) {
    const m = byId.get(id)!;
    const ms: WidgetSettings = { ...(m.settings ?? {}) };
    if (hostTab) ms.tab = hostTab;
    else delete ms.tab;
    const { error } = await supabase
      .from("widgets")
      .update({ settings: ms })
      .eq("id", id)
      .eq("dashboard_id", dashboardId);
    if (error) return { ok: false, message: error.message };
  }
  const { error } = await supabase
    .from("widgets")
    .update({
      settings: {
        ...(host.settings ?? {}),
        pages: [...existing, ...additions],
      },
    })
    .eq("id", hostId)
    .eq("dashboard_id", dashboardId);
  if (error) return { ok: false, message: error.message };

  // Conectores com ponta num membro saem (o card some do canvas) — mesmo
  // padrão da limpeza do deleteWidget.
  const connectors = dashSettings.connectors ?? [];
  const memberSet = new Set(additions);
  if (
    connectors.some(
      (c) => memberSet.has(c.from.widgetId) || memberSet.has(c.to.widgetId)
    )
  ) {
    await supabase
      .from("dashboards")
      .update({
        settings: {
          ...dashSettings,
          connectors: connectors.filter(
            (c) =>
              !memberSet.has(c.from.widgetId) && !memberSet.has(c.to.widgetId)
          ),
        },
      })
      .eq("id", dashboardId);
  }
  revalidatePath(`/dashboards/${dashboardId}`);
  return { ok: true };
}

// Desfazer mescla: devolve membros (todos, ou só os informados) ao canvas em
// posição livre da aba do host. RLS (widgets_write) restringe a dono/admin.
export async function unmergeWidgetPages(
  dashboardId: string,
  hostId: string,
  memberIds?: string[]
): Promise<ActionState> {
  const session = await getSessionInfo();
  if (!session) return { ok: false, message: "Sessão expirada." };
  const supabase = await createClient();
  await ensureFineGrid(supabase, dashboardId);
  const { data: hostRow } = await supabase
    .from("widgets")
    .select("id, settings")
    .eq("id", hostId)
    .eq("dashboard_id", dashboardId)
    .maybeSingle();
  if (!hostRow) return { ok: false, message: "Widget não encontrado." };
  const hostSettings = (hostRow.settings ?? {}) as WidgetSettings;
  const current = pageMembersOf({ settings: hostSettings });
  const freed = memberIds
    ? current.filter((id) => memberIds.includes(id))
    : current;
  if (freed.length === 0) return { ok: true };
  const remaining = current.filter((id) => !freed.includes(id));
  const nextSettings: WidgetSettings = { ...hostSettings };
  if (remaining.length > 0) nextSettings.pages = remaining;
  else delete nextSettings.pages;
  const { error } = await supabase
    .from("widgets")
    .update({ settings: nextSettings })
    .eq("id", hostId)
    .eq("dashboard_id", dashboardId);
  if (error) return { ok: false, message: error.message };
  const freeErr = await freePageMembers(supabase, dashboardId, freed);
  if (freeErr) return { ok: false, message: freeErr };
  revalidatePath(`/dashboards/${dashboardId}`);
  return { ok: true };
}

export async function deleteWidget(
  widgetId: string,
  dashboardId: string
): Promise<ActionState> {
  const session = await getSessionInfo();
  if (!session) return { ok: false, message: "Sessão expirada." };
  const supabase = await createClient();
  // Páginas de widget: as settings precisam ser lidas ANTES do delete — um
  // HOST excluído devolve os membros (ocultos) ao canvas; um MEMBRO excluído
  // sai do `pages` de quem o referencia (senão o pager pularia um id morto
  // para sempre e o unmerge tentaria reposicionar um widget inexistente).
  const { data: victim } = await supabase
    .from("widgets")
    .select("settings")
    .eq("id", widgetId)
    .eq("dashboard_id", dashboardId)
    .maybeSingle();
  const victimPages = pageMembersOf({
    settings: (victim?.settings ?? {}) as WidgetSettings,
  });
  // Só o delete principal decide sucesso/falha (RLS negada aparece aqui);
  // as limpezas abaixo (pages/conectores) seguem best-effort.
  const { error: deleteError } = await supabase
    .from("widgets")
    .delete()
    .eq("id", widgetId);
  if (deleteError) return { ok: false, message: deleteError.message };
  if (victimPages.length > 0) {
    await freePageMembers(supabase, dashboardId, victimPages);
  }
  const { data: hostRows } = await supabase
    .from("widgets")
    .select("id, settings")
    .eq("dashboard_id", dashboardId);
  for (const row of hostRows ?? []) {
    const s = (row.settings ?? {}) as WidgetSettings;
    const pages = pageMembersOf({ settings: s });
    if (!pages.includes(widgetId)) continue;
    const rest = pages.filter((id) => id !== widgetId);
    const next: WidgetSettings = { ...s };
    if (rest.length > 0) next.pages = rest;
    else delete next.pages;
    await supabase
      .from("widgets")
      .update({ settings: next })
      .eq("id", row.id as string);
  }

  // Conectores órfãos (ponta no widget excluído) saem do settings do dashboard.
  const { data: dash } = await supabase
    .from("dashboards")
    .select("settings")
    .eq("id", dashboardId)
    .maybeSingle();
  const settings = (dash?.settings ?? {}) as DashboardSettings;
  const connectors = settings.connectors ?? [];
  if (
    connectors.some(
      (c) => c.from.widgetId === widgetId || c.to.widgetId === widgetId
    )
  ) {
    await supabase
      .from("dashboards")
      .update({
        settings: {
          ...settings,
          connectors: connectors.filter(
            (c) => c.from.widgetId !== widgetId && c.to.widgetId !== widgetId
          ),
        },
      })
      .eq("id", dashboardId);
  }
  revalidatePath(`/dashboards/${dashboardId}`);
  return { ok: true };
}

// ============ Presets (motor v2, 20/07/2026) ============
// Aplicação IDEMPOTENTE de PresetDashboard (lib/presets/definitions.ts):
// cria/ATUALIZA o dashboard do usuário (identidade settings.preset.key) e os
// widgets (identidade settings.presetKey — update in-place preserva ids →
// conectores/links/células sobrevivem). Widgets sem presetKey (adicionados à
// mão) nunca são tocados; presetKey do preset que sumiu da definição é
// removido (GC). Dependências: campos e sub-fontes ausentes são criados
// (existentes nunca sobrescritos) e as chaves de métrica de meta usadas são
// registradas no registry goal_metrics. Sem UI nesta entrega — a futura aba
// "Presets" das Configurações chama applyPreset/generatePresets.

export interface PresetApplyResult {
  presetKey: string;
  dashboard: "created" | "updated";
  dashboardId: string; // p/ a aba Presets linkar "Abrir dashboard"
  widgets: { created: number; updated: number; deleted: number };
  fieldsCreated: number;
  subSourcesCreated: number;
  subSourcesSkipped: number;
  correspondencesCreated: number;
  correspondencesSkipped: number;
  // Seções de ORG (31/07/2026) — só o caminho de fábrica as aplica.
  operationsCreated: number;
  operationsSkipped: number;
  operationLinksCreated: number;
  operationLinksSkipped: number;
  compPlansCreated: number;
  compPlansSkipped: number;
  // Erros NÃO fatais das seções de org (plano pulado por operação ausente…):
  // o apply do dashboard segue, mas o admin precisa VER o motivo.
  orgSectionErrors?: string[];
}

async function ensurePresetFields(
  supabase: Awaited<ReturnType<typeof createClient>>,
  fields: PresetField[]
): Promise<{ created: number; createdCalc: boolean }> {
  if (fields.length === 0) return { created: 0, createdCalc: false };
  const { data: existingFields } = await supabase
    .from("field_definitions")
    .select("field_key");
  const have = new Set((existingFields ?? []).map((f) => f.field_key as string));
  const toCreate = fields.filter((f) => !have.has(f.field_key));
  if (toCreate.length === 0) return { created: 0, createdCalc: false };
  const { error } = await supabase.from("field_definitions").insert(
    toCreate.map((f, i) => ({
      field_key: f.field_key,
      label: f.label,
      data_type: f.data_type,
      options: f.options,
      visible_to_roles: f.visible_to_roles,
      editable_by_roles: f.editable_by_roles,
      is_local: f.is_local,
      sort_order: 100 + i,
      currency_mode: f.currency_mode ?? null,
      currency_code: null,
      // Campos calculados de preset (20/07/2026): fórmula + escopo de fonte.
      formula: f.formula ?? null,
      applies_to: f.applies_to ?? null,
      // Dropdown vivo (0113): o refresh abaixo preenche as options.
      options_source: f.options_source ?? null,
    }))
  );
  if (error) return { created: 0, createdCalc: false };
  // Campo novo com options_source ganha as options frescas já no apply
  // (best-effort — o próximo sync também as reescreve).
  if (toCreate.some((f) => f.options_source)) {
    await refreshResponsibleOptionFields(supabase, await getActiveOrgId());
  }
  return {
    created: toCreate.length,
    // 'calculado' por-registro materializa em custom_fields → o chamador
    // dispara recalcAllFormulaFields (mesmo gatilho do createField em /campos).
    createdCalc: toCreate.some((f) => f.data_type === "calculado"),
  };
}

// ---------- Seções de ORG do preset (31/07/2026) ----------
// Operações: ensure-BY-NAME (trim exato) — nunca renomeia/religa/reativa uma
// existente; pais declarados antes dos filhos (resolve sequencial); filho com
// pai não resolvido é PULADO (nunca criar raiz órfã em silêncio). Insert com
// id do app + carimbo de org (padrão do createOperation/dashboards).
async function ensurePresetOperations(
  supabase: Awaited<ReturnType<typeof createClient>>,
  orgId: string | null,
  ops: PresetOperation[]
): Promise<{
  created: number;
  skipped: number;
  errors: string[];
  // nome → id (existentes ∪ criadas) — insumo do ensure de vínculos.
  idByName: Map<string, string>;
}> {
  const { data } = await supabase.from("operations").select("id, name");
  const idByName = new Map(
    ((data ?? []) as { id: string; name: string }[]).map((o) => [
      o.name.trim(),
      o.id,
    ])
  );
  if (ops.length === 0) return { created: 0, skipped: 0, errors: [], idByName };
  let created = 0;
  let skipped = 0;
  const errors: string[] = [];
  for (const op of ops) {
    const name = op.name.trim();
    if (idByName.has(name)) {
      skipped += 1; // já existe (possivelmente ajustada) — nunca sobrescrever
      continue;
    }
    const parentId = op.parentName ? (idByName.get(op.parentName.trim()) ?? null) : null;
    if (op.parentName && !parentId) {
      skipped += 1;
      errors.push(
        `Operação "${name}": pai "${op.parentName}" não encontrado — declare o pai antes do filho.`
      );
      continue;
    }
    const newId = crypto.randomUUID();
    const { error } = await supabase.from("operations").insert({
      id: newId,
      name,
      active: true,
      ...(parentId ? { parent_operation_id: parentId } : {}),
      ...(orgId ? { organization_id: orgId } : {}),
    });
    if (error) {
      skipped += 1;
      errors.push(`Operação "${name}": ${error.message}`);
      continue;
    }
    idByName.set(name, newId);
    created += 1;
  }
  return { created, skipped, errors, idByName };
}

// Resolução de responsável por NOME (display_name exato, trim): linha
// CANÔNICA preferida quando o mesmo nome existe em canônico e apelido; alvo
// apelido resolve para o principal (canonical_id) — mesmo espírito do
// agrupamento 0101. Insumo dos vínculos declarados e da sentinela
// `@responsible:` dos filtros de widget.
async function loadResponsibleIdByName(
  supabase: Awaited<ReturnType<typeof createClient>>
): Promise<Map<string, string>> {
  const { data } = await supabase
    .from("responsibles")
    .select("id, display_name, canonical_id");
  const byName = new Map<string, { id: string; canonical: boolean }>();
  for (const r of (data ?? []) as {
    id: string;
    display_name: string | null;
    canonical_id: string | null;
  }[]) {
    const name = (r.display_name ?? "").trim();
    if (!name) continue;
    const entry = { id: r.canonical_id ?? r.id, canonical: r.canonical_id == null };
    const cur = byName.get(name);
    if (!cur || (!cur.canonical && entry.canonical)) byName.set(name, entry);
  }
  return new Map([...byName].map(([name, e]) => [name, e.id]));
}

// Vínculos responsável↔operação declarados no preset
// (PresetOperation.responsibleNames): ensure-if-absent a CADA apply — nunca
// remove nem repõe prioridade de vínculo existente (vínculos manuais
// intocados; remover permanentemente = tirar do preset). priority é UNIQUE
// por responsável — o vínculo novo entra com max(priority)+1 (nunca vira o
// primário de quem já tem operação).
async function ensurePresetOperationLinks(
  supabase: Awaited<ReturnType<typeof createClient>>,
  ops: PresetOperation[],
  opIdByName: Map<string, string>,
  respIdByName: Map<string, string>
): Promise<{ created: number; skipped: number; errors: string[] }> {
  const wanted = ops.filter((o) => (o.responsibleNames?.length ?? 0) > 0);
  if (wanted.length === 0) return { created: 0, skipped: 0, errors: [] };
  const { data: linkRows } = await supabase
    .from("responsible_operations")
    .select("responsible_id, operation_id, priority");
  const links = (linkRows ?? []) as {
    responsible_id: string;
    operation_id: string;
    priority: number | null;
  }[];
  const linkSet = new Set(links.map((l) => `${l.responsible_id}:${l.operation_id}`));
  const maxPriority = new Map<string, number>();
  for (const l of links) {
    maxPriority.set(
      l.responsible_id,
      Math.max(maxPriority.get(l.responsible_id) ?? 0, l.priority ?? 0)
    );
  }
  let created = 0;
  let skipped = 0;
  const errors: string[] = [];
  for (const op of wanted) {
    const opId = opIdByName.get(op.name.trim());
    if (!opId) {
      errors.push(`Vínculos de "${op.name}": operação não encontrada.`);
      continue;
    }
    for (const rawName of op.responsibleNames ?? []) {
      const name = rawName.trim();
      const respId = respIdByName.get(name);
      if (!respId) {
        errors.push(
          `Vínculo "${name}" → "${op.name}": responsável não encontrado (confira a grafia em Configurações → Responsáveis).`
        );
        continue;
      }
      const key = `${respId}:${opId}`;
      if (linkSet.has(key)) {
        skipped += 1;
        continue;
      }
      const priority = (maxPriority.get(respId) ?? 0) + 1;
      const { error } = await supabase
        .from("responsible_operations")
        .insert({ responsible_id: respId, operation_id: opId, priority });
      if (error) {
        errors.push(`Vínculo "${name}" → "${op.name}": ${error.message}`);
        continue;
      }
      linkSet.add(key);
      maxPriority.set(respId, priority);
      created += 1;
    }
  }
  return { created, skipped, errors };
}

// Planos de remuneração: identidade = config.presetKey (cru — sem full-parse
// dos configs alheios); ensure-only (plano existente NUNCA é sobrescrito —
// ajustes do admin sobrevivem ao re-apply). memberOperationNames resolve por
// nome — ausente PULA com erro ALTO (nunca criar plano silenciosamente ligado
// a "todos os ativos"). O config declarado passa pelo parseCompPlanConfig
// como sanidade (falha = bug do preset, reportado) e é gravado PARSEADO
// (canônico); as métricas de meta dos fatores entram no registry com rótulo
// "Plano — Fator" (mesma regra do savePlan).
async function ensurePresetCompPlans(
  supabase: Awaited<ReturnType<typeof createClient>>,
  orgId: string | null,
  plans: PresetCompPlan[]
): Promise<{ created: number; skipped: number; errors: string[] }> {
  if (plans.length === 0) return { created: 0, skipped: 0, errors: [] };
  const [{ data: planRows }, { data: opRows }] = await Promise.all([
    supabase.from("comp_plans").select("id, config"),
    supabase.from("operations").select("id, name"),
  ]);
  const havePresetKeys = new Set<string>();
  for (const row of (planRows ?? []) as { config: unknown }[]) {
    const pk = (row.config as { presetKey?: unknown } | null)?.presetKey;
    if (typeof pk === "string" && pk !== "") havePresetKeys.add(pk);
  }
  const opByName = new Map(
    ((opRows ?? []) as { id: string; name: string }[]).map((o) => [
      o.name.trim(),
      o.id,
    ])
  );
  let created = 0;
  let skipped = 0;
  const errors: string[] = [];
  for (const decl of plans) {
    if (havePresetKeys.has(decl.presetKey)) {
      skipped += 1;
      continue;
    }
    const opIds: string[] = [];
    let missingOp: string | null = null;
    for (const name of decl.memberOperationNames ?? []) {
      const id = opByName.get(name.trim());
      if (!id) {
        missingOp = name;
        break;
      }
      opIds.push(id);
    }
    if (missingOp) {
      skipped += 1;
      errors.push(
        `Plano "${decl.name}": operação "${missingOp}" não encontrada — plano não criado.`
      );
      continue;
    }
    const config = parseCompPlanConfig({
      ...decl.config,
      v: 1,
      presetKey: decl.presetKey,
      ...(opIds.length > 0 ? { memberOperationIds: opIds } : {}),
    });
    if (!config) {
      skipped += 1;
      errors.push(`Plano "${decl.name}": config inválida (bug do preset).`);
      continue;
    }
    const { error: regError } = await registerGoalMetrics(
      supabase,
      orgId,
      config.factors.map((f) => ({
        key: f.metricKey,
        label: `${decl.name} — ${f.label}`.slice(0, 60),
        money: f.money,
      }))
    );
    if (regError) {
      skipped += 1;
      errors.push(`Plano "${decl.name}": ${regError}`);
      continue;
    }
    const { error } = await supabase.from("comp_plans").insert({
      name: decl.name,
      active: true,
      base_amount_default: decl.baseAmountDefault ?? null,
      config,
      ...(orgId ? { organization_id: orgId } : {}),
    });
    if (error) {
      skipped += 1;
      errors.push(`Plano "${decl.name}": ${error.message}`);
      continue;
    }
    created += 1;
  }
  return { created, skipped, errors };
}

// Correspondências (campos unificados) do preset: cria as ausentes por `key`;
// existentes NUNCA são sobrescritas (o admin pode tê-las ajustado). Chamar
// DEPOIS de ensurePresetSubSources — o record_type de cada membro sai do
// catálogo (loadSources), que precisa enxergar as subs recém-criadas.
async function ensurePresetCorrespondences(
  supabase: Awaited<ReturnType<typeof createClient>>,
  corrs: PresetCorrespondence[]
): Promise<{ created: number; skipped: number }> {
  if (corrs.length === 0) return { created: 0, skipped: 0 };
  const catalog = await loadSources(supabase);
  const known = new Set(catalog.map((s) => s.key));
  let created = 0;
  let skipped = 0;
  for (const corr of corrs) {
    const { data: existing } = await supabase
      .from("field_correspondences")
      .select("id")
      .eq("key", corr.key)
      .maybeSingle();
    if (existing) {
      skipped += 1;
      continue;
    }
    const members = corr.members.filter((m) => known.has(m.source_key));
    if (members.length < 2) {
      skipped += 1; // membros insuficientes (fonte fora do catálogo)
      continue;
    }
    const { data: inserted, error } = await supabase
      .from("field_correspondences")
      .insert({ key: corr.key, label: corr.label, data_type: corr.data_type })
      .select("id")
      .maybeSingle();
    if (error || !inserted?.id) {
      skipped += 1;
      continue;
    }
    const { error: memberError } = await supabase
      .from("field_correspondence_members")
      .insert(
        members.map((m) => ({
          correspondence_id: inserted.id as string,
          record_type: recordTypeOf(m.source_key, catalog),
          source_key: m.source_key,
          field_ref: m.field_ref,
        }))
      );
    if (memberError) {
      // Membros falharam: remove a correspondência órfã (cascade nos membros).
      await supabase.from("field_correspondences").delete().eq("id", inserted.id);
      skipped += 1;
      continue;
    }
    created += 1;
  }
  return { created, skipped };
}

async function ensurePresetSubSources(
  supabase: Awaited<ReturnType<typeof createClient>>,
  subs: PresetSubSource[]
): Promise<{ created: number; skipped: number }> {
  let created = 0;
  let skipped = 0;
  for (const sub of subs) {
    const { data: existing } = await supabase
      .from("sub_sources")
      .select("key")
      .eq("key", sub.key)
      .maybeSingle();
    if (existing) {
      skipped += 1; // já existe (possivelmente ajustada) — nunca sobrescrever
      continue;
    }
    const { data: parent } = await supabase
      .from("data_sources")
      .select("key")
      .eq("key", sub.parent_key)
      .maybeSingle();
    if (!parent) {
      skipped += 1; // pai fora do catálogo — reportado no resultado
      continue;
    }
    const { error } = await supabase.from("sub_sources").insert({
      key: sub.key,
      parent_key: sub.parent_key,
      label: sub.label,
      short_label: sub.short_label ?? sub.label,
      default_period_field: sub.default_period_field,
      filter: sub.filter,
    });
    if (!error) created += 1;
    else skipped += 1;
  }
  return { created, skipped };
}

// Chaves de métrica de meta referenciadas pelo preset (KPI modo meta e
// goalLine) que ainda não existem no registry → registradas com rótulo = key
// (o admin renomeia depois se quiser). Builtins nunca duplicam.
async function ensureGoalMetricKeys(
  supabase: Awaited<ReturnType<typeof createClient>>,
  preset: PresetDashboard
): Promise<void> {
  const keys = new Set<string>();
  for (const w of preset.widgets) {
    const s = w.settings;
    if (s?.mode === "meta" && s.metric) keys.add(s.metric);
    if (s?.goalLine?.enabled && s.goalLine.metric) keys.add(s.goalLine.metric);
  }
  if (keys.size === 0) return;
  // sync_config tem PK (organization_id, key) desde a 0090 — leitura e upsert
  // escopados pela org ativa (sem o filtro, um usuário multi-org leria 2
  // linhas e o maybeSingle falharia).
  const orgId = await getActiveOrgId();
  let regQuery = supabase
    .from("sync_config")
    .select("value")
    .eq("key", GOAL_METRICS_CONFIG_KEY);
  if (orgId) regQuery = regQuery.eq("organization_id", orgId);
  const { data } = await regQuery.maybeSingle();
  const registry = mergeGoalMetrics(data?.value);
  const missing = [...keys].filter((k) => !registry.some((m) => m.key === k));
  if (missing.length === 0) return;
  const current = Array.isArray(data?.value) ? (data.value as unknown[]) : [];
  await supabase.from("sync_config").upsert(
    {
      key: GOAL_METRICS_CONFIG_KEY,
      value: [...current, ...missing.map((k) => ({ key: k, label: k }))],
      ...(orgId ? { organization_id: orgId } : {}),
    },
    { onConflict: "organization_id,key" }
  );
}

async function applyPresetDefinition(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  preset: PresetDashboard,
  // includeSupportFields=false: o import via JSON não cria os campos de apoio
  // globais dos presets de fábrica (forecast/potencial/desconto).
  // targetDashboardId (modo EDITAR da IA, 23/07/2026): aplica NESSE dashboard
  // — pula a busca por identidade/adoção por nome (que é escopada ao owner) e
  // NUNCA cria um novo; e o GC de widgets é DESLIGADO (widget omitido do JSON
  // permanece — decisão de produto: a IA não exclui widgets; a resposta pode
  // ser PARCIAL, só com os widgets alterados/novos).
  // allowOrgSections (31/07/2026): SÓ o caminho de fábrica (applyPreset) o
  // passa — as seções operations/compPlans ficam ESTRUTURALMENTE fora do
  // alcance do import/IA, mesmo que um validador futuro vaze as chaves.
  opts: {
    includeSupportFields?: boolean;
    targetDashboardId?: string;
    allowOrgSections?: boolean;
  } = {}
  // Falha retorna { error } com a mensagem REAL do banco — o genérico "Falha
  // ao aplicar" escondia o diagnóstico (ex.: o 42501 do RETURNING, abaixo).
): Promise<PresetApplyResult | { error: string }> {
  // Espaço de grid v2: preset/JSON legado (sem canvas.gridVersion) entra JÁ
  // convertido — lib/presets/definitions segue intocado em unidades antigas.
  // `hadCanvas` preserva a semântica de canvas GERIDO: preset de fábrica sem
  // canvas nunca sobrescrevia o do usuário, e o carimbo que a normalização
  // adiciona não pode mudar isso (só o dashboard CRIADO precisa nascer v2).
  const hadCanvas = preset.settings?.canvas !== undefined;
  preset = normalizePresetGridSpace(preset);
  // 1) Dependências: campos (globais de apoio + os do preset), sub-fontes,
  //    correspondências (depois das subs — o record_type dos membros sai do
  //    catálogo) e chaves de métrica de meta. Campo 'calculado' novo dispara o
  //    recálculo global (materializa em custom_fields; best-effort — mesmo
  //    gatilho do createField em /campos).
  const fieldsResult = await ensurePresetFields(supabase, [
    ...(opts.includeSupportFields === false ? [] : PRESET_FIELDS),
    ...(preset.fields ?? []),
  ]);
  const subResult = await ensurePresetSubSources(
    supabase,
    preset.subSources ?? []
  );
  const corrResult = await ensurePresetCorrespondences(
    supabase,
    preset.correspondences ?? []
  );
  await ensureGoalMetricKeys(supabase, preset);
  if (fieldsResult.createdCalc) {
    try {
      await recalcAllFormulaFields();
    } catch {
      // registros ficam sem o valor materializado até o próximo recálculo
      // (diário/da tela de Campos) — não derruba a geração do preset.
    }
  }
  // Seções de ORG (operações/vínculos/planos/base espelho): SÓ caminho de
  // fábrica. Filtros por NOME em responsible_id/operation_id NÃO precisam de
  // resolução aqui — o ENGINE resolve em runtime (resolveFkFilterNames).
  let opsResult = { created: 0, skipped: 0, errors: [] as string[] };
  let linksResult = { created: 0, skipped: 0, errors: [] as string[] };
  let compPlansResult = { created: 0, skipped: 0, errors: [] as string[] };
  const extraSectionErrors: string[] = [];
  if (opts.allowOrgSections) {
    const sectionOrgId = await getActiveOrgId();
    const opsOut = await ensurePresetOperations(
      supabase,
      sectionOrgId,
      preset.operations ?? []
    );
    opsResult = opsOut;
    const respIdByName = await loadResponsibleIdByName(supabase);
    // Depois das operações — vínculos e planos as referenciam por nome.
    linksResult = await ensurePresetOperationLinks(
      supabase,
      preset.operations ?? [],
      opsOut.idByName,
      respIdByName
    );
    compPlansResult = await ensurePresetCompPlans(
      supabase,
      sectionOrgId,
      preset.compPlans ?? []
    );
    if (preset.ensureCompMirror) {
      const mirror = await ensureMirrorSource(supabase, sectionOrgId);
      if (!mirror.ok) {
        extraSectionErrors.push(
          `Base espelho da remuneração: ${mirror.message ?? "falha ao garantir."}`
        );
      } else if (mirror.sourceKey !== MIRROR_SOURCE_KEY) {
        // Widgets do preset referenciam a key literal — sufixo de colisão
        // deixaria a aba Remuneração vazia em silêncio.
        extraSectionErrors.push(
          `Base espelho tem a chave "${mirror.sourceKey}" (colisão) — ajuste os widgets da aba Remuneração para essa Base.`
        );
      }
    }
  }

  // 2) Dashboard: com targetDashboardId, o alvo é EXPLÍCITO (modo Editar da
  //    IA) — a RLS decide o acesso e "não achou" é erro, nunca INSERT. Sem
  //    ele: identidade pelo marcador settings.preset.key, com fallback de
  //    ADOÇÃO por nome (dashboard gerado pelo motor antigo, sem marcador).
  let target: { id: string; name: string; settings: DashboardSettings | null } | undefined;
  if (opts.targetDashboardId) {
    const { data: row } = await supabase
      .from("dashboards")
      .select("id, name, settings")
      .eq("id", opts.targetDashboardId)
      .eq("kind", "dashboard")
      .neq("status", "trashed")
      .maybeSingle();
    if (!row) {
      return { error: "Dashboard alvo não encontrado (ou sem acesso)." };
    }
    target = row as typeof target;
  } else {
    const { data: dashRows } = await supabase
      .from("dashboards")
      .select("id, name, settings")
      .eq("owner_user_id", userId)
      .eq("kind", "dashboard")
      // Preset na Lixeira (0087) não é adotado nem atualizado em silêncio —
      // reaplicar o preset cria um dashboard fresco.
      .neq("status", "trashed");
    const rows = (dashRows ?? []) as {
      id: string;
      name: string;
      settings: DashboardSettings | null;
    }[];
    target =
      rows.find((d) => d.settings?.preset?.key === preset.presetKey) ??
      rows.find((d) => d.name === preset.name && !d.settings?.preset);
  }

  const marker = { key: preset.presetKey, version: preset.version };
  let dashboardAction: "created" | "updated";
  let dashId: string;

  // Alvo EXISTENTE legado: converte antes de gravar widgets em unidades finas
  // e RELÊ as settings (o update abaixo parte delas — partir da leitura antiga
  // desfaria o carimbo do ensureFineGrid).
  if (target) {
    await ensureFineGrid(supabase, target.id);
    const { data: fresh } = await supabase
      .from("dashboards")
      .select("settings")
      .eq("id", target.id)
      .maybeSingle();
    if (fresh) target.settings = (fresh.settings ?? {}) as DashboardSettings;
  }

  if (!target) {
    // Id gerado no APP + insert SEM RETURNING (padrão duplicateBoard): a
    // policy de SELECT de dashboards (auth_board_visible, 0088) consulta a
    // própria tabela via função STABLE, que não enxerga a linha do PRÓPRIO
    // comando — `.insert(...).select("id")` falhava com 42501 mesmo para o
    // dono (derrubava presets e o import via JSON). Carimbo de org na mesma
    // linha do createDashboard (multi-org, 0090).
    const orgId = await getActiveOrgId();
    const newId = crypto.randomUUID();
    const { error } = await supabase.from("dashboards").insert({
      id: newId,
      name: preset.name,
      owner_user_id: userId,
      visible_to_roles: preset.visible_to_roles,
      is_shared: preset.visible_to_roles.length > 0,
      settings: { ...(preset.settings ?? {}), preset: marker },
      ...(orgId ? { organization_id: orgId } : {}),
    });
    if (error) return { error: error.message };
    dashId = newId;
    dashboardAction = "created";
  } else {
    // Update: sobrescreve só as seções GERIDAS presentes no preset; `tabs`
    // faz merge por id (abas do preset na ordem do preset + abas do usuário
    // ao final); chaves desconhecidas (connectors…) são preservadas.
    const current = (target.settings ?? {}) as DashboardSettings;
    const managed = preset.settings ?? {};
    const next: DashboardSettings = { ...current };
    if (managed.periodBar !== undefined) next.periodBar = managed.periodBar;
    // hadCanvas: só sobrescreve o canvas do alvo se o preset ORIGINAL o
    // definia (o carimbo v2 da normalização não conta como canvas gerido).
    if (managed.canvas !== undefined && hadCanvas) next.canvas = managed.canvas;
    if (managed.background !== undefined) next.background = managed.background;
    if (managed.dateFormat !== undefined) next.dateFormat = managed.dateFormat;
    // fontScale gerida (23/07/2026): presets de fábrica não a definem (zero
    // mudança); o modo Editar da IA precisa alcançá-la (export a inclui).
    if (managed.fontScale !== undefined) next.fontScale = managed.fontScale;
    if (managed.tabs) {
      const presetTabIds = new Set(managed.tabs.map((t) => t.id));
      next.tabs = [
        ...managed.tabs,
        ...(current.tabs ?? []).filter((t) => !presetTabIds.has(t.id)),
      ];
    }
    next.preset = marker;
    const { error } = await supabase
      .from("dashboards")
      .update({
        name: preset.name,
        visible_to_roles: preset.visible_to_roles,
        is_shared: preset.visible_to_roles.length > 0,
        settings: next,
      })
      .eq("id", target.id);
    if (error) return { error: error.message };
    dashId = target.id;
    dashboardAction = "updated";
  }

  // 3) Widgets: update in-place por presetKey; insert dos novos; GC dos
  //    presetKeys deste preset que sumiram da definição.
  const { data: widgetRows } = await supabase
    .from("widgets")
    .select("id, settings")
    .eq("dashboard_id", dashId);
  const existingByKey = new Map<string, string>(); // presetKey → widget id
  // Páginas de widget: `pages` NUNCA viaja no JSON (export a remove — ids não
  // sobrevivem) e por isso precisa ser PRESERVADA do settings existente no
  // update in-place, senão qualquer edição por IA desfaria a mescla em
  // silêncio.
  const existingPagesByKey = new Map<string, string[]>();
  for (const w of widgetRows ?? []) {
    const s = w.settings as WidgetSettings | null;
    const pk = s?.presetKey;
    if (!pk) continue;
    existingByKey.set(pk, w.id as string);
    const pages = pageMembersOf({ settings: s ?? undefined });
    if (pages.length > 0) existingPagesByKey.set(pk, pages);
  }
  const wantedKeys = new Set(preset.widgets.map((w) => w.presetKey));
  const counts = { created: 0, updated: 0, deleted: 0 };
  for (let i = 0; i < preset.widgets.length; i++) {
    const w = preset.widgets[i];
    const keptPages = existingPagesByKey.get(w.presetKey);
    const row = {
      title: w.title,
      visual_type: w.visual_type,
      source: "records",
      sources: w.sources ?? [],
      split_by_source: w.split_by_source ?? false,
      dimensions: w.dimensions,
      metrics: w.metrics,
      filters: w.filters,
      settings: {
        ...(w.settings ?? {}),
        presetKey: w.presetKey,
        ...(keptPages ? { pages: keptPages } : {}),
      },
      grid_position: w.grid_position,
      sort_order: i,
    };
    const existingId = existingByKey.get(w.presetKey);
    if (existingId) {
      const { error } = await supabase
        .from("widgets")
        .update(row)
        .eq("id", existingId);
      if (!error) counts.updated += 1;
    } else {
      const { error } = await supabase
        .from("widgets")
        .insert({ ...row, dashboard_id: dashId });
      if (!error) counts.created += 1;
    }
  }
  // GC desligado no modo Editar (targetDashboardId): widget fora do JSON
  // permanece — a IA nunca exclui; a resposta pode ser parcial.
  if (!opts.targetDashboardId) {
    const prefix = `${preset.presetKey}.`;
    for (const [pk, id] of existingByKey) {
      if (!wantedKeys.has(pk) && pk.startsWith(prefix)) {
        await supabase.from("widgets").delete().eq("id", id);
        counts.deleted += 1;
      }
    }
  }

  const orgSectionErrors = [
    ...opsResult.errors,
    ...linksResult.errors,
    ...compPlansResult.errors,
    ...extraSectionErrors,
  ];
  return {
    presetKey: preset.presetKey,
    dashboard: dashboardAction,
    dashboardId: dashId,
    widgets: counts,
    fieldsCreated: fieldsResult.created,
    subSourcesCreated: subResult.created,
    subSourcesSkipped: subResult.skipped,
    correspondencesCreated: corrResult.created,
    correspondencesSkipped: corrResult.skipped,
    operationsCreated: opsResult.created,
    operationsSkipped: opsResult.skipped,
    operationLinksCreated: linksResult.created,
    operationLinksSkipped: linksResult.skipped,
    compPlansCreated: compPlansResult.created,
    compPlansSkipped: compPlansResult.skipped,
    ...(orgSectionErrors.length > 0 ? { orgSectionErrors } : {}),
  };
}

/** Aplica UM preset pela chave (pronto p/ a futura aba "Presets"). Só admin. */
export async function applyPreset(
  presetKey: string
): Promise<ActionState & { result?: PresetApplyResult }> {
  const session = await getSessionInfo();
  if (!session) return { ok: false, message: "Sessão expirada." };
  if (!session.roles.includes("admin")) {
    return { ok: false, message: "Apenas administradores podem gerar presets." };
  }
  const preset = PRESETS.find((p) => p.presetKey === presetKey);
  if (!preset) return { ok: false, message: `Preset "${presetKey}" não existe.` };
  const supabase = await createClient();
  // Recurso sob demanda (0114): a lista filtrada não basta — a action é
  // alcançável direto; feature off barra o apply.
  if (preset.requiresFeature) {
    const features = await loadOrgFeatures(supabase, await getActiveOrgId());
    if (!features[preset.requiresFeature]) {
      return {
        ok: false,
        message:
          `O preset "${preset.name}" é uma configuração sob demanda e não ` +
          "está habilitado para esta organização.",
      };
    }
  }
  const result = await applyPresetDefinition(supabase, session.user.id, preset, {
    // Caminho de FÁBRICA: único autorizado a aplicar operations/compPlans.
    allowOrgSections: true,
  });
  if ("error" in result) {
    return { ok: false, message: `Falha ao aplicar o preset: ${result.error}` };
  }
  revalidatePath("/");
  revalidatePath("/configuracoes/presets");
  revalidatePath(`/dashboards/${result.dashboardId}`);
  if (result.operationsCreated > 0) revalidatePath("/configuracoes/operacoes");
  if (result.compPlansCreated > 0) revalidatePath("/configuracoes/remuneracao");
  const w = result.widgets;
  const extras = [
    result.operationsCreated > 0 ? `${result.operationsCreated} operação(ões)` : null,
    result.operationLinksCreated > 0
      ? `${result.operationLinksCreated} vínculo(s) de responsável`
      : null,
    result.compPlansCreated > 0
      ? `${result.compPlansCreated} plano(s) de remuneração`
      : null,
  ].filter(Boolean);
  return {
    ok: true,
    result,
    message:
      `Preset "${preset.name}" ${result.dashboard === "created" ? "criado" : "atualizado"} (${w.created} widget(s) novo(s), ${w.updated} atualizado(s), ${w.deleted} removido(s)` +
      (extras.length > 0 ? `; ${extras.join(", ")}` : "") +
      ")." +
      (result.orgSectionErrors?.length
        ? ` Atenção: ${result.orgSectionErrors.join(" ")}`
        : ""),
  };
}

// ---------------- Importar dashboard via JSON (modo IA) ----------------

export interface ImportDashboardState {
  ok?: boolean;
  message?: string;
  id?: string; // dashboard criado/atualizado (o cliente navega p/ ele)
  errors?: string[]; // legíveis — o usuário devolve à IA corrigir
  warnings?: string[];
}

/**
 * Importa o JSON gerado pela IA como um dashboard completo. Validação em
 * lib/import/dashboard/validate.ts (pura); aplicação pelo MESMO motor
 * idempotente dos presets — identidade "import:<chave>": reimportar a mesma
 * chave ATUALIZA o dashboard (widgets adicionados à mão são preservados).
 * Gates granulares, espelhando as actions de cada cadastro: create_dashboards
 * sempre; manage_field_definitions p/ fields/correspondences; admin p/
 * subSources (mesma exigência do createSubSource).
 */
// Gates por seção do import (mesmos das actions de cadastro correspondentes).
// Compartilhado por importDashboardJson e applyDashboardEditJson.
function importSectionGateError(
  session: { permissions: string[]; roles: string[] },
  declares: { fields: boolean; subSources: boolean; correspondences: boolean }
): string | null {
  if (
    (declares.fields || declares.correspondences) &&
    !session.permissions.includes("manage_field_definitions")
  ) {
    return "O JSON declara campos/correspondências — importe com um usuário que gerencia campos (admin).";
  }
  if (declares.subSources && !session.roles.includes("admin")) {
    return "O JSON declara Sub-bases — apenas administradores podem criá-las.";
  }
  return null;
}

export async function importDashboardJson(
  raw: string
): Promise<ImportDashboardState> {
  const session = await getSessionInfo();
  if (!session) return { ok: false, message: "Sessão expirada." };
  if (!session.permissions.includes("create_dashboards")) {
    return { ok: false, message: "Você não tem permissão para criar dashboards." };
  }
  if (!raw.trim()) return { ok: false, message: "Cole o JSON gerado pela IA." };

  const supabase = await createClient();
  const validation = validateDashboardImport(
    raw,
    await loadImportContext(supabase)
  );
  if (!validation.ok || !validation.preset) {
    return {
      ok: false,
      message: "O JSON tem problemas — corrija (ou devolva os erros à IA) e tente de novo.",
      errors: validation.errors,
      warnings: validation.warnings,
    };
  }
  const gateError = importSectionGateError(session, validation.declares);
  if (gateError) return { ok: false, message: gateError };

  const result = await applyPresetDefinition(
    supabase,
    session.user.id,
    validation.preset,
    { includeSupportFields: false }
  );
  if ("error" in result) {
    return {
      ok: false,
      message: `Falha ao aplicar o dashboard importado: ${result.error}`,
      warnings: validation.warnings,
    };
  }
  revalidatePath("/");
  revalidatePath(`/dashboards/${result.dashboardId}`);
  const w = result.widgets;
  return {
    ok: true,
    id: result.dashboardId,
    warnings: validation.warnings,
    message:
      `Dashboard "${validation.preset.name}" ${result.dashboard === "created" ? "criado" : "atualizado"}: ` +
      `${w.created} widget(s) criado(s), ${w.updated} atualizado(s), ${w.deleted} removido(s)` +
      (result.fieldsCreated > 0 ? `, ${result.fieldsCreated} campo(s)` : "") +
      (result.subSourcesCreated > 0 ? `, ${result.subSourcesCreated} sub-base(s)` : "") +
      (result.correspondencesCreated > 0
        ? `, ${result.correspondencesCreated} correspondência(s)`
        : "") +
      ".",
  };
}

export interface EditDashboardState extends ImportDashboardState {
  // Snapshot capturado ANTES da edição — o cliente guarda o último e oferece
  // "Desfazer edição da IA" via restoreDashboardSnapshot.
  snapshot?: DashboardSnapshot;
}

/**
 * Aplica um JSON dashboard-import como EDIÇÃO in-place de um dashboard
 * existente (modo Editar da conversa com IA). Diferenças do import normal:
 * a identidade é FORÇADA no servidor (normalizeImportRaw sobrescreve a chave
 * pela canônica do board — a IA nunca é confiada), os widgets atuais são
 * ADOTADOS (settings.presetKey carimbado pelo MESMO mapeamento do export,
 * assignWidgetKeys) para o update casar 1:1, o apply roda com
 * targetDashboardId (sem busca por identidade, SEM GC — widget omitido
 * permanece; resposta parcial é válida) e um snapshot é capturado antes para
 * desfazer. Gate: dono/admin do board (RLS auth_board_editable como muralha).
 */
export async function applyDashboardEditJson(
  dashboardId: string,
  raw: string
): Promise<EditDashboardState> {
  const session = await getSessionInfo();
  if (!session) return { ok: false, message: "Sessão expirada." };
  if (!raw.trim()) return { ok: false, message: "JSON vazio." };

  const supabase = await createClient();
  const { data: dash } = await supabase
    .from("dashboards")
    .select("id, name, owner_user_id, visible_to_roles, settings, kind, status")
    .eq("id", dashboardId)
    .maybeSingle();
  if (!dash) return { ok: false, message: "Dashboard não encontrado." };
  if ((dash.kind as string) === "kanban") {
    return { ok: false, message: "Edição por IA é só para dashboards." };
  }
  if ((dash.status as string) === "trashed") {
    return { ok: false, message: "Restaure o dashboard antes de editar." };
  }
  const isAdmin = session.roles.includes("admin");
  if (!isAdmin && dash.owner_user_id !== session.user.id) {
    return {
      ok: false,
      message: "Apenas o dono ou um administrador podem editar por IA.",
    };
  }

  const dashSettings = (dash.settings ?? {}) as DashboardSettings;
  const chave = importChaveForDashboard({
    id: dash.id as string,
    settings: dashSettings,
  });

  // Estado atual exportado: BASE do merge por widget — a IA manda a `key` + só
  // os campos que mudam e o servidor preenche o resto (sem depender de a IA
  // re-emitir o widget inteiro).
  const { data: baseWidgetData } = await supabase
    .from("widgets")
    .select(
      "id, title, visual_type, sources, split_by_source, dimensions, metrics, filters, settings, grid_position, sort_order"
    )
    .eq("dashboard_id", dashboardId)
    .order("sort_order", { ascending: true });
  const baseWidgets = (baseWidgetData ?? []) as unknown as ExportWidgetRow[];
  const exported = exportDashboardJson({
    dash: dash as unknown as ExportDashRow,
    widgets: baseWidgets,
    sources: await loadSources(supabase),
    // Filtros de relação da BASE do merge por NOME (31/07/2026): o delta da IA
    // referencia/preserva nomes, nunca UUIDs.
    fkNames: await loadExportFkNames(supabase, baseWidgets),
  });

  // Identidade canônica + injeções protetivas (roles/tabs/canvas v2) + base do
  // merge por widget ANTES de validar.
  const normalized = normalizeImportRaw(raw, {
    chave,
    currentTabs: dashSettings.tabs,
    currentRoles: (dash.visible_to_roles as string[] | null) ?? [],
    baseWidgets: exported.json.widgets,
    currentCanvas: exported.json.dashboard.settings?.canvas as
      | Record<string, unknown>
      | undefined,
  });

  const validation = validateDashboardImport(
    normalized,
    await loadImportContext(supabase)
  );
  if (!validation.ok || !validation.preset) {
    return {
      ok: false,
      message: "O JSON tem problemas — corrija (ou devolva os erros à IA).",
      errors: validation.errors,
      warnings: validation.warnings,
    };
  }
  const gateError = importSectionGateError(session, validation.declares);
  if (gateError) return { ok: false, message: gateError };

  // Snapshot ANTES de qualquer escrita (Desfazer).
  const snapshot = await captureDashboardSnapshot(dashboardId);

  // Adoção: carimba settings.presetKey nos widgets cujo valor difere do
  // canônico (mesmo mapeamento do export — keys do JSON casam 1:1).
  const { data: widgetRows } = await supabase
    .from("widgets")
    .select("id, settings, sort_order")
    .eq("dashboard_id", dashboardId);
  const rows = (widgetRows ?? []) as {
    id: string;
    settings: WidgetSettings | null;
    sort_order: number | null;
  }[];
  const keyById = assignWidgetKeys(rows, chave);
  const prefix = `${IMPORT_PRESET_PREFIX}${chave}.`;
  for (const row of rows) {
    const wanted = `${prefix}${keyById.get(row.id)}`;
    const current = row.settings?.presetKey;
    if (current === wanted) continue;
    const { error } = await supabase
      .from("widgets")
      .update({ settings: { ...(row.settings ?? {}), presetKey: wanted } })
      .eq("id", row.id);
    if (error) {
      return { ok: false, message: `Falha ao preparar a edição: ${error.message}` };
    }
  }

  const result = await applyPresetDefinition(
    supabase,
    session.user.id,
    validation.preset,
    { includeSupportFields: false, targetDashboardId: dashboardId }
  );
  if ("error" in result) {
    return {
      ok: false,
      message: `Falha ao aplicar a edição: ${result.error}`,
      warnings: validation.warnings,
      snapshot: snapshot ?? undefined,
    };
  }
  revalidatePath("/");
  revalidatePath(`/dashboards/${dashboardId}`);
  const w = result.widgets;
  return {
    ok: true,
    id: dashboardId,
    warnings: validation.warnings,
    snapshot: snapshot ?? undefined,
    message:
      `Dashboard "${validation.preset.name}" atualizado: ` +
      `${w.created} widget(s) criado(s), ${w.updated} atualizado(s)` +
      (result.fieldsCreated > 0 ? `, ${result.fieldsCreated} campo(s)` : "") +
      (result.subSourcesCreated > 0
        ? `, ${result.subSourcesCreated} sub-base(s)`
        : "") +
      (result.correspondencesCreated > 0
        ? `, ${result.correspondencesCreated} correspondência(s)`
        : "") +
      ".",
  };
}

// Gera/atualiza TODOS os dashboards preset (idempotente). Só admin.
export async function generatePresets(): Promise<ActionState> {
  const session = await getSessionInfo();
  if (!session) return { ok: false, message: "Sessão expirada." };
  if (!session.roles.includes("admin")) {
    return { ok: false, message: "Apenas administradores podem gerar presets." };
  }
  const supabase = await createClient();
  // Recurso sob demanda (0114): preset de feature desligado é PULADO — um
  // "gerar todos" nunca cria a config custom de outra org.
  const features = await loadOrgFeatures(supabase, await getActiveOrgId());
  let created = 0;
  let updated = 0;
  for (const preset of PRESETS) {
    if (preset.requiresFeature && !features[preset.requiresFeature]) continue;
    const result = await applyPresetDefinition(supabase, session.user.id, preset, {
      // Caminho de fábrica — mesmas seções de org do applyPreset unitário.
      allowOrgSections: true,
    });
    if ("error" in result) continue; // relatado no contador final
    if (result.dashboard === "created") created += 1;
    else if (result.dashboard === "updated") updated += 1;
  }
  revalidatePath("/");
  revalidatePath("/configuracoes/presets");
  return {
    ok: true,
    message: `${created} dashboard(s) preset criado(s), ${updated} atualizado(s).`,
  };
}

export async function saveLayout(
  dashboardId: string,
  items: { id: string; x: number; y: number; w: number; h: number }[]
): Promise<ActionState> {
  const session = await getSessionInfo();
  if (!session) return { ok: false, message: "Sessão expirada." };
  const supabase = await createClient();
  // Itens em unidades FINAS: gravar sem converter o restante do board
  // misturaria escalas (saveLayout só grava os widgets arrastados).
  await ensureFineGrid(supabase, dashboardId);
  for (const it of items) {
    await supabase
      .from("widgets")
      .update({ grid_position: { x: it.x, y: it.y, w: it.w, h: it.h } })
      .eq("id", it.id)
      .eq("dashboard_id", dashboardId);
  }
  return { ok: true };
}

// Grava o traçado de uma Linha divisória (settings.shape.line, unidades de
// grid fracionárias) junto do grid_position DERIVADO (bounding box inteiro) num
// único update. Espelho do saveLayout: sem revalidatePath (edição fluida — o
// estado otimista do shell é a verdade até o próximo refresh real; o cliente
// registra no histórico após o await). Normaliza no servidor com os MESMOS
// helpers do cliente (axisLock/round/clamp), então o valor persistido é
// byte-igual ao otimista e o reseed vira no-op.
export async function saveShapeLine(
  dashboardId: string,
  widgetId: string,
  line: ShapeLine
): Promise<ActionState> {
  const session = await getSessionInfo();
  if (!session) return { ok: false, message: "Sessão expirada." };
  const nums = [line?.x1, line?.y1, line?.x2, line?.y2];
  if (nums.some((v) => typeof v !== "number" || !Number.isFinite(v))) {
    return { ok: false, message: "Traçado inválido." };
  }
  // Teto de sanidade nos limites MÁXIMOS do canvas (grid-space, unidades
  // finas); o clamp fino pelas colunas reais é do cliente.
  const clean = roundLine(
    clampLine(axisLock(line), GRID_MAX_COLS, GRID_MAX_ROWS)
  );
  const supabase = await createClient();
  await ensureFineGrid(supabase, dashboardId);
  const { data: row } = await supabase
    .from("widgets")
    .select("visual_type, settings")
    .eq("id", widgetId)
    .eq("dashboard_id", dashboardId)
    .maybeSingle();
  // Identidade nova ('linha_divisoria', 0100) OU legada (forma + kind linha —
  // linha antiga não backfillada, ex.: re-import de JSON antigo).
  if (
    !row ||
    (row.visual_type !== "forma" && row.visual_type !== "linha_divisoria")
  ) {
    return { ok: false, message: "Widget não é uma linha divisória." };
  }
  const settings = (row.settings ?? {}) as WidgetSettings;
  const { error } = await supabase
    .from("widgets")
    .update({
      settings: { ...settings, shape: { ...settings.shape, line: clean } },
      grid_position: lineGridBBox(clean),
    })
    .eq("id", widgetId)
    .eq("dashboard_id", dashboardId);
  if (error) return { ok: false, message: error.message };
  return { ok: true };
}

// ---------------- Histórico (Desfazer/Refazer) ----------------

// Lê o estado atual do dashboard (nome + settings + widgets + células das tabelas
// editáveis) e devolve um snapshot determinístico. Usado pelo cliente para
// capturar as poucas mudanças que não revalidam as props (ex.: arrastar/
// redimensionar via saveLayout). Leitura barata; não computa dados de widget.
export async function captureDashboardSnapshot(
  dashboardId: string
): Promise<DashboardSnapshot | null> {
  const session = await getSessionInfo();
  if (!session) return null;
  const supabase = await createClient();

  const { data: dash } = await supabase
    .from("dashboards")
    .select("name, settings")
    .eq("id", dashboardId)
    .maybeSingle();
  if (!dash) return null;

  const { data: widgetsData } = await supabase
    .from("widgets")
    .select(
      "id, dashboard_id, title, visual_type, source, sources, split_by_source, dimensions, metrics, filters, settings, grid_position, sort_order"
    )
    .eq("dashboard_id", dashboardId)
    .order("sort_order", { ascending: true });
  const widgets = (widgetsData ?? []) as Widget[];

  const widgetIds = widgets.map((w) => w.id);
  const { data: cellsData } = widgetIds.length
    ? await supabase
        .from("dashboard_table_cells")
        .select("widget_id, row_key, col_key, value")
        .in("widget_id", widgetIds)
    : { data: [] as { widget_id: string; row_key: string; col_key: string; value: number | string | null }[] };

  // Snapshot SEMPRE no espaço fino: o histórico precisa casar com o estado
  // otimista do cliente (normalizado) — um snapshot legado restaurado voltaria
  // a ser convertido na leitura (self-healing), mas o diff do Desfazer com o
  // estado em tela ficaria falso-positivo.
  const norm = normalizeGridSpace(
    (dash.settings ?? {}) as DashboardSettings,
    widgets
  );

  return buildDashboardSnapshot(
    dash.name as string,
    norm.settings,
    norm.widgets,
    // Valores de filtros rápidos ('__qf__'), o filtro por campo compartilhado
    // ('__ff__') e a expressão compartilhada da calculadora ('__calc__') ficam
    // FORA do histórico: mudar um dropdown ou digitar um cálculo não é edição
    // de dashboard (Desfazer não os reverte).
    (cellsData ?? []).filter(
      (c) =>
        c.row_key !== QF_ROW_KEY &&
        c.row_key !== FF_ROW_KEY &&
        c.row_key !== CALC_ROW_KEY
    )
  );
}

// Grava de volta um snapshot inteiro (Desfazer/Refazer). Reconcilia por linha:
// atualiza nome/settings do dashboard, faz upsert dos widgets do snapshot (por
// id — reinsere excluídos com o mesmo id), exclui os widgets que sobraram
// (desfaz criações) e repõe as células das tabelas editáveis. RLS
// (dashboards_update / widgets_write) restringe a owner/admin.
export async function restoreDashboardSnapshot(
  dashboardId: string,
  snap: DashboardSnapshot
): Promise<ActionState> {
  const session = await getSessionInfo();
  if (!session) return { ok: false, message: "Sessão expirada." };
  const supabase = await createClient();

  // 1) Dashboard (nome + settings).
  const { error: dashErr } = await supabase
    .from("dashboards")
    .update({ name: snap.name, settings: snap.settings })
    .eq("id", dashboardId);
  if (dashErr) return { ok: false, message: dashErr.message };

  // 2) Widgets: upsert dos do snapshot (dashboard_id injetado p/ satisfazer o RLS).
  const snapIds = snap.widgets.map((w) => w.id);
  if (snap.widgets.length > 0) {
    const { error } = await supabase.from("widgets").upsert(
      snap.widgets.map((w) => ({ ...w, dashboard_id: dashboardId })),
      { onConflict: "id" }
    );
    if (error) return { ok: false, message: error.message };
  }

  // 2b) Exclui os widgets que existem hoje mas não no snapshot (desfaz criações).
  const { data: currentRows } = await supabase
    .from("widgets")
    .select("id")
    .eq("dashboard_id", dashboardId);
  const toDelete = (currentRows ?? [])
    .map((r) => r.id as string)
    .filter((id) => !snapIds.includes(id));
  if (toDelete.length > 0) {
    const { error } = await supabase
      .from("widgets")
      .delete()
      .eq("dashboard_id", dashboardId)
      .in("id", toDelete);
    if (error) return { ok: false, message: error.message };
  }

  // 3) Células das tabelas editáveis: apaga as dos widgets do snapshot e repõe.
  // (Widgets excluídos acima já levaram suas células por ON DELETE CASCADE.)
  // Os valores de filtros rápidos ('__qf__'), o filtro por campo compartilhado
  // ('__ff__') e a expressão da calculadora ('__calc__') ficam de fora do
  // snapshot E do delete — Desfazer/Refazer não deve apagar estado
  // compartilhado que não é edição de dashboard.
  if (snapIds.length > 0) {
    const { error: delErr } = await supabase
      .from("dashboard_table_cells")
      .delete()
      .in("widget_id", snapIds)
      .neq("row_key", QF_ROW_KEY)
      .neq("row_key", FF_ROW_KEY)
      .neq("row_key", CALC_ROW_KEY);
    if (delErr) return { ok: false, message: delErr.message };
  }
  if (snap.cells.length > 0) {
    const { error: insErr } = await supabase.from("dashboard_table_cells").insert(
      snap.cells.map((c) => ({
        widget_id: c.widget_id,
        row_key: c.row_key,
        col_key: c.col_key,
        value: c.value,
        updated_by: session.user.id,
      }))
    );
    if (insErr) return { ok: false, message: insErr.message };
  }

  revalidatePath(`/dashboards/${dashboardId}`);
  return { ok: true };
}
