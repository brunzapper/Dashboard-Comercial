// Versão: 1.0 | Data: 09/07/2026
// Controle de período reutilizável (client): seletor preset/personalizado +
// inputs de data, opcionalmente com seletor de campo de data. Reflete/atualiza
// a URL sob os nomes de parâmetro informados em `keys` — o server recomputa os
// widgets a cada mudança. Usado pela barra global e pelo widget de filtro.
"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";

import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import { Input } from "@/components/ui/input";
import { useNavPending } from "./pending-context";
import type { AvailableField } from "@/lib/widgets/fields";
import {
  PERIOD_ALL,
  PERIOD_PRESETS,
  hasSelection,
  type PeriodPresetKey,
  type PeriodSelection,
  type SavedPeriod,
} from "@/lib/widgets/period";

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
  // Persiste a seleção resultante (só a barra global usa — salva por usuário).
  persist?: (sel: SavedPeriod) => void;
  className?: string;
}

export function PeriodControls({
  keys,
  defaults,
  fieldControl,
  persist,
  className,
}: PeriodControlsProps) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const { run } = useNavPending();

  const urlSel: PeriodSelection = {
    preset: sp.get(keys.preset) ?? "",
    de: sp.get(keys.de) ?? "",
    ate: sp.get(keys.ate) ?? "",
  };
  const sel: PeriodSelection = hasSelection(urlSel) ? urlSel : (defaults ?? {});

  const isPreset = Boolean(sel.preset) && sel.preset !== PERIOD_ALL;
  const isCustom = !sel.preset && Boolean(sel.de || sel.ate);

  const [customOpen, setCustomOpen] = useState(isCustom);
  const mode = isCustom || customOpen ? CUSTOM : isPreset ? sel.preset! : "";

  const hasDefault = defaults ? hasSelection(defaults) : false;

  const modeOptions: ComboboxOption[] = [
    { value: "", label: "Todo o período" },
    ...(Object.keys(PERIOD_PRESETS) as PeriodPresetKey[]).map((k) => ({
      value: k,
      label: PERIOD_PRESETS[k],
    })),
    { value: CUSTOM, label: "Personalizado" },
  ];

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
    // Persiste o último período consultado (barra global; salvo por usuário).
    if (persist) {
      persist({
        periodo: params.get(keys.preset) ?? "",
        de: params.get(keys.de) ?? "",
        ate: params.get(keys.ate) ?? "",
        // O campo é removido da URL quando igual ao default; persiste o efetivo.
        campo: fieldControl
          ? (params.get(fieldControl.paramKey) ?? fieldControl.defaultValue)
          : undefined,
      });
    }
    // Envolve em transition (contexto): a barra/os widgets exibem "Carregando…"
    // enquanto o servidor recomputa os dados após a mudança de período.
    run(() => {
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    });
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
      <Combobox
        options={modeOptions}
        value={mode}
        onValueChange={onModeChange}
        searchable={false}
        className="w-auto min-w-40"
        aria-label="Período"
      />

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
        <Combobox
          options={fieldControl.options.map((f) => ({
            value: f.field,
            label: f.label,
          }))}
          value={fieldControl.value}
          onValueChange={(v) => navigate({ [fieldControl.paramKey]: v })}
          className="w-auto min-w-44"
          aria-label="Campo de data"
        />
      ) : null}
    </div>
  );
}
