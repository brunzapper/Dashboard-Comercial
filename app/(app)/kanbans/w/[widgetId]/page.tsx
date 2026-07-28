// Versão: 1.0 | Data: 26/07/2026
// Página cheia de um WIDGET kanban (widgets.visual_type 'kanban'), aberta pela
// seção Kanbans do hub. É o MESMO kanban do widget: mesma config
// widgets.settings.kanban (salvar aqui reflete no dashboard e vice-versa) e
// mesmos kanban_placements.widget_id (mover card sincroniza). Contexto de
// visualização PRÓPRIO: ignora POR DESIGN os filtros/período do dashboard pai
// (mesma regra da Agenda; a invariante 12 vale para o widget renderizado NO
// dashboard — runKanbanWidget/widget-scope seguem intocados) e usa a barra de
// período simples via ?periodo/?de/?ate, como a página dedicada /kanbans/[id],
// que serviu de molde. RLS de widgets (auth_board_visible do pai, 0088) decide
// a visibilidade; salvar exige auth_board_editable (widgets_write).
import { notFound } from "next/navigation";

import { getSessionInfo } from "@/lib/auth/session";
import { hasAnyRole, type RoleKey } from "@/lib/auth/roles";
import { createClient } from "@/lib/supabase/server";
import { loadSources } from "@/lib/config/sources";
import {
  buildResponsibleCanon,
  canonicalOf,
} from "@/lib/config/responsible-canon";
import {
  applySourceScope,
  collectBoardSourceKeys,
} from "@/lib/config/source-scope";
import { SourcesProvider } from "@/components/sources-context";
import { fieldAppliesToSource } from "@/lib/sources";
import { resolvePeriodSelection } from "@/lib/widgets/period";
import type {
  DashboardSettings,
  Metric,
  WidgetFilter,
  WidgetSettings,
} from "@/lib/widgets/types";
import type { FieldDefinition, OptionItem } from "@/lib/records/types";
import { isCoreDef, splitCoreDefs } from "@/lib/records/core-defs";
import { runKanban } from "@/lib/kanban/data";
import type { KanbanSettings } from "@/lib/kanban/types";
import { taskBoardData } from "@/lib/tasks/kanban";
import { TASK_COLS_WITH_RECORD, type TaskRow } from "@/lib/tasks/types";
import { KanbanPageClient } from "@/components/kanban/kanban-page-client";
import { TrackLastView } from "@/components/layout/track-last-view";

function str(v: string | string[] | undefined): string {
  return Array.isArray(v) ? (v[0] ?? "") : (v ?? "");
}

interface WidgetRow {
  id: string;
  title: string | null;
  sources: string[] | null;
  metrics: Metric[] | null;
  filters: WidgetFilter[] | null;
  settings: WidgetSettings | null;
  dashboard_id: string;
  dashboards: {
    id: string;
    name: string;
    owner_user_id: string | null;
    settings: DashboardSettings | null;
    kind: string;
    status: string;
    organization_id: string | null;
  } | null;
}

export default async function WidgetKanbanPage({
  params,
  searchParams,
}: {
  params: Promise<{ widgetId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { widgetId } = await params;
  const sp = await searchParams;

  const session = await getSessionInfo();
  if (!session) notFound();
  const userRoles = session.roles;
  const isAdmin = userRoles.includes("admin");
  const canEditValues = session.permissions.includes("edit_record_values");
  const canManageFields = session.permissions.includes(
    "manage_field_definitions"
  );

  const supabase = await createClient();
  const { data: widgetData } = await supabase
    .from("widgets")
    .select(
      "id, title, sources, metrics, filters, settings, dashboard_id, dashboards!inner(id, name, owner_user_id, settings, kind, status, organization_id)"
    )
    .eq("id", widgetId)
    .eq("visual_type", "kanban")
    .maybeSingle();
  const w = widgetData as unknown as WidgetRow | null;
  const dash = w?.dashboards;
  // Sem linha (inexistente/RLS), pai na Lixeira (0087 — arquivado ABRE, como
  // os boards) ou widget ainda sem configuração → mesmo 404.
  if (!w || !dash || dash.kind !== "dashboard" || dash.status === "trashed") {
    notFound();
  }
  const kanban: KanbanSettings | undefined = w.settings?.kanban;
  if (!kanban) notFound();

  const dashSettings = (dash.settings ?? {}) as DashboardSettings;

  const allSources = await loadSources(supabase, dash.organization_id);
  // Escopo de BASES do dashboard PAI (⋮ → "Bases"): catálogo efetivo — a fonte
  // do quadro nunca sai (collectBoardSourceKeys sobre o próprio widget).
  const sources = applySourceScope(
    allSources,
    dashSettings.sourceScope,
    collectBoardSourceKeys(
      [
        {
          sources: w.sources ?? [],
          metrics: w.metrics ?? [],
          filters: w.filters ?? [],
          settings: w.settings ?? undefined,
        },
      ],
      dashSettings
    )
  );
  const sourceDef = sources.find((s) => s.key === kanban.source) ?? null;

  // Definições de campo (rótulos/opções/tipos) da fonte, visíveis ao papel —
  // mesmo bloco da página dedicada /kanbans/[id] e do runKanbanWidget.
  const { data: fieldsData } = await supabase
    .from("field_definitions")
    .select(
      "id, field_key, label, data_type, options, visible_to_roles, editable_by_roles, is_local, show_in_builder, formula, sort_order, applies_to, source_system, source_field_id, write_back, currency_code, currency_mode, show_as_percent"
    )
    // Linhas core (0086) entram MESMO ocultas: o olho do /campos é aplicado
    // no merge (buildAvailableFields) — sem a linha, o hardcoded reapareceria.
    .or("show_in_builder.eq.true,source_system.eq.core")
    .order("sort_order", { ascending: true });
  const allFields = (fieldsData ?? []) as FieldDefinition[];
  // Linhas core (0086) fora da lista de campos custom (edit sheet/colunas do
  // card leem custom_fields); entram à parte no runKanban (groupDef/labels).
  const { core: coreDefs } = splitCoreDefs(allFields);
  const fields = allFields.filter(
    (f) =>
      !isCoreDef(f) &&
      f.data_type !== "calculado_agg" &&
      (!kanban.source || fieldAppliesToSource(f.applies_to, kanban.source)) &&
      (isAdmin || hasAnyRole(userRoles, f.visible_to_roles as RoleKey[]))
  );

  // Garante a definição do campo de agrupamento (mesmo fora do construtor/
  // oculto ao papel) para que as OPÇÕES do selecao virem colunas — ver
  // kanbans/[id].
  const groupRef = kanban.dateBucket ? kanban.dateField : kanban.groupField;
  if (groupRef?.startsWith("custom:")) {
    const groupKey = groupRef.slice("custom:".length);
    if (!fields.some((f) => f.field_key === groupKey)) {
      const { data: groupDefData } = await supabase
        .from("field_definitions")
        .select(
          "id, field_key, label, data_type, options, visible_to_roles, editable_by_roles, is_local, show_in_builder, formula, sort_order, applies_to, source_system, source_field_id, write_back, currency_code, currency_mode, show_as_percent"
        )
        .eq("field_key", groupKey)
        .maybeSingle();
      if (groupDefData) fields.push(groupDefData as FieldDefinition);
    }
  }

  const [{ data: respData }, { data: opsData }] = await Promise.all([
    supabase
      .from("responsibles")
      .select("id, display_name, bitrix_user_id, canonical_id")
      .eq("active", true)
      .order("display_name"),
    supabase.from("operations").select("id, name").eq("active", true).order("name"),
  ]);
  const responsibles: OptionItem[] = (respData ?? []).map((r) => ({
    id: r.id as string,
    label: r.display_name as string,
    bitrixLinked: Boolean(r.bitrix_user_id),
  }));
  const operations: OptionItem[] = (opsData ?? []).map((o) => ({
    id: o.id as string,
    label: o.name as string,
  }));

  // Agrupamento (0101): rótulo do apelido = nome do PRINCIPAL ("nome usado")
  // — colunas/células do quadro saem canônicas.
  const kanbanCanon = buildResponsibleCanon(
    (respData ?? []) as { id: string; canonical_id?: string | null }[]
  );
  const nameById = Object.fromEntries(responsibles.map((r) => [r.id, r.label]));
  const responsibleLabels = Object.fromEntries(
    responsibles.map((r) => [
      r.id,
      nameById[canonicalOf(r.id, kanbanCanon)] ?? r.label,
    ])
  );

  // Período PRÓPRIO da página (?periodo/?de/?ate) — o widget no dashboard
  // segue com o resolver/filtros de lá (runKanbanWidget), intocados.
  const periodField =
    kanban.dateField ?? sourceDef?.defaultPeriodField ?? "source_created_at";
  const period = resolvePeriodSelection(
    { preset: str(sp.periodo), de: str(sp.de), ate: str(sp.ate) },
    periodField
  );

  let data;
  let effKanban = kanban;
  if (kanban.mode === "tarefas") {
    // Espelho do runKanbanWidget: tasks do board apontado (fases DELE) ou
    // todas as visíveis ("minhas tarefas"), limit 500.
    let q = supabase
      .from("tasks")
      .select(TASK_COLS_WITH_RECORD)
      // Subtarefas não viram card — aparecem no feed da tarefa pai.
      .is("parent_task_id", null)
      .order("position", { ascending: true })
      .order("created_at", { ascending: false })
      .limit(500);
    if (kanban.taskBoardId) {
      q = q.eq("board_id", kanban.taskBoardId);
      const { data: boardRow } = await supabase
        .from("dashboards")
        .select("settings")
        .eq("id", kanban.taskBoardId)
        .maybeSingle();
      const bk = (boardRow?.settings as DashboardSettings | null)?.kanban;
      if (bk?.columns) effKanban = { ...kanban, columns: bk.columns };
    }
    const { data: tasksData } = await q;
    data = taskBoardData(
      (tasksData ?? []) as unknown as TaskRow[],
      effKanban,
      responsibleLabels
    );
  } else {
    data = await runKanban(
      supabase,
      kanban,
      period,
      // Core rows junto: groupDef de coluna núcleo selecao (ex.: pipeline)
      // ordena as colunas pelas options; recordFieldDef (custom:) as ignora.
      [...fields, ...coreDefs.values()],
      {
        responsibles: responsibleLabels,
        operations: Object.fromEntries(operations.map((o) => [o.id, o.label])),
      },
      // Colunas "Personalizar": MESMOS posicionamentos do widget no dashboard.
      { kind: "widget", id: widgetId },
      // Catálogo p/ as métricas de conectados (rótulos + record_type da base).
      { catalog: sources }
    );
  }

  // Override individual (board_access do PAI, 0088): 'edit' concede
  // configuração — espelha auth_board_editable, que a RLS de widgets_write
  // consulta no save.
  const { data: myAccess } = await supabase
    .from("board_access")
    .select("level")
    .eq("dashboard_id", dash.id)
    .eq("user_id", session.user.id)
    .maybeSingle();
  const canConfig =
    isAdmin ||
    dash.owner_user_id === session.user.id ||
    myAccess?.level === "edit";
  const quickCreateSource =
    kanban.mode === "registros" && canEditValues && sourceDef?.manualEntry
      ? { key: sourceDef.key, label: sourceDef.label }
      : null;
  const viewAll = session.permissions.includes("view_all_records");
  const isManager = isAdmin || userRoles.includes("gestor");

  return (
    // Catálogo escopado por cima do provider do layout (⋮ → "Bases" do pai).
    <SourcesProvider sources={sources}>
      {/* Grava a view p/ restauração ao reabrir o app. */}
      <TrackLastView />
      <KanbanPageClient
        boardId={dash.id}
        boardName={w.title?.trim() || "Kanban (sem título)"}
        settings={dashSettings}
        kanban={effKanban}
        data={data}
        quickCreateSource={quickCreateSource}
        recordCtx={{
          fields,
          responsibles,
          operations,
          userRoles,
          canEditValues,
          canManageFields,
        }}
        taskCtx={{
          responsibles,
          canAssignOthers: viewAll,
          canLock: isManager,
        }}
        responsibleLabels={responsibleLabels}
        canConfig={canConfig}
        widgetCtx={{
          widgetId: w.id,
          dashboardId: dash.id,
          dashboardName: dash.name,
          widgetSettings: w.settings ?? {},
        }}
      />
    </SourcesProvider>
  );
}
