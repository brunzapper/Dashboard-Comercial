// Versão: 1.0 | Data: 09/09/2026
// Widget TREE (0134): a árvore de acompanhamento de um registro — e, no modo
// livre, o mapa mental.
//
// O que ela responde, e nenhum gráfico respondia: "como o vendedor está
// conduzindo este lead". O tronco são as COBRANÇAS (derivadas, então a que
// ninguém fez também aparece) e cada anotação, tarefa e alteração pendura
// naquela em cuja janela caiu.
//
// Render em HTML/CSS, não SVG: os nós têm texto de tamanho variável e ações
// dentro deles (anotar, agendar, pausar), e um <foreignObject> para cada um
// custaria mais do que a linha de conexão vale. As linhas são bordas.
//
// Refetch: origem do EVENT BUS é silenciosa (§4.10) — o sync do Bitrix roda a
// cada minuto e uma árvore que pisca sozinha lê como defeito.
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  CalendarPlus,
  ChevronDown,
  ChevronRight,
  MessageSquarePlus,
  Pause,
  Play,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  addTreeNote,
  addTreeTask,
  loadRecordTree,
  type TreeData,
} from "@/app/(app)/dashboards/tree-actions";
import { setRecordAttributeStatus } from "@/lib/attributes/actions";
import { useBackgroundSave } from "@/lib/feedback/use-background-save";
import { TREE_NODE_KIND_LABELS, type TreeNode } from "@/lib/tree/model";
import type { TreeSettings } from "@/lib/widgets/types";

const KIND_TONE: Record<string, string> = {
  occurrence: "border-primary/50 bg-primary/5",
  task: "border-amber-500/40",
  comment: "border-emerald-500/40",
  change: "border-muted",
  note: "border-sky-500/40",
};

function NodeCard({
  node,
  onNote,
  onTask,
}: {
  node: TreeNode;
  onNote: (node: TreeNode) => void;
  onTask: (node: TreeNode) => void;
}) {
  const [open, setOpen] = useState(true);
  const hasChildren = node.children.length > 0;

  return (
    <div className="flex flex-col">
      <div
        className={`flex flex-wrap items-center gap-2 rounded-md border px-2 py-1.5 ${
          KIND_TONE[node.kind] ?? "border-muted"
        }`}
      >
        {hasChildren ? (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-label={open ? "Recolher" : "Expandir"}
            className="text-muted-foreground shrink-0"
          >
            {open ? (
              <ChevronDown className="size-4" />
            ) : (
              <ChevronRight className="size-4" />
            )}
          </button>
        ) : (
          <span className="w-4 shrink-0" />
        )}

        <Badge variant="outline" className="shrink-0 text-xs">
          {TREE_NODE_KIND_LABELS[node.kind]}
        </Badge>
        <span className="min-w-0 flex-1 truncate text-sm" title={node.label}>
          {node.label}
        </span>
        {node.status ? (
          <span className="text-muted-foreground text-xs">{node.status}</span>
        ) : null}
        <span className="text-muted-foreground text-xs">
          {node.at ? new Date(`${node.at}T12:00:00`).toLocaleDateString("pt-BR") : ""}
        </span>

        {node.kind === "occurrence" ? (
          <span className="flex shrink-0 items-center gap-1">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-6"
              title="Anotar nesta cobrança"
              onClick={() => onNote(node)}
            >
              <MessageSquarePlus className="size-3.5" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-6"
              title="Agendar tarefa"
              onClick={() => onTask(node)}
            >
              <CalendarPlus className="size-3.5" />
            </Button>
          </span>
        ) : null}
      </div>

      {open && hasChildren ? (
        // A linha de conexão é a borda esquerda: o galho é visual, não SVG.
        <div className="border-muted ml-4 flex flex-col gap-1.5 border-l pt-1.5 pl-3">
          {node.children.map((c) => (
            <NodeCard key={c.id} node={c} onNote={onNote} onTask={onTask} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function TreeWidget({
  settings,
  recordId,
  dataChangedAt,
}: {
  settings: TreeSettings | undefined;
  /** Registro em foco: o do settings, ou o que a tabela clicou. */
  recordId: string | null;
  /** Carimbo do event bus — muda quando um registro mudou. */
  dataChangedAt?: number;
}) {
  const [data, setData] = useState<TreeData | null>(null);
  const [draft, setDraft] = useState<{ kind: "note" | "task"; text: string } | null>(
    null
  );
  const { save } = useBackgroundSave();
  const lastJson = useRef<string>("");

  const layout = settings?.layout ?? "por_ocorrencia";

  // Sem setState SÍNCRONO no efeito (a regra do projeto): o estado só muda
  // depois do await. Enquanto não chega, `data === null` já diz "carregando".
  const refresh = useCallback(async () => {
    if (!recordId) return;
    const next = await loadRecordTree(recordId, layout);
    // Payload idêntico não re-renderiza: o tick do sync roda a cada minuto e
    // não pode fazer a árvore piscar para quem só está lendo.
    const json = JSON.stringify(next);
    if (json !== lastJson.current) {
      lastJson.current = json;
      setData(next);
    }
  }, [recordId, layout]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    // Origem event bus: recarrega com o desenho antigo em tela, sem spinner
    // nem overlay (§4.10) — o refetch de fundo é silencioso.
    if (dataChangedAt) void refresh();
  }, [dataChangedAt, refresh]);

  if (!recordId) {
    return (
      <div className="text-muted-foreground flex h-full items-center justify-center p-4 text-center text-sm">
        Escolha um registro na configuração do widget, ou clique numa linha da
        tabela configurada para abrir a Tree.
      </div>
    );
  }

  if (!data) {
    return (
      <div className="text-muted-foreground p-4 text-sm">Carregando…</div>
    );
  }

  if (data.message) {
    return <div className="text-muted-foreground p-4 text-sm">{data.message}</div>;
  }

  const submitDraft = () => {
    if (!draft || draft.text.trim() === "") return setDraft(null);
    const text = draft.text.trim();
    const kind = draft.kind;
    setDraft(null);
    save({
      key: `tree-${kind}`,
      context:
        kind === "note" ? "Não foi possível anotar" : "Não foi possível agendar",
      action: () =>
        kind === "note"
          ? addTreeNote(recordId, text, { revalidate: false })
          : addTreeTask(recordId, { title: text }, { revalidate: false }),
    });
    // A árvore recarrega depois da escrita: o nó novo é um FATO, e ela o lê.
    window.setTimeout(() => void refresh(), 600);
  };

  return (
    <div className="flex h-full flex-col gap-2 overflow-auto p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="truncate text-sm font-medium">{data.recordTitle}</span>
        {data.series ? (
          <>
            <Badge variant="outline" className="text-xs">
              a cada {data.series.cadenceDays} dia(s)
            </Badge>
            {!data.series.active ? (
              <Badge variant="secondary" className="text-xs">
                série desligada para este recorte
              </Badge>
            ) : null}
          </>
        ) : null}
        {data.attribute ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="ml-auto gap-1"
            onClick={() => {
              const next =
                data.attribute!.status === "pausado" ? "ativo" : "pausado";
              // Pausar NÃO remove o acompanhamento: o registro continua na
              // funcionalidade e a árvore continua inteira.
              setData({ ...data, attribute: { ...data.attribute!, status: next } });
              save({
                key: "tree-status",
                context: "Não foi possível alterar o acompanhamento",
                action: () =>
                  setRecordAttributeStatus(data.attribute!.id, next, {
                    revalidate: false,
                  }),
                revert: () => setData(data),
              });
            }}
          >
            {data.attribute.status === "pausado" ? (
              <>
                <Play className="size-3.5" /> Retomar
              </>
            ) : (
              <>
                <Pause className="size-3.5" /> Pausar
              </>
            )}
          </Button>
        ) : null}
      </div>

      {data.attribute?.status === "pausado" ? (
        <p className="text-muted-foreground text-xs">
          Acompanhamento pausado: novas cobranças não são abertas. O registro
          continua na automação e o histórico permanece.
        </p>
      ) : null}

      {draft ? (
        <div className="flex flex-wrap items-center gap-2 rounded-md border p-2">
          <Input
            autoFocus
            value={draft.text}
            onChange={(e) => setDraft({ ...draft, text: e.target.value })}
            placeholder={
              draft.kind === "note" ? "O que aconteceu?" : "Título da tarefa"
            }
            onKeyDown={(e) => {
              if (e.key === "Enter") submitDraft();
              if (e.key === "Escape") setDraft(null);
            }}
            aria-label={draft.kind === "note" ? "Anotação" : "Tarefa"}
          />
          <Button type="button" size="sm" onClick={submitDraft}>
            Salvar
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setDraft(null)}
          >
            Cancelar
          </Button>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="gap-1"
            onClick={() => setDraft({ kind: "note", text: "" })}
          >
            <MessageSquarePlus className="size-3.5" /> Anotar
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="gap-1"
            onClick={() => setDraft({ kind: "task", text: "" })}
          >
            <CalendarPlus className="size-3.5" /> Agendar tarefa
          </Button>
        </div>
      )}

      {data.nodes.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          Nada aconteceu com este registro ainda.
        </p>
      ) : (
        <div className="flex flex-col gap-1.5">
          {data.nodes.map((n) => (
            <NodeCard
              key={n.id}
              node={n}
              onNote={() => setDraft({ kind: "note", text: "" })}
              onTask={() => setDraft({ kind: "task", text: "" })}
            />
          ))}
        </div>
      )}
    </div>
  );
}
