// Versão: 1.0 | Data: 10/09/2026
// A PERGUNTA que faltava ao concluir ou excluir uma ocorrência de série.
//
// Uma tarefa de série não é uma tarefa: é a N-ésima de uma sequência que o
// calendário continua produzindo. Fechar a 3ª quinzena e ver a 4ª e a 5ª ainda
// ali é o comportamento certo na maior parte das vezes — e é exatamente o
// errado quando o motivo de fechar foi "este lead não recebe mais
// acompanhamento". Até aqui só o primeiro caso existia, e o segundo se resolvia
// apagando ocorrência por ocorrência enquanto o tick recriava as futuras.
//
// Por que três botões e não um checkbox: as duas saídas são decisões
// diferentes com consequências diferentes (uma some com o que estava previsto,
// a outra não), e a pergunta é o momento de dizer isso. Cancelar continua sendo
// a saída de quem clicou sem querer.
//
// O que NUNCA acontece por aqui: mexer no que já foi concluído (é histórico, e
// é o que a árvore mostra) e excluir o atributo do registro (pausar ≠ excluir,
// 0131). Encerrar tira o que estava PREVISTO, não o que aconteceu.
"use client";

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";

/** O que o usuário escolheu. */
export type SeriesScopeChoice = "somente_esta" | "encerrar";

export function TaskSeriesScopeDialog({
  open,
  onOpenChange,
  /** "Concluir" ou "Excluir" — a mesma pergunta serve às duas. */
  verb,
  /** Como esta ocorrência se chama ("3ª Tarefa"), vindo de `occurrenceLabel`. */
  occurrenceLabel,
  pending = false,
  onChoose,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  verb: "concluir" | "excluir";
  occurrenceLabel: string;
  pending?: boolean;
  onChoose: (choice: SeriesScopeChoice) => void;
}) {
  const acao = verb === "concluir" ? "Concluir" : "Excluir";
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {acao} {occurrenceLabel} — e as demais da sequência?
          </AlertDialogTitle>
          <AlertDialogDescription>
            Esta tarefa faz parte de uma sequência periódica. Encerrar apaga as
            ocorrências ainda ABERTAS deste registro e desliga a sequência para
            ele — o que já foi concluído permanece, e o acompanhamento continua
            na árvore.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="sm:justify-between">
          <AlertDialogCancel disabled={pending}>Cancelar</AlertDialogCancel>
          <span className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              onClick={() => onChoose("somente_esta")}
            >
              {acao} só esta
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={pending}
              onClick={() => onChoose("encerrar")}
            >
              {acao} e encerrar a sequência
            </Button>
          </span>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
