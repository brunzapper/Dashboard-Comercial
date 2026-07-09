// Versão: 2.0 | Data: 09/07/2026
// Barra de período global do dashboard: filtra todos os widgets não cobertos
// por um widget de filtro. Editores configuram (engrenagem) o período/campo
// padrão e podem ocultá-la (persistido em dashboards.settings). Usa o controle
// reutilizável PeriodControls (URL: periodo/de/ate/campo).
"use client";

import { useSearchParams } from "next/navigation";
import { useState, useTransition } from "react";
import { CalendarDays, Settings2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import type { AvailableField } from "@/lib/widgets/fields";
import {
  DEFAULT_PERIOD_FIELD,
  PERIOD_PRESETS,
  type PeriodPresetKey,
} from "@/lib/widgets/period";
import type { DashboardSettings } from "@/lib/widgets/types";
import { updateDashboardSettings } from "@/app/(app)/dashboards/actions";
import { PeriodControls } from "./period-controls";

const selectClass =
  "border-input flex h-9 w-full rounded-md border bg-transparent px-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]";

type PeriodBar = NonNullable<DashboardSettings["periodBar"]>;

export function PeriodFilter({
  available,
  canEdit,
  dashboardId,
  periodBar,
}: {
  available: AvailableField[];
  canEdit: boolean;
  dashboardId: string;
  periodBar?: PeriodBar;
}) {
  const sp = useSearchParams();
  const dateFields = available.filter((f) => f.isDate);

  const defaultField = periodBar?.field || DEFAULT_PERIOD_FIELD;
  const field = sp.get("campo") || defaultField;

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2">
      <CalendarDays className="text-muted-foreground size-4 shrink-0" />
      <PeriodControls
        keys={{ preset: "periodo", de: "de", ate: "ate" }}
        defaults={{ preset: periodBar?.defaultPreset ?? "" }}
        fieldControl={{
          paramKey: "campo",
          value: field,
          defaultValue: defaultField,
          options: dateFields,
        }}
      />
      {canEdit ? (
        <PeriodBarConfig
          dashboardId={dashboardId}
          dateFields={dateFields}
          periodBar={periodBar}
        />
      ) : null}
    </div>
  );
}

// Popover de configuração da barra (editores): período/campo padrão + ocultar.
function PeriodBarConfig({
  dashboardId,
  dateFields,
  periodBar,
}: {
  dashboardId: string;
  dateFields: AvailableField[];
  periodBar?: PeriodBar;
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [preset, setPreset] = useState(periodBar?.defaultPreset ?? "");
  const [field, setField] = useState(periodBar?.field ?? DEFAULT_PERIOD_FIELD);

  function persist(next: PeriodBar) {
    startTransition(async () => {
      await updateDashboardSettings(dashboardId, { periodBar: next });
      setOpen(false);
    });
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="ml-auto"
          aria-label="Configurar barra de período"
        >
          <Settings2 className="size-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="flex flex-col gap-3">
        <div className="flex flex-col gap-1.5">
          <Label>Período padrão</Label>
          <select
            value={preset}
            onChange={(e) => setPreset(e.target.value)}
            className={selectClass}
          >
            <option value="">Todo o período</option>
            {(Object.keys(PERIOD_PRESETS) as PeriodPresetKey[]).map((k) => (
              <option key={k} value={k}>
                {PERIOD_PRESETS[k]}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>Campo de data padrão</Label>
          <select
            value={field}
            onChange={(e) => setField(e.target.value)}
            className={selectClass}
          >
            {dateFields.map((f) => (
              <option key={f.field} value={f.field}>
                {f.label}
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-center justify-between gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={pending}
            onClick={() => persist({ enabled: false })}
          >
            Ocultar barra
          </Button>
          <Button
            size="sm"
            disabled={pending}
            onClick={() =>
              persist({ enabled: true, defaultPreset: preset, field })
            }
          >
            Salvar
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
