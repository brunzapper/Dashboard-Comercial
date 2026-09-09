// Versão: 1.1 | Data: 09/09/2026
// v1.1 (09/09/2026): a lista de tarefas ganha ORDEM e "carregar mais". Um
//   registro sob cobrança periódica acumula dezenas delas; a lista inteira
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

import { useEffect, useState } from "react";

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
  const [order, setOrder] = useState<RowTaskOrder>("desc");
  const [loadingMore, setLoadingMore] = useState(false);

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
            {data.tasks.length === 0 ? null : (
              data.tasks.map((t) => (
                <div
                  key={t.id}
                  className="flex flex-wrap items-center gap-2 rounded-md border p-2"
                >
                  <span className="min-w-0 flex-1 truncate text-sm">
                    {t.title}
                  </span>
                  {t.occurrence != null ? (
                    <Badge variant="outline" className="text-xs">
                      {t.occurrence}ª cobrança
                    </Badge>
                  ) : null}
                  <Badge
                    variant={t.done ? "secondary" : "outline"}
                    className="text-xs"
                  >
                    {t.done ? "concluída" : "aberta"}
                  </Badge>
                  <span className="text-muted-foreground text-xs">
                    {t.dueDate
                      ? new Date(`${t.dueDate}T12:00:00`).toLocaleDateString(
                          "pt-BR"
                        )
                      : "sem prazo"}
                  </span>
                </div>
              ))
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
