// Versão: 1.5 | Data: 22/07/2026
// v1.5 (22/07/2026): importDashboardJson — modo "Importar dashboard via JSON
//   (IA)": valida o JSON colado (lib/import/dashboard/validate.ts, erros
//   legíveis p/ devolver à IA) e o aplica pelo MESMO motor idempotente dos
//   presets (applyPresetDefinition, identidade "import:<chave>" — reimportar
//   atualiza em vez de duplicar). applyPresetDefinition ganha opts
//   includeSupportFields (o import NÃO cria os campos de apoio PRESET_FIELDS).
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
import { createClient } from "@/lib/supabase/server";
import {
  PRESETS,
  PRESET_FIELDS,
  type PresetCorrespondence,
  type PresetDashboard,
  type PresetField,
  type PresetSubSource,
} from "@/lib/presets/definitions";
import { GOAL_METRICS_CONFIG_KEY } from "@/lib/config/goal-metrics";
import { mergeGoalMetrics } from "@/lib/metas/metrics";
import { loadSources } from "@/lib/config/sources";
import { recordTypeOf } from "@/lib/sources";
import { recalcAllFormulaFields } from "@/lib/records/recalc";
import type { SourceKey } from "@/lib/sources";
import type { SavedPeriod } from "@/lib/widgets/period";
import {
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
import { baseColId, canTypeInColumn } from "@/lib/widgets/quick-table/model";
import type {
  DashboardSettings,
  Dimension,
  GridPosition,
  Metric,
  VisualType,
  Widget,
  WidgetFilter,
  WidgetSettings,
} from "@/lib/widgets/types";
import {
  buildDashboardSnapshot,
  type DashboardSnapshot,
} from "@/lib/widgets/history";
import { sanitizeImageSettings } from "@/lib/widgets/image-url";
import { validateDashboardImport } from "@/lib/import/dashboard/validate";
import type { ImportDefRow } from "@/lib/import/dashboard/types";

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

  const supabase = await createClient();
  const { error } = await supabase.from("dashboards").insert({
    name,
    owner_user_id: session.user.id,
    visible_to_roles: visible,
    is_shared: visible.length > 0,
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

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("dashboards")
    .insert({
      name,
      kind: "kanban",
      owner_user_id: session.user.id,
      visible_to_roles: visible,
      is_shared: visible.length > 0,
      settings: { kanban },
    })
    .select("id")
    .single();
  if (error) return { ok: false, message: error.message };
  revalidatePath("/");
  return { ok: true, message: `Kanban "${name}" criado.`, id: data.id as string };
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
  const { error } = await supabase
    .from("dashboards")
    .update({ settings })
    .eq("id", boardId)
    .eq("kind", "kanban");
  if (error) return { ok: false, message: error.message };
  revalidatePath(`/kanbans/${boardId}`);
  return { ok: true };
}

export async function deleteDashboard(formData: FormData): Promise<void> {
  const session = await getSessionInfo();
  if (!session) return;
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const supabase = await createClient();
  await supabase.from("dashboards").delete().eq("id", id);
  revalidatePath("/");
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
    position = { x: 0, y: maxBottom, w: 6, h: 8 };
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
      settings: sanitizeImageSettings(input.settings),
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
      settings: sanitizeImageSettings(input.settings),
    })
    .eq("id", widgetId);
  if (error) return { ok: false, message: error.message };
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
      .select("id, display_name")
      .eq("active", true)
      .order("display_name");
    return (data ?? []).map((r) => ({
      value: r.id as string,
      label: (r.display_name as string) ?? "—",
    }));
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
    supabase.from("dashboards").select("id, name, settings").eq("kind", "dashboard"),
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
  const { error } = await supabase
    .from("widgets")
    .update({ settings: sanitizeImageSettings(settings) })
    .eq("id", widgetId)
    .eq("dashboard_id", dashboardId);
  if (error) return { ok: false, message: error.message };
  return { ok: true };
}

export async function deleteWidget(
  widgetId: string,
  dashboardId: string
): Promise<void> {
  const session = await getSessionInfo();
  if (!session) return;
  const supabase = await createClient();
  await supabase.from("widgets").delete().eq("id", widgetId);

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
    }))
  );
  if (error) return { created: 0, createdCalc: false };
  return {
    created: toCreate.length,
    // 'calculado' por-registro materializa em custom_fields → o chamador
    // dispara recalcAllFormulaFields (mesmo gatilho do createField em /campos).
    createdCalc: toCreate.some((f) => f.data_type === "calculado"),
  };
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
  const { data } = await supabase
    .from("sync_config")
    .select("value")
    .eq("key", GOAL_METRICS_CONFIG_KEY)
    .maybeSingle();
  const registry = mergeGoalMetrics(data?.value);
  const missing = [...keys].filter((k) => !registry.some((m) => m.key === k));
  if (missing.length === 0) return;
  const current = Array.isArray(data?.value) ? (data.value as unknown[]) : [];
  await supabase.from("sync_config").upsert(
    {
      key: GOAL_METRICS_CONFIG_KEY,
      value: [...current, ...missing.map((k) => ({ key: k, label: k }))],
    },
    { onConflict: "key" }
  );
}

async function applyPresetDefinition(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  preset: PresetDashboard,
  // includeSupportFields=false: o import via JSON não cria os campos de apoio
  // globais dos presets de fábrica (forecast/potencial/desconto).
  opts: { includeSupportFields?: boolean } = {}
): Promise<PresetApplyResult | null> {
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

  // 2) Dashboard: identidade pelo marcador settings.preset.key; fallback de
  //    ADOÇÃO por nome (dashboard gerado pelo motor antigo, sem marcador).
  const { data: dashRows } = await supabase
    .from("dashboards")
    .select("id, name, settings")
    .eq("owner_user_id", userId)
    .eq("kind", "dashboard");
  const rows = (dashRows ?? []) as {
    id: string;
    name: string;
    settings: DashboardSettings | null;
  }[];
  const target =
    rows.find((d) => d.settings?.preset?.key === preset.presetKey) ??
    rows.find((d) => d.name === preset.name && !d.settings?.preset);

  const marker = { key: preset.presetKey, version: preset.version };
  let dashboardAction: "created" | "updated";
  let dashId: string;

  if (!target) {
    const { data: dash, error } = await supabase
      .from("dashboards")
      .insert({
        name: preset.name,
        owner_user_id: userId,
        visible_to_roles: preset.visible_to_roles,
        is_shared: preset.visible_to_roles.length > 0,
        settings: { ...(preset.settings ?? {}), preset: marker },
      })
      .select("id")
      .maybeSingle();
    if (error || !dash?.id) return null;
    dashId = dash.id as string;
    dashboardAction = "created";
  } else {
    // Update: sobrescreve só as seções GERIDAS presentes no preset; `tabs`
    // faz merge por id (abas do preset na ordem do preset + abas do usuário
    // ao final); chaves desconhecidas (connectors…) são preservadas.
    const current = (target.settings ?? {}) as DashboardSettings;
    const managed = preset.settings ?? {};
    const next: DashboardSettings = { ...current };
    if (managed.periodBar !== undefined) next.periodBar = managed.periodBar;
    if (managed.canvas !== undefined) next.canvas = managed.canvas;
    if (managed.background !== undefined) next.background = managed.background;
    if (managed.dateFormat !== undefined) next.dateFormat = managed.dateFormat;
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
    if (error) return null;
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
  for (const w of widgetRows ?? []) {
    const pk = (w.settings as WidgetSettings | null)?.presetKey;
    if (pk) existingByKey.set(pk, w.id as string);
  }
  const wantedKeys = new Set(preset.widgets.map((w) => w.presetKey));
  const counts = { created: 0, updated: 0, deleted: 0 };
  for (let i = 0; i < preset.widgets.length; i++) {
    const w = preset.widgets[i];
    const row = {
      title: w.title,
      visual_type: w.visual_type,
      source: "records",
      sources: w.sources ?? [],
      split_by_source: w.split_by_source ?? false,
      dimensions: w.dimensions,
      metrics: w.metrics,
      filters: w.filters,
      settings: { ...(w.settings ?? {}), presetKey: w.presetKey },
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
  const prefix = `${preset.presetKey}.`;
  for (const [pk, id] of existingByKey) {
    if (!wantedKeys.has(pk) && pk.startsWith(prefix)) {
      await supabase.from("widgets").delete().eq("id", id);
      counts.deleted += 1;
    }
  }

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
  const result = await applyPresetDefinition(supabase, session.user.id, preset);
  if (!result) return { ok: false, message: "Falha ao aplicar o preset." };
  revalidatePath("/");
  revalidatePath("/configuracoes/presets");
  revalidatePath(`/dashboards/${result.dashboardId}`);
  const w = result.widgets;
  return {
    ok: true,
    result,
    message: `Preset "${preset.name}" ${result.dashboard === "created" ? "criado" : "atualizado"} (${w.created} widget(s) novo(s), ${w.updated} atualizado(s), ${w.deleted} removido(s)).`,
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
  const [sources, defsRes, corrRes, respRes, opRes] = await Promise.all([
    loadSources(supabase),
    supabase
      .from("field_definitions")
      .select("id, field_key, label, data_type, formula, applies_to, source_system"),
    supabase.from("field_correspondences").select("key"),
    supabase.from("responsibles").select("display_name"),
    supabase.from("operations").select("name"),
  ]);
  const validation = validateDashboardImport(raw, {
    sources,
    defs: ((defsRes.data ?? []) as Record<string, unknown>[]).map((d) => ({
      id: String(d.id),
      field_key: String(d.field_key),
      label: String(d.label ?? d.field_key),
      data_type: d.data_type as ImportDefRow["data_type"],
      formula: (d.formula as ImportDefRow["formula"]) ?? null,
      applies_to: (d.applies_to as string[] | null) ?? null,
      source_system: (d.source_system as string | null) ?? null,
    })),
    correspondenceKeys: (corrRes.data ?? []).map((c) => String(c.key)),
    responsibleNames: (respRes.data ?? [])
      .map((r) => String((r as { display_name?: unknown }).display_name ?? ""))
      .filter(Boolean),
    operationNames: (opRes.data ?? [])
      .map((o) => String((o as { name?: unknown }).name ?? ""))
      .filter(Boolean),
  });
  if (!validation.ok || !validation.preset) {
    return {
      ok: false,
      message: "O JSON tem problemas — corrija (ou devolva os erros à IA) e tente de novo.",
      errors: validation.errors,
      warnings: validation.warnings,
    };
  }
  // Gates por seção (mesmos das actions de cadastro correspondentes).
  if (
    (validation.declares.fields || validation.declares.correspondences) &&
    !session.permissions.includes("manage_field_definitions")
  ) {
    return {
      ok: false,
      message:
        "O JSON declara campos/correspondências — importe com um usuário que gerencia campos (admin).",
    };
  }
  if (validation.declares.subSources && !session.roles.includes("admin")) {
    return {
      ok: false,
      message: "O JSON declara Sub-bases — apenas administradores podem criá-las.",
    };
  }

  const result = await applyPresetDefinition(
    supabase,
    session.user.id,
    validation.preset,
    { includeSupportFields: false }
  );
  if (!result) return { ok: false, message: "Falha ao aplicar o dashboard importado." };
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

// Gera/atualiza TODOS os dashboards preset (idempotente). Só admin.
export async function generatePresets(): Promise<ActionState> {
  const session = await getSessionInfo();
  if (!session) return { ok: false, message: "Sessão expirada." };
  if (!session.roles.includes("admin")) {
    return { ok: false, message: "Apenas administradores podem gerar presets." };
  }
  const supabase = await createClient();
  let created = 0;
  let updated = 0;
  for (const preset of PRESETS) {
    const result = await applyPresetDefinition(
      supabase,
      session.user.id,
      preset
    );
    if (result?.dashboard === "created") created += 1;
    else if (result?.dashboard === "updated") updated += 1;
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
  for (const it of items) {
    await supabase
      .from("widgets")
      .update({ grid_position: { x: it.x, y: it.y, w: it.w, h: it.h } })
      .eq("id", it.id)
      .eq("dashboard_id", dashboardId);
  }
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

  return buildDashboardSnapshot(
    dash.name as string,
    (dash.settings ?? {}) as DashboardSettings,
    widgets,
    // Valores de filtros rápidos ('__qf__') e a expressão compartilhada da
    // calculadora ('__calc__') ficam FORA do histórico: mudar um dropdown ou
    // digitar um cálculo não é edição de dashboard (Desfazer não os reverte).
    (cellsData ?? []).filter(
      (c) => c.row_key !== QF_ROW_KEY && c.row_key !== CALC_ROW_KEY
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
  // Os valores de filtros rápidos ('__qf__') e a expressão da calculadora
  // ('__calc__') ficam de fora do snapshot E do delete — Desfazer/Refazer não
  // deve apagar estado compartilhado que não é edição de dashboard.
  if (snapIds.length > 0) {
    const { error: delErr } = await supabase
      .from("dashboard_table_cells")
      .delete()
      .in("widget_id", snapIds)
      .neq("row_key", QF_ROW_KEY)
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
