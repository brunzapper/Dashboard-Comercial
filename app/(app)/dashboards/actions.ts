// Versão: 1.2 | Data: 15/07/2026
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
import { PRESETS, PRESET_FIELDS } from "@/lib/presets/definitions";
import type { SourceKey } from "@/lib/sources";
import type { SavedPeriod } from "@/lib/widgets/period";
import {
  QF_ROW_KEY,
  type QuickFilterValue,
} from "@/lib/widgets/quick-filters";
import { CALC_COL_KEY, CALC_ROW_KEY } from "@/lib/widgets/calculator";
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

// Preferências GLOBAIS do usuário (user_settings), não por dashboard. Hoje só a
// barra lateral fixada. Read-modify-write para preservar chaves futuras. RLS
// garante que cada usuário só toca a própria linha. Fire-and-forget no cliente.
export interface UserAppSettings {
  sidebarPinned?: boolean;
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
      settings: input.settings ?? {},
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
      settings: input.settings ?? {},
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

  // Apaga células esvaziadas agrupando por linha (1 round-trip por linha).
  const emptyByRow = new Map<string, string[]>();
  for (const c of empty) {
    (emptyByRow.get(c.rowKey) ?? emptyByRow.set(c.rowKey, []).get(c.rowKey)!)
      .push(c.colKey);
  }
  for (const [rowKey, colKeys] of emptyByRow) {
    const { error } = await supabase
      .from("dashboard_table_cells")
      .delete()
      .eq("widget_id", widgetId)
      .eq("row_key", rowKey)
      .in("col_key", colKeys);
    if (error) return { ok: false, message: error.message };
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
    supabase.from("dashboards").select("id, name, settings"),
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
  rawValue: string
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
  revalidatePath("/dashboards/[id]", "page");
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
    .update({ settings })
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

// Gera os dashboards preset (idempotente): cria campos de apoio que faltam e
// os dashboards que ainda não existem para este usuário. Só admin.
export async function generatePresets(): Promise<ActionState> {
  const session = await getSessionInfo();
  if (!session) return { ok: false, message: "Sessão expirada." };
  if (!session.roles.includes("admin")) {
    return { ok: false, message: "Apenas administradores podem gerar presets." };
  }
  const supabase = await createClient();

  // 1) Campos de apoio (pula os que já existem)
  const { data: existingFields } = await supabase
    .from("field_definitions")
    .select("field_key");
  const have = new Set((existingFields ?? []).map((f) => f.field_key as string));
  const toCreate = PRESET_FIELDS.filter((f) => !have.has(f.field_key));
  if (toCreate.length > 0) {
    await supabase.from("field_definitions").insert(
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
      }))
    );
  }

  // 2) Dashboards (pula os que já existem por nome, deste usuário)
  const { data: existingDash } = await supabase
    .from("dashboards")
    .select("name")
    .eq("owner_user_id", session.user.id);
  const haveDash = new Set((existingDash ?? []).map((d) => d.name as string));

  let created = 0;
  for (const preset of PRESETS) {
    if (haveDash.has(preset.name)) continue;
    const { data: dash, error } = await supabase
      .from("dashboards")
      .insert({
        name: preset.name,
        owner_user_id: session.user.id,
        visible_to_roles: preset.visible_to_roles,
        is_shared: preset.visible_to_roles.length > 0,
      })
      .select("id")
      .maybeSingle();
    if (error || !dash?.id) continue;
    await supabase.from("widgets").insert(
      preset.widgets.map((w, i) => ({
        dashboard_id: dash.id as string,
        title: w.title,
        visual_type: w.visual_type,
        source: "records",
        dimensions: w.dimensions,
        metrics: w.metrics,
        filters: w.filters,
        settings: w.settings ?? {},
        grid_position: w.grid_position,
        sort_order: i,
      }))
    );
    created += 1;
  }

  revalidatePath("/");
  return {
    ok: true,
    message:
      created > 0
        ? `${created} dashboard(s) preset criado(s).`
        : "Presets já existiam (nada a criar).",
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
