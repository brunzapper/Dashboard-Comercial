// Versão: 1.0 | Data: 02/10/2026
// v1.0 (02/10/2026): SELETOR DE MESES — substitui a digitação de
//   "2026-10, 2026-11, 2026-12" (que ainda comia a vírgula no meio da
//   digitação). Grade de meses por ano, intervalo "de/até", atalhos (este
//   trimestre, próximo trimestre, este ano, próximos/últimos 3 meses) e chips
//   removíveis. Lista vazia = "meses do período do painel" (dinâmico — segue a
//   barra de período). Usado pela Tree e pelas colunas de meta da Tabela Livre.
"use client";

import { useState } from "react";
import { CalendarRange, ChevronLeft, ChevronRight, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { todayBrasiliaIso } from "@/lib/date/today";
import { addMonths, monthKey, monthPreset, monthSpan } from "@/lib/date/month-range";
import { MAX_TABLE_MONTHS, monthLabel } from "@/lib/indicators/model";

const SHORT = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

const PRESETS: { key: Parameters<typeof monthPreset>[0]; label: string }[] = [
  { key: "trimestre", label: "Este trimestre" },
  { key: "proximo_trimestre", label: "Próximo trimestre" },
  { key: "ano", label: "Este ano" },
  { key: "proximos3", label: "Próximos 3 meses" },
  { key: "ultimos3", label: "Últimos 3 meses" },
];

export function MonthRangePicker({
  value,
  onChange,
  max = MAX_TABLE_MONTHS,
  allowPeriod = true,
  periodLabel = "Meses do período do painel",
  single = false,
  ariaLabel = "Meses",
}: {
  value: string[];
  onChange: (months: string[]) => void;
  max?: number;
  /** Lista vazia vale como "meses do período" (dinâmico). */
  allowPeriod?: boolean;
  periodLabel?: string;
  /** Um mês só (ex.: mês inicial). */
  single?: boolean;
  ariaLabel?: string;
}) {
  const today = todayBrasiliaIso();
  const [open, setOpen] = useState(false);
  const [year, setYear] = useState(() => Number((value[0] ?? today).slice(0, 4)));
  // Primeiro clique marca o início do intervalo; o segundo fecha.
  const [anchor, setAnchor] = useState<string | null>(null);

  const pick = (key: string) => {
    if (single) {
      onChange([key]);
      setOpen(false);
      return;
    }
    if (!anchor) {
      setAnchor(key);
      onChange([key]);
      return;
    }
    onChange(monthSpan(anchor, key, max));
    setAnchor(null);
  };

  const summary =
    value.length === 0
      ? allowPeriod
        ? periodLabel
        : "Escolher…"
      : value.length === 1
        ? monthLabel(value[0], true)
        : `${monthLabel(value[0], true)} – ${monthLabel(value[value.length - 1], true)} (${value.length})`;

  return (
    <div className="flex flex-col gap-1.5">
      <Popover
        open={open}
        onOpenChange={(o) => {
          setOpen(o);
          if (!o) setAnchor(null);
        }}
      >
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="justify-start gap-2 self-start font-normal"
            aria-label={ariaLabel}
          >
            <CalendarRange className="size-4" />
            {summary}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-72 p-2" align="start">
          <div className="mb-2 flex items-center justify-between">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-7"
              aria-label="Ano anterior"
              onClick={() => setYear((y) => y - 1)}
            >
              <ChevronLeft className="size-4" />
            </Button>
            <span className="text-sm font-medium tabular-nums">{year}</span>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-7"
              aria-label="Próximo ano"
              onClick={() => setYear((y) => y + 1)}
            >
              <ChevronRight className="size-4" />
            </Button>
          </div>
          <div className="grid grid-cols-4 gap-1">
            {SHORT.map((name, i) => {
              const key = monthKey(year, i + 1);
              const on = value.includes(key);
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => pick(key)}
                  aria-pressed={on}
                  className={cn(
                    "rounded px-1 py-1.5 text-sm capitalize",
                    on ? "bg-primary text-primary-foreground" : "hover:bg-accent",
                    anchor === key && "ring-primary ring-2"
                  )}
                >
                  {name}
                </button>
              );
            })}
          </div>
          {!single ? (
            <p className="text-muted-foreground mt-2 text-xs">
              {anchor
                ? "Agora clique no último mês do intervalo."
                : "Clique no primeiro e depois no último mês."}
            </p>
          ) : null}
          {!single ? (
            <div className="mt-2 flex flex-wrap gap-1 border-t pt-2">
              {PRESETS.map((p) => (
                <button
                  key={p.key}
                  type="button"
                  className="hover:bg-accent rounded border px-1.5 py-0.5 text-xs"
                  onClick={() => {
                    onChange(monthPreset(p.key, today).slice(0, max));
                    setAnchor(null);
                    setOpen(false);
                  }}
                >
                  {p.label}
                </button>
              ))}
              {allowPeriod ? (
                <button
                  type="button"
                  className="hover:bg-accent rounded border px-1.5 py-0.5 text-xs"
                  onClick={() => {
                    onChange([]);
                    setAnchor(null);
                    setOpen(false);
                  }}
                >
                  {periodLabel}
                </button>
              ) : null}
            </div>
          ) : null}
        </PopoverContent>
      </Popover>
      {!single && value.length > 0 ? (
        <div className="flex flex-wrap gap-1">
          {value.map((m) => (
            <span
              key={m}
              className="bg-muted inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs"
            >
              {monthLabel(m, true)}
              <button
                type="button"
                aria-label={`Remover ${monthLabel(m, true)}`}
                onClick={() => onChange(value.filter((x) => x !== m))}
              >
                <X className="size-3" />
              </button>
            </span>
          ))}
          {value.length < max ? (
            <button
              type="button"
              className="text-muted-foreground hover:text-foreground text-xs underline"
              onClick={() => onChange([...value, addMonths(value[value.length - 1], 1)])}
            >
              + mês seguinte
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
