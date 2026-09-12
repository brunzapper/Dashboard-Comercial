// Versão: 1.0 | Data: 12/09/2026
// Dialog "Descrição" do board (menu ⋮ do hub, 0141): texto livre exibido no card
// quando a preferência de interface pedir descrição. Grava na COLUNA
// `dashboards.description` — e não em `settings` — porque
// updateDashboardSettings sobrescreve aquela coluna inteira e a descrição é
// propriedade do board, não configuração de render.
// Texto vazio LIMPA a descrição (grava null), nunca uma string vazia.
"use client";

import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { saveBoardDescription } from "@/app/(app)/dashboards/actions";

export const MAX_BOARD_DESCRIPTION = 280;

export function BoardDescriptionDialog({
  boardId,
  kanban,
  initialValue,
  open,
  onOpenChange,
}: {
  boardId: string;
  kanban: boolean;
  initialValue: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [value, setValue] = useState(initialValue);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const noun = kanban ? "kanban" : "dashboard";

  // Re-semeia a cada ABERTURA (padrão seedKey do app, ajustando estado durante
  // o render — não em efeito): o texto pode ter mudado em outra aba desde a
  // última vez que este painel foi aberto. A key inclui o valor do servidor, e
  // não só `open`, para um refresh de fora também chegar ao rascunho.
  const seedKey = open ? `${boardId}:${initialValue}` : null;
  const [seededFor, setSeededFor] = useState(seedKey);
  if (seedKey !== null && seedKey !== seededFor) {
    setSeededFor(seedKey);
    setValue(initialValue);
  }

  function save() {
    setError(null);
    startTransition(async () => {
      const res = await saveBoardDescription(boardId, value);
      if (!res.ok) {
        setError(res.message ?? "Falha ao salvar.");
        return;
      }
      onOpenChange(false);
    });
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex flex-col gap-4">
        <SheetHeader>
          <SheetTitle>Descrição do {noun}</SheetTitle>
          <SheetDescription>
            Aparece sob o nome no card do Workspace — quando a exibição de
            descrição estiver ligada nas preferências de interface.
          </SheetDescription>
        </SheetHeader>

        <div className="flex flex-col gap-1.5 px-4">
          <Label htmlFor="board-description-input">Texto</Label>
          <Textarea
            id="board-description-input"
            value={value}
            maxLength={MAX_BOARD_DESCRIPTION}
            rows={4}
            onChange={(e) => setValue(e.target.value)}
            placeholder={`Para que serve este ${noun}…`}
          />
          <p className="text-muted-foreground text-xs">
            {value.trim().length}/{MAX_BOARD_DESCRIPTION} — deixe em branco para
            remover a descrição.
          </p>
        </div>

        {error ? (
          <p className="text-destructive px-4 text-sm" role="status">
            {error}
          </p>
        ) : null}

        <div className="flex justify-end gap-2 px-4 pb-4">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={pending}
          >
            Cancelar
          </Button>
          <Button onClick={save} disabled={pending}>
            Salvar
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
