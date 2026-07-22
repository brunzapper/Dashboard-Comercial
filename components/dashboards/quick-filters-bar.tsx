// Versão: 1.2 | Data: 22/07/2026
// v1.2 (22/07/2026): entry.hiddenOptions oculta opções do dropdown de
// multi-seleção (só exibição — visibleOptions com `keep` = valores
// selecionados, p/ o rótulo do chip resolver e dar para desmarcar).
// v1.1 (21/07/2026): intervalo personalizado do filtro de período em RASCUNHO
// (PeriodRangeDraft) — escolher "Personalizado" não emite mais valor (não
// apaga o preset persistido) e digitar as datas não grava/consulta: o commit
// (onChange → persist debounced) sai com o intervalo completo ou pelo
// "Aplicar" (intervalo aberto deliberado).
// Barra de filtros rápidos de um widget: dropdowns lado a lado no card (onde
// fica a barra de busca das tabelas, ou no topo dos gráficos/KPI/calculado).
// - Responsável/Operação/data com formato → Popover com multi-seleção.
// - Data no formato PADRÃO → dropdown de período (mesmas opções da barra
//   global) + intervalo personalizado.
// Ao contrário da barra de busca (URL), a seleção é PERSISTIDA no servidor
// (dashboard_table_cells '__qf__', via saveQuickFilterValue) — compartilhada
// entre usuários e sobrevive a reloads. Estado otimista + debounce; a action
// revalida a página e o RSC recomputa o widget (overlay via useNavPending).
// EXCEÇÃO — modo snapshot (viewer público /s/<token>): a seleção é POR
// VISITANTE e vai para a URL (qf_<widget>_<entry>, mesma técnica da
// TableFilterBar); nada é gravado no servidor.
"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ChevronDown, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import type { AvailableField } from "@/lib/widgets/fields";
import { fieldLabel } from "@/lib/widgets/fields";
import {
  PERIOD_ALL,
  PERIOD_PRESETS,
  type PeriodPresetKey,
} from "@/lib/widgets/period";
import {
  hasQuickValue,
  isPeriodEntry,
  type QuickFilterValue,
  type WidgetQuickFilters,
} from "@/lib/widgets/quick-filters";
import { visibleOptions } from "@/lib/widgets/hidden-options";
import { TRANSFORM_LABELS, type QuickFilterEntry } from "@/lib/widgets/types";
import { saveQuickFilterValue } from "@/app/(app)/dashboards/actions";
import { useSnapshotMode } from "@/components/snapshots/snapshot-mode";
import { useNavPending } from "./pending-context";
import { PeriodRangeDraft } from "./period-range-inputs";

const CUSTOM = "__custom__";

// Rótulo do chip: nome configurado > rótulo do campo (+ formato quando houver).
function entryLabel(entry: QuickFilterEntry, available: AvailableField[]): string {
  if (entry.label?.trim()) return entry.label.trim();
  const base = fieldLabel(entry.field, available);
  const t = entry.transform;
  return t && t !== "none" ? `${base} (${TRANSFORM_LABELS[t]})` : base;
}

export function QuickFiltersBar({
  dashboardId,
  widgetId,
  qf,
  available,
  className,
}: {
  dashboardId: string;
  widgetId: string;
  qf: WidgetQuickFilters;
  available: AvailableField[];
  className?: string;
}) {
  const { run } = useNavPending();
  const { snapshot } = useSnapshotMode();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // Estado otimista, ressincronizado quando o servidor manda valores novos
  // (outro usuário mudou / sync da barra global) — padrão seedKey do app.
  const serverKey = JSON.stringify(qf.values);
  const [seedKey, setSeedKey] = useState(serverKey);
  const [values, setValues] = useState<Record<string, QuickFilterValue>>(
    qf.values
  );
  if (seedKey !== serverKey) {
    setSeedKey(serverKey);
    setValues(qf.values);
  }

  // Debounce por entry: agrupa cliques rápidos numa única gravação.
  const timersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      for (const t of Object.values(timers)) clearTimeout(t);
    };
  }, []);

  const persist = (entryId: string, value: QuickFilterValue | null) => {
    clearTimeout(timersRef.current[entryId]);
    timersRef.current[entryId] = setTimeout(() => {
      // Modo snapshot: seleção por visitante na URL; o RSC público a lê e
      // recomputa sobre o dataset congelado. Nada persiste no servidor.
      if (snapshot) {
        const params = new URLSearchParams(searchParams.toString());
        const key = `qf_${widgetId}_${entryId}`;
        if (value) params.set(key, JSON.stringify(value));
        else params.delete(key);
        const qs = params.toString();
        run(() =>
          router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
        );
        return;
      }
      // Transition assíncrona: o overlay "Carregando…" cobre a gravação + a
      // revalidação da página disparada pela action.
      run(async () => {
        await saveQuickFilterValue(dashboardId, widgetId, entryId, value);
      });
    }, 400);
  };

  const setValue = (entryId: string, value: QuickFilterValue | null) => {
    setValues((prev) => {
      const next = { ...prev };
      if (value == null) delete next[entryId];
      else next[entryId] = value;
      return next;
    });
    persist(entryId, value);
  };

  if (qf.entries.length === 0) return null;

  return (
    <div className={cn("flex flex-wrap items-center gap-1.5", className)}>
      {qf.entries.map((entry) =>
        isPeriodEntry(entry, available) ? (
          <PeriodQuickFilter
            key={entry.id}
            label={entryLabel(entry, available)}
            value={values[entry.id]}
            onChange={(v) => setValue(entry.id, v)}
          />
        ) : (
          <MultiQuickFilter
            key={entry.id}
            label={entryLabel(entry, available)}
            options={visibleOptions(
              qf.options[entry.id] ?? [],
              entry.hiddenOptions,
              values[entry.id]?.kind === "options"
                ? (values[entry.id] as { values: string[] }).values
                : []
            )}
            value={values[entry.id]}
            onChange={(v) => setValue(entry.id, v)}
          />
        )
      )}
    </div>
  );
}

// Dropdown de multi-seleção (responsável / operação / bucket de data).
function MultiQuickFilter({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { value: string; label: string }[];
  value?: QuickFilterValue;
  onChange: (v: QuickFilterValue | null) => void;
}) {
  const chosen = new Set(value?.kind === "options" ? value.values : []);
  const count = chosen.size;

  const toggle = (v: string) => {
    const next = new Set(chosen);
    if (next.has(v)) next.delete(v);
    else next.add(v);
    onChange(next.size > 0 ? { kind: "options", values: [...next] } : null);
  };

  // Resumo no chip: 1 seleção mostra o nome; várias, a contagem.
  const summary =
    count === 0
      ? "todos"
      : count === 1
        ? (options.find((o) => chosen.has(o.value))?.label ?? "1")
        : `${count} selecionados`;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant={count > 0 ? "secondary" : "outline"}
          size="sm"
          className="h-8 max-w-56 gap-1 px-2 text-xs"
        >
          <span className="truncate">
            {label}: <span className="font-semibold">{summary}</span>
          </span>
          <ChevronDown className="size-3.5 shrink-0 opacity-60" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="flex w-64 flex-col gap-2 p-2">
        <div className="flex max-h-56 flex-col gap-1 overflow-auto">
          {options.length === 0 ? (
            <p className="text-muted-foreground p-1 text-xs">
              Nenhuma opção disponível.
            </p>
          ) : (
            options.map((o) => (
              <label
                key={o.value}
                className="hover:bg-accent flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-sm"
              >
                <Checkbox
                  checked={chosen.has(o.value)}
                  onCheckedChange={() => toggle(o.value)}
                />
                <span className="truncate">{o.label}</span>
              </label>
            ))
          )}
        </div>
        {count > 0 ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 self-start gap-1 px-2 text-xs"
            onClick={() => onChange(null)}
          >
            <X className="size-3.5" /> Limpar ({count})
          </Button>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}

// Dropdown de período (data no formato padrão): mesmas opções da barra global
// (Todo o período / presets / Personalizado), persistidas em vez de irem à URL.
function PeriodQuickFilter({
  label,
  value,
  onChange,
}: {
  label: string;
  value?: QuickFilterValue;
  onChange: (v: QuickFilterValue | null) => void;
}) {
  const sel = value?.kind === "period" ? value : undefined;
  const preset = sel?.preset ?? "";
  const isCustom = !preset && Boolean(sel?.de || sel?.ate);
  const [customOpen, setCustomOpen] = useState(isCustom);
  const mode = isCustom || customOpen ? CUSTOM : preset === PERIOD_ALL ? "" : preset;

  const modeOptions: ComboboxOption[] = [
    { value: "", label: "Todo o período" },
    ...(Object.keys(PERIOD_PRESETS) as PeriodPresetKey[]).map((k) => ({
      value: k,
      label: PERIOD_PRESETS[k],
    })),
    { value: CUSTOM, label: "Personalizado" },
  ];

  function onModeChange(v: string) {
    if (v === CUSTOM) {
      // Só abre os inputs de rascunho — nada é emitido/persistido até o
      // commit do intervalo (o valor anterior segue filtrando).
      setCustomOpen(true);
      return;
    }
    setCustomOpen(false);
    if (v === "") {
      // "Todo o período" explícito: sentinel (sobrepõe o período geral quando o
      // campo é o mesmo; limpar de vez = mesma coisa com menos estado, mas o
      // sentinel preserva a intenção após o sync da barra).
      onChange(hasQuickValue(sel) ? { kind: "period", preset: PERIOD_ALL } : null);
      return;
    }
    onChange({ kind: "period", preset: v });
  }

  return (
    <div className="flex flex-wrap items-center gap-1">
      <span className="text-muted-foreground max-w-40 truncate text-xs">
        {label}:
      </span>
      <Combobox
        options={modeOptions}
        value={mode}
        onValueChange={onModeChange}
        searchable={false}
        className="h-8 w-auto min-w-36 text-xs"
        aria-label={`Período — ${label}`}
      />
      {mode === CUSTOM ? (
        // Rascunho: digitar não emite; o commit emite UMA vez (intervalo
        // completo auto, ou aberto via "Aplicar") e o persist do pai grava.
        <PeriodRangeDraft
          compact
          de={sel?.de ?? ""}
          ate={sel?.ate ?? ""}
          ariaPrefix={label}
          onCommit={({ de, ate }) =>
            onChange({ kind: "period", preset: "", de, ate })
          }
        />
      ) : null}
    </div>
  );
}
