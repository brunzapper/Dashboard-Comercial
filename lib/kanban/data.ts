// Versão: 1.4 | Data: 28/07/2026
// v1.4 (28/07/2026): métricas expandidas — leitura via normalizeKanbanMetrics
//   (columnMetric com agregação escolhível vence `metric` legado; badges do
//   card, default = badge de tarefas abertas de sempre), fatos GATEADOS pela
//   config (conectados por base via countRelatedBySource + gêmeo
//   related_lead_id; tarefas atrasadas na MESMA query do badge; idade em
//   dias) e opts.lean (tick de automações pula badges/conectados).
// v1.3 (27/07/2026): opts.orgId — escopo explícito de org repassado ao
//   runRecordList (chamadores SERVICE ROLE: engine de automações do kanban).
// v1.2 (26/07/2026): agrupamento de responsáveis (0101) — quadro agrupado por
//   responsible_id joga o card do APELIDO na coluna do PRINCIPAL
//   (recordGroupKey canonicaliza; rótulo da coluna já sai canônico via
//   labels/fk-labels). Filtros expandem dentro do runRecordList.
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
import { recordTypeOf, type SourceDef } from "@/lib/sources";
import { bucketRecordDate } from "@/lib/widgets/date-buckets";
import type { AvailableField } from "@/lib/widgets/fields";
import { runRecordList } from "@/lib/widgets/record-list";
import { loadResponsibleCanon } from "@/lib/config/responsible-canon";
import type { DashboardPeriod } from "@/lib/widgets/period";
import {
  AGG_LABELS,
  type WidgetConfig,
  type WidgetFilter,
} from "@/lib/widgets/types";
import { resolveFieldMoneyFromRecord } from "@/lib/widgets/currency";
import { todayBrasiliaIso } from "@/lib/date/today";
import {
  recordCellValue,
  recordFieldDef,
  recordRefLabel,
  resolveRecordRef,
  type RecordLabels,
} from "@/lib/export/record-cells";
import { deriveColumns, resolveCardColumn } from "./columns";
import {
  aggregateMetric,
  defaultAggFor,
  encodeMetricSpec,
  metricSpecLabel,
  normalizeKanbanMetrics,
  recordAgeDays,
} from "./metrics";
import { countRelatedBySource } from "./related-count";
import {
  KANBAN_NO_VALUE_KEY,
  type KanbanAgg,
  type KanbanColumn,
  type KanbanMetricSpec,
  type KanbanMode,
  type KanbanSettings,
} from "./types";

export interface KanbanCardField {
  label: string;
  value: string;
}

/** Formato de exibição da métrica do cabeçalho (28/07/2026). */
export type KanbanMetricFormat = "number" | "money" | "days";

/**
 * Indicador (badge) calculado de um card. `value` null = fato indisponível
 * (consulta falhou / adapter sem a tabela) — o renderer OCULTA o badge, nunca
 * mostra um 0 enganoso.
 */
export interface KanbanCardBadge {
  key: string; // encodeMetricSpec (estável: React key / colunas da lista)
  label: string;
  kind: KanbanMetricSpec["kind"];
  value: number | null;
  isMoney?: boolean;
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
  // Indicadores calculados (métricas 28/07/2026). AUSENTE = produtor sem
  // badges (modo tarefas / lean) — o renderer cai no pill legado de tarefas.
  badges?: KanbanCardBadge[];
  // Registro completo p/ o painel de edição e a visão lista (modo registros).
  record?: RecordRow;
  // Tarefa completa (modo tarefas — ver lib/tasks/kanban.ts).
  task?: TaskRow & { responsible_label?: string | null };
}

export interface KanbanColumnCards extends KanbanColumn {
  cards: KanbanCard[];
  count: number;
  // Agregado da métrica do cabeçalho. Nome legado (era sempre soma) mantido de
  // propósito — desde 28/07/2026 carrega a agregação escolhida (metricAgg).
  metricSum: number | null;
}

export interface KanbanBoardData {
  mode: KanbanMode;
  columns: KanbanColumnCards[];
  metricLabel: string | null;
  metricIsMoney: boolean;
  // Agregação e formato da métrica do cabeçalho (28/07/2026). Ausentes em
  // produtores antigos — consumidores caem no legado (soma + metricIsMoney).
  metricAgg?: KanbanAgg;
  metricFormat?: KanbanMetricFormat;
}

// Extraídos para lib/export/record-cells.ts (compartilhados com os exports
// CSV); re-exportados aqui porque a agenda e os hosts de kanban importam deste
// módulo.
export { resolveRecordRef };
export type KanbanLabels = RecordLabels;

// Chave de grupo de um registro conforme a config (valor ou bucket de data).
export function recordGroupKey(
  record: RecordRow,
  settings: KanbanSettings,
  // Agrupamento de responsáveis (0101): apelido → principal — o card do
  // apelido cai na coluna do principal. Ausente = sem canonicalização.
  respCanonById?: Map<string, string>
): string {
  if (settings.dateBucket && settings.dateField) {
    const raw = resolveRecordRef(record, settings.dateField);
    const bucket = bucketRecordDate(raw, settings.dateBucket);
    return bucket.key === "—" ? KANBAN_NO_VALUE_KEY : bucket.key;
  }
  const raw = resolveRecordRef(record, settings.groupField ?? "stage");
  let s = raw == null ? "" : String(raw).trim();
  if (s && (settings.groupField ?? "stage") === "responsible_id")
    s = respCanonById?.get(s) ?? s;
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
    // Escopo explícito de org (chamadores service-role — automações).
    orgId?: string;
    // Pula os fatos extras das métricas (badges/conectados) — o tick de
    // automações só consome cards/colunas/openTasks.
    lean?: boolean;
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
    opts?.catalog,
    opts?.orgId ? { orgId: opts.orgId } : undefined
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

  // Métricas normalizadas (legado resolvido em lib/kanban/metrics.ts). Fatos
  // extras são GATEADOS pela config — quadro sem métrica nova não dispara
  // nenhuma consulta além das de sempre. `lean` (tick de automações) pula
  // badges e conectados por inteiro.
  const lean = opts?.lean === true;
  const normalized = normalizeKanbanMetrics(settings);
  const columnMetric =
    lean && normalized.columnMetric?.spec.kind === "linked"
      ? null
      : normalized.columnMetric;
  const badgeSpecs = lean ? [] : normalized.badges;
  const specs: KanbanMetricSpec[] = [
    ...(columnMetric ? [columnMetric.spec] : []),
    ...badgeSpecs,
  ];
  const todayIso = todayBrasiliaIso();
  const catalog = opts?.catalog ?? [];

  // Tarefas ABERTAS/ATRASADAS por registro (badge do card + métricas tasks:) —
  // a MESMA query de sempre, agora com due_date (atrasada = aberta com prazo
  // antes de hoje, dia de Brasília — régua do engine de automações). Falha
  // silenciosa (ex.: migração 0063 não aplicada; adapter de snapshot
  // fail-closed p/ `tasks`) não derruba o quadro.
  const taskCounts = new Map<string, number>();
  const overdueCounts = new Map<string, number>();
  let tasksOk = true;
  try {
    const ids = records.map((r) => r.id);
    const CHUNK = 200;
    for (let i = 0; i < ids.length; i += CHUNK) {
      const slice = ids.slice(i, i + CHUNK);
      if (slice.length === 0) continue;
      const { data } = await supabase
        .from("tasks")
        .select("record_id, due_date")
        .is("completed_at", null)
        .in("record_id", slice);
      for (const t of data ?? []) {
        const k = t.record_id as string;
        taskCounts.set(k, (taskCounts.get(k) ?? 0) + 1);
        const due = (t.due_date as string | null) ?? null;
        if (due && due.slice(0, 10) < todayIso) {
          overdueCounts.set(k, (overdueCounts.get(k) ?? 0) + 1);
        }
      }
    }
  } catch {
    // sem contagem — o quadro segue sem badges (métricas tasks: viram null)
    tasksOk = false;
  }

  // Conectados por base ("Leads vinculados"): UMA consulta por base distinta
  // referenciada (cabeçalho ∪ badges), fail-soft — falha vira null (badge
  // oculto, nunca 0 enganoso). O gêmeo records.related_lead_id entra como par
  // extra quando a base contada resolve p/ 'lead' (espelha o coalesce do
  // _widget_match_expr, 0104); o dedupe interno cobre gêmeo × match real.
  const linkedBySource = new Map<string, Map<string, number> | null>();
  const linkedSources = [
    ...new Set(specs.flatMap((s) => (s.kind === "linked" ? [s.source] : []))),
  ];
  if (linkedSources.length > 0 && records.length > 0) {
    const ids = records.map((r) => r.id);
    await Promise.all(
      linkedSources.map(async (source) => {
        try {
          const extraPairs =
            recordTypeOf(source, catalog) === "lead"
              ? records.flatMap((r) =>
                  r.related_lead_id
                    ? [{ selfId: r.id, partnerId: r.related_lead_id }]
                    : []
                )
              : undefined;
          const map = await countRelatedBySource(
            supabase,
            opts?.orgId ?? null,
            ids,
            source,
            [],
            opts?.available ?? [],
            catalog,
            extraPairs?.length ? { extraPairs } : undefined
          );
          linkedBySource.set(source, map);
        } catch {
          linkedBySource.set(source, null);
        }
      })
    );
  }

  // Dinheiro de um ref de campo (resolvido uma vez por ref, não por card).
  const moneyByRef = new Map<string, boolean>();
  const fieldRefIsMoney = (ref: string): boolean => {
    const hit = moneyByRef.get(ref);
    if (hit !== undefined) return hit;
    const def = recordFieldDef(ref, defs);
    const isMoney =
      ref === "value" ||
      ref === "mrr" ||
      (def
        ? resolveFieldMoneyFromRecord(
            def,
            (records[0] as RecordRow | undefined) ?? ({} as RecordRow)
          ).isMoney
        : false);
    moneyByRef.set(ref, isMoney);
    return isMoney;
  };

  // Valor de UMA métrica p/ um card (null = sem fato / fato indisponível).
  const metricValueFor = (
    spec: KanbanMetricSpec,
    r: RecordRow
  ): number | null => {
    switch (spec.kind) {
      case "field": {
        const raw = resolveRecordRef(r, spec.ref);
        const num = raw == null || raw === "" ? null : Number(raw);
        return num != null && Number.isFinite(num) ? num : null;
      }
      case "linked": {
        const map = linkedBySource.get(spec.source);
        return map == null ? null : (map.get(r.id) ?? 0);
      }
      case "tasks":
        if (!tasksOk) return null;
        return spec.metric === "open"
          ? (taskCounts.get(r.id) ?? 0)
          : (overdueCounts.get(r.id) ?? 0);
      case "age":
        return recordAgeDays(r, todayIso);
    }
  };

  // Rótulo/dinheiro dos badges resolvidos uma vez (fora do map de cards).
  const badgeDefs = badgeSpecs.map((spec) => ({
    spec,
    key: encodeMetricSpec(spec),
    label: metricSpecLabel(spec, defs, catalog),
    isMoney: spec.kind === "field" && fieldRefIsMoney(spec.ref),
  }));

  const titleField = settings.card?.titleField || "title";
  const extraRefs = (settings.card?.extraFields ?? []).slice(0, 4);

  // Agrupamento de responsáveis (0101): só carrega o mapa quando o quadro
  // agrupa por responsible_id (gate — sem consulta extra nos demais).
  const respCanonById =
    !isCustom &&
    !(settings.dateBucket && settings.dateField) &&
    (settings.groupField ?? "stage") === "responsible_id"
      ? (await loadResponsibleCanon(supabase)).canonicalById
      : undefined;

  const groupKeys: string[] = [];
  const cards: Omit<KanbanCard, "columnKey">[] = records.map((r) => {
    // Personalizar: a "chave de grupo" é a coluna posicionada ("" = 1ª coluna).
    const groupKey = isCustom
      ? (placements.get(r.id)?.columnKey ?? "")
      : recordGroupKey(r, settings, respCanonById);
    groupKeys.push(groupKey);
    const metricNum = columnMetric
      ? metricValueFor(columnMetric.spec, r)
      : null;
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
      metricValue: metricNum,
      isMock: Boolean((r as unknown as { is_mock?: boolean }).is_mock),
      openTasks: taskCounts.get(r.id) ?? 0,
      badges: badgeDefs.map((b) => ({
        key: b.key,
        label: b.label,
        kind: b.spec.kind,
        value: metricValueFor(b.spec, r),
        ...(b.isMoney ? { isMoney: true } : {}),
      })),
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

  // Fato do cabeçalho indisponível (consulta falhou) → agregado null (oculto),
  // nunca um 0 enganoso — mesmo contrato dos badges.
  const columnFactFailed =
    (columnMetric?.spec.kind === "linked" &&
      linkedBySource.get(columnMetric.spec.source) == null) ||
    (columnMetric?.spec.kind === "tasks" && !tasksOk);

  const columnCards: KanbanColumnCards[] = columns.map((c) => {
    const list = byColumn.get(c.key) ?? [];
    const metricSum =
      columnMetric && !columnFactFailed
        ? aggregateMetric(
            list.map((card) => card.metricValue),
            columnMetric.agg
          )
        : null;
    return { ...c, cards: list, count: list.length, metricSum };
  });

  // Formato do cabeçalho: idade = dias; contagem nunca é dinheiro; campo
  // moeda (value/mrr/custom) = dinheiro (mesma régua do metricIsMoney legado).
  const metricFormat: KanbanMetricFormat | undefined = columnMetric
    ? columnMetric.spec.kind === "age"
      ? "days"
      : columnMetric.agg !== "count" &&
          columnMetric.spec.kind === "field" &&
          fieldRefIsMoney(columnMetric.spec.ref)
        ? "money"
        : "number"
    : undefined;

  // Rótulo = spec + sufixo da agregação quando difere do default do kind
  // (config legada segue byte-idêntica: campo somado sem sufixo).
  const metricLabel = columnMetric
    ? metricSpecLabel(columnMetric.spec, defs, catalog) +
      (columnMetric.agg !== defaultAggFor(columnMetric.spec)
        ? ` — ${AGG_LABELS[columnMetric.agg]}`
        : "")
    : null;

  return {
    mode: settings.mode,
    columns: columnCards,
    metricLabel,
    metricIsMoney: metricFormat === "money",
    ...(columnMetric
      ? { metricAgg: columnMetric.agg, metricFormat }
      : {}),
  };
}
