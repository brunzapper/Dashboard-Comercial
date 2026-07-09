// Versão: 1.0 | Data: 08/07/2026
// Barra de período do dashboard: preset ou intervalo personalizado + campo de
// data alvo. Reflete/atualiza a URL (?periodo/de/ate/campo) — o server refaz
// os widgets a cada mudança, como na barra de filtros de registros.
"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { CalendarDays, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { AvailableField } from "@/lib/widgets/fields";
import {
  DEFAULT_PERIOD_FIELD,
  PERIOD_PRESETS,
  type PeriodPresetKey,
} from "@/lib/widgets/period";

const selectClass =
  "border-input flex h-9 rounded-md border bg-transparent px-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]";

const CUSTOM = "personalizado";

export function PeriodFilter({ available }: { available: AvailableField[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();

  const dateFields = available.filter((f) => f.isDate);

  const periodo = sp.get("periodo") ?? "";
  const de = sp.get("de") ?? "";
  const ate = sp.get("ate") ?? "";
  const campo = sp.get("campo") ?? DEFAULT_PERIOD_FIELD;

  // "Personalizado" fica selecionado sem datas ainda definidas — estado local
  // para os inputs aparecerem antes da primeira data ser escolhida.
  const [customMode, setCustomMode] = useState(!periodo && Boolean(de || ate));
  const mode = periodo || (customMode || de || ate ? CUSTOM : "");
  const active = Boolean(periodo || de || ate);

  function navigate(next: {
    periodo?: string;
    de?: string;
    ate?: string;
    campo?: string;
  }) {
    const params = new URLSearchParams(sp.toString());
    for (const [key, value] of Object.entries(next)) {
      if (value) params.set(key, value);
      else params.delete(key);
    }
    // Campo padrão não precisa poluir a URL.
    if (params.get("campo") === DEFAULT_PERIOD_FIELD) params.delete("campo");
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }

  function onModeChange(value: string) {
    if (value === CUSTOM) {
      setCustomMode(true);
      navigate({ periodo: "" });
      return;
    }
    setCustomMode(false);
    navigate({ periodo: value, de: "", ate: "" });
  }

  function clear() {
    setCustomMode(false);
    navigate({ periodo: "", de: "", ate: "", campo: "" });
  }

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2">
      <CalendarDays className="text-muted-foreground size-4 shrink-0" />
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
            value={de}
            onChange={(e) => navigate({ de: e.target.value })}
            className="w-auto"
            aria-label="De"
          />
          <span className="text-muted-foreground text-sm">até</span>
          <Input
            type="date"
            value={ate}
            onChange={(e) => navigate({ ate: e.target.value })}
            className="w-auto"
            aria-label="Até"
          />
        </>
      ) : null}

      {active ? (
        <>
          <select
            value={campo}
            onChange={(e) => navigate({ campo: e.target.value })}
            className={selectClass}
            aria-label="Campo de data"
          >
            {dateFields.map((f) => (
              <option key={f.field} value={f.field}>
                {f.label}
              </option>
            ))}
          </select>
          <Button
            variant="ghost"
            size="sm"
            onClick={clear}
            aria-label="Limpar período"
          >
            <X className="size-4" /> Limpar
          </Button>
        </>
      ) : null}
    </div>
  );
}
