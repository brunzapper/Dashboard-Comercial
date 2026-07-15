// Versão: 2.2 | Data: 15/07/2026
// Shell do dashboard: cabeçalho + alternar modo de edição + adicionar widget +
// barra de período global + o grid. Recebe tudo já serializável (widgets +
// dados pré-computados).
// v2.2 (15/07/2026): widgets calculadora/nota/forma — focusWidget (atalhos:
//   troca aba/dashboard e centraliza o alvo, WidgetFocusProvider), estado
//   otimista de conectores (settings.connectors) + modo "Conectar", e repasse
//   de calcVarsById/noteById/calcExprById ao grid.
// v2.1 (15/07/2026): estado otimista de layout
// (layoutById) — fonte de verdade das posições entre um saveLayout (que não
// revalida) e o próximo refresh real; aba ativa persistida na URL (?tab=).
// v2.0 (09/07/2026): barra de período editável/removível e filtro como widget
// (siblings ao builder).
"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Clock, Pencil, Plus, Redo2, Spline, Undo2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { FieldDefinition, RecordRow } from "@/lib/records/types";
import type { AvailableField } from "@/lib/widgets/fields";
import type { PeriodScope, PeriodSelection } from "@/lib/widgets/period";
import type {
  CalcWidgetResult,
  Connector,
  DashboardSettings,
  FieldFilterOptions,
  GridPosition,
  Widget,
  WidgetData,
  WidgetLinkTarget,
} from "@/lib/widgets/types";
import { posOf } from "@/lib/widgets/grid-placement";
import { focusWidgetWithRetry } from "@/lib/widgets/focus";
import type { DateFormat } from "@/lib/widgets/format";
import type { CurrencyRates } from "@/lib/widgets/currency";
import type { WidgetQuickFilters } from "@/lib/widgets/quick-filters";
import type { EntityListRow } from "@/lib/widgets/entity-list";
import { dashboardBackgroundCss } from "@/lib/widgets/appearance";
import type { DashboardSnapshot } from "@/lib/widgets/history";
import { renameDashboard, updateDashboardSettings } from "@/app/(app)/dashboards/actions";
import { DashboardGrid } from "./dashboard-grid";
import type { ResponsibleOption } from "./charts/record-list-table";
import { DashboardMenu } from "./dashboard-menu";
import { DashboardTabs } from "./dashboard-tabs";
import {
  DashboardHistoryProvider,
  useDashboardHistory,
} from "./history-context";
import { DashboardPendingProvider } from "./pending-context";
import { WidgetFocusProvider } from "./focus-context";
import { PeriodFilter } from "./period-filter";
import { WidgetBuilder } from "./widget-builder";

// Id determinístico da aba sintética que abriga os widgets SEM etiqueta
// (settings.tab ausente) durante a reconstrução. Constante (não uuid) para não
// colidir com abas reais e manter o resync (seedKey) estável entre renders.
const RECOVERED_FIRST_TAB_ID = "__recovered_tab_1__";

// Reconstrói a lista de abas a partir dos widgets quando `settings.tabs` foi
// perdido (ex.: sobrescrito por uma gravação parcial de settings). Cada widget
// guarda a aba em `settings.tab`; widgets SEM `tab` herdam a 1ª aba (ver
// `widgetTab`: undefined → firstTabId). No fluxo comum "adicionei a 2ª aba num
// dashboard já cheio", os widgets da 1ª aba ficam sem etiqueta e só os da 2ª são
// etiquetados — por isso os sem-etiqueta viram uma 1ª aba sintética própria,
// senão duas abas colapsariam em uma. Nomes/cores originais não são recuperáveis
// (viviam só em settings.tabs) → nomes padrão "Aba N". Sem nenhum id explícito
// (tela única), devolve [] — nada é reconstruído.
function rebuildTabsFromWidgets(
  widgets: Widget[]
): NonNullable<DashboardSettings["tabs"]> {
  const explicit: string[] = [];
  let hasUntagged = false;
  for (const w of widgets) {
    const t = w.settings?.tab;
    if (t) {
      if (!explicit.includes(t)) explicit.push(t);
    } else {
      hasUntagged = true;
    }
  }
  if (explicit.length === 0) return []; // nunca teve abas (tela única)
  const ids = hasUntagged ? [RECOVERED_FIRST_TAB_ID, ...explicit] : explicit;
  return ids.map((id, i) => ({ id, name: `Aba ${i + 1}` }));
}

export function DashboardClient({
  dashboardId,
  dashboardName,
  historySeed,
  widgets,
  dataById,
  recordListById,
  entityListById,
  calcById,
  calcVarsById = {},
  noteById = {},
  calcExprById = {},
  fields,
  fkLabels,
  responsibleOptions,
  userRoles,
  canEditValues,
  available,
  availableForBuilder,
  canEdit,
  canManageFields = false,
  currencyOptions,
  currencyRates = {},
  conversionPeriodById = {},
  settings,
  visibleToRoles,
  dateFormat,
  periodBar,
  periodScope,
  periodDefaultsByTab,
  periodDefaultFieldByTab,
  filterOptionsById,
  quickFiltersById,
  initialTabId,
  focusWidgetId,
}: {
  dashboardId: string;
  dashboardName: string;
  historySeed: DashboardSnapshot;
  widgets: Widget[];
  dataById: Record<string, WidgetData>;
  recordListById: Record<string, RecordRow[]>;
  entityListById: Record<string, EntityListRow[]>;
  calcById: Record<string, CalcWidgetResult>;
  // Calculadora: valores das variáveis por widget ({ widgetId: { varId: r } }).
  calcVarsById?: Record<string, Record<string, CalcWidgetResult>>;
  // Nota: resultados das expressões {=…} por widget, na ordem do texto.
  noteById?: Record<string, CalcWidgetResult[]>;
  // Calculadora: expressão compartilhada corrente (row __calc__).
  calcExprById?: Record<string, string>;
  fields: FieldDefinition[];
  fkLabels: Record<string, string>;
  responsibleOptions?: ResponsibleOption[];
  userRoles: string[];
  canEditValues: boolean;
  available: AvailableField[];
  // Lista de campos para os SELETORES de edição (construtor de widgets, barra de
  // período): já filtrada pelo ACL por papel (visible_to_roles) na page. Pode
  // ser mais curta que `available`, que é a lista COMPLETA usada na renderização.
  availableForBuilder: AvailableField[];
  canEdit: boolean;
  canManageFields?: boolean;
  currencyOptions?: { value: string; label: string }[];
  currencyRates?: CurrencyRates;
  conversionPeriodById?: Record<string, { year: number; quarter: number }>;
  settings: DashboardSettings;
  visibleToRoles: string[];
  dateFormat?: DateFormat;
  periodBar?: DashboardSettings["periodBar"];
  periodScope?: PeriodScope;
  periodDefaultsByTab?: Record<string, PeriodSelection>;
  periodDefaultFieldByTab?: Record<string, string>;
  filterOptionsById?: Record<string, FieldFilterOptions>;
  quickFiltersById?: Record<string, WidgetQuickFilters>;
  // Aba vinda da URL (?tab=), para restaurar a aba ativa ao recarregar. Chega
  // crua da page (sem validação) — validada aqui contra as abas efetivas.
  initialTabId?: string;
  // Widget a focar ao montar (?focus= — atalho vindo de outro dashboard). A
  // page já entrega initialTabId apontando para a aba do alvo.
  focusWidgetId?: string;
}) {
  const [editMode, setEditMode] = useState(false);
  // Modo "Conectar" (criar linhas entre widgets); só faz sentido em editMode.
  const [connectMode, setConnectMode] = useState(false);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const barEnabled = periodBar?.enabled !== false;
  const backgroundCss = dashboardBackgroundCss(settings.background);

  // Abas: id efetivo de um widget = settings.tab ?? primeira aba. Sem abas
  // configuradas, o dashboard é uma tela única (todos os widgets visíveis).
  // Estado local otimista: cor/nome/adicionar/excluir refletem na hora (a
  // revalidação do servidor só chega ao recarregar). Ressincroniza quando o
  // servidor muda de fato (comparação por valor, sem useEffect).
  // Abas efetivas: as do servidor quando existem; senão, reconstruídas dos
  // widgets (recuperação após perda de settings.tabs). A reconstrução é
  // determinística por load; ao editar uma aba, `saveTabs` grava as reais.
  const serverTabs = settings.tabs?.length
    ? settings.tabs
    : rebuildTabsFromWidgets(widgets);
  const serverKey = JSON.stringify(serverTabs);
  const [seedKey, setSeedKey] = useState(serverKey);
  const [tabs, setTabs] = useState(serverTabs);
  if (seedKey !== serverKey) {
    setSeedKey(serverKey);
    setTabs(serverTabs);
  }
  // Aba inicial: a da URL (?tab=) quando ainda existe; senão a primeira. Assim
  // recarregar a página mantém o usuário na aba em que estava.
  const [activeTabId, setActiveTabId] = useState<string>(
    initialTabId && tabs.some((t) => t.id === initialTabId)
      ? initialTabId
      : (tabs[0]?.id ?? "")
  );
  const firstTabId = tabs[0]?.id ?? "";
  // Troca de aba: além do estado, espelha na URL via history.replaceState (sem
  // navegação RSC — a page é pesada; o Next sincroniza useSearchParams). A
  // primeira aba fica sem ?tab para manter URLs limpas.
  const selectTab = useCallback(
    (id: string) => {
      setActiveTabId(id);
      const sp = new URLSearchParams(window.location.search);
      if (id && id !== (tabs[0]?.id ?? "")) sp.set("tab", id);
      else sp.delete("tab");
      const qs = sp.toString();
      window.history.replaceState(
        null,
        "",
        qs ? `?${qs}` : window.location.pathname
      );
    },
    [tabs]
  );

  // Layout otimista: posições BASE de TODOS os widgets (não só os da aba
  // visível), seedadas do servidor com o mesmo padrão seedKey-resync das abas
  // acima. saveLayout não revalida (edição fluida), então após arrastar ou
  // redimensionar a prop `widgets` fica obsoleta — este mapa é a fonte de
  // verdade do grid até um refresh real chegar (colar, período, undo/redo),
  // quando o grid_position refetchado já é o salvo e o reseed é um no-op (ou
  // aplica a restauração, no undo/redo). Vive aqui no shell para sobreviver à
  // troca de abas e ao early-return de aba vazia do grid.
  const serverLayout: Record<string, GridPosition> = {};
  widgets.forEach((w, i) => {
    serverLayout[w.id] = posOf(w, i);
  });
  const serverLayoutKey = JSON.stringify(serverLayout);
  const [layoutSeedKey, setLayoutSeedKey] = useState(serverLayoutKey);
  const [layoutById, setLayoutById] = useState(serverLayout);
  if (layoutSeedKey !== serverLayoutKey) {
    setLayoutSeedKey(serverLayoutKey);
    setLayoutById(serverLayout);
  }
  const applyLayoutPatch = useCallback((patch: Record<string, GridPosition>) => {
    setLayoutById((prev) => ({ ...prev, ...patch }));
  }, []);
  const tabIds = new Set(tabs.map((t) => t.id));
  // Aba efetiva: a do widget quando ainda existe; senão (sem aba ou aba excluída)
  // cai na primeira aba, para nenhum widget "sumir".
  const widgetTab = useCallback(
    (w: Widget) => {
      const t = w.settings?.tab;
      return t && tabIds.has(t) ? t : firstTabId;
    },
    // tabIds deriva de tabs; a dependência real é tabs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tabs, firstTabId]
  );
  const visibleWidgets =
    tabs.length === 0 ? widgets : widgets.filter((w) => widgetTab(w) === activeTabId);

  // Conectores: estado otimista com o mesmo padrão seedKey das abas. Toda
  // gravação passa por saveConnectors (spread do settings — a action
  // sobrescreve o jsonb inteiro).
  const serverConnectors = settings.connectors ?? [];
  const serverConnKey = JSON.stringify(serverConnectors);
  const [connSeedKey, setConnSeedKey] = useState(serverConnKey);
  const [connectors, setConnectors] = useState<Connector[]>(serverConnectors);
  if (connSeedKey !== serverConnKey) {
    setConnSeedKey(serverConnKey);
    setConnectors(serverConnectors);
  }
  const saveConnectors = useCallback(
    (next: Connector[]) => {
      setConnectors(next);
      startTransition(async () => {
        await updateDashboardSettings(dashboardId, {
          ...settings,
          connectors: next,
        });
      });
    },
    [dashboardId, settings, startTransition]
  );

  // Focar um widget (atalhos de forma/nota): outro dashboard → navega com
  // ?focus= (a page abre na aba do alvo e o effect abaixo centraliza); mesmo
  // dashboard → troca de aba se preciso e rola até centralizar com destaque.
  const focusWidget = useCallback(
    (t: WidgetLinkTarget) => {
      if (t.dashboardId && t.dashboardId !== dashboardId) {
        router.push(`/dashboards/${t.dashboardId}?focus=${t.widgetId}`);
        return;
      }
      const w = widgets.find((x) => x.id === t.widgetId);
      if (!w) return;
      if (tabs.length > 0) {
        const target = widgetTab(w);
        if (target !== activeTabId) selectTab(target);
      }
      focusWidgetWithRetry(t.widgetId);
    },
    [dashboardId, widgets, tabs.length, widgetTab, activeTabId, selectTab, router]
  );

  // Consome o ?focus= da URL uma única vez ao montar (atalho vindo de outro
  // dashboard): centraliza o alvo e limpa o parâmetro (mesma técnica do
  // selectTab, sem navegação RSC).
  useEffect(() => {
    if (!focusWidgetId) return;
    focusWidgetWithRetry(focusWidgetId);
    const sp = new URLSearchParams(window.location.search);
    sp.delete("focus");
    const qs = sp.toString();
    window.history.replaceState(
      null,
      "",
      qs ? `?${qs}` : window.location.pathname
    );
    // Só no mount — o parâmetro já foi consumido.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Renomear o dashboard (inline no título). Estado otimista: aplica o nome na
  // hora e persiste no servidor. Nome vazio mantém o atual.
  const [renaming, setRenaming] = useState(false);
  const [seedName, setSeedName] = useState(dashboardName);
  const [name, setName] = useState(dashboardName);
  // Ressincroniza só quando a prop do servidor muda de fato (evita reverter o
  // valor otimista a cada render, como o padrão seedKey das abas acima).
  if (seedName !== dashboardName) {
    setSeedName(dashboardName);
    setName(dashboardName);
  }
  function commitName(value: string) {
    setRenaming(false);
    const next = value.trim();
    if (!next || next === name) return;
    setName(next);
    startTransition(async () => {
      await renameDashboard(dashboardId, next);
    });
  }

  function showBar() {
    startTransition(async () => {
      await updateDashboardSettings(dashboardId, {
        ...settings,
        periodBar: { ...periodBar, enabled: true },
      });
    });
  }

  function saveTabs(next: DashboardSettings["tabs"]) {
    setTabs(next ?? []); // aplica na hora (cor/nome/adicionar/excluir)
    startTransition(async () => {
      await updateDashboardSettings(dashboardId, { ...settings, tabs: next });
    });
  }

  return (
    <DashboardHistoryProvider dashboardId={dashboardId} seed={historySeed}>
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        {renaming ? (
          <Input
            autoFocus
            defaultValue={name}
            className="h-9 max-w-xs text-2xl font-semibold"
            onBlur={(e) => commitName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
              if (e.key === "Escape") setRenaming(false);
            }}
            aria-label="Nome do dashboard"
          />
        ) : (
          <div className="flex items-center gap-1">
            <h1
              className="text-2xl font-semibold"
              onDoubleClick={() => canEdit && setRenaming(true)}
            >
              {name}
            </h1>
            {canEdit ? (
              <Button
                variant="ghost"
                size="icon"
                className="text-muted-foreground hover:text-foreground size-7"
                onClick={() => setRenaming(true)}
                title="Renomear dashboard"
                aria-label="Renomear dashboard"
              >
                <Pencil className="size-4" />
              </Button>
            ) : null}
          </div>
        )}
        {canEdit ? (
          <div className="flex items-center gap-2">
            <HistoryButtons />
            <Button
              variant={editMode ? "default" : "outline"}
              size="sm"
              onClick={() => {
                setEditMode((v) => !v);
                setConnectMode(false); // conectar é um submodo da edição
              }}
            >
              {editMode ? <Check className="size-4" /> : <Pencil className="size-4" />}
              {editMode ? "Concluir" : "Editar layout"}
            </Button>
            {editMode ? (
              <Button
                variant={connectMode ? "default" : "outline"}
                size="sm"
                onClick={() => setConnectMode((v) => !v)}
                title="Conectar widgets com linhas (clique na origem e no destino)"
              >
                <Spline className="size-4" /> Conectar
              </Button>
            ) : null}
            <WidgetBuilder
              dashboardId={dashboardId}
              available={availableForBuilder}
              siblings={widgets}
              canManageFields={canManageFields}
              fields={fields}
              currencyOptions={currencyOptions}
              tabs={tabs}
              activeTabId={activeTabId}
              layoutById={layoutById}
              canvasCols={settings.canvas?.cols ?? 12}
              trigger={
                <Button size="sm">
                  <Plus className="size-4" /> Adicionar widget
                </Button>
              }
            />
            <DashboardMenu
              dashboardId={dashboardId}
              settings={settings}
              visibleToRoles={visibleToRoles}
            />
          </div>
        ) : null}
      </div>

      {tabs.length > 0 || (canEdit && editMode) ? (
        <DashboardTabs
          tabs={tabs}
          activeId={activeTabId}
          onSelect={selectTab}
          editMode={canEdit && editMode}
          onChange={saveTabs}
        />
      ) : null}

      <DashboardPendingProvider>
        {barEnabled ? (
          <PeriodFilter
            available={availableForBuilder}
            canEdit={canEdit}
            dashboardId={dashboardId}
            settings={settings}
            periodBar={periodBar}
            periodScope={periodScope}
            activeTabId={activeTabId}
            firstTabId={firstTabId}
            hasTabs={tabs.length > 0}
            periodDefaultsByTab={periodDefaultsByTab}
            periodDefaultFieldByTab={periodDefaultFieldByTab}
          />
        ) : canEdit ? (
          <Button
            variant="outline"
            size="sm"
            className="self-start"
            disabled={pending}
            onClick={showBar}
          >
            <Clock className="size-4" /> Mostrar barra de período
          </Button>
        ) : null}

        <div
          className={backgroundCss ? "rounded-lg p-3" : undefined}
          style={backgroundCss ? { background: backgroundCss } : undefined}
        >
          <WidgetFocusProvider focus={focusWidget}>
          <DashboardGrid
            widgets={visibleWidgets}
            dataById={dataById}
            recordListById={recordListById}
            entityListById={entityListById}
            calcById={calcById}
            calcVarsById={calcVarsById}
            noteById={noteById}
            calcExprById={calcExprById}
            fields={fields}
            fkLabels={fkLabels}
            responsibleOptions={responsibleOptions}
            userRoles={userRoles}
            canEditValues={canEditValues}
            available={available}
            availableForBuilder={availableForBuilder}
            dashboardId={dashboardId}
            dateFormat={dateFormat}
            settings={settings}
            tabs={tabs}
            activeTabId={activeTabId}
            canEdit={canEdit}
            canManageFields={canManageFields}
            currencyOptions={currencyOptions}
            currencyRates={currencyRates}
            conversionPeriodById={conversionPeriodById}
            editMode={editMode}
            filterOptionsById={filterOptionsById}
            quickFiltersById={quickFiltersById}
            layoutById={layoutById}
            applyLayoutPatch={applyLayoutPatch}
            connectors={connectors}
            saveConnectors={saveConnectors}
            connectMode={editMode && connectMode}
          />
          </WidgetFocusProvider>
        </div>
      </DashboardPendingProvider>
    </div>
    </DashboardHistoryProvider>
  );
}

// Botões Desfazer/Refazer (à esquerda de "Editar layout"). Componente separado
// para consumir o contexto de dentro do provider. Desabilita nos extremos do
// histórico e enquanto um restore está em andamento.
function HistoryButtons() {
  const { undo, redo, canUndo, canRedo, isRestoring } = useDashboardHistory();
  return (
    <>
      <Button
        variant="outline"
        size="icon"
        className="size-8"
        onClick={undo}
        disabled={!canUndo || isRestoring}
        title="Desfazer"
        aria-label="Desfazer"
      >
        <Undo2 className="size-4" />
      </Button>
      <Button
        variant="outline"
        size="icon"
        className="size-8"
        onClick={redo}
        disabled={!canRedo || isRestoring}
        title="Refazer"
        aria-label="Refazer"
      >
        <Redo2 className="size-4" />
      </Button>
    </>
  );
}
