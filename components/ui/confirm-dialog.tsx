// Versão: 1.0 | Data: 29/07/2026
// ConfirmDialog — casca fina e controlada sobre o AlertDialog (padrão do app
// para ações destrutivas; modelo: users-manager). Centraliza copy pt-BR e o
// layout Cancelar/Confirmar para os sites que hoje excluem sem confirmação
// (bases, operações, metas, campos…) ou usam window.confirm.
"use client";

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
import { buttonVariants } from "@/components/ui/button";

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  actionLabel = "Excluir",
  cancelLabel = "Cancelar",
  onConfirm,
  pending = false,
  destructive = true,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: React.ReactNode;
  actionLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  pending?: boolean;
  /** Pinta o botão de confirmação como destrutivo (default). */
  destructive?: boolean;
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          {description ? (
            <AlertDialogDescription>{description}</AlertDialogDescription>
          ) : null}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>{cancelLabel}</AlertDialogCancel>
          <AlertDialogAction
            disabled={pending}
            className={
              destructive ? buttonVariants({ variant: "destructive" }) : undefined
            }
            onClick={onConfirm}
          >
            {actionLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
