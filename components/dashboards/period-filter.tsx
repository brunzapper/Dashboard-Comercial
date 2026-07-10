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
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
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
  type PeriodSelection,
  type SavedPeriod,
} from "@/lib/widgets/period";
import type { DashboardSettings } from "@/lib/widgets/types";
import {
  saveLastPeriod,
  updateDashboardSettings,
} from "@/app/(app)/dashboards/actions";
import { PeriodControls } from "./period-controls";

type PeriodBar = NonNullable<DashboardSettings["periodBar"]>;

export function PeriodFilter({
  available,
  canEdit,
  dashboardId,
  periodBar,
  periodDefaults,
  periodDefaultField,
}: {
  available: AvailableField[];
  canEdit: boolean;
  dashboardId: string;
  periodBar?: PeriodBar;
  periodDefaults?: PeriodSelection;
  periodDefaultField?: string;
}) {
  const sp = useSearchParams();
  const dateFields = available.filter((f) => f.isDate);

  // Default (URL vazia): usa o que o servidor resolveu (último período do
  // usuário > config do dashboard > default), garantindo que UI e dados batam.
  const defaultField =
    periodDefaultField || periodBar?.field || DEFAULT_PERIOD_FIELD;
  const field = sp.get("campo") || defaultField;

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2">
      <CalendarDays className="text-muted-foreground size-4 shrink-0" />
      <PeriodControls
        keys={{ preset: "periodo", de: "de", ate: "ate" }}
        defaults={periodDefaults ?? { preset: periodBar?.defaultPreset ?? "" }}
        persist={(sel: SavedPeriod) => {
          // Salva o último período consultado deste usuário/dashboard.
          void saveLastPeriod(dashboardId, sel);
        }}
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

  const presetOptions: ComboboxOption[] = [
    { value: "", label: "Todo o período" },
    ...(Object.keys(PERIOD_PRESETS) as PeriodPresetKey[]).map((k) => ({
      value: k,
      label: PERIOD_PRESETS[k],
    })),
  ];
  const fieldOptions: ComboboxOption[] = dateFields.map((f) => ({
    value: f.field,
    label: f.label,
  }));

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
          <Combobox
            options={presetOptions}
            value={preset}
            onValueChange={setPreset}
            searchable={false}
            aria-label="Período padrão"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>Campo de data padrão</Label>
          <Combobox
            options={fieldOptions}
            value={field}
            onValueChange={setField}
            aria-label="Campo de data padrão"
          />
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
