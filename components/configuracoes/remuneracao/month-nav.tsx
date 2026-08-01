// Versão: 1.0 | Data: 31/07/2026
// Navegação de mês da Remuneração (admin e vendedor): rascunho local +
// commit DEBOUNCED — as setas atualizam o rótulo na hora e só depois de
// ~450ms sem cliques disparam UMA navegação RSC (padrão period-controls:
// run(() => router.replace()) é do PAI, via useNavPending). O rótulo é um
// botão que abre um picker (grid de 12 meses + stepper de ano + "Hoje") com
// commit IMEDIATO (gesto deliberado). Regra do rascunho: nunca regride para
// props velhos — só limpa quando o commit confirmado chega (props === draft)
// e não há timer pendente; voltar ao mês commitado cancela o timer.
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { MONTH_LABELS, addMonths } from "@/lib/date/month-labels";
import { todayBrasiliaIso } from "@/lib/date/today";

export interface MonthDraft {
  /** Mês EXIBIDO (rascunho quando há; senão o commitado dos props). */
  year: number;
  month: number;
  /** true enquanto o exibido ainda não é o commitado (dim + trava da grade). */
  dirty: boolean;
  shift: (delta: number) => void;
  goTo: (year: number, month: number) => void;
  goToday: () => void;
  /**
   * Cancela o commit agendado SEM limpar o rascunho — para navegações
   * explícitas do pai (pill de plano/aba) que já levam o mês efetivo na URL;
   * o rascunho limpa sozinho quando os props confirmados chegarem.
   */
  cancel: () => void;
}

const COMMIT_DELAY_MS = 450;

export function useMonthDraft(
  committedYear: number,
  committedMonth: number,
  onCommit: (year: number, month: number) => void,
  delayMs: number = COMMIT_DELAY_MS
): MonthDraft {
  const [draft, setDraft] = useState<{ year: number; month: number } | null>(
    null
  );
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearTimer = useCallback(() => {
    if (timer.current != null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);
  // Ref estável p/ o timeout (o callback do pai muda a cada render).
  const commitRef = useRef(onCommit);
  useEffect(() => {
    commitRef.current = onCommit;
  }, [onCommit]);

  const year = draft?.year ?? committedYear;
  const month = draft?.month ?? committedMonth;

  // Commit confirmado chegou e nada mais está agendado ⇒ rascunho vira props.
  useEffect(() => {
    if (
      draft &&
      timer.current == null &&
      draft.year === committedYear &&
      draft.month === committedMonth
    ) {
      setDraft(null);
    }
  }, [draft, committedYear, committedMonth]);
  useEffect(() => clearTimer, [clearTimer]);

  const schedule = useCallback(
    (next: { year: number; month: number }) => {
      clearTimer();
      timer.current = setTimeout(() => {
        timer.current = null;
        commitRef.current(next.year, next.month);
      }, delayMs);
    },
    [delayMs, clearTimer]
  );

  const shift = useCallback(
    (delta: number) => {
      const next = addMonths(year, month, delta);
      if (next.year === committedYear && next.month === committedMonth) {
        // Voltou ao mês commitado antes do commit disparar: nada a navegar.
        clearTimer();
        setDraft(null);
        return;
      }
      setDraft(next);
      schedule(next);
    },
    [year, month, committedYear, committedMonth, schedule, clearTimer]
  );

  const goTo = useCallback(
    (y: number, m: number) => {
      clearTimer();
      if (y === committedYear && m === committedMonth) {
        setDraft(null);
        return;
      }
      setDraft({ year: y, month: m });
      commitRef.current(y, m);
    },
    [committedYear, committedMonth, clearTimer]
  );

  const goToday = useCallback(() => {
    const today = todayBrasiliaIso();
    goTo(Number(today.slice(0, 4)), Number(today.slice(5, 7)));
  }, [goTo]);

  const cancel = clearTimer;

  return { year, month, dirty: draft != null, shift, goTo, goToday, cancel };
}

export function MonthNav(props: {
  draft: MonthDraft;
  /** Transition da navegação RSC em voo (useNavPending do pai). */
  pending: boolean;
}) {
  const { draft, pending } = props;
  const busy = draft.dirty || pending;
  const [open, setOpen] = useState(false);
  const [pickerYear, setPickerYear] = useState(draft.year);

  return (
    <div className="flex items-center gap-1">
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label="Mês anterior"
        onClick={() => draft.shift(-1)}
      >
        <ChevronLeft className="size-4" />
      </Button>
      <Popover
        open={open}
        onOpenChange={(o) => {
          setOpen(o);
          if (o) setPickerYear(draft.year);
        }}
      >
        <PopoverTrigger asChild>
          <button
            type="button"
            className="hover:bg-accent inline-flex min-w-36 items-center justify-center gap-1.5 rounded-md px-2 py-1 text-sm font-medium"
            title="Escolher mês"
          >
            {busy ? (
              <Loader2 className="text-muted-foreground size-3.5 animate-spin" />
            ) : (
              <CalendarDays className="text-muted-foreground size-3.5" />
            )}
            {MONTH_LABELS[draft.month - 1]}/{draft.year}
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-64 p-3" align="end">
          <div className="mb-2 flex items-center justify-between">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Ano anterior"
              onClick={() => setPickerYear((y) => y - 1)}
            >
              <ChevronLeft className="size-4" />
            </Button>
            <span className="text-sm font-medium tabular-nums">
              {pickerYear}
            </span>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Próximo ano"
              onClick={() => setPickerYear((y) => y + 1)}
            >
              <ChevronRight className="size-4" />
            </Button>
          </div>
          <div className="grid grid-cols-3 gap-1">
            {MONTH_LABELS.map((label, i) => {
              const m = i + 1;
              const selected =
                pickerYear === draft.year && m === draft.month;
              return (
                <button
                  key={label}
                  type="button"
                  className={`rounded-md px-1 py-1.5 text-xs ${
                    selected
                      ? "bg-primary/10 border-primary border font-medium"
                      : "hover:bg-accent border border-transparent"
                  }`}
                  onClick={() => {
                    setOpen(false);
                    draft.goTo(pickerYear, m);
                  }}
                >
                  {label.slice(0, 3)}
                </button>
              );
            })}
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="mt-2 w-full"
            onClick={() => {
              setOpen(false);
              draft.goToday();
            }}
          >
            Hoje
          </Button>
        </PopoverContent>
      </Popover>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label="Próximo mês"
        onClick={() => draft.shift(1)}
      >
        <ChevronRight className="size-4" />
      </Button>
    </div>
  );
}
