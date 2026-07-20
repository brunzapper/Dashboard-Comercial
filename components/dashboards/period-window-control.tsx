"use client";
// Versão: 1.0 | Data: 20/07/2026
// Controle da JANELA DE PERÍODOS do widget (settings.periodWindow): dropdown
// de meses ("3 meses", "Este trimestre"…) + toggle "dia útil × dia cheio" no
// próprio card. A seleção persiste COMPARTILHADA entre usuários
// (dashboard_table_cells row __pw__ — savePeriodWindowChoice), como os
// filtros rápidos; o servidor mescla a escolha nos settings efetivos antes do
// engine (applyPeriodWindowChoice).
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CalendarRange, Loader2 } from "lucide-react";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  PERIOD_WINDOW_LABELS,
  type PeriodWindowKey,
} from "@/lib/widgets/types";
import { savePeriodWindowChoice } from "@/app/(app)/dashboards/actions";
import { useSnapshotMode } from "@/components/snapshots/snapshot-mode";

export interface WidgetPeriodWindowState {
  options: PeriodWindowKey[];
  value: PeriodWindowKey | null;
  bd: boolean;
  showAlignToggle: boolean;
}

export function PeriodWindowControl({
  dashboardId,
  widgetId,
  state,
}: {
  dashboardId: string;
  widgetId: string;
  state: WidgetPeriodWindowState;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [value, setValue] = useState<PeriodWindowKey | null>(state.value);
  const [bd, setBd] = useState(state.bd);
  // Defensivo: o viewer de snapshot não monta este controle (dataset
  // congelado usa o default), mas se montar, nunca persiste.
  const { snapshot } = useSnapshotMode();

  const persist = (next: { w?: PeriodWindowKey | null; bd?: boolean }) => {
    if (snapshot) return;
    const w = next.w !== undefined ? next.w : value;
    const nb = next.bd !== undefined ? next.bd : bd;
    startTransition(async () => {
      await savePeriodWindowChoice(dashboardId, widgetId, {
        ...(w ? { w } : {}),
        bd: nb,
      });
      router.refresh();
    });
  };

  return (
    <div
      className="flex flex-wrap items-center gap-1.5 px-3 pb-1.5"
      data-no-drag
    >
      <CalendarRange className="text-muted-foreground size-3.5 shrink-0" />
      <Select
        value={value ?? ""}
        onValueChange={(v) => {
          const key = v as PeriodWindowKey;
          setValue(key);
          persist({ w: key });
        }}
      >
        <SelectTrigger
          className="h-6 w-auto gap-1 border-dashed px-2 text-xs"
          aria-label="Janela de meses"
        >
          <SelectValue placeholder="Janela" />
        </SelectTrigger>
        <SelectContent>
          {state.options.map((k) => (
            <SelectItem key={k} value={k} className="text-xs">
              {PERIOD_WINDOW_LABELS[k]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {state.showAlignToggle ? (
        <button
          type="button"
          className={
            "rounded-full border px-2 py-0.5 text-[10px] font-semibold transition-colors " +
            (bd
              ? "border-primary bg-primary/10 text-primary"
              : "text-muted-foreground border-dashed")
          }
          title="Alternar corte: dia útil (mesmo estágio) × dia cheio"
          onClick={() => {
            const next = !bd;
            setBd(next);
            persist({ bd: next });
          }}
        >
          {bd ? "Dia útil" : "Dia cheio"}
        </button>
      ) : null}
      {pending ? (
        <Loader2 className="text-muted-foreground size-3 animate-spin" />
      ) : null}
    </div>
  );
}
