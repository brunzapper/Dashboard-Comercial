// Versão: 1.3 | Data: 18/07/2026
// v1.3 (18/07/2026): fontes por métrica (Metric.sources) — modo lista via
//   runRecordListWithExtras (extras saem do dataset congelado; allowed_sources
//   pode zerá-los → métrica degrada p/ "—") e @period dos filtros rápidos
//   cobrindo as fontes das métricas (widgetQuerySources), espelho da page.
// v1.2 (17/07/2026): busca client-side — com allowWidgetFilters, o q do tf_ é
//   pulado nos widgets em que searchHandledOnClient(settings) (lista de
//   registros sem limit): o viewer filtra em memória, como no dashboard. Com
//   allowWidgetFilters off nada muda (tf_ nem é lido; barra forçada a oculta).
// v1.1: período congelado (0059) — snapshots.default_period (capturado do
//   dashboard na criação) vira o período de TODOS os widgets de dados, via o
//   resolver padrão (periodBar sintético + prefSettings.lastPeriod). As chaves
//   da barra global na URL são SEMPRE descartadas (não há UI para elas aqui).
// VIEWER PÚBLICO de um snapshot (/s/<token>) — a única rota sem autenticação
// além do login. Segurança:
//  * token de 256 bits na URL; o banco guarda só o sha256 (lookup por hash);
//  * 404 UNIFORME para token malformado, inexistente, pausado ou revogado;
//  * toda leitura passa pelo snapshotClient (dataset congelado do snapshot;
//    fail closed para qualquer outra tabela/RPC) via service role — o anon
//    key não enxerga NADA (nenhuma política RLS anon existe);
//  * as restrições do snapshot são aplicadas em dupla camada NO BANCO (0057):
//    linhas reais fora da restrição nem existem na cópia E o RPC do snapshot
//    re-aplica o predicado internamente, mock-aware — os mocks de Data
//    Reunião entram sempre (regra 0052 intacta). O viewer NÃO injeta filtros
//    de restrição (AND puro derrubaria os mocks); no modo lista, os partner
//    rows (só p/ colunas match:) são excluídos por pós-filtro de ids;
//  * inputs do visitante (qf_/tf_/ff_/pf_ na URL) são parseados com os
//    parsers seguros do app e validados contra as opções CONGELADAS.
// A computação espelha app/(app)/dashboards/[id]/page.tsx, trocando o client
// RLS pelo adapter do snapshot e as opções vivas pelas congeladas no config.
import { notFound } from "next/navigation";
import { after } from "next/server";
import type { Metadata } from "next";

import { createServiceClient } from "@/lib/supabase/service";
import { snapshotClient } from "@/lib/snapshots/db-adapter";
import { withRpcMemo } from "@/lib/widgets/rpc-memo";
import { hashToken, isTokenShaped } from "@/lib/snapshots/token";
import {
  SNAPSHOT_LIST_COLS,
  type SnapshotConfig,
  type SnapshotRow,
} from "@/lib/snapshots/types";
import type { FieldDefinition, RecordRow } from "@/lib/records/types";
import { buildAvailableFields } from "@/lib/widgets/fields";
import {
  resolveCurrencyCode,
  yearQuarterOf,
  type CurrencyRates,
} from "@/lib/widgets/currency";
import { runWidget } from "@/lib/widgets/engine";
import { isCardModeWidget, runCardWidget } from "@/lib/widgets/card";
import { runKanban } from "@/lib/kanban/data";
import type { KanbanWidgetResult } from "@/app/(app)/dashboards/kanban-actions";
import { runRecordListWithExtras } from "@/lib/widgets/record-list";
import {
  runEntityList,
  type EntityListRow,
  type EntityRowSource,
} from "@/lib/widgets/entity-list";
import { runCalculatedWidget } from "@/lib/widgets/formula-metric";
import { buildCorrespondenceMap } from "@/lib/correspondences";
import {
  applyPeriodToFilters,
  resolvePeriodSelection,
} from "@/lib/widgets/period";
import { widgetQuerySources } from "@/lib/widgets/metric-sources";
import { createPeriodResolver } from "@/lib/widgets/period-resolve";
import {
  hasQuickValue,
  isPeriodEntry,
  parseQuickFilterValue,
  quickOptionsFilter,
  type QuickFilterValue,
  type WidgetQuickFilters,
} from "@/lib/widgets/quick-filters";
import { NOTE_MAX_EXPRS } from "@/lib/widgets/note-template";
import type {
  CalcWidgetResult,
  Dimension,
  Widget,
  WidgetConfig,
  WidgetData,
  WidgetFilter,
} from "@/lib/widgets/types";
import { isKnownSource, type SourceKey } from "@/lib/sources";
import { loadSources } from "@/lib/config/sources";
import {
  parseViewFilter,
  searchHandledOnClient,
  viewStateToFilters,
} from "@/lib/widgets/view-filters";
import { tokenizeFormulaText } from "@/lib/records/formula-text";
import type { OperandRef } from "@/lib/records/date-operands";
import { COND_DATA_TYPES } from "@/lib/records/cond-operands";
import {
  aggOperandRefs,
  condAggOperandRefs,
  sourceScopedAggOperandRefs,
} from "@/lib/widgets/calc-metrics";
import {
  cellKey,
  classifyCellRaw,
  exprSource,
  quickTableBI,
} from "@/lib/widgets/quick-table/model";
import type { QuickTableResult } from "@/app/(app)/dashboards/quick-table-actions";
import { SnapshotClient } from "@/components/snapshots/snapshot-client";
import { frozenPeriodLabel } from "@/components/snapshots/labels";
import { SourceLabelsProvider } from "@/components/source-labels-context";
import { SourcesProvider } from "@/components/sources-context";
import {
  loadSourceLabelsValue,
  mergeSourceLabels,
} from "@/lib/config/source-labels";

// Sempre computa por request (os filtros do visitante vivem na URL) e nunca
// entra em índice de busca.
export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Snapshot",
  robots: { index: false, follow: false },
};

// Mesmo teto da action deferida da Tabela Livre (quick-table-actions.ts).
const QT_MAX_EXPRS = 30;

function str(v: string | string[] | undefined): string {
  return Array.isArray(v) ? (v[0] ?? "") : (v ?? "");
}

export default async function SnapshotPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { token } = await params;
  const sp = await searchParams;

  // Formato inválido → 404 sem tocar o banco.
  if (!isTokenShaped(token)) notFound();

  const service = createServiceClient();
  const { data: snapData } = await service
    .from("snapshots")
    .select(`${SNAPSHOT_LIST_COLS}, config`)
    .eq("token_hash", hashToken(token))
    .maybeSingle();
  // 404 uniforme: inexistente e pausado são indistinguíveis para o visitante.
  if (!snapData || snapData.status !== "active") notFound();
  const snap = snapData as unknown as SnapshotRow;

  // Auditoria de acesso (contagem aproximada; corrida entre requests é ok).
  // Roda DEPOIS da resposta (after) — o UPDATE não bloqueia a renderização.
  after(async () => {
    await service
      .from("snapshots")
      .update({
        last_accessed_at: new Date().toISOString(),
        access_count: (snap.access_count ?? 0) + 1,
      })
      .eq("id", snap.id);
  });

  const cfg = (snap.config ?? {}) as SnapshotConfig;
  if (!cfg.dashboard || !Array.isArray(cfg.widgets)) {
    // Criado mas nunca congelado com sucesso (primeiro refresh falhou).
    return (
      <main className="flex min-h-svh items-center justify-center p-6">
        <p className="text-muted-foreground text-sm">
          Este snapshot ainda não foi atualizado. Tente novamente mais tarde.
        </p>
      </main>
    );
  }

  const widgets = cfg.widgets;
  const fields = (cfg.fields ?? []) as FieldDefinition[];
  // Mapa chave→def p/ resolver operandos com escopo de fonte em fórmulas de
  // 'calculado_agg' salvas (widgetQuerySources / metricScopedSources).
  const fieldByKeyAll = new Map(fields.map((f) => [f.field_key, f]));
  const correspondences = cfg.correspondences ?? [];
  // Catálogo de fontes + rótulos curtos (dropdowns de campo do viewer) —
  // leitura VIVA via service role (config de exibição, não dado congelado;
  // NUNCA policy anon — regra do projeto). Rótulos via loadSourceLabelsValue +
  // mergeSourceLabels (mesmo split do layout autenticado) p/ buscar em
  // paralelo com loadSources; partner rows entram na mesma leva (antes: três
  // awaits seriais).
  const [sources, sourceLabelsValue, { data: partnerRows }] = await Promise.all(
    [
      loadSources(service),
      loadSourceLabelsValue(service),
      // Partner rows (registros casados fora das restrições, presentes SÓ para
      // resolver colunas match:): o RPC os exclui no SQL (`not partner_only`);
      // no modo lista (PostgREST direto) eles são excluídos por pós-filtro com
      // este conjunto de ids. Restrições de linhas reais NÃO são injetadas
      // aqui: a cópia é a garantia física e o RPC re-aplica o predicado
      // internamente, mock-aware (0057) — filtros AND injetados derrubariam os
      // mocks.
      service
        .from("snapshot_records")
        .select("id")
        .eq("snapshot_id", snap.id)
        .eq("partner_only", true),
    ]
  );
  const available = buildAvailableFields(fields, correspondences, sources);
  const sourceLabels = mergeSourceLabels(sourceLabelsValue, sources);
  const correspondencesMap = buildCorrespondenceMap(correspondences);
  const dashSettings = cfg.dashboard.settings ?? {};
  const currencyRates = (cfg.currencyRates ?? {}) as CurrencyRates;
  const allowQuickFilters = snap.allow_quick_filters;
  const allowWidgetFilters = snap.allow_widget_filters;

  // Memoização por argumentos (a mesma do dashboard autenticado): widgets/
  // notas/calculadoras duplicados geram RPCs idênticas — o memo intercepta
  // `run_widget_query` ANTES de o adapter renomear p/ o RPC do snapshot.
  const db = withRpcMemo(snapshotClient(service, snap.id));
  const partnerIds = new Set((partnerRows ?? []).map((r) => r.id as string));

  // Período congelado na criação (0059): default_period vira o período de
  // todos os widgets de dados via o resolver padrão — periodBar sintético
  // habilitado (o settings congelado vem com ele desabilitado) e a seleção
  // entregue como prefSettings.lastPeriod (tier-1 dos defaults; cobre preset,
  // faixa de/até e campo, inclusive unificado). null = todo o período
  // (snapshots antigos). O dataset congelado não muda: o filtro é em tempo de
  // consulta — e, referenciando Data Reunião, mantém a regra dos mocks viva.
  const frozenPeriod =
    snap.default_period &&
    (snap.default_period.periodo ||
      snap.default_period.de ||
      snap.default_period.ate)
      ? snap.default_period
      : null;

  // Chaves da barra global fora SEMPRE (o período congelado é fixo; não há UI
  // para ele no viewer); widgets `filtro` seguem funcionando via URL quando os
  // filtros de widget estão habilitados — senão vale só o defaultPreset.
  const isBarKey = (k: string) =>
    ["periodo", "de", "ate", "campo"].some(
      (base) => k === base || k.startsWith(`${base}__`)
    );
  const spForPeriods = Object.fromEntries(
    Object.entries(sp).filter(
      ([k]) =>
        !isBarKey(k) &&
        (allowWidgetFilters ||
          (!k.startsWith("pf_") &&
            !k.startsWith("pfd_") &&
            !k.startsWith("pfa_")))
    )
  );
  const resolver = createPeriodResolver({
    sp: spForPeriods,
    available,
    correspondences,
    dashSettings: frozenPeriod
      ? {
          ...dashSettings,
          periodBar: {
            enabled: true,
            scope: "global",
            field: frozenPeriod.campo,
          },
        }
      : dashSettings,
    prefSettings: frozenPeriod ? { lastPeriod: frozenPeriod } : {},
    sources,
  });

  const dataWidgets = widgets.filter(
    (w) =>
      w.visual_type !== "filtro" &&
      w.visual_type !== "filtro_campo" &&
      w.visual_type !== "forma" &&
      w.visual_type !== "imagem"
  );
  const filterWidgets = widgets.filter((w) => w.visual_type === "filtro");
  const fieldFilterWidgets = widgets.filter(
    (w) => w.visual_type === "filtro_campo"
  );

  const { periodByWidget, periodSourceByWidget } =
    resolver.computeWidgetPeriods(dataWidgets, filterWidgets);

  // ============ Filtros rápidos (se habilitados) ============
  // Valores SÓ da URL (qf_<widget>_<entry>) — por visitante, nunca
  // compartilhados — validados contra as opções CONGELADAS (restritas).
  const quickFiltersById: Record<string, WidgetQuickFilters> = {};
  const qfFiltersByWidget: Record<string, WidgetFilter[]> = {};
  if (allowQuickFilters) {
    const qfWidgets = dataWidgets.filter((w) =>
      (w.settings?.quickFilters ?? []).some((e) => e.field)
    );
    for (const w of qfWidgets) {
      const entries = (w.settings?.quickFilters ?? []).filter((e) => e.field);
      const values: Record<string, QuickFilterValue> = {};
      const options: Record<string, { value: string; label: string }[]> = {};
      let filters: WidgetFilter[] = [];

      for (const entry of entries) {
        const frozenOpts = cfg.quickFilterOptions?.[w.id]?.[entry.id] ?? [];
        const raw = str(sp[`qf_${w.id}_${entry.id}`]);
        const stored = raw ? parseQuickFilterValue(raw) : null;

        if (isPeriodEntry(entry, available)) {
          let val = stored?.kind === "period" ? stored : null;
          const wPeriod = periodByWidget[w.id];
          if (val && hasQuickValue(val)) {
            // Mesma interação da page: o filtro rápido assume o campo — se o
            // período congelado ou um widget `filtro` rege este widget no
            // MESMO campo, o dele sai.
            if (wPeriod && wPeriod.field === entry.field) {
              periodByWidget[w.id] = null;
            }
            const p = resolvePeriodSelection(
              { preset: val.preset ?? "", de: val.de ?? "", ate: val.ate ?? "" },
              entry.field
            );
            if (p) {
              const pMap = entry.field.startsWith("unified:")
                ? {
                    ...p,
                    fieldBySource: resolver.resolveFieldBySource(entry.field),
                  }
                : p;
              // Cobertura = fontes do widget ∪ fontes das métricas (espelho da
              // page viva): as pernas por métrica reusam este @period.
              filters = applyPeriodToFilters(
                filters,
                pMap,
                widgetQuerySources(
                  (w.sources ?? []) as SourceKey[],
                  w.metrics,
                  fieldByKeyAll
                )
              );
            }
          } else if (
            frozenPeriod &&
            periodSourceByWidget[w.id] === "bar" &&
            wPeriod?.field === entry.field
          ) {
            // Sem valor do visitante e o período CONGELADO rege o widget no
            // MESMO campo: exibe a seleção congelada no dropdown (espelho da
            // page viva; o período geral continua filtrando por si).
            val = {
              kind: "period",
              preset: frozenPeriod.periodo ?? "",
              de: frozenPeriod.de ?? "",
              ate: frozenPeriod.ate ?? "",
            };
          }
          if (val) values[entry.id] = val;
          continue;
        }

        // Multi-seleção: ids/buckets fora das opções congeladas são DESCARTADOS
        // (visitante não filtra pelo que não pode ver).
        let vals = stored?.kind === "options" ? stored.values : [];
        if (vals.length > 0) {
          const allowed = new Set(frozenOpts.map((o) => o.value));
          vals = vals.filter((v) => allowed.has(v));
        }
        if (vals.length > 0) {
          values[entry.id] = { kind: "options", values: vals };
          filters.push(...quickOptionsFilter(entry, vals, available));
        }
        options[entry.id] = frozenOpts;
      }

      quickFiltersById[w.id] = { entries, values, options };
      if (filters.length > 0) qfFiltersByWidget[w.id] = filters;
    }
  }

  // Ano/trimestre p/ conversão monetária (igual à page).
  const conversionPeriodById: Record<string, { year: number; quarter: number }> =
    {};
  for (const w of dataWidgets) {
    const p = periodByWidget[w.id];
    conversionPeriodById[w.id] = yearQuarterOf(p?.to ?? p?.from ?? null);
  }

  // ============ Filtros de visualização (tf_/ff_, se habilitados) ============
  const viewFiltersByWidget: Record<string, WidgetFilter[]> = {};
  const addViewFilters = (id: string, fs: WidgetFilter[]) => {
    if (fs.length === 0) return;
    viewFiltersByWidget[id] = [...(viewFiltersByWidget[id] ?? []), ...fs];
  };
  for (const [id, fs] of Object.entries(qfFiltersByWidget)) addViewFilters(id, fs);

  if (allowWidgetFilters) {
    for (const w of dataWidgets) {
      if (w.visual_type !== "tabela") continue;
      const raw = str(sp[`tf_${w.id}`]);
      if (!raw) continue;
      addViewFilters(
        w.id,
        // Lista de registros sem limit: o q roda no CLIENTE (mesmo critério do
        // dashboard — ver searchHandledOnClient); estruturados seguem aqui.
        viewStateToFilters(parseViewFilter(raw), w.settings?.searchFields, {
          skipSearch: searchHandledOnClient(w.settings),
        })
      );
    }

    const sourcesOverlap = (a: string[], b: string[]) => {
      if (a.length === 0 || b.length === 0) return true;
      return a.some((s) => b.includes(s));
    };
    for (const fw of fieldFilterWidgets) {
      const raw = str(sp[`ff_${fw.id}`]);
      if (!raw) continue;
      const fs = viewStateToFilters(
        parseViewFilter(raw),
        fw.settings?.searchFields
      );
      if (fs.length === 0) continue;
      const excluded = new Set(fw.settings?.excludedTargets ?? []);
      const fwSources = (fw.sources ?? []) as string[];
      const isUnifiedFilter = (f: WidgetFilter) =>
        f.field.split("|").some((p) => p.startsWith("unified:"));
      const unified = fs.some(isUnifiedFilter);
      const fwSourceKeys = fwSources.filter((s) => isKnownSource(s, sources));
      const targeted =
        fwSourceKeys.length > 0
          ? fs.map((f) => (isUnifiedFilter(f) ? f : { ...f, sources: fwSourceKeys }))
          : fs;
      for (const w of dataWidgets) {
        if (excluded.has(w.id)) continue;
        if (!unified && !sourcesOverlap(fwSources, (w.sources ?? []) as string[]))
          continue;
        addViewFilters(w.id, targeted);
      }
    }
  }

  // Filtros efetivos de um widget: os do próprio widget + filtros de visão.
  // As restrições do snapshot NÃO entram aqui — são aplicadas no banco
  // (cópia + RPC interno, mock-aware; ver cabeçalho).
  const effectiveFilters = (w: Widget): WidgetFilter[] => [
    ...(w.filters ?? []),
    ...(viewFiltersByWidget[w.id] ?? []),
  ];

  // ============ Computação dos widgets (espelho da page, com o adapter) ======
  const isListWidget = (w: Widget) =>
    w.visual_type === "tabela" && w.settings?.rowMode === "records";
  const isCalcWidget = (w: Widget) => w.visual_type === "calculado";
  const isCalculatorWidget = (w: Widget) => w.visual_type === "calculadora";
  const isNoteWidget = (w: Widget) => w.visual_type === "nota";
  const isQuickTableWidget = (w: Widget) => w.visual_type === "tabela_editavel";
  // Kanban: modo registros é precomputado abaixo (read-only sobre o dataset
  // congelado); modo tarefas NUNCA entra no snapshot (dados privados por
  // usuário numa página pública) — o widget mostra placeholder.
  const isKanbanWidget = (w: Widget) => w.visual_type === "kanban";
  // Agenda: nunca no snapshot (tarefas privadas + navegação exige sessão) —
  // o widget mostra placeholder.
  const isAgendaWidget = (w: Widget) => w.visual_type === "agenda";

  const allowedRespSet = snap.allowed_responsible_ids
    ? new Set(snap.allowed_responsible_ids)
    : null;
  const allowedOpsSet = snap.allowed_operation_ids
    ? new Set(snap.allowed_operation_ids)
    : null;

  // Todas as ondas de computação (widgets, rótulos FK, calc/calculadora/nota,
  // tabela livre, kanban) são disparadas como promises e aguardadas numa
  // BARREIRA ÚNICA adiante — antes eram ~6 await seriais. As únicas
  // dependências reais são: rótulos FK ← widgets-lista; kanban ← rótulos FK.
  const dataById: Record<string, WidgetData> = {};
  const recordListById: Record<string, RecordRow[]> = {};
  // Registros EXTRAS por widget (fontes de Metric.sources fora das do widget):
  // só basis dos subtotais no cliente; fora dos rótulos FK.
  const recordListExtraById: Record<string, RecordRow[]> = {};
  const entityListById: Record<string, EntityListRow[]> = {};
  const widgetTasks =
    dataWidgets.map(async (w) => {
      if (isCalcWidget(w) || isCalculatorWidget(w) || isNoteWidget(w)) return;
      if (isQuickTableWidget(w)) return; // precomputado abaixo
      if (isKanbanWidget(w)) return; // precomputado abaixo (só modo registros)
      if (isAgendaWidget(w)) return; // placeholder no viewer
      const config: WidgetConfig = {
        source: "records",
        sources: (w.sources ?? []) as SourceKey[],
        splitBySource: w.split_by_source ?? false,
        dimensions: w.dimensions ?? [],
        metrics: w.metrics ?? [],
        filters: effectiveFilters(w),
        visual_type: w.visual_type,
        settings: w.settings,
      };
      const fail = (e: unknown) => {
        const msg = e instanceof Error ? e.message : String(e);
        console.error(`[snapshot] widget ${w.id} falhou:`, msg);
        dataById[w.id] = { rows: [], dimensions: [], metrics: [], error: msg };
      };
      // Card em modo novo (record/topn/list/formula): mesmo motor do dashboard
      // (lib/widgets/card.ts) sobre o dataset congelado; partner rows excluídas
      // do modo record como nas listas.
      if (isCardModeWidget(w)) {
        try {
          dataById[w.id] = await runCardWidget(
            db,
            config,
            periodByWidget[w.id],
            available,
            fields,
            currencyRates,
            conversionPeriodById[w.id],
            correspondencesMap,
            { excludeRecordIds: partnerIds },
            sources,
            correspondences
          );
        } catch (e) {
          fail(e);
        }
        return;
      }
      if (isListWidget(w)) {
        const rowSource = w.settings?.rowSource ?? "records";
        if (rowSource === "responsibles" || rowSource === "operations") {
          try {
            let rows = await runEntityList(
              db,
              rowSource as EntityRowSource,
              w.settings?.limit
            );
            // Restrições valem também para listas de ENTIDADES (senão a lista
            // completa de responsáveis/operações vazaria).
            if (rowSource === "responsibles" && allowedRespSet) {
              rows = rows.filter((r) => allowedRespSet.has(r.id));
            }
            if (rowSource === "operations" && allowedOpsSet) {
              rows = rows.filter((r) => allowedOpsSet.has(r.id));
            }
            entityListById[w.id] = rows;
          } catch (e) {
            entityListById[w.id] = [];
            fail(e);
          }
          return;
        }
        try {
          const { records: rows, extra } = await runRecordListWithExtras(
            db,
            config,
            periodByWidget[w.id],
            available,
            sources,
            fields
          );
          // Partner rows nunca são linhas de dados (existem só p/ resolver
          // colunas match: — e por construção violam ≥1 restrição).
          recordListById[w.id] =
            partnerIds.size > 0
              ? rows.filter((r) => !partnerIds.has(r.id))
              : rows;
          // Extras (Metric.sources): saem do dataset CONGELADO — allowed_sources
          // do snapshot pode zerá-los (métrica degrada p/ "—"; documentado).
          if (extra.length > 0) {
            recordListExtraById[w.id] =
              partnerIds.size > 0
                ? extra.filter((r) => !partnerIds.has(r.id))
                : extra;
          }
        } catch (e) {
          recordListById[w.id] = [];
          fail(e);
        }
        return;
      }
      try {
        dataById[w.id] = await runWidget(
          db,
          config,
          available,
          periodByWidget[w.id],
          correspondencesMap,
          fields,
          currencyRates,
          conversionPeriodById[w.id],
          sources,
          correspondences
        );
      } catch (e) {
        fail(e);
      }
    });

  // Rótulos FK das tabelas de registros (ids congelados → nomes; leads saem da
  // própria cópia via adapter). Só os widgets-lista alimentam recordListById:
  // a busca dispara quando ELES terminam, em paralelo com o resto.
  const listTasks = widgetTasks.filter((_, i) => {
    const w = dataWidgets[i];
    return isListWidget(w) && (w.settings?.rowSource ?? "records") === "records";
  });
  const fkLabels: Record<string, string> = {};
  const fkLabelsPromise = Promise.all(listTasks).then(async () => {
    const listRows = Object.values(recordListById).flat();
    if (listRows.length === 0) return;
    const respIds = new Set<string>();
    const opIds = new Set<string>();
    const leadIds = new Set<string>();
    for (const r of listRows) {
      if (r.responsible_id) respIds.add(r.responsible_id);
      if (r.operation_id) opIds.add(r.operation_id);
      if (r.related_lead_id) leadIds.add(r.related_lead_id);
    }
    const [resp, ops, leads] = await Promise.all([
      respIds.size
        ? db.from("responsibles").select("id, display_name").in("id", [...respIds])
        : Promise.resolve({ data: [] }),
      opIds.size
        ? db.from("operations").select("id, name").in("id", [...opIds])
        : Promise.resolve({ data: [] }),
      leadIds.size
        ? db.from("records").select("id, title").in("id", [...leadIds])
        : Promise.resolve({ data: [] }),
    ]);
    for (const r of resp.data ?? [])
      fkLabels[r.id as string] = (r.display_name as string) ?? "—";
    for (const o of ops.data ?? [])
      fkLabels[o.id as string] = (o.name as string) ?? "—";
    for (const l of leads.data ?? [])
      fkLabels[l.id as string] = (l.title as string) ?? "—";
  });

  // ============ Métricas calculadas / calculadora / nota ============
  const calcById: Record<string, CalcWidgetResult> = {};
  const calcPromise = Promise.all(
    dataWidgets.filter(isCalcWidget).map(async (w) => {
      try {
        const calcKey = w.settings?.calcField;
        const def = calcKey?.startsWith("custom:")
          ? fields.find(
              (f) =>
                f.field_key === calcKey.slice(7) &&
                f.data_type === "calculado_agg"
            )
          : undefined;
        const formula = calcKey ? (def?.formula ?? null) : w.settings?.formula;
        calcById[w.id] = await runCalculatedWidget(db, {
          formula,
          sources: (w.sources ?? []) as SourceKey[],
          sourceDefs: sources,
          filters: effectiveFilters(w),
          period: periodByWidget[w.id],
          correspondencesMap,
          currencyMode:
            def?.currency_mode === "fixed"
              ? "fixed"
              : def?.currency_mode === "inherit"
                ? "auto"
                : "none",
          currencyCode:
            def?.currency_mode === "fixed"
              ? resolveCurrencyCode(def.currency_code)
              : null,
          allowNegative: def?.allow_negative !== false,
          fields,
          rates: currencyRates,
          conversionPeriod: conversionPeriodById[w.id],
        });
      } catch {
        calcById[w.id] = { value: null, currency: null };
      }
    })
  );

  const calcVarsById: Record<string, Record<string, CalcWidgetResult>> = {};
  const calculatorPromise = Promise.all(
    dataWidgets.filter(isCalculatorWidget).map(async (w) => {
      const vars = w.settings?.calculator?.variables ?? [];
      const out: Record<string, CalcWidgetResult> = {};
      await Promise.all(
        vars.map(async (v) => {
          try {
            out[v.id] = await runCalculatedWidget(db, {
              formula: v.formula ?? null,
              sources: (w.sources ?? []) as SourceKey[],
              sourceDefs: sources,
              filters: effectiveFilters(w),
              period: periodByWidget[w.id],
              correspondencesMap,
              currencyMode: "auto",
              fields,
              rates: currencyRates,
              conversionPeriod: conversionPeriodById[w.id],
            });
          } catch {
            out[v.id] = { value: null, currency: null };
          }
        })
      );
      calcVarsById[w.id] = out;
    })
  );

  const noteById: Record<string, CalcWidgetResult[]> = {};
  const notePromise = Promise.all(
    dataWidgets.filter(isNoteWidget).map(async (w) => {
      const exprs = (w.settings?.note?.exprs ?? []).slice(0, NOTE_MAX_EXPRS);
      noteById[w.id] = await Promise.all(
        exprs.map(async (formula) => {
          try {
            return await runCalculatedWidget(db, {
              formula,
              sources: (w.sources ?? []) as SourceKey[],
              sourceDefs: sources,
              filters: effectiveFilters(w),
              period: periodByWidget[w.id],
              correspondencesMap,
              currencyMode: "auto",
              fields,
              rates: currencyRates,
              conversionPeriod: conversionPeriodById[w.id],
            });
          } catch {
            return { value: null, currency: null };
          }
        })
      );
    })
  );

  // ============ Tabela Livre: BI + expressões PRECOMPUTADOS ============
  // A action deferida (runQuickTable) exige sessão — aqui o servidor da página
  // computa o mesmo resultado sobre o dataset congelado e entrega via
  // SnapshotModeProvider (o widget pula o fetch em modo snapshot).
  const quickTableResults: Record<string, QuickTableResult> = {};
  const quickTableWidgets = dataWidgets.filter(isQuickTableWidget);
  let quickTablePromise: Promise<unknown> = Promise.resolve();
  if (quickTableWidgets.length > 0) {
    // Catálogo de operandos das expressões {=…} — mesma montagem da action.
    const numeric = available.filter((f) => f.isNumeric);
    const countable = available.filter(
      (f) => (f.isNumeric || f.isDate) && !f.aggCalc && !f.displayOnly
    );
    const customCond = fields
      .filter((f) => COND_DATA_TYPES.includes(f.data_type))
      .map((f) => ({ field_key: f.field_key, label: f.label }));
    const customDate = fields
      .filter((f) => f.data_type === "data")
      .map((f) => ({ field_key: f.field_key, label: f.label }));
    // Escopo de fonte: mesma montagem da action (sem match:).
    const scopedInput = (list: typeof available) =>
      list
        .filter((f) => !f.field.startsWith("match:"))
        .map((f) => ({
          field: f.field,
          label: f.label,
          appliesTo: f.field.startsWith("custom:")
            ? (fields.find((d) => d.field_key === f.field.slice(7))
                ?.applies_to ?? null)
            : f.unifiedMembers
              ? Object.keys(f.unifiedMembers)
              : null,
        }));
    const catalog: OperandRef[] = [
      ...aggOperandRefs(numeric, countable),
      ...sourceScopedAggOperandRefs(
        scopedInput(numeric),
        scopedInput(countable),
        sources
      ),
      ...condAggOperandRefs(
        numeric,
        customCond,
        customDate,
        sources,
        available
          .filter((f) => f.unified && !f.isNumeric)
          .map((f) => ({ field: f.field, label: f.label }))
      ),
    ];

    quickTablePromise = Promise.all(
      quickTableWidgets.map(async (w) => {
        const qt = w.settings?.quickTable;
        if (!qt) {
          quickTableResults[w.id] = { data: null, exprValues: {} };
          return;
        }
        const filters = effectiveFilters(w);
        const period = periodByWidget[w.id] ?? null;
        const conversionPeriod = conversionPeriodById[w.id];

        const bi = quickTableBI(qt);
        let data: WidgetData | null = null;
        if (bi.hasBI) {
          const dimOf = (c: (typeof bi.rowDims)[number]): Dimension => ({
            field: c.field!,
            ...(c.transform && c.transform !== "none"
              ? { transform: c.transform, weekMode: c.weekMode }
              : {}),
          });
          const config: WidgetConfig = {
            source: "records",
            sources: (w.sources ?? []) as SourceKey[],
            splitBySource: false,
            dimensions: [
              ...bi.rowDims.map(dimOf),
              ...(bi.pivotDim ? [dimOf(bi.pivotDim)] : []),
            ],
            metrics: bi.metricCols.map((c) => c.metric!),
            filters,
            visual_type: "tabela",
            settings: w.settings,
          };
          try {
            data = await runWidget(
              db,
              config,
              available,
              period,
              correspondencesMap,
              fields,
              currencyRates,
              conversionPeriod,
              sources,
              correspondences
            );
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            console.error(`[snapshot] tabela livre ${w.id} falhou:`, msg);
            data = { rows: [], dimensions: [], metrics: [], error: msg };
          }
        }

        // Expressões {=…} das células CONGELADAS (tableCellsById do config).
        const exprValues: Record<string, CalcWidgetResult> = {};
        const exprCells = (cfg.tableCellsById?.[w.id] ?? [])
          .filter((c) => classifyCellRaw(String(c.value ?? "")) === "expr")
          .slice(0, QT_MAX_EXPRS);
        await Promise.all(
          exprCells.map(async (c) => {
            const key = cellKey(String(c.row_key), String(c.col_key));
            const tok = tokenizeFormulaText(
              exprSource(String(c.value ?? "")),
              catalog
            );
            if (!tok.ok) {
              exprValues[key] = { value: null, currency: null, text: "#ERRO" };
              return;
            }
            try {
              exprValues[key] = await runCalculatedWidget(db, {
                formula: tok.formula,
                sources: (w.sources ?? []) as SourceKey[],
                sourceDefs: sources,
                filters,
                period,
                correspondencesMap,
                currencyMode: "auto",
                fields,
                rates: currencyRates,
                conversionPeriod,
              });
            } catch {
              exprValues[key] = { value: null, currency: null };
            }
          })
        );

        quickTableResults[w.id] = { data, exprValues, error: data?.error };
      })
    );
  }

  // ============ Kanban: quadro PRECOMPUTADO (read-only) ============
  // Só o modo registros — roda sobre o dataset congelado via adapter (mesmo
  // caminho do modo lista). Tarefas nunca entram no snapshot: o adapter falha
  // fechado p/ a tabela `tasks` e o widget mostra placeholder.
  const kanbanResults: Record<string, KanbanWidgetResult> = {};
  // Kanban consome os rótulos FK — encadeia na promise deles (não em todos os
  // widgets).
  const kanbanPromise = fkLabelsPromise.then(() =>
    Promise.all(
      dataWidgets.filter(isKanbanWidget).map(async (w) => {
        const kanban = w.settings?.kanban;
        if (!kanban || kanban.mode !== "registros") return;
        try {
          const data = await runKanban(
            db,
            kanban,
            periodByWidget[w.id] ?? null,
            fields,
            { responsibles: fkLabels, operations: fkLabels },
            // Personalizar no snapshot: o adapter do dataset congelado não tem
            // kanban_placements — o try/catch interno derruba tudo na 1ª
            // coluna.
            { kind: "widget", id: w.id }
          );
          kanbanResults[w.id] = {
            data,
            kanban,
            fields: [],
            responsibles: [],
            operations: [],
            quickCreateSource: null,
          };
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          console.error(`[snapshot] kanban ${w.id} falhou:`, msg);
        }
      })
    )
  );

  // BARREIRA ÚNICA: tudo acima corre em paralelo (respeitadas as dependências
  // widgets-lista → rótulos FK → kanban, encadeadas nas próprias promises).
  await Promise.all([
    ...widgetTasks,
    fkLabelsPromise,
    calcPromise,
    calculatorPromise,
    notePromise,
    quickTablePromise,
    kanbanPromise,
  ]);

  // ============ Widgets a RENDERIZAR ============
  // Filtros de widget desabilitados: os cards de controle (filtro/filtro_campo)
  // saem da tela (o defaultPreset dos widgets `filtro` já foi aplicado acima) e
  // a barra de busca embutida das tabelas é forçada a ficar oculta.
  const renderWidgets = allowWidgetFilters
    ? widgets
    : widgets
        .filter(
          (w) => w.visual_type !== "filtro" && w.visual_type !== "filtro_campo"
        )
        .map((w) =>
          w.visual_type === "tabela" && w.settings?.showFilterBar !== false
            ? { ...w, settings: { ...w.settings, showFilterBar: false } }
            : w
        );

  const activeTabId = dashSettings.tabs?.[0]?.id ?? "";

  // Selo do período congelado no cabeçalho (ex.: "Este ano · Data Reunião").
  const frozenCampoLabel = frozenPeriod?.campo
    ? (available.find((a) => a.field === frozenPeriod.campo)?.label ??
      frozenPeriod.campo)
    : "";
  const periodLabel = frozenPeriod
    ? frozenPeriodLabel(frozenPeriod) +
      (frozenCampoLabel ? ` · ${frozenCampoLabel}` : "")
    : undefined;

  return (
    <SourcesProvider sources={sources}>
      <SourceLabelsProvider labels={sourceLabels}>
        <SnapshotClient
          snapshotName={snap.name}
          dashboardName={cfg.dashboard.name}
          tabName={cfg.tabName}
          periodLabel={periodLabel}
          lastRefreshedAt={snap.last_refreshed_at}
          dashboardId={snap.dashboard_id}
          widgets={renderWidgets}
          dataById={dataById}
          recordListById={recordListById}
          recordListExtraById={recordListExtraById}
          entityListById={entityListById}
          calcById={calcById}
          calcVarsById={calcVarsById}
          noteById={noteById}
          calcExprById={cfg.calcExprById ?? {}}
          tableCellsById={cfg.tableCellsById ?? {}}
          quickTableResults={quickTableResults}
          kanbanResults={kanbanResults}
          fields={fields}
          fkLabels={fkLabels}
          available={available}
          settings={dashSettings}
          activeTabId={activeTabId}
          dateFormat={dashSettings.dateFormat}
          currencyRates={currencyRates}
          conversionPeriodById={conversionPeriodById}
          filterOptionsById={
            allowWidgetFilters ? (cfg.fieldFilterOptions ?? {}) : undefined
          }
          quickFiltersById={allowQuickFilters ? quickFiltersById : undefined}
        />
      </SourceLabelsProvider>
    </SourcesProvider>
  );
}
