// Versão: 1.4 | Data: 10/09/2026
// v1.4 (10/09/2026): seleção múltipla das tarefas. O `onDone` REBUSCA
//   (`loadRowTasks`) em vez de confiar no bus: este painel não escuta
//   `useDataChanged`, então sem o refetch a lista ficaria com o que já
//   não existe.
// v1.3 (10/09/2026): só vocabulário — o substantivo da ocorrência
//   da série saiu do código e virou dado (SeriesConfig.noun, e
//   tasks.occurrence_noun por tarefa).
// v1.2 (09/09/2026): a lista de tarefas passou a ser o `TaskList` canônico —
//   concluir, editar e o DueBadge, os mesmos de /tarefas, do kanban e do feed.
//   Antes era uma projeção de 4 campos desenhada aqui, sem nenhuma ação: dava
//   para ver a tarefa e não para mexer nela.
// v1.1 (09/09/2026): a lista de tarefas ganha ORDEM e "carregar mais". Um
//   registro em série periódica acumula dezenas delas; a lista inteira
//   de uma vez é uma parede, e o corte mudo escondia o resto sem dizer.
// O PAINEL do clique numa linha da tabela — detalhe, tarefas ou um atributo.
//
// Abre SOBRE o dashboard, sem navegar: quem está analisando a tabela quer
// espiar um registro e voltar, não perder o contexto. Os três modos são os do
// pedido, e a escolha de qual abrir é do widget (opções avançadas), não do
// usuário no meio da análise.
//
// O detalhe é somente leitura — ver todos os campos. Editar segue em
// /registros, com o formulário inteiro; um segundo editor aqui seria uma
// segunda régua sobre as mesmas escritas.
"use client";

import { useEffect, useMemo, useState } from "react";

import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  loadRowPanel,
  loadRowTasks,
  type RowPanelData,
  type RowTaskOrder,
} from "@/app/(app)/dashboards/row-panel-actions";
import { ROW_TASKS_PAGE } from "@/lib/records/row-panel";
import { ATTRIBUTE_STATUS_LABELS } from "@/lib/attributes/registry";
import type { RowActionSettings } from "@/lib/widgets/types";

import { TreeWidget } from "./charts/tree-widget";
import { TaskList } from "@/components/tarefas/task-list";
import { TasksBulkBar } from "@/components/tarefas/tasks-bulk-bar";
import { useBulkSelection } from "@/lib/feedback/use-bulk-selection";
import type { TaskFormContext } from "@/components/tarefas/task-sheet";

export function RecordRowPanel({
  recordId,
  action,
  onClose,
}: {
  /** Registro clicado; null fecha o painel. */
  recordId: string | null;
  action: RowActionSettings;
  onClose: () => void;
}) {
  const [data, setData] = useState<RowPanelData | null>(null);
  // v1.2: contexto do editor de tarefa — o mesmo shape que kanban e agenda
  // montam (components/kanban/kanban-widget.tsx).
  const taskCtx: TaskFormContext = {
    responsibles: data?.responsibles ?? [],
    canAssignOthers: true,
    canLock: false,
  };
  const respLabels: Record<string, string> = Object.fromEntries(
    (data?.responsibles ?? []).map((r) => [r.id, r.label])
  );
  const [order, setOrder] = useState<RowTaskOrder>("desc");
  const [loadingMore, setLoadingMore] = useState(false);

  // Seleção múltipla das tarefas do registro. O universo é a JANELA carregada
  // (o painel pagina): "selecionar todas" marca o que está na tela.
  const rowTasks = useMemo(() => data?.tasks ?? [], [data]);
  const taskIds = useMemo(() => rowTasks.map((t) => t.id), [rowTasks]);
  const bulk = useBulkSelection(taskIds);
  const selectedTasks = useMemo(
    () => rowTasks.filter((t) => bulk.selected.has(t.id)),
    [rowTasks, bulk.selected]
  );

  // Sem setState síncrono no efeito (regra do projeto): o estado só muda depois
  // do await; enquanto isso, `data === null` já diz "carregando".
  useEffect(() => {
    if (!recordId) return;
    let alive = true;
    void loadRowPanel(recordId).then((d) => {
      if (alive) setData(d);
    });
    return () => {
      alive = false;
    };
  }, [recordId]);

  // Trocar a ordem RE-BUSCA a primeira página em vez de inverter o que está em
  // memória: com só uma página carregada, inverter mostraria as 20 mais
  // recentes de trás para frente, não as 20 mais antigas.
  const changeOrder = (next: RowTaskOrder) => {
    if (!recordId || next === order) return;
    setOrder(next);
    void loadRowTasks(recordId, { offset: 0, order: next }).then((p) =>
      setData((d) => (d ? { ...d, tasks: p.tasks, taskTotal: p.total } : d))
    );
  };

  /**
   * Re-busca a PRIMEIRA página depois de uma ação em massa.
   *
   * O painel não escuta o event bus (é efêmero, montado no clique da linha),
   * então sem isto a lista seguiria mostrando as tarefas que acabaram de ser
   * excluídas. Volta ao offset 0 de propósito: depois de apagar N itens, os
   * offsets das páginas seguintes já não valem.
   */
  const reloadTasks = async () => {
    if (!recordId) return;
    const p = await loadRowTasks(recordId, { offset: 0, order });
    setData((d) => (d ? { ...d, tasks: p.tasks, taskTotal: p.total } : d));
  };

  const loadMore = () => {
    if (!recordId || !data) return;
    setLoadingMore(true);
    void loadRowTasks(recordId, { offset: data.tasks.length, order })
      .then((p) =>
        setData((d) =>
          d ? { ...d, tasks: [...d.tasks, ...p.tasks], taskTotal: p.total } : d
        )
      )
      .finally(() => setLoadingMore(false));
  };

  const isTree = action.kind === "atributo" && action.attributeKey === "tree";

  return (
    <Sheet
      open={recordId != null}
      onOpenChange={(open) => {
        if (!open) {
          setData(null);
          onClose();
        }
      }}
    >
      <SheetContent className="flex w-full flex-col gap-3 sm:max-w-2xl">
        <SheetHeader>
          <SheetTitle className="truncate">
            {data?.title || "Registro"}
          </SheetTitle>
        </SheetHeader>

        {!recordId ? null : !data ? (
          <p className="text-muted-foreground px-4 text-sm">Carregando…</p>
        ) : data.message ? (
          <p className="text-muted-foreground px-4 text-sm">{data.message}</p>
        ) : isTree ? (
          <div className="min-h-0 flex-1">
            <TreeWidget settings={undefined} recordId={recordId} />
          </div>
        ) : action.kind === "tarefas" ? (
          <div className="flex flex-col gap-2 overflow-auto px-4 pb-6">
            {data.tasks.length === 0 ? (
              <p className="text-muted-foreground text-sm">
                Nenhuma tarefa vinculada a este registro.
              </p>
            ) : (
              <>
              <div className="text-muted-foreground flex items-center gap-2 text-xs">
                <span>
                  {data.tasks.length} de {data.taskTotal}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="ml-auto h-7 text-xs"
                  onClick={() =>
                    changeOrder(order === "desc" ? "asc" : "desc")
                  }
                >
                  {order === "desc" ? "Mais recentes ↓" : "Mais antigas ↑"}
                </Button>
              </div>
              </>
            )}
            {/* v1.2 (09/09/2026): o TaskList canônico, não uma projeção
                read-only. É o mesmo componente de /tarefas, do kanban e do
                feed — traz concluir, editar e o DueBadge de graça. A lista
                artesanal daqui não tinha nenhum dos três. */}
            {data.tasks.length === 0 ? null : (
              <>
                <TaskList
                  tasks={data.tasks}
                  ctx={taskCtx}
                  responsibleLabels={respLabels}
                  selection={{ selected: bulk.selected, onToggle: bulk.toggle }}
                  allState={bulk.allState}
                  onToggleAll={bulk.toggleAll}
                />
                <TasksBulkBar
                  tasks={selectedTasks}
                  onClear={bulk.clear}
                  onDone={() => {
                    bulk.clear();
                    void reloadTasks();
                  }}
                />
              </>
            )}
            {data.tasks.length < data.taskTotal ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={loadMore}
                disabled={loadingMore}
              >
                {loadingMore
                  ? "Carregando…"
                  : `Carregar mais ${Math.min(
                      ROW_TASKS_PAGE,
                      data.taskTotal - data.tasks.length
                    )}`}
              </Button>
            ) : null}
          </div>
        ) : action.kind === "atributo" ? (
          <div className="flex flex-col gap-2 overflow-auto px-4 pb-6">
            {data.attributes.length === 0 ? (
              <p className="text-muted-foreground text-sm">
                Este registro não participa de nenhuma funcionalidade de
                Operação.
              </p>
            ) : (
              data.attributes.map((a) => (
                <div
                  key={a.id}
                  className="flex flex-wrap items-center gap-2 rounded-md border p-2"
                >
                  <span className="flex-1 text-sm font-medium">{a.label}</span>
                  <Badge variant="outline" className="text-xs">
                    {ATTRIBUTE_STATUS_LABELS[a.status]}
                  </Badge>
                </div>
              ))
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-1.5 overflow-auto px-4 pb-6">
            {data.fields.length === 0 ? (
              <p className="text-muted-foreground text-sm">
                Sem campos preenchidos neste registro.
              </p>
            ) : (
              data.fields.map((f) => (
                <div key={f.key} className="flex flex-wrap gap-2 border-b py-1.5">
                  <span className="text-muted-foreground w-48 shrink-0 text-xs">
                    {f.label}
                  </span>
                  <span className="min-w-0 flex-1 text-sm break-words">
                    {f.value}
                  </span>
                </div>
              ))
            )}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
