// Versão: 1.2 | Data: 17/07/2026
// Página dedicada de um kanban (dashboards.kind 'kanban', 0062). O RSC computa
// o quadro (lib/kanban/data.ts → runRecordList com RLS) e entrega ao client;
// período simples via ?periodo/?de/?ate sobre o campo de data da fonte (ou do
// bucket). RLS de dashboards decide a visibilidade (owner/papéis/admin).
// v1.2 (17/07/2026): <TrackLastView /> — grava a rota em user_settings.lastView
//   p/ a Home restaurar ao reabrir o app.
// v1.1 (16/07/2026): modo TAREFAS — tasks do board agrupadas por fase
//   (lib/tasks/kanban.ts); RLS de tasks escopa o vendedor às próprias.
import { notFound } from "next/navigation";

import { getSessionInfo } from "@/lib/auth/session";
import { hasAnyRole, type RoleKey } from "@/lib/auth/roles";
import { createClient } from "@/lib/supabase/server";
import { loadSources } from "@/lib/config/sources";
import { fieldAppliesToSource } from "@/lib/sources";
import { resolvePeriodSelection } from "@/lib/widgets/period";
import type { DashboardSettings } from "@/lib/widgets/types";
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

export default async function KanbanPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
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
  const { data: board } = await supabase
    .from("dashboards")
    .select("id, name, owner_user_id, settings, kind")
    .eq("id", id)
    .eq("kind", "kanban")
    .maybeSingle();
  if (!board) notFound();

  const settings = (board.settings ?? {}) as DashboardSettings;
  const kanban: KanbanSettings = settings.kanban ?? { mode: "registros" };

  const sources = await loadSources(supabase);
  const sourceDef = sources.find((s) => s.key === kanban.source) ?? null;

  // Definições de campo (rótulos/opções/tipos) da fonte, visíveis ao papel.
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

  // O campo que define as colunas (agrupamento por valor ou bucket de data) pode
  // ter sido escolhido pelo dono do board mesmo que ele esteja fora do construtor
  // (show_in_builder off) ou oculto ao papel — sem a definição, as OPÇÕES do
  // selecao não virariam colunas. Garantimos que a definição do campo de
  // agrupamento esteja presente para a derivação das colunas (columns.ts).
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
      .select("id, display_name, bitrix_user_id")
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

  const responsibleLabels = Object.fromEntries(
    responsibles.map((r) => [r.id, r.label])
  );

  // Período: bucket de data filtra pelo próprio campo do bucket; senão, pelo
  // campo de período padrão da fonte. Default = todo o período.
  const periodField =
    kanban.dateField ?? sourceDef?.defaultPeriodField ?? "source_created_at";
  const period = resolvePeriodSelection(
    { preset: str(sp.periodo), de: str(sp.de), ate: str(sp.ate) },
    periodField
  );

  let data;
  if (kanban.mode === "tarefas") {
    const { data: tasksData } = await supabase
      .from("tasks")
      .select(TASK_COLS_WITH_RECORD)
      .eq("board_id", id)
      // Subtarefas não viram card — aparecem no feed da tarefa pai.
      .is("parent_task_id", null)
      .order("position", { ascending: true })
      .order("created_at", { ascending: false });
    data = taskBoardData(
      (tasksData ?? []) as unknown as TaskRow[],
      kanban,
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
      // Colunas "Personalizar": posicionamentos escopados a ESTE board.
      { kind: "board", id }
    );
  }

  const canConfig = isAdmin || board.owner_user_id === session.user.id;
  const quickCreateSource =
    kanban.mode === "registros" && canEditValues && sourceDef?.manualEntry
      ? { key: sourceDef.key, label: sourceDef.label }
      : null;
  const viewAll = session.permissions.includes("view_all_records");
  const isManager = isAdmin || userRoles.includes("gestor");

  return (
    <>
      {/* Grava a view p/ restauração ao reabrir o app. */}
      <TrackLastView />
      <KanbanPageClient
        boardId={board.id as string}
        boardName={board.name as string}
        settings={settings}
        kanban={kanban}
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
      />
    </>
  );
}
