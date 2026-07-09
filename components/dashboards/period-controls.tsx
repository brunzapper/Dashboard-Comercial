// Versão: 1.0 | Data: 09/07/2026
// Controle de período reutilizável (client): seletor preset/personalizado +
// inputs de data, opcionalmente com seletor de campo de data. Reflete/atualiza
// a URL sob os nomes de parâmetro informados em `keys` — o server recomputa os
// widgets a cada mudança. Usado pela barra global e pelo widget de filtro.
"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";

import { Input } from "@/components/ui/input";
import type { AvailableField } from "@/lib/widgets/fields";
import {
  PERIOD_ALL,
  PERIOD_PRESETS,
  hasSelection,
  type PeriodPresetKey,
  type PeriodSelection,
} from "@/lib/widgets/period";

const selectClass =
  "border-input flex h-9 rounded-md border bg-transparent px-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]";

const CUSTOM = "__custom__";

export interface PeriodControlsProps {
  // Nomes dos parâmetros de URL para preset/de/até.
  keys: { preset: string; de: string; ate: string };
  // Fallback (config) quando a URL não tem seleção — usado no display e para
  // decidir se "Todo o período" precisa do sentinel PERIOD_ALL.
  defaults?: PeriodSelection;
  // Seletor de campo de data (só a barra global). Ausente = campo fixo.
  fieldControl?: {
    paramKey: string;
    value: string;
    defaultValue: string;
    options: AvailableField[];
  };
  className?: string;
}

export function PeriodControls({
  keys,
  defaults,
  fieldControl,
  className,
}: PeriodControlsProps) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();

  const urlSel: PeriodSelection = {
    preset: sp.get(keys.preset) ?? "",
    de: sp.get(keys.de) ?? "",
    ate: sp.get(keys.ate) ?? "",
  };
  const sel: PeriodSelection = hasSelection(urlSel) ? urlSel : (defaults ?? {});

  const isAll = sel.preset === PERIOD_ALL;
  const isPreset = Boolean(sel.preset) && sel.preset !== PERIOD_ALL;
  const isCustom = !sel.preset && Boolean(sel.de || sel.ate);

  const [customOpen, setCustomOpen] = useState(isCustom);
  const mode = isCustom || customOpen ? CUSTOM : isPreset ? sel.preset! : "";

  const hasDefault = defaults ? hasSelection(defaults) : false;

  function navigate(next: Record<string, string>) {
    const params = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(next)) {
      if (v) params.set(k, v);
      else params.delete(k);
    }
    if (
      fieldControl &&
      params.get(fieldControl.paramKey) === fieldControl.defaultValue
    ) {
      params.delete(fieldControl.paramKey);
    }
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }

  function onModeChange(value: string) {
    if (value === CUSTOM) {
      setCustomOpen(true);
      navigate({ [keys.preset]: "", [keys.de]: "", [keys.ate]: "" });
      return;
    }
    setCustomOpen(false);
    if (value === "") {
      // "Todo o período": sobrepõe o default com o sentinel; sem default, limpa.
      navigate({
        [keys.preset]: hasDefault ? PERIOD_ALL : "",
        [keys.de]: "",
        [keys.ate]: "",
      });
      return;
    }
    navigate({ [keys.preset]: value, [keys.de]: "", [keys.ate]: "" });
  }

  return (
    <div className={`flex flex-wrap items-center gap-2 ${className ?? ""}`}>
      <select
        value={mode}
        onChange={(e) => onModeChange(e.target.value)}
        className={selectClass}
        aria-label="Período"
      >
        <option value="">Todo o período</option>
        {(Object.keys(PERIOD_PRESETS) as PeriodPresetKey[]).map((k) => (
          <option key={k} value={k}>
            {PERIOD_PRESETS[k]}
          </option>
        ))}
        <option value={CUSTOM}>Personalizado</option>
      </select>

      {mode === CUSTOM ? (
        <>
          <Input
            type="date"
            value={sel.de ?? ""}
            onChange={(e) => navigate({ [keys.de]: e.target.value })}
            className="w-auto"
            aria-label="De"
          />
          <span className="text-muted-foreground text-sm">até</span>
          <Input
            type="date"
            value={sel.ate ?? ""}
            onChange={(e) => navigate({ [keys.ate]: e.target.value })}
            className="w-auto"
            aria-label="Até"
          />
        </>
      ) : null}

      {fieldControl ? (
        <select
          value={fieldControl.value}
          onChange={(e) => navigate({ [fieldControl.paramKey]: e.target.value })}
          className={selectClass}
          aria-label="Campo de data"
        >
          {fieldControl.options.map((f) => (
            <option key={f.field} value={f.field}>
              {f.label}
            </option>
          ))}
        </select>
      ) : null}
    </div>
  );
}
