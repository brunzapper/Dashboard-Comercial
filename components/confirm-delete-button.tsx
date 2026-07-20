"use client";
// Versão: 1.0 | Data: 20/07/2026
// Botão de exclusão destrutiva com CONFIRMAÇÃO (AlertDialog, padrão do
// widget-card) + feedback de erro da server action (useActionState). Criado na
// auditoria de 20/07/2026: correspondências, conexões, campos e sub-fontes
// excluíam objetos GLOBAIS com um clique, sem confirmação nem mensagem quando
// o servidor recusava. A action deve devolver { ok?, message? } — 0 linhas/RLS
// vira mensagem na linha, nunca sucesso silencioso.
import { useActionState, useState, useTransition } from "react";
import { Trash2 } from "lucide-react";

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
import { Button } from "@/components/ui/button";

export interface DeleteActionState {
  ok?: boolean;
  message?: string;
}

export function ConfirmDeleteButton({
  action,
  values,
  title,
  description,
  ariaLabel = "Excluir",
  confirmLabel = "Excluir",
}: {
  action: (
    prev: DeleteActionState,
    formData: FormData
  ) => Promise<DeleteActionState>;
  // Campos hidden do form (ex.: { id }) enviados à action na confirmação.
  values: Record<string, string>;
  title: string;
  // Descreva o ALCANCE da exclusão (o que quebra/some), não só "tem certeza?".
  description: string;
  ariaLabel?: string;
  confirmLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const [state, dispatch, pending] = useActionState(action, {});
  const [, startTransition] = useTransition();

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label={ariaLabel}
        disabled={pending}
        onClick={() => setOpen(true)}
      >
        <Trash2 className="size-4" />
      </Button>
      {state.message && !state.ok ? (
        <p className="text-destructive mt-1 text-right text-xs" role="status">
          {state.message}
        </p>
      ) : null}
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{title}</AlertDialogTitle>
            <AlertDialogDescription>{description}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={pending}
              onClick={(e) => {
                e.preventDefault();
                const fd = new FormData();
                for (const [k, v] of Object.entries(values)) fd.set(k, v);
                startTransition(() => {
                  dispatch(fd);
                  setOpen(false); // erro (se houver) aparece junto ao botão
                });
              }}
            >
              {confirmLabel}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
