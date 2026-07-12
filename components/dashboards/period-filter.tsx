// Versão: 3.0 | Data: 12/07/2026
// Barra de período do dashboard: filtra todos os widgets não cobertos por um
// widget de filtro. Editores configuram (engrenagem) o período/campo padrão, o
// escopo (global x por aba) e podem ocultá-la (persistido em dashboards.settings).
// Usa o controle reutilizável PeriodControls. v3.0: escopo por aba — as chaves de
// URL passam a ser namespadas por id da aba ativa (periodo__<tabId>…).
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
  periodKeys,
  type PeriodPresetKey,
  type PeriodScope,
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
  periodScope,
  activeTabId,
  hasTabs,
  periodDefaultsByTab,
  periodDefaultFieldByTab,
}: {
  available: AvailableField[];
  canEdit: boolean;
  dashboardId: string;
  periodBar?: PeriodBar;
  periodScope?: PeriodScope;
  activeTabId: string;
  hasTabs: boolean;
  periodDefaultsByTab?: Record<string, PeriodSelection>;
  periodDefaultFieldByTab?: Record<string, string>;
}) {
  const sp = useSearchParams();
  const dateFields = available.filter((f) => f.isDate);

  // Escopo e "bucket" ativo: no modo por aba a barra opera sobre a aba ativa
  // (chaves de URL namespadas); no modo global, sobre o bucket único "".
  const scope: PeriodScope = periodScope === "tab" ? "tab" : "global";
  const bucket = scope === "tab" ? activeTabId : "";
  const keys = periodKeys(scope, bucket);

  // Default (URL vazia): usa o que o servidor resolveu para este bucket (último
  // período do usuário > config do dashboard > default), p/ UI e dados baterem.
  const periodDefaults = periodDefaultsByTab?.[bucket] ?? {
    preset: periodBar?.defaultPreset ?? "",
  };
  const defaultField =
    periodDefaultFieldByTab?.[bucket] || periodBar?.field || DEFAULT_PERIOD_FIELD;
  const field = sp.get(keys.campo) || defaultField;

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2">
      <CalendarDays className="text-muted-foreground size-4 shrink-0" />
      <PeriodControls
        // `key` força o controle a reidratar (estado interno) ao trocar de aba.
        key={bucket}
        keys={{ preset: keys.preset, de: keys.de, ate: keys.ate }}
        defaults={periodDefaults}
        persist={(sel: SavedPeriod) => {
          // Salva o último período consultado deste usuário/dashboard (por aba
          // no modo "tab"; global caso contrário).
          void saveLastPeriod(dashboardId, sel, scope === "tab" && bucket ? bucket : undefined);
        }}
        fieldControl={{
          paramKey: keys.campo,
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
          hasTabs={hasTabs}
        />
      ) : null}
    </div>
  );
}

// Popover de configuração da barra (editores): período/campo/escopo padrão + ocultar.
function PeriodBarConfig({
  dashboardId,
  dateFields,
  periodBar,
  hasTabs,
}: {
  dashboardId: string;
  dateFields: AvailableField[];
  periodBar?: PeriodBar;
  hasTabs: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [preset, setPreset] = useState(periodBar?.defaultPreset ?? "");
  const [field, setField] = useState(periodBar?.field ?? DEFAULT_PERIOD_FIELD);
  const [scope, setScope] = useState<PeriodScope>(
    periodBar?.scope === "tab" ? "tab" : "global"
  );

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
  const scopeOptions: ComboboxOption[] = [
    { value: "global", label: "Global (todas as abas)" },
    { value: "tab", label: "Por aba" },
  ];

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
        {hasTabs ? (
          <div className="flex flex-col gap-1.5">
            <Label>Escopo do período</Label>
            <Combobox
              options={scopeOptions}
              value={scope}
              onValueChange={(v) => setScope(v as PeriodScope)}
              searchable={false}
              aria-label="Escopo do período"
            />
          </div>
        ) : null}
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
            onClick={() => persist({ ...periodBar, enabled: false })}
          >
            Ocultar barra
          </Button>
          <Button
            size="sm"
            disabled={pending}
            onClick={() =>
              persist({ enabled: true, defaultPreset: preset, field, scope })
            }
          >
            Salvar
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
