// Versão: 1.1 | Data: 20/07/2026
// v1.1 (20/07/2026): métrica monetária soma POR MOEDA na coluna (metricSumText
//   + metricCurrency por card) — antes BRL+USD entravam numa soma crua e o
//   isMoney era decidido pelo 1º registro.
// Montagem dos dados de um kanban de REGISTROS: consulta via runRecordList
// (RLS, período, fontes — mesma semântica dos widgets de registros), calcula a
// chave de grupo por card (valor do campo ou bucket de data), deriva as
// colunas (columns.ts) e agrega contagem + métrica opcional por coluna.
// Compartilhado pela página dedicada (/kanbans/[id], computa no RSC) e pelo
// widget kanban (fetch deferido via server action). O modo 'tarefas' tem
// montagem própria (lib/tasks — S3).
import type { SupabaseClient } from "@supabase/supabase-js";

import type { FieldDefinition, RecordRow } from "@/lib/records/types";
import type { TaskRow } from "@/lib/tasks/types";
import { bucketRecordDate } from "@/lib/widgets/date-buckets";
import { runRecordList } from "@/lib/widgets/record-list";
import type { DashboardPeriod } from "@/lib/widgets/period";
import type { WidgetConfig } from "@/lib/widgets/types";
import { formatMoney, resolveFieldMoneyFromRecord } from "@/lib/widgets/currency";
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
  // Moeda do metricValue quando a métrica é monetária (v20/07/2026) — permite
  // somar por moeda na coluna em vez de misturar BRL+USD numa soma crua.
  metricCurrency: string | null;
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
  // Texto pronto do agregado monetário por moeda ("R$ 10.000,00 · US$ 2.000,00");
  // null = métrica não-monetária (a UI formata metricSum como número).
  metricSumText: string | null;
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
  owner?: KanbanOwner
): Promise<KanbanBoardData> {
  const config: WidgetConfig = {
    sources: settings.source ? [settings.source] : [],
    dimensions: [],
    metrics: [],
    filters: [],
    settings: {},
  } as unknown as WidgetConfig;

  const records = await runRecordList(supabase, config, period ?? undefined);

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

  // v20/07/2026: métrica monetária decide-se pela DEFINIÇÃO (não pelo 1º
  // registro) e cada card carrega a própria moeda — a coluna soma POR moeda.
  const metricDef = metricRef ? recordFieldDef(metricRef, defs) : null;
  const metricIsMoney =
    metricRef === "value" ||
    metricRef === "mrr" ||
    (metricDef
      ? resolveFieldMoneyFromRecord(metricDef, {} as RecordRow).isMoney
      : false);
  const metricCurrencyOf = (r: RecordRow): string | null => {
    if (!metricIsMoney) return null;
    if (metricRef === "value" || metricRef === "mrr") return r.currency ?? null;
    return metricDef ? (resolveFieldMoneyFromRecord(metricDef, r).code ?? null) : null;
  };

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
      metricCurrency: metricCurrencyOf(r),
      isMock: Boolean((r as unknown as { is_mock?: boolean }).is_mock),
      openTasks: taskCounts.get(r.id) ?? 0,
      record: r,
    };
  });

  const groupDef = settings.groupField
    ? recordFieldDef(settings.groupField, defs)
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
    let metricSumText: string | null = null;
    if (metricRef) {
      metricSum = 0;
      const byCurrency = new Map<string, number>();
      for (const card of list) {
        const v = card.metricValue;
        if (v == null) continue;
        metricSum += v;
        if (metricIsMoney) {
          // Sem moeda no registro → BRL (mesmo default do formatMoney(v, null)).
          const code = card.metricCurrency ?? "BRL";
          byCurrency.set(code, (byCurrency.get(code) ?? 0) + v);
        }
      }
      if (metricIsMoney) {
        // BRL primeiro, demais em ordem alfabética; coluna vazia = R$ 0,00.
        const codes = [...byCurrency.keys()].sort((a, b) =>
          a === "BRL" ? -1 : b === "BRL" ? 1 : a.localeCompare(b)
        );
        metricSumText =
          codes.length === 0
            ? formatMoney(0, "BRL")
            : codes.map((code) => formatMoney(byCurrency.get(code), code)).join(" · ");
      }
    }
    return { ...c, cards: list, count: list.length, metricSum, metricSumText };
  });

  return {
    mode: settings.mode,
    columns: columnCards,
    metricLabel: metricRef ? recordRefLabel(metricRef, defs) : null,
    metricIsMoney,
  };
}
