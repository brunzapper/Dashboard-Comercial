// Versão: 2.4 | Data: 17/07/2026
// Shell do dashboard: cabeçalho + alternar modo de edição + adicionar widget +
// barra de período global + o grid. Recebe tudo já serializável (widgets +
// dados pré-computados).
// v2.4 (17/07/2026): modo Posicionar — beginPlacement pré-cria o widget
//   ({revalidate:false} + refresh em segundo plano) enquanto o usuário mira; o
//   clique no canvas define a posição (patch sticky + saveLayout); Esc/troca
//   de aba caem no fallback. stickyLayout protege a posição escolhida do
//   reseed de um refresh em voo. Inserir ▸ tipo com autoEdit (abre o editor do
//   widget novo); appendPending extraído do quickCreateWidget.
// v2.3 (15/07/2026): Tabela Livre — estado drawQuick (desenhar para criar,
//   armado pelo builder via onRequestDraw; onDrawDone cria o widget com o
//   retângulo desenhado) e fio de tableCellsById até o grid.
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

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
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
import {
  createWidget,
  renameDashboard,
  saveLayout,
  updateDashboardSettings,
  type WidgetInput,
} from "@/app/(app)/dashboards/actions";
import { defaultQuickTable } from "@/lib/widgets/quick-table/model";
import { DashboardGrid } from "./dashboard-grid";
import type { ResponsibleOption } from "./charts/record-list-table";
import { DashboardMenu } from "./dashboard-menu";
import type { SnapshotPeriodCapture } from "./snapshots-panel";
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
  recordListTotalById,
  entityListById,
  calcById,
  calcVarsById = {},
  noteById = {},
  calcExprById = {},
  tableCellsById = {},
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
  // Total dos widgets-lista paginados no servidor (chave ausente = full fetch).
  recordListTotalById: Record<string, number>;
  entityListById: Record<string, EntityListRow[]>;
  calcById: Record<string, CalcWidgetResult>;
  // Calculadora: valores das variáveis por widget ({ widgetId: { varId: r } }).
  calcVarsById?: Record<string, Record<string, CalcWidgetResult>>;
  // Nota: resultados das expressões {=…} por widget, na ordem do texto.
  noteById?: Record<string, CalcWidgetResult[]>;
  // Calculadora: expressão compartilhada corrente (row __calc__).
  calcExprById?: Record<string, string>;
  // Tabela Livre: células digitadas por widget (rows não reservadas).
  tableCellsById?: Record<
    string,
    { row_key: string; col_key: string; value: number | string | null }[]
  >;
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
  // Modo "desenhar para criar" (Tabela Livre): armado pelo builder; o título
  // digitado lá viaja junto. O retângulo desenhado dimensiona widget E tabela.
  const [drawQuick, setDrawQuick] = useState<{ title: string | null } | null>(
    null
  );
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const barEnabled = periodBar?.enabled !== false;
  const backgroundCss = dashboardBackgroundCss(settings.background);

  // Contexto do período p/ o painel de Snapshots capturar a seleção efetiva no
  // momento da criação (0059) — mesmos insumos entregues à barra de período.
  const snapshotPeriod = useMemo<SnapshotPeriodCapture>(
    () => ({
      periodBar,
      scope: periodScope ?? "global",
      defaultsByTab: periodDefaultsByTab ?? {},
      defaultFieldByTab: periodDefaultFieldByTab ?? {},
      fieldLabels: Object.fromEntries(
        availableForBuilder.map((a) => [a.field, a.label])
      ),
    }),
    [
      periodBar,
      periodScope,
      periodDefaultsByTab,
      periodDefaultFieldByTab,
      availableForBuilder,
    ]
  );

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

  // Widgets da criação "rápida" (menu de contexto / modo Posicionar): o INSERT
  // retorna o id sem esperar a revalidação RSC e o widget entra aqui na hora; o
  // router.refresh() corre em segundo plano. Sai quando o servidor passa a
  // incluí-lo (reconciliação em render, mesmo padrão seedKey) ou quando é
  // excluído antes do refresh chegar (onWidgetDeleted). Declarado antes do
  // layout otimista: a poda do sticky abaixo precisa saber quem ainda existe.
  const [pendingWidgets, setPendingWidgets] = useState<Widget[]>([]);
  const serverWidgetIds = new Set(widgets.map((w) => w.id));

  // Layout otimista: posições BASE de TODOS os widgets (não só os da aba
  // visível), seedadas do servidor com o mesmo padrão seedKey-resync das abas
  // acima. saveLayout não revalida (edição fluida), então após arrastar ou
  // redimensionar a prop `widgets` fica obsoleta — este mapa é a fonte de
  // verdade do grid até um refresh real chegar (colar, período, undo/redo),
  // quando o grid_position refetchado já é o salvo e o reseed é um no-op (ou
  // aplica a restauração, no undo/redo). Vive aqui no shell para sobreviver à
  // troca de abas e ao early-return de aba vazia do grid.
  //
  // stickyLayout: overrides que SOBREVIVEM ao reseed. Um refresh disparado
  // antes do clique do modo Posicionar aterrissa DEPOIS dele trazendo a posição
  // fallback — sem o sticky, o reseed devolveria o widget recém-posicionado
  // para lá. A poda solta o override quando o servidor já reflete a posição ou
  // quando o widget sumiu (exclusão/undo); um patch comum (arrasto manual)
  // também solta. Não generalizar para todo arrasto: um sticky permanente
  // impediria o undo/redo de restaurar posições antigas.
  const serverLayout: Record<string, GridPosition> = {};
  widgets.forEach((w, i) => {
    serverLayout[w.id] = posOf(w, i);
  });
  const serverLayoutKey = JSON.stringify(serverLayout);
  const [stickyLayout, setStickyLayout] = useState<
    Record<string, GridPosition>
  >({});
  const [layoutSeedKey, setLayoutSeedKey] = useState(serverLayoutKey);
  const [layoutById, setLayoutById] = useState(serverLayout);
  if (layoutSeedKey !== serverLayoutKey) {
    setLayoutSeedKey(serverLayoutKey);
    const alive: Record<string, GridPosition> = {};
    for (const [id, p] of Object.entries(stickyLayout)) {
      const known =
        serverWidgetIds.has(id) || pendingWidgets.some((w) => w.id === id);
      if (!known) continue;
      const s = serverLayout[id];
      if (s && s.x === p.x && s.y === p.y && s.w === p.w && s.h === p.h) {
        continue; // servidor alcançou → solta o override
      }
      alive[id] = p;
    }
    if (Object.keys(alive).length !== Object.keys(stickyLayout).length) {
      setStickyLayout(alive);
    }
    setLayoutById({ ...serverLayout, ...alive });
  }
  const applyLayoutPatch = useCallback(
    (patch: Record<string, GridPosition>, opts?: { sticky?: boolean }) => {
      setLayoutById((prev) => ({ ...prev, ...patch }));
      setStickyLayout((prev) => {
        if (opts?.sticky) return { ...prev, ...patch };
        // Patch comum (arrasto/redimensionamento) solta o override dos ids
        // afetados — a partir dali o fluxo normal reassume.
        let changed = false;
        const next = { ...prev };
        for (const id of Object.keys(patch)) {
          if (id in next) {
            delete next[id];
            changed = true;
          }
        }
        return changed ? next : prev;
      });
    },
    []
  );
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
  const alivePending = pendingWidgets.filter((p) => !serverWidgetIds.has(p.id));
  if (alivePending.length !== pendingWidgets.length) {
    setPendingWidgets(alivePending);
  }
  const allWidgets = alivePending.length
    ? [...widgets, ...alivePending]
    : widgets;
  // Widget oculto: o do modo Posicionar enquanto o usuário mira — cobre tanto a
  // cópia pendente quanto a do servidor (mesmo id), se o refresh da
  // pré-criação aterrissar no meio da mira.
  const [hiddenWidgetId, setHiddenWidgetId] = useState<string | null>(null);
  const tabWidgets =
    tabs.length === 0
      ? allWidgets
      : allWidgets.filter((w) => widgetTab(w) === activeTabId);
  const visibleWidgets = hiddenWidgetId
    ? tabWidgets.filter((w) => w.id !== hiddenWidgetId)
    : tabWidgets;

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

  // Fim do desenho da Tabela Livre: cria o widget com o retângulo como
  // grid_position e linhas/colunas derivadas do tamanho desenhado.
  const onDrawDone = useCallback(
    (rect: GridPosition, table: { rows: number; cols: number }) => {
      const cfg = drawQuick;
      setDrawQuick(null);
      startTransition(async () => {
        await createWidget(dashboardId, {
          title: cfg?.title ?? "Tabela Livre",
          visual_type: "tabela_editavel",
          sources: [],
          splitBySource: false,
          dimensions: [],
          metrics: [],
          filters: [],
          settings: {
            quickTable: defaultQuickTable(table.rows, table.cols),
            ...(activeTabId ? { tab: activeTabId } : {}),
          },
          grid_position: rect,
        });
        router.refresh();
      });
    },
    [drawQuick, dashboardId, activeTabId, router, startTransition]
  );

  // Widget otimista: entra em pendingWidgets na hora (renderiza com dados
  // vazios até o refresh reconciliar). Compartilhado entre a criação rápida do
  // menu de contexto e o modo Posicionar. Fica FORA de transition — o padrão do
  // colar (tudo dentro) segura o commit até o refresh terminar.
  const appendPending = useCallback(
    (id: string, input: WidgetInput) => {
      setPendingWidgets((prev) => [
        ...prev,
        {
          id,
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
          grid_position: input.grid_position ?? {},
          sort_order: 0,
        },
      ]);
    },
    [dashboardId]
  );

  // Abertura automática do editor de um widget recém-criado pelo Inserir
  // (tipos que exigem configuração). Consumido one-shot pelo WidgetCard.
  const [autoEditId, setAutoEditId] = useState<string | null>(null);
  const clearAutoEdit = useCallback((id: string) => {
    setAutoEditId((v) => (v === id ? null : v));
  }, []);

  // Criação RÁPIDA pelo menu de contexto do grid (Inserir ▸ tipo): INSERT sem
  // revalidação (retorna após uma ida ao banco), widget otimista na hora e
  // refresh completo em segundo plano. `autoEdit` abre o editor do widget novo.
  const quickCreateWidget = useCallback(
    async (input: WidgetInput, opts?: { autoEdit?: boolean }) => {
      const res = await createWidget(dashboardId, input, { revalidate: false });
      if (!res.ok || !res.id) return;
      appendPending(res.id, input);
      if (opts?.autoEdit) setAutoEditId(res.id);
      startTransition(() => router.refresh());
    },
    [dashboardId, appendPending, router, startTransition]
  );

  // ---------------- Modo Posicionar (criação pelo builder) ----------------
  // O botão "Posicionar" do builder entrega o input pronto (posição fallback =
  // primeiro espaço livre da aba destino). Daqui em diante:
  //   1. o INSERT parte IMEDIATAMENTE ({revalidate:false}) e o router.refresh()
  //      em seguida — os dados computam ENQUANTO o usuário mira (pré-aceleração);
  //   2. o canvas mostra o ghost (PlaceWidgetOverlay) e o widget fica OCULTO;
  //   3. o clique define a posição (centro na célula clicada): patch otimista
  //      sticky + saveLayout; Esc/troca de aba posicionam no fallback — o
  //      widget nunca se perde.
  // O job vive num ref (o INSERT resolve fora do render); `placing` é só o que
  // a UI precisa (tamanho do ghost).
  type PlacementJob = {
    input: WidgetInput;
    fallback: GridPosition;
    id: string | null; // null = INSERT ainda em voo
    clickedAt: GridPosition | null; // clique antes do INSERT voltar
    done: boolean;
  };
  const placingJobRef = useRef<PlacementJob | null>(null);
  const [placing, setPlacing] = useState<{ w: number; h: number } | null>(null);
  const [placeError, setPlaceError] = useState<string | null>(null);

  // Posição final de um widget posicionado: patch sticky (sobrevive ao reseed
  // do refresh da pré-criação) + saveLayout quando saiu do fallback, com
  // refresh na sequência (captura o histórico e solta o sticky).
  const finalizePlaced = useCallback(
    (
      id: string,
      pos: GridPosition,
      fallback: GridPosition,
      opts?: { refreshAlways?: boolean }
    ) => {
      applyLayoutPatch({ [id]: pos }, { sticky: true });
      const moved =
        pos.x !== fallback.x ||
        pos.y !== fallback.y ||
        pos.w !== fallback.w ||
        pos.h !== fallback.h;
      if (moved) {
        void saveLayout(dashboardId, [{ id, ...pos }]).then(() => {
          startTransition(() => router.refresh());
        });
      } else if (opts?.refreshAlways) {
        startTransition(() => router.refresh());
      }
    },
    [dashboardId, applyLayoutPatch, router, startTransition]
  );

  // Resolve o placement ativo no fallback (Esc, troca de aba, novo Posicionar).
  const resolveAutoPlacement = useCallback(() => {
    const job = placingJobRef.current;
    placingJobRef.current = null;
    setPlacing(null);
    setHiddenWidgetId(null);
    if (!job || job.done) return;
    if (job.id === null) {
      job.clickedAt = job.fallback; // o then() do INSERT finaliza lá
    } else {
      job.done = true; // já está no fallback (patch da pré-criação) — só desocultar
    }
  }, []);

  const beginPlacement = useCallback(
    (input: WidgetInput) => {
      resolveAutoPlacement(); // placement anterior ainda ativo → fallback
      const fallback = input.grid_position;
      if (!fallback) return; // o builder sempre envia; guarda de tipo
      const targetTab = input.settings?.tab ?? firstTabId;
      if (tabs.length > 0 && targetTab !== activeTabId) selectTab(targetTab);
      const job: PlacementJob = {
        input,
        fallback,
        id: null,
        clickedAt: null,
        done: false,
      };
      placingJobRef.current = job;
      setPlacing({ w: fallback.w, h: fallback.h });
      setPlaceError(null);
      void createWidget(dashboardId, input, { revalidate: false }).then(
        (res) => {
          if (!res.ok || !res.id) {
            job.done = true;
            if (placingJobRef.current === job) {
              placingJobRef.current = null;
              setPlacing(null);
            }
            setPlaceError(res.message ?? "Falha ao criar o widget.");
            return;
          }
          const id = res.id;
          job.id = id;
          appendPending(id, input);
          if (job.clickedAt) {
            // Clicou (ou resolveu no fallback) enquanto o INSERT corria: já
            // nasce na posição final, visível.
            job.done = true;
            finalizePlaced(id, job.clickedAt, job.fallback, {
              refreshAlways: true,
            });
          } else {
            // Ainda mirando: entra OCULTO no fallback e o refresh começa a
            // computar os dados; o clique desoculta na posição final.
            applyLayoutPatch({ [id]: job.fallback });
            if (placingJobRef.current === job) setHiddenWidgetId(id);
            startTransition(() => router.refresh());
          }
        }
      );
    },
    [
      dashboardId,
      tabs.length,
      activeTabId,
      firstTabId,
      selectTab,
      resolveAutoPlacement,
      appendPending,
      applyLayoutPatch,
      finalizePlaced,
      router,
      startTransition,
    ]
  );

  // Clique de posicionamento (overlay): pos já vem com o centro ancorado.
  const onPlaceAt = useCallback(
    (pos: GridPosition) => {
      const job = placingJobRef.current;
      placingJobRef.current = null;
      setPlacing(null);
      setHiddenWidgetId(null);
      if (!job || job.done) return;
      if (job.id === null) {
        job.clickedAt = pos; // INSERT em voo — o then() finaliza aqui
        return;
      }
      job.done = true;
      finalizePlaced(job.id, pos, job.fallback);
    },
    [finalizePlaced]
  );

  // Troca de aba segura: um placement ativo resolve no fallback antes (o ghost
  // não atravessa abas — a posição pertence à aba destino do builder).
  const selectTabSafe = useCallback(
    (id: string) => {
      resolveAutoPlacement();
      selectTab(id);
    },
    [resolveAutoPlacement, selectTab]
  );
  // Pendente excluído antes do refresh viraria fantasma (o id nunca chega do
  // servidor para a reconciliação) — o WidgetCard avisa a exclusão por aqui.
  const onWidgetDeleted = useCallback((id: string) => {
    setPendingWidgets((prev) => prev.filter((w) => w.id !== id));
  }, []);

  function saveTabs(next: DashboardSettings["tabs"]) {
    setTabs(next ?? []); // aplica na hora (cor/nome/adicionar/excluir)
    startTransition(async () => {
      await updateDashboardSettings(dashboardId, { ...settings, tabs: next });
    });
  }

  return (
    <DashboardHistoryProvider dashboardId={dashboardId} seed={historySeed}>
    <div className="flex flex-col gap-4">
      {/* pr-8: afasta a toolbar do sino fixo (TaskBell, topo-direito) */}
      <div className="flex items-center justify-between pr-8">
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
              onRequestDraw={(title) => setDrawQuick({ title })}
              onRequestPlacement={beginPlacement}
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
              snapshotPeriod={snapshotPeriod}
            />
          </div>
        ) : null}
      </div>

      {tabs.length > 0 || (canEdit && editMode) ? (
        <DashboardTabs
          tabs={tabs}
          activeId={activeTabId}
          onSelect={selectTabSafe}
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

        {placeError ? (
          <div className="border-destructive/50 bg-destructive/10 text-destructive flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm">
            <span>{placeError}</span>
            <button
              type="button"
              className="shrink-0 underline"
              onClick={() => setPlaceError(null)}
            >
              Fechar
            </button>
          </div>
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
            recordListTotalById={recordListTotalById}
            entityListById={entityListById}
            calcById={calcById}
            calcVarsById={calcVarsById}
            noteById={noteById}
            calcExprById={calcExprById}
            tableCellsById={tableCellsById}
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
            canExport
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
            drawMode={drawQuick != null}
            onDrawDone={onDrawDone}
            onDrawCancel={() => setDrawQuick(null)}
            placing={placing}
            onPlace={onPlaceAt}
            onPlaceCancel={resolveAutoPlacement}
            autoEditWidgetId={autoEditId}
            onAutoEditConsumed={clearAutoEdit}
            onQuickCreate={quickCreateWidget}
            onWidgetDeleted={onWidgetDeleted}
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
