// Versão: 1.0 | Data: 26/07/2026
// Gestão das PASTAS DE BASES (source_folders, 0107): criar, renomear,
// reordenar (↑/↓) e excluir pastas. Pasta é agrupamento de EXIBIÇÃO — a
// exclusão devolve as bases para "sem pasta" (FK on delete set null), nunca
// toca registros/consultas. A base entra/sai de uma pasta pelo campo "Pasta"
// do formulário da própria base (SourcesManager). Esqueleto visual do
// SourcesManager.
"use client";

import { useEffect, useMemo, useState } from "react";
import { useActionState } from "react";
import { ArrowDown, ArrowUp, Pencil, Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { SourceDef } from "@/lib/sources";
import type { SourceFolder } from "@/lib/source-folders";
import {
  createSourceFolder,
  deleteSourceFolder,
  reorderSourceFolder,
  updateSourceFolder,
  type SourceActionState,
} from "@/app/(app)/configuracoes/fontes/actions";

const initial: SourceActionState = {};

function FolderForm({
  folder,
  onDone,
}: {
  folder?: SourceFolder;
  onDone?: () => void;
}) {
  const isEdit = Boolean(folder);
  const action = isEdit ? updateSourceFolder : createSourceFolder;
  const [state, formAction, pending] = useActionState(action, initial);

  useEffect(() => {
    if (state.ok && onDone) onDone();
  }, [state.ok, onDone]);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      {isEdit ? <input type="hidden" name="id" value={folder!.id} /> : null}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="folder-label">Nome da pasta</Label>
        <Input
          id="folder-label"
          name="label"
          defaultValue={folder?.label ?? ""}
          placeholder="Ex.: Inbound"
          maxLength={60}
          required
        />
        <p className="text-muted-foreground text-xs">
          Agrupa bases nas abas de Registros/Campos e nos seletores. Mova as
          bases pelo campo &quot;Pasta&quot; de cada base, abaixo.
        </p>
      </div>

      {state.message ? (
        <p
          className={
            state.ok ? "text-muted-foreground text-sm" : "text-destructive text-sm"
          }
          role="status"
        >
          {state.message}
        </p>
      ) : null}

      <Button type="submit" disabled={pending} className="w-full">
        {pending ? "Salvando..." : isEdit ? "Salvar alterações" : "Criar pasta"}
      </Button>
    </form>
  );
}

function MoveFolderButtons({ folderId }: { folderId: string }) {
  const [, formAction, pending] = useActionState(reorderSourceFolder, initial);
  return (
    <form action={formAction} className="flex items-center">
      <input type="hidden" name="id" value={folderId} />
      <Button
        type="submit"
        name="dir"
        value="up"
        variant="ghost"
        size="icon"
        disabled={pending}
        aria-label="Mover pasta para cima"
      >
        <ArrowUp className="size-4" />
      </Button>
      <Button
        type="submit"
        name="dir"
        value="down"
        variant="ghost"
        size="icon"
        disabled={pending}
        aria-label="Mover pasta para baixo"
      >
        <ArrowDown className="size-4" />
      </Button>
    </form>
  );
}

function DeleteFolderButton({ folderId }: { folderId: string }) {
  const [state, formAction, pending] = useActionState(deleteSourceFolder, initial);
  return (
    <form action={formAction} className="flex items-center gap-1">
      <input type="hidden" name="id" value={folderId} />
      <Button
        type="submit"
        variant="ghost"
        size="icon"
        disabled={pending}
        aria-label="Excluir pasta"
      >
        <Trash2 className="size-4" />
      </Button>
      {state.message && !state.ok ? (
        <span className="text-destructive text-xs" role="status">
          {state.message}
        </span>
      ) : null}
    </form>
  );
}

export function SourceFoldersManager({
  folders,
  sources,
}: {
  folders: SourceFolder[];
  sources: SourceDef[];
}) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<SourceFolder | undefined>(undefined);

  // Contagem de bases RAIZ por pasta (subs seguem a pai).
  const countByFolder = useMemo(() => {
    const map = new Map<string, number>();
    for (const s of sources) {
      if (s.parentKey || !s.folderId) continue;
      map.set(s.folderId, (map.get(s.folderId) ?? 0) + 1);
    }
    return map;
  }, [sources]);

  function openCreate() {
    setEditing(undefined);
    setOpen(true);
  }
  function openEdit(f: SourceFolder) {
    setEditing(f);
    setOpen(true);
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Pastas</h2>
          <p className="text-muted-foreground text-sm">
            Grupos de bases para organizar as abas de Registros/Campos e os
            seletores. Excluir uma pasta devolve as bases para &quot;sem
            pasta&quot; — nenhum dado é apagado.
          </p>
        </div>
        <Button onClick={openCreate}>
          <Plus className="size-4" />
          Nova pasta
        </Button>
      </div>

      {folders.length === 0 ? (
        <p className="text-muted-foreground rounded-lg border p-6 text-center text-sm">
          Nenhuma pasta ainda. Sem pastas, as abas e listas mostram todas as
          bases lado a lado, como sempre.
        </p>
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nome</TableHead>
                <TableHead>Bases</TableHead>
                <TableHead className="text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {folders.map((f) => (
                <TableRow key={f.id}>
                  <TableCell className="font-medium">{f.label}</TableCell>
                  <TableCell className="text-muted-foreground text-xs">
                    {countByFolder.get(f.id) ?? 0}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center justify-end gap-1">
                      <MoveFolderButtons folderId={f.id} />
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => openEdit(f)}
                        aria-label="Editar pasta"
                      >
                        <Pencil className="size-4" />
                      </Button>
                      <DeleteFolderButton folderId={f.id} />
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent className="overflow-y-auto">
          <SheetHeader>
            <SheetTitle>{editing ? "Editar pasta" : "Nova pasta"}</SheetTitle>
            <SheetDescription>
              {editing
                ? "Renomeie a pasta. As bases dentro dela não mudam."
                : "Crie o grupo e depois escolha a pasta em cada base."}
            </SheetDescription>
          </SheetHeader>
          <div className="px-4 pb-4">
            <FolderForm
              key={editing?.id ?? "new"}
              folder={editing}
              onDone={() => setOpen(false)}
            />
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
