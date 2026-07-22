// Versão: 1.1 | Data: 21/07/2026
// v1.1 (21/07/2026): opts { filters, available, catalog } — o widget kanban
//   passa os filtros de VISUALIZAÇÃO do dashboard (__qf__/?ff_/operação, via
//   resolveWidgetViewScope) e o catálogo p/ resolvê-los (unified:/@bucket).
//   Sem opts, comportamento idêntico (página dedicada /kanbans/[id]).
// Montagem dos dados de um kanban de REGISTROS: consulta via runRecordList
// (RLS, período, fontes — mesma semântica dos widgets de registros), calcula a
// chave de grupo por card (valor do campo ou bucket de data), deriva as
// colunas (columns.ts) e agrega contagem + métrica opcional por coluna.
// Compartilhado pela página dedicada (/kanbans/[id], computa no RSC) e pelo
// widget kanban (fetch deferido via server action). O modo 'tarefas' tem
// montagem própria (lib/tasks — S3).
import type { SupabaseClient } from "@supabase/supabase-js";

import type { FieldDefinition, RecordRow } from "@/lib/records/types";
import { isCoreDef } from "@/lib/records/core-defs";
import type { TaskRow } from "@/lib/tasks/types";
import type { SourceDef } from "@/lib/sources";
import { bucketRecordDate } from "@/lib/widgets/date-buckets";
import type { AvailableField } from "@/lib/widgets/fields";
import { runRecordList } from "@/lib/widgets/record-list";
import type { DashboardPeriod } from "@/lib/widgets/period";
import type { WidgetConfig, WidgetFilter } from "@/lib/widgets/types";
import { resolveFieldMoneyFromRecord } from "@/lib/widgets/currency";
import {
  recordCellValue,
  recordFieldDef,
  recordRefLabel,
  resolveRecordRef,
  type RecordLabels,
} from "@/lib/export/record-cells";
import { deriveColumns, resolveCardColumn } from "./columns";
import {
  KANBAN_NO_VALUE_KEY,
  type KanbanColumn,
  type KanbanMode,
  type KanbanSettings,
} from "./types";

export interface KanbanCardField {
  label: string;
  value: string;
}

export interface KanbanCard {
  id: string;
  title: string;
  columnKey: string;
  // Chave de grupo crua (difere de columnKey só no estouro "Outros").
  groupKey: string;
  // Valor cru do campo de data (modo bucket) — insumo do computeDateOnMove.
  dateValue: string | null;
  // Valor cru do colorField (a UI mapeia valor → cor estável).
  colorValue: string | null;
  fields: KanbanCardField[];
  metricValue: number | null;
  isMock: boolean;
  // Tarefas ABERTAS vinculadas ao registro (badge do card).
  openTasks: number;
  // Registro completo p/ o painel de edição e a visão lista (modo registros).
  record?: RecordRow;
  // Tarefa completa (modo tarefas — ver lib/tasks/kanban.ts).
  task?: TaskRow & { responsible_label?: string | null };
}

export interface KanbanColumnCards extends KanbanColumn {
  cards: KanbanCard[];
  count: number;
  metricSum: number | null;
}

export interface KanbanBoardData {
  mode: KanbanMode;
  columns: KanbanColumnCards[];
  metricLabel: string | null;
  metricIsMoney: boolean;
}

// Extraídos para lib/export/record-cells.ts (compartilhados com os exports
// CSV); re-exportados aqui porque a agenda e os hosts de kanban importam deste
// módulo.
export { resolveRecordRef };
export type KanbanLabels = RecordLabels;

// Chave de grupo de um registro conforme a config (valor ou bucket de data).
export function recordGroupKey(
  record: RecordRow,
  settings: KanbanSettings
): string {
  if (settings.dateBucket && settings.dateField) {
    const raw = resolveRecordRef(record, settings.dateField);
    const bucket = bucketRecordDate(raw, settings.dateBucket);
    return bucket.key === "—" ? KANBAN_NO_VALUE_KEY : bucket.key;
  }
  const raw = resolveRecordRef(record, settings.groupField ?? "stage");
  const s = raw == null ? "" : String(raw).trim();
  return s === "" ? KANBAN_NO_VALUE_KEY : s;
}

/** Dono da visão (colunas "Personalizar"): widget kanban ou board dedicado. */
export type KanbanOwner = { kind: "widget" | "board"; id: string };

/**
 * Monta o quadro (modo registros): cards + colunas derivadas + agregados.
 * `period` é o período já resolvido (barra da página/dashboard); `defs` são as
 * field_definitions visíveis (options do selecao, rótulos, tipos). `owner`
 * escopa os posicionamentos das colunas "Personalizar" (kanban_placements).
 */
export async function runKanban(
  supabase: SupabaseClient,
  settings: KanbanSettings,
  period: DashboardPeriod | null,
  defs: FieldDefinition[],
  labels: KanbanLabels = {},
  owner?: KanbanOwner,
  // Filtros de visualização do dashboard (widget kanban) + catálogo p/
  // resolvê-los; ausente = quadro sem recorte extra (página dedicada).
  opts?: {
    filters?: WidgetFilter[];
    available?: AvailableField[];
    catalog?: SourceDef[];
  }
): Promise<KanbanBoardData> {
  const config: WidgetConfig = {
    sources: settings.source ? [settings.source] : [],
    dimensions: [],
    metrics: [],
    filters: opts?.filters ?? [],
    settings: {},
  } as unknown as WidgetConfig;

  const records = await runRecordList(
    supabase,
    config,
    period ?? undefined,
    opts?.available,
    opts?.catalog
  );

  // Colunas "Personalizar": posição do card é dado da visão
  // (kanban_placements por widget/board). Falha silenciosa (migração 0067
  // pendente, snapshot com dataset congelado) → todos na primeira coluna.
  const isCustom = settings.columnSource === "custom";
  const placements = new Map<string, { columnKey: string; position: number }>();
  if (isCustom && owner) {
    try {
      const ownerCol = owner.kind === "widget" ? "widget_id" : "board_id";
      const ids = records.map((r) => r.id);
      const CHUNK = 200;
      for (let i = 0; i < ids.length; i += CHUNK) {
        const slice = ids.slice(i, i + CHUNK);
        if (slice.length === 0) continue;
        const { data } = await supabase
          .from("kanban_placements")
          .select("record_id, column_key, position")
          .eq(ownerCol, owner.id)
          .in("record_id", slice);
        for (const p of data ?? []) {
          placements.set(p.record_id as string, {
            columnKey: p.column_key as string,
            position: Number(p.position) || 0,
          });
        }
      }
    } catch {
      // sem posicionamentos — o quadro segue com tudo na primeira coluna
    }
  }

  // Tarefas ABERTAS por registro (badge do card). Falha silenciosa (ex.:
  // migração 0063 ainda não aplicada) não derruba o quadro.
  const taskCounts = new Map<string, number>();
  try {
    const ids = records.map((r) => r.id);
    const CHUNK = 200;
    for (let i = 0; i < ids.length; i += CHUNK) {
      const slice = ids.slice(i, i + CHUNK);
      if (slice.length === 0) continue;
      const { data } = await supabase
        .from("tasks")
        .select("record_id")
        .is("completed_at", null)
        .in("record_id", slice);
      for (const t of data ?? []) {
        const k = t.record_id as string;
        taskCounts.set(k, (taskCounts.get(k) ?? 0) + 1);
      }
    }
  } catch {
    // sem contagem — o quadro segue sem badges
  }

  const titleField = settings.card?.titleField || "title";
  const extraRefs = (settings.card?.extraFields ?? []).slice(0, 4);
  const metricRef = settings.metric || null;

  const groupKeys: string[] = [];
  const cards: Omit<KanbanCard, "columnKey">[] = records.map((r) => {
    // Personalizar: a "chave de grupo" é a coluna posicionada ("" = 1ª coluna).
    const groupKey = isCustom
      ? (placements.get(r.id)?.columnKey ?? "")
      : recordGroupKey(r, settings);
    groupKeys.push(groupKey);
    const metricRaw = metricRef ? resolveRecordRef(r, metricRef) : null;
    const metricNum =
      metricRaw == null || metricRaw === "" ? null : Number(metricRaw);
    const titleRaw = resolveRecordRef(r, titleField);
    return {
      id: r.id,
      title:
        titleRaw == null || titleRaw === "" ? "(sem nome)" : String(titleRaw),
      groupKey,
      dateValue: settings.dateField
        ? ((resolveRecordRef(r, settings.dateField) as string | null) ?? null)
        : null,
      colorValue: settings.card?.colorField
        ? String(resolveRecordRef(r, settings.card.colorField) ?? "")
        : null,
      fields: extraRefs.map((ref) => ({
        label: recordRefLabel(ref, defs),
        value: recordCellValue(r, ref, defs, labels),
      })),
      metricValue: Number.isFinite(metricNum) ? metricNum : null,
      isMock: Boolean((r as unknown as { is_mock?: boolean }).is_mock),
      openTasks: taskCounts.get(r.id) ?? 0,
      record: r,
    };
  });

  // Agrupamento por coluna núcleo 'selecao' (linha core 0086, ex.: pipeline):
  // a def core entra como groupDef p/ as colunas seguirem a ordem das options.
  const groupDef = settings.groupField
    ? (recordFieldDef(settings.groupField, defs) ??
      defs.find(
        (d) => isCoreDef(d) && d.field_key === settings.groupField
      ) ??
      null)
    : null;
  const columns = deriveColumns(settings, groupKeys, groupDef);

  const byColumn = new Map<string, KanbanCard[]>(
    columns.map((c) => [c.key, []])
  );
  for (const card of cards) {
    // Personalizar: coluna desconhecida/removida ou sem posição → 1ª coluna.
    const columnKey = isCustom
      ? byColumn.has(card.groupKey)
        ? card.groupKey
        : (columns[0]?.key ?? null)
      : resolveCardColumn(card.groupKey, columns);
    if (!columnKey) continue; // coluna oculta
    byColumn.get(columnKey)?.push({ ...card, columnKey });
  }
  // Personalizar: ordena por posição fracionária (movidos recentes no topo;
  // sem posição = 0 → abaixo dos movidos).
  if (isCustom) {
    for (const list of byColumn.values()) {
      list.sort(
        (a, b) =>
          (placements.get(a.id)?.position ?? 0) -
          (placements.get(b.id)?.position ?? 0)
      );
    }
  }

  const columnCards: KanbanColumnCards[] = columns.map((c) => {
    const list = byColumn.get(c.key) ?? [];
    let metricSum: number | null = null;
    if (metricRef) {
      metricSum = 0;
      for (const card of list) metricSum += card.metricValue ?? 0;
    }
    return { ...c, cards: list, count: list.length, metricSum };
  });

  const metricIsMoney =
    metricRef === "value" ||
    metricRef === "mrr" ||
    (metricRef
      ? Boolean(
          recordFieldDef(metricRef, defs) &&
            resolveFieldMoneyFromRecord(
              recordFieldDef(metricRef, defs)!,
              (records[0] as RecordRow | undefined) ?? ({} as RecordRow)
            ).isMoney
        )
      : false);

  return {
    mode: settings.mode,
    columns: columnCards,
    metricLabel: metricRef ? recordRefLabel(metricRef, defs) : null,
    metricIsMoney,
  };
}
