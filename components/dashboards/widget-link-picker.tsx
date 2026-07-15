// Versão: 1.0 | Data: 15/07/2026
// Seletor de destino de atalho para widget (formas e links de nota):
// Dashboard → Aba → Widget ("Título (Tipo)" — endereçamento por nome e tipo).
// O catálogo vem de listWidgetLinkTargets (RLS limita aos dashboards visíveis)
// e é carregado sob demanda no primeiro uso. Emite WidgetLinkTarget —
// dashboardId presente só quando o destino está em OUTRO dashboard.
"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { Label } from "@/components/ui/label";
import {
  listWidgetLinkTargets,
  type LinkTargetsCatalog,
} from "@/app/(app)/dashboards/actions";
import {
  VISUAL_TYPE_LABELS,
  type WidgetLinkTarget,
} from "@/lib/widgets/types";

const ALL_TABS = "__all__";

export function WidgetLinkPicker({
  currentDashboardId,
  value,
  onChange,
}: {
  currentDashboardId: string;
  value?: WidgetLinkTarget;
  onChange: (t: WidgetLinkTarget | undefined) => void;
}) {
  const [catalog, setCatalog] = useState<LinkTargetsCatalog | null>(null);
  const [loading, startLoading] = useTransition();
  useEffect(() => {
    startLoading(async () => {
      setCatalog(await listWidgetLinkTargets());
    });
  }, []);

  // Dashboard/aba selecionados na UI (o widget escolhido vive em `value`).
  const [dashId, setDashId] = useState(
    value?.dashboardId ?? currentDashboardId
  );
  const [tabId, setTabId] = useState(value?.tab ?? ALL_TABS);

  const dash = catalog?.dashboards.find((d) => d.id === dashId);
  const dashOptions = useMemo(
    () =>
      (catalog?.dashboards ?? []).map((d) => ({
        value: d.id,
        label: d.id === currentDashboardId ? `${d.name} (este)` : d.name,
      })),
    [catalog, currentDashboardId]
  );
  const tabOptions = useMemo(
    () => [
      { value: ALL_TABS, label: "Todas as abas" },
      ...(dash?.tabs ?? []).map((t) => ({ value: t.id, label: t.name })),
    ],
    [dash]
  );
  // Widgets do dashboard/aba: sem etiqueta = primeira aba (mesmo fallback do
  // shell). Rótulo "Título (Tipo)".
  const widgetOptions = useMemo(() => {
    if (!dash) return [];
    const firstTabId = dash.tabs[0]?.id ?? "";
    const tabIds = new Set(dash.tabs.map((t) => t.id));
    const effTab = (t?: string) => (t && tabIds.has(t) ? t : firstTabId);
    return dash.widgets
      .filter((w) => tabId === ALL_TABS || effTab(w.tab) === tabId)
      .map((w) => ({
        value: w.id,
        label: `${w.title?.trim() || "Sem título"} (${VISUAL_TYPE_LABELS[w.visual_type] ?? w.visual_type})`,
      }));
  }, [dash, tabId]);

  if (loading && !catalog) {
    return (
      <p className="text-muted-foreground flex items-center gap-2 text-xs">
        <Loader2 className="size-3.5 animate-spin" /> Carregando destinos…
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-col gap-1">
        <Label className="text-xs">Dashboard</Label>
        <Combobox
          options={dashOptions}
          value={dashId}
          onValueChange={(v) => {
            setDashId(v);
            setTabId(ALL_TABS);
            onChange(undefined); // dashboard mudou → widget anterior não vale
          }}
          placeholder="Escolher dashboard…"
          aria-label="Dashboard de destino"
        />
      </div>
      {dash && dash.tabs.length > 0 ? (
        <div className="flex flex-col gap-1">
          <Label className="text-xs">Aba</Label>
          <Combobox
            options={tabOptions}
            value={tabId}
            onValueChange={(v) => {
              setTabId(v);
              onChange(undefined);
            }}
            placeholder="Todas as abas"
            searchable={false}
            aria-label="Aba de destino"
          />
        </div>
      ) : null}
      <div className="flex flex-col gap-1">
        <Label className="text-xs">Widget</Label>
        <Combobox
          options={widgetOptions}
          value={value?.widgetId ?? ""}
          onValueChange={(widgetId) => {
            const w = dash?.widgets.find((x) => x.id === widgetId);
            onChange({
              widgetId,
              tab: w?.tab,
              dashboardId: dashId !== currentDashboardId ? dashId : undefined,
            });
          }}
          placeholder="Escolher widget…"
          emptyText="Nenhum widget."
          aria-label="Widget de destino"
        />
      </div>
      {value ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="text-muted-foreground h-7 self-start px-2 text-xs"
          onClick={() => onChange(undefined)}
        >
          Limpar atalho
        </Button>
      ) : null}
    </div>
  );
}
