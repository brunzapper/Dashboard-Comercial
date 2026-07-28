// Versão: 1.0 | Data: 28/07/2026
// Cliente da AGENDA DO WORKSPACE (/agenda): calendário cheio (AgendaView) com
// barra PRÓPRIA de controles — Conteúdo (todas as agendas dos dashboards /
// uma específica / só entradas diretas), Responsável e Operação. A agenda
// segue FORA dos filtros de dashboard por design (invariante 12); a tradução
// de Operação acontece no servidor (fetchWorkspaceAgenda → operation-scope).
// Escolhas persistem por usuário em user_settings.agendaHub (fire-and-forget,
// mesmo padrão do lastView). Fetch deferido com guarda de resposta obsoleta
// (reqRef) + reload pelo event bus/realtime — cópia do padrão do AgendaWidget.
"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { Combobox } from "@/components/ui/combobox";
import { Label } from "@/components/ui/label";
import {
  fetchWorkspaceAgenda,
  type AgendaResult,
  type WorkspaceAgendaControls,
} from "@/lib/agenda/actions";
import { todayBrasiliaIso } from "@/lib/date/today";
import { useDataChanged } from "@/lib/tasks/events";
import { updateUserSettings } from "@/app/(app)/dashboards/actions";
import type { TaskFormContext } from "@/components/tarefas/task-sheet";
import { AgendaView, type AgendaViewMode } from "./agenda-view";
import { agendaRangeOf } from "./agenda-widget";

export interface WorkspaceAgendaOption {
  widgetId: string;
  label: string;
  dashboardName: string;
}

// Encoding do controle de conteúdo no estado/persistência.
const CONTENT_ALL = "todas";
const CONTENT_OWN = "propria";
const contentToControls = (
  content: string
): WorkspaceAgendaControls["content"] =>
  content === CONTENT_OWN
    ? "propria"
    : content.startsWith("widget:")
      ? { widgetId: content.slice("widget:".length) }
      : "todas";

export function WorkspaceAgendaClient({
  widgetOptions,
  initial,
  userRoles,
  canEditValues,
  canManageFields,
}: {
  widgetOptions: WorkspaceAgendaOption[];
  initial: {
    content: string;
    responsibleId: string | null;
    operationId: string | null;
    view: AgendaViewMode;
  };
  userRoles: string[];
  canEditValues: boolean;
  canManageFields: boolean;
}) {
  // Conteúdo persistido pode apontar p/ widget excluído — cai em "todas".
  const validContent =
    initial.content === CONTENT_OWN ||
    initial.content === CONTENT_ALL ||
    widgetOptions.some((o) => `widget:${o.widgetId}` === initial.content)
      ? initial.content
      : CONTENT_ALL;
  const [content, setContent] = useState(validContent);
  const [responsibleId, setResponsibleId] = useState(
    initial.responsibleId ?? ""
  );
  const [operationId, setOperationId] = useState(initial.operationId ?? "");
  const [view, setView] = useState<AgendaViewMode>(initial.view);
  const [anchor, setAnchor] = useState(todayBrasiliaIso());
  const [result, setResult] = useState<AgendaResult | null>(null);

  // Guarda de resposta obsoleta (padrão do AgendaWidget).
  const reqRef = useRef(0);
  const reload = useCallback(() => {
    const { from, to } = agendaRangeOf(anchor, view);
    const id = ++reqRef.current;
    void fetchWorkspaceAgenda(from, to, {
      content: contentToControls(content),
      responsibleId: responsibleId || null,
      operationId: operationId || null,
    }).then((res) => {
      if (reqRef.current === id) setResult(res);
    });
  }, [anchor, view, content, responsibleId, operationId]);

  useEffect(() => {
    reload();
  }, [reload]);

  useDataChanged(() => reload());

  // Persistência das escolhas (pulando o primeiro render — é o estado salvo).
  const mounted = useRef(false);
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    void updateUserSettings({
      agendaHub: {
        content,
        responsibleId: responsibleId || null,
        operationId: operationId || null,
        view,
      },
    });
  }, [content, responsibleId, operationId, view]);

  const isManager = userRoles.includes("admin") || userRoles.includes("gestor");
  const taskCtx: TaskFormContext = {
    responsibles: result?.responsibles ?? [],
    canAssignOthers: isManager,
    canLock: isManager,
    canGlobal: isManager,
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <Label className="text-xs">Conteúdo</Label>
          <Combobox
            options={[
              { value: CONTENT_ALL, label: "Todas as agendas" },
              { value: CONTENT_OWN, label: "Só desta agenda (tarefas + anotações)" },
              ...widgetOptions.map((o) => ({
                value: `widget:${o.widgetId}`,
                label: `${o.label} — ${o.dashboardName}`,
              })),
            ]}
            value={content}
            onValueChange={setContent}
            className="w-64"
            aria-label="Conteúdo"
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label className="text-xs">Responsável</Label>
          <Combobox
            options={[
              { value: "", label: "Todos" },
              ...(result?.responsibles ?? []).map((r) => ({
                value: r.id,
                label: r.label,
              })),
            ]}
            value={responsibleId}
            onValueChange={setResponsibleId}
            className="w-52"
            aria-label="Responsável"
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label className="text-xs">Operação</Label>
          <Combobox
            options={[
              { value: "", label: "Todas" },
              ...(result?.operations ?? []).map((o) => ({
                value: o.id,
                label: o.label,
              })),
            ]}
            value={operationId}
            onValueChange={setOperationId}
            className="w-52"
            aria-label="Operação"
          />
        </div>
        {operationId ? (
          <p className="text-muted-foreground pb-1 text-xs">
            Operação recorta registros; tarefas seguem os responsáveis do
            vínculo.
          </p>
        ) : null}
      </div>

      {result?.error ? (
        <p className="text-destructive text-sm">{result.error}</p>
      ) : null}
      {result?.warning ? (
        <p className="text-muted-foreground text-xs">{result.warning}</p>
      ) : null}

      <div className="min-h-0 flex-1">
        <AgendaView
          anchor={anchor}
          view={view}
          data={result?.data ?? null}
          recordCtx={{
            fields: result?.fields ?? [],
            responsibles: result?.responsibles ?? [],
            operations: result?.operations ?? [],
            userRoles,
            canEditValues,
            canManageFields,
          }}
          taskCtx={taskCtx}
          onNavigate={setAnchor}
          onViewChange={setView}
          onChanged={reload}
        />
      </div>
    </div>
  );
}
