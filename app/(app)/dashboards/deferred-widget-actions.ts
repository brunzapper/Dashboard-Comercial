// Versão: 1.0 | Data: 26/07/2026
// Widgets de ENGINE deferidos (padrão Tabela Livre/Kanban, agora em LOTE): a
// page NÃO computa gráfico/KPI/card/pizza/funil/tabela agregada/calculado/
// calculadora/nota — o DashboardClient chama esta action após o mount com os
// ids e recebe os resultados no MESMO shape dos mapas da page (dataById/
// calcById/calcVarsById/noteById). Uma chamada por lote (não N round-trips):
// o escopo sai do widget-scope com bundle COMPARTILHADO (invariante 12 —
// nunca remontar filtros na mão; consultas de catálogo/prefs/períodos rodam
// 1×), o cliente RPC é o MESMO em duas camadas da page (memo por lote + cache
// TTL entre requisições) e o limitador de concorrência é o compartilhado
// (task-limiter). Dispatch por tipo espelha o computeWidget da page; RLS
// cobre o acesso (client do usuário); RPCs de widget INTOCADOS.
"use server";

import { getSessionInfo } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { splitCoreDefs } from "@/lib/records/core-defs";
import { isCardModeWidget, runCardWidget } from "@/lib/widgets/card";
import {
  loadCurrencyRates,
  resolveCurrencyCode,
  yearQuarterOf,
} from "@/lib/widgets/currency";
import { runWidget } from "@/lib/widgets/engine";
import { runCalculatedWidget } from "@/lib/widgets/formula-metric";
import { NOTE_MAX_EXPRS } from "@/lib/widgets/note-template";
import { withRpcTtlCache } from "@/lib/widgets/rpc-cache";
import { withRpcMemo } from "@/lib/widgets/rpc-memo";
import {
  createTaskLimiter,
  WIDGET_TASK_CONCURRENCY,
} from "@/lib/widgets/task-limiter";
import {
  loadDashboardScopeBundle,
  scopeForWidget,
} from "@/lib/widgets/widget-scope";
import type {
  CalcWidgetResult,
  Widget,
  WidgetData,
} from "@/lib/widgets/types";

// Teto defensivo de ids por lote (o cliente manda todos os widgets de engine
// do dashboard de uma vez; acima disso é sinal de chamada malformada).
const MAX_DEFERRED_BATCH = 120;

export interface DeferredWidgetsPayload {
  dataById: Record<string, WidgetData>;
  calcById: Record<string, CalcWidgetResult>;
  calcVarsById: Record<string, Record<string, CalcWidgetResult>>;
  noteById: Record<string, CalcWidgetResult[]>;
}

export type DeferredWidgetsResult =
  | ({ ok: true } & DeferredWidgetsPayload)
  | { ok: false; message: string };

// Tipos que ESTA action computa (espelho do computeWidget da page, menos os
// que têm caminho próprio: listas/entity ficam inline na page; Tabela Livre/
// kanban/agenda têm actions próprias; filtros/forma/imagem não têm dados).
function isEngineWidget(w: Widget): boolean {
  if (w.visual_type === "tabela" && w.settings?.rowMode === "records") {
    return false; // modo lista (inline na page)
  }
  return ![
    "filtro",
    "filtro_campo",
    "forma",
    "linha_divisoria",
    "imagem",
    "tabela_editavel",
    "kanban",
    "agenda",
  ].includes(w.visual_type);
}

export async function runDeferredWidgets(
  dashboardId: string,
  widgetIds: string[],
  // window.location.search do cliente — período/aba/filtros são parâmetros de
  // URL, resolvidos exatamente como a page (resolver único).
  search: string
): Promise<DeferredWidgetsResult> {
  const session = await getSessionInfo();
  if (!session) return { ok: false, message: "Sessão expirada." };
  const supabase = await createClient();

  const ids = [...new Set(widgetIds)].slice(0, MAX_DEFERRED_BATCH);
  const loaded = await loadDashboardScopeBundle(
    supabase,
    session,
    dashboardId,
    search
  );
  if (!loaded.ok) return loaded;
  const bundle = loaded.bundle;

  // Duas camadas da page: memo (dedup no lote — widgets idênticos compartilham
  // a chamada) sobre o cache TTL entre requisições (chave por usuário — RPC
  // SECURITY INVOKER). loadCurrencyRates em paralelo com nada a esperar.
  const rpcClient = withRpcMemo(
    withRpcTtlCache(supabase, `u:${session.user.id}`)
  );
  const currencyRates = await loadCurrencyRates(supabase);
  const { custom: customFields } = splitCoreDefs(bundle.allFields);

  const out: DeferredWidgetsPayload = {
    dataById: {},
    calcById: {},
    calcVarsById: {},
    noteById: {},
  };
  const runLimited = createTaskLimiter(WIDGET_TASK_CONCURRENCY);

  const computeOne = async (widgetId: string): Promise<void> => {
    const scoped = await scopeForWidget(supabase, session, bundle, widgetId);
    if (!scoped.ok) return; // id desconhecido/estranho ao board: ignora
    const { widget: w, config, period, available, sources, correspondences } =
      scoped.scope;
    if (!isEngineWidget(w)) return;
    // Mesma regra da page/quick-table p/ o período de conversão de moeda.
    const conversionPeriod = yearQuarterOf(period?.to ?? period?.from ?? null);

    // Métrica calculada (espelho da page: def de /campos ou fórmula inline).
    if (w.visual_type === "calculado") {
      try {
        const calcKey = w.settings?.calcField;
        const def = calcKey?.startsWith("custom:")
          ? customFields.find(
              (f) =>
                f.field_key === calcKey.slice(7) &&
                f.data_type === "calculado_agg"
            )
          : undefined;
        const formula = calcKey ? (def?.formula ?? null) : w.settings?.formula;
        out.calcById[w.id] = await runCalculatedWidget(rpcClient, {
          formula,
          sources: w.sources ?? [],
          sourceDefs: sources,
          filters: config.filters ?? [],
          period,
          correspondences,
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
          fields: customFields,
          rates: currencyRates,
          conversionPeriod,
        });
      } catch {
        out.calcById[w.id] = { value: null, currency: null };
      }
      return;
    }
    // Calculadora: valor de cada variável nomeada (expressão avaliada no
    // cliente contra esses valores).
    if (w.visual_type === "calculadora") {
      const vars = w.settings?.calculator?.variables ?? [];
      const values: Record<string, CalcWidgetResult> = {};
      await Promise.all(
        vars.map(async (v) => {
          try {
            values[v.id] = await runCalculatedWidget(rpcClient, {
              formula: v.formula ?? null,
              sources: w.sources ?? [],
              sourceDefs: sources,
              filters: config.filters ?? [],
              period,
              correspondences,
              currencyMode: "auto",
              fields: customFields,
              rates: currencyRates,
              conversionPeriod,
            });
          } catch {
            values[v.id] = { value: null, currency: null };
          }
        })
      );
      out.calcVarsById[w.id] = values;
      return;
    }
    // Nota (post-it): expressões {=…} na ordem do texto (teto NOTE_MAX_EXPRS).
    if (w.visual_type === "nota") {
      const exprs = (w.settings?.note?.exprs ?? []).slice(0, NOTE_MAX_EXPRS);
      out.noteById[w.id] = await Promise.all(
        exprs.map(async (formula) => {
          try {
            return await runCalculatedWidget(rpcClient, {
              formula,
              sources: w.sources ?? [],
              sourceDefs: sources,
              filters: config.filters ?? [],
              period,
              correspondences,
              currencyMode: "auto",
              fields: customFields,
              rates: currencyRates,
              conversionPeriod,
            });
          } catch {
            return { value: null, currency: null };
          }
        })
      );
      return;
    }
    // Erro: loga no servidor e propaga a mensagem no `data` do card
    // (WidgetData.error) — mesmo contrato do computeWidget da page.
    const fail = (e: unknown) => {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(
        `[deferred] widget ${w.id} (${w.title ?? w.visual_type}) falhou:`,
        msg
      );
      out.dataById[w.id] = { rows: [], dimensions: [], metrics: [], error: msg };
    };
    if (isCardModeWidget(w)) {
      try {
        out.dataById[w.id] = await runCardWidget(
          rpcClient,
          config,
          period,
          available,
          customFields,
          currencyRates,
          conversionPeriod,
          {},
          sources,
          correspondences
        );
      } catch (e) {
        fail(e);
      }
      return;
    }
    try {
      out.dataById[w.id] = await runWidget(
        rpcClient,
        config,
        available,
        period,
        bundle.allFields,
        currencyRates,
        conversionPeriod,
        sources,
        correspondences
      );
    } catch (e) {
      fail(e);
    }
  };

  await Promise.all(ids.map((id) => runLimited(() => computeOne(id))));
  return { ok: true, ...out };
}
