// Versão: 1.1 | Data: 23/07/2026
// Menu "⋮" dos cards do hub (dashboards E kanbans): substitui o botão de
// lixeira. Itens por status (0087): ativo → Duplicar/Arquivar/Excluir (vai à
// Lixeira, reversível — sem confirmação); arquivado → Desarquivar/Duplicar/
// Excluir; na Lixeira → Restaurar/Excluir permanentemente (AlertDialog).
// `canManage` espelha a RLS de update/delete (owner/admin); `canDuplicate` é a
// permissão create_dashboards (quem enxerga o board pode duplicar — a cópia
// nasce privada do usuário).
// v1.2 (23/07/2026): item "Exportar JSON" (dashboards ativos/arquivados) —
//   baixa a estrutura no formato dashboard-import (exportDashboardStructure);
//   é o mesmo JSON que os modos "Criar a partir de"/"Editar" da IA usam.
// v1.1 (23/07/2026): itens "Bases" (escopo de bases do board —
//   BoardSourcesDialog) e "Acesso" (funções + pessoas — BoardAccessDialog),
//   boards ativos/arquivados, gate canManage.
"use client";

import { useState, useTransition } from "react";
import {
  Archive,
  ArchiveRestore,
  Copy,
  Database,
  FileJson,
  MoreVertical,
  Trash2,
  Undo2,
  Users,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  archiveBoard,
  deleteBoardPermanently,
  duplicateBoard,
  restoreBoard,
  trashBoard,
} from "@/app/(app)/dashboards/actions";
import type { ActionState } from "@/app/(app)/dashboards/actions";
import { exportDashboardStructure } from "@/app/(app)/dashboards/export-structure-actions";
import { BoardSourcesDialog } from "./board-sources-dialog";
import { BoardAccessDialog } from "./board-access-dialog";

export type BoardStatus = "active" | "archived" | "trashed";

export function BoardCardMenu({
  id,
  kanban,
  status,
  canManage,
  canDuplicate,
}: {
  id: string;
  kanban: boolean;
  status: BoardStatus;
  canManage: boolean;
  canDuplicate: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const [accessOpen, setAccessOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const noun = kanban ? "kanban" : "dashboard";
  const trashed = status === "trashed";

  function run(action: (id: string) => Promise<ActionState>) {
    setError(null);
    startTransition(async () => {
      const res = await action(id);
      if (!res.ok) setError(res.message ?? "Falha na operação.");
    });
  }

  // Baixa a estrutura do dashboard como .json (formato dashboard-import).
  function runExportJson() {
    setError(null);
    startTransition(async () => {
      const res = await exportDashboardStructure(id);
      if (!res.ok || !res.json) {
        setError(res.message ?? "Falha ao exportar.");
        return;
      }
      const blob = new Blob([res.json], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = res.filename ?? "dashboard.json";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    });
  }

  // Sem item aplicável (viewer sem permissão de criar): não renderiza nada.
  if (!canManage && !(canDuplicate && !trashed)) return null;

  return (
    <div className="absolute top-3 right-3">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            disabled={pending}
            aria-label={`Opções do ${noun}`}
          >
            <MoreVertical className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {trashed ? (
            <>
              {canManage ? (
                <DropdownMenuItem onSelect={() => run(restoreBoard)}>
                  <Undo2 className="size-4" /> Restaurar
                </DropdownMenuItem>
              ) : null}
              {canManage ? (
                <DropdownMenuItem
                  variant="destructive"
                  onSelect={(e) => {
                    e.preventDefault();
                    setConfirmOpen(true);
                  }}
                >
                  <Trash2 className="size-4" /> Excluir permanentemente
                </DropdownMenuItem>
              ) : null}
            </>
          ) : (
            <>
              {status === "archived" && canManage ? (
                <DropdownMenuItem onSelect={() => run(restoreBoard)}>
                  <ArchiveRestore className="size-4" /> Desarquivar
                </DropdownMenuItem>
              ) : null}
              {canManage ? (
                <DropdownMenuItem
                  onSelect={(e) => {
                    e.preventDefault();
                    setSourcesOpen(true);
                  }}
                >
                  <Database className="size-4" /> Bases
                </DropdownMenuItem>
              ) : null}
              {canManage ? (
                <DropdownMenuItem
                  onSelect={(e) => {
                    e.preventDefault();
                    setAccessOpen(true);
                  }}
                >
                  <Users className="size-4" /> Acesso
                </DropdownMenuItem>
              ) : null}
              {canDuplicate ? (
                <DropdownMenuItem onSelect={() => run(duplicateBoard)}>
                  <Copy className="size-4" /> Duplicar
                </DropdownMenuItem>
              ) : null}
              {!kanban ? (
                <DropdownMenuItem onSelect={() => runExportJson()}>
                  <FileJson className="size-4" /> Exportar JSON
                </DropdownMenuItem>
              ) : null}
              {status === "active" && canManage ? (
                <DropdownMenuItem onSelect={() => run(archiveBoard)}>
                  <Archive className="size-4" /> Arquivar
                </DropdownMenuItem>
              ) : null}
              {canManage ? (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    variant="destructive"
                    onSelect={() => run(trashBoard)}
                  >
                    <Trash2 className="size-4" /> Excluir
                  </DropdownMenuItem>
                </>
              ) : null}
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {error ? (
        <p className="bg-destructive/10 text-destructive absolute top-10 right-0 z-10 w-52 rounded-md p-2 text-xs">
          {error}
        </p>
      ) : null}

      <BoardSourcesDialog
        boardId={id}
        kanban={kanban}
        open={sourcesOpen}
        onOpenChange={setSourcesOpen}
      />

      <BoardAccessDialog
        boardId={id}
        kanban={kanban}
        open={accessOpen}
        onOpenChange={setAccessOpen}
      />

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir permanentemente?</AlertDialogTitle>
            <AlertDialogDescription>
              O {noun} e todo o seu conteúdo serão excluídos em definitivo.
              Esta ação não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                setConfirmOpen(false);
                run(deleteBoardPermanently);
              }}
            >
              Excluir permanentemente
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
