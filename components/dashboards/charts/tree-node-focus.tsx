// Versão: 1.0 | Data: 02/10/2026
// v1.0 (02/10/2026): o cartão da Tree EM DESTAQUE (duplo-clique) e o EDITOR
//   da anotação.
//   * Destaque: o cartão aberto grande no centro da tela, sem recorte — o
//     texto longo de um Multi-fatores, a descrição de uma anotação, a tabela
//     do indicador com a quebra aberta. Funciona também no modo Apresentar:
//     o portal vai para o elemento em TELA CHEIA (fora dele nada aparece).
//   * Editor da anotação: título, DESCRIÇÃO (antes só existia no tooltip) e
//     a data PRÓPRIA (prazo — antes a anotação mostrava a data de criação, o
//     dia do apply do preset, sem como editar), além do tipo/resultado e da
//     exibição do cartão.
"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { TREE_NODE_KIND_LABELS, type TreeNode } from "@/lib/tree/model";
import type { TreeNodeDisplay } from "@/lib/tree/display";
import { DEFAULT_DATE_FORMAT, formatDateValue } from "@/lib/widgets/format";
import type { TreeNoteStatus } from "@/app/(app)/dashboards/tree-actions";
import { DisplaySection, isOperationalNode, OperationalBody } from "./tree-op-nodes";

/** Onde o portal monta: o elemento em tela cheia (apresentação) ou o body. */
function portalTarget(): Element | null {
  if (typeof document === "undefined") return null;
  return document.fullscreenElement ?? document.body;
}

export function TreeNodeFocusDialog({
  node,
  onClose,
  onEdit,
}: {
  node: TreeNode | null;
  onClose: () => void;
  /** Abre o editor do nó (ausente = só leitura, ex.: apresentando). */
  onEdit?: (node: TreeNode) => void;
}) {
  useEffect(() => {
    if (!node) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [node, onClose]);
  const target = portalTarget();
  if (!node || !target) return null;
  const body = node.kind === "comment" ? (node.body ?? node.label) : node.body;
  return createPortal(
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={node.label}
        className="bg-background flex max-h-[85vh] w-full max-w-3xl flex-col gap-3 overflow-auto rounded-lg border p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-2">
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <Badge variant="outline" className="self-start text-xs">
              {TREE_NODE_KIND_LABELS[node.kind]}
            </Badge>
            <h2 className="text-xl leading-tight font-semibold">{node.label}</h2>
            {node.dueDate ? (
              <span className="text-muted-foreground text-sm">
                Prazo: {formatDateValue(node.dueDate, DEFAULT_DATE_FORMAT)}
              </span>
            ) : null}
          </div>
          {onEdit ? (
            <Button type="button" variant="outline" size="sm" onClick={() => onEdit(node)}>
              Editar
            </Button>
          ) : null}
          <Button type="button" variant="ghost" size="icon" aria-label="Fechar" onClick={onClose}>
            <X className="size-4" />
          </Button>
        </div>
        {body ? <p className="text-base leading-relaxed whitespace-pre-line">{body}</p> : null}
        {isOperationalNode(node) ? (
          <div className="text-base [&_.text-micro]:text-sm [&_.text-2xs]:text-xs">
            <OperationalBody node={node} full />
          </div>
        ) : null}
        {node.children.length > 0 ? (
          <div className="text-muted-foreground border-t pt-2 text-sm">
            {node.children.length} branch(es) abaixo:{" "}
            {node.children.map((c) => c.label).join(" · ")}
          </div>
        ) : null}
      </div>
    </div>,
    target
  );
}

export interface NoteEditInput {
  label: string;
  body: string | null;
  dueDate: string | null;
  status: TreeNoteStatus;
  goal: boolean;
  display: TreeNodeDisplay | null;
}

export function TreeNoteEditSheet({
  node,
  display,
  onClose,
  onSave,
  saving,
}: {
  node: TreeNode | null;
  display: TreeNodeDisplay | null;
  onClose: () => void;
  onSave: (input: NoteEditInput) => void;
  saving: boolean;
}) {
  return (
    <Sheet open={node != null} onOpenChange={(o) => (o ? null : onClose())}>
      <SheetContent className="flex flex-col gap-3 overflow-y-auto sm:max-w-xl">
        {node ? (
          <NoteForm key={node.id} node={node} display={display} onClose={onClose} onSave={onSave} saving={saving} />
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

function NoteForm({
  node,
  display: initialDisplay,
  onClose,
  onSave,
  saving,
}: {
  node: TreeNode;
  display: TreeNodeDisplay | null;
  onClose: () => void;
  onSave: (input: NoteEditInput) => void;
  saving: boolean;
}) {
  const [label, setLabel] = useState(node.label);
  const [body, setBody] = useState(node.body ?? "");
  const [dueDate, setDueDate] = useState(node.dueDate ?? "");
  const [status, setStatus] = useState<TreeNoteStatus>(
    node.status === "concluída" ? "concluida" : node.status === "aberta" ? "pendente" : "texto"
  );
  const [goal, setGoal] = useState(node.goal === true);
  const [display, setDisplay] = useState<TreeNodeDisplay>(initialDisplay ?? {});
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <SheetHeader>
        <SheetTitle>Editar {TREE_NODE_KIND_LABELS.note.toLowerCase()}</SheetTitle>
        <SheetDescription>
          O título aparece no cartão; a descrição aparece abaixo dele (inteira no
          destaque — duplo-clique). A data é opcional: sem ela o cartão não mostra
          data nenhuma.
        </SheetDescription>
      </SheetHeader>
      <div className="flex flex-col gap-3 px-4 pb-4">
        <div className="flex flex-col gap-1.5">
          <Label>Título</Label>
          <Input value={label} onChange={(e) => setLabel(e.target.value)} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>Descrição</Label>
          <Textarea rows={5} value={body} onChange={(e) => setBody(e.target.value)} />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label>Data / prazo (opcional)</Label>
            <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Tipo</Label>
            <select
              className="border-input h-9 rounded-md border bg-transparent px-2 text-sm"
              value={status}
              onChange={(e) => setStatus(e.target.value as TreeNoteStatus)}
            >
              <option value="texto">Texto livre</option>
              <option value="pendente">Etapa — pendente</option>
              <option value="concluida">Etapa — concluída</option>
            </select>
          </div>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <Checkbox checked={goal} onCheckedChange={(v) => setGoal(v === true)} />
          É o resultado esperado (a Root destaca o caminho até ele)
        </label>
        <DisplaySection display={display} setDisplay={setDisplay} />
        {error ? <p className="text-destructive text-sm">{error}</p> : null}
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button
            disabled={saving}
            onClick={() => {
              if (!label.trim()) return setError("O título não pode ficar vazio.");
              onSave({
                label: label.trim(),
                body: body.trim() ? body : null,
                dueDate: dueDate || null,
                status,
                goal,
                display: Object.keys(display).length > 0 ? display : null,
              });
            }}
          >
            {saving ? "Salvando…" : "Salvar"}
          </Button>
        </div>
      </div>
    </>
  );
}
