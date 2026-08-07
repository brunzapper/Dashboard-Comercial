"use client";
// Versão: 1.3 | Data: 07/08/2026
// v1.3 (07/08/2026): persistência OTIMISTA em background (useBackgroundSave,
// revalidate:false): o controle responde na hora, o spinner é LOCAL e o
// refresh debounced do hook reconcilia os widgets — o transition global
// (overlay do board) saiu deste fluxo; erro → toast + revert do controle.
// v1.1 (21/07/2026): badge "Nº dia útil" (bdRef — WidgetData.businessDayRef)
// ao lado do toggle quando o alinhamento está ativo.
// Controle da JANELA DE PERÍODOS do widget (settings.periodWindow): dropdown
// de meses ("3 meses", "Este trimestre"…) + toggle "dia útil × dia cheio" no
// próprio card. A seleção persiste COMPARTILHADA entre usuários
// (dashboard_table_cells row __pw__ — savePeriodWindowChoice), como os
// filtros rápidos; o servidor mescla a escolha nos settings efetivos antes do
// engine (applyPeriodWindowChoice).
import { useState } from "react";
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
  type WidgetData,
} from "@/lib/widgets/types";
import { useBackgroundSave } from "@/lib/feedback/use-background-save";
import { savePeriodWindowChoice } from "@/app/(app)/dashboards/actions";
import { useSnapshotMode } from "@/components/snapshots/snapshot-mode";
import { BusinessDayBadge } from "./business-day-badge";

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
  bdRef,
}: {
  dashboardId: string;
  widgetId: string;
  state: WidgetPeriodWindowState;
  // Referência de dia útil do RESULTADO (WidgetData.businessDayRef) — badge
  // "Nº dia útil" ao lado do toggle. Server-derived: aparece/atualiza após o
  // refresh (o spinner de pending cobre o gap do toggle otimista).
  bdRef?: WidgetData["businessDayRef"] | null;
}) {
  // Save otimista em background: o controle responde na hora, o spinner é
  // local e o refresh debounced do hook reconcilia o recompute dos widgets.
  const { save, hasPending } = useBackgroundSave();
  const [value, setValue] = useState<PeriodWindowKey | null>(state.value);
  const [bd, setBd] = useState(state.bd);
  // Defensivo: o viewer de snapshot não monta este controle (dataset
  // congelado usa o default), mas se montar, nunca persiste.
  const { snapshot } = useSnapshotMode();

  const persist = (next: { w?: PeriodWindowKey | null; bd?: boolean }) => {
    if (snapshot) return;
    const w = next.w !== undefined ? next.w : value;
    const nb = next.bd !== undefined ? next.bd : bd;
    // Estado ANTES desta mudança (o handler chama persist logo após o set —
    // este closure ainda vê os valores antigos): baseline do revert no erro.
    const prev = { value, bd };
    save({
      key: "pw",
      context: "Não foi possível salvar a janela de períodos",
      action: () =>
        savePeriodWindowChoice(
          dashboardId,
          widgetId,
          { ...(w ? { w } : {}), bd: nb },
          { revalidate: false }
        ),
      revert: () => {
        setValue(prev.value);
        setBd(prev.bd);
      },
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
              ? "border-brand bg-brand/10 text-brand"
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
      {bd && bdRef ? <BusinessDayBadge bdRef={bdRef} /> : null}
      {hasPending ? (
        <Loader2 className="text-muted-foreground size-3 animate-spin" />
      ) : null}
    </div>
  );
}
