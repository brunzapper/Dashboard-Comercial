// Versão: 1.0 | Data: 11/07/2026
// Barra de busca/filtro embutida nas tabelas (registros e agregada), usável na
// VISUALIZAÇÃO do dashboard. Grava o estado ({q, filters}) na URL sob `paramKey`
// (tf_<widgetId>) com debounce; o servidor (page.tsx) lê o parâmetro e mescla os
// filtros em config.filters, recomputando o widget. Mesmo padrão de URL do
// filtro de período (period-controls.tsx). Visível a todos os visualizadores.
"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Plus, Search, SlidersHorizontal, Trash2, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { AvailableField } from "@/lib/widgets/fields";
import type { FilterOp, WidgetFilter } from "@/lib/widgets/types";
import {
  cleanFilters,
  FILTER_OPS,
  opHasNoValue,
  sourceChips,
  toFieldOptions,
} from "@/lib/widgets/filter-ops";
import { useSourceLabels } from "@/components/source-labels-context";
import {
  encodeViewFilter,
  parseViewFilter,
} from "@/lib/widgets/view-filters";
import { useNavPending } from "./pending-context";

const FILTER_OP_OPTIONS = FILTER_OPS.map((o) => ({ value: o.op, label: o.label }));

export function TableFilterBar({
  paramKey,
  available,
  className,
}: {
  paramKey: string;
  available: AvailableField[];
  className?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const { run } = useNavPending();

  const initial = parseViewFilter(sp.get(paramKey));
  const [q, setQ] = useState(initial.q ?? "");
  const [filters, setFilters] = useState<WidgetFilter[]>(initial.filters);
  const [open, setOpen] = useState(initial.filters.length > 0);

  const sourceLabels = useSourceLabels();
  const fieldOptions = toFieldOptions(available, sourceLabels);
  const fieldSourceChips = sourceChips(sourceLabels);

  // Estado efetivo (normalizado) → parâmetro de URL. Debounce p/ não navegar a
  // cada tecla. Só navega quando o valor muda de fato.
  const encoded = encodeViewFilter({ q, filters: cleanFilters(filters) });
  useEffect(() => {
    const currentVal = sp.get(paramKey) ?? "";
    if (encoded === currentVal) return;
    const timer = setTimeout(() => {
      const params = new URLSearchParams(sp.toString());
      if (encoded) params.set(paramKey, encoded);
      else params.delete(paramKey);
      const qs = params.toString();
      run(() =>
        router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
      );
    }, 350);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [encoded]);

  const activeCount = cleanFilters(filters).length;

  function addFilter() {
    setFilters((prev) => [...prev, { field: "", op: "eq", value: "" }]);
    setOpen(true);
  }
  function updateFilter(i: number, patch: Partial<WidgetFilter>) {
    setFilters((prev) => {
      const next = [...prev];
      next[i] = { ...next[i], ...patch };
      return next;
    });
  }
  function removeFilter(i: number) {
    setFilters((prev) => prev.filter((_, j) => j !== i));
  }
  function clearAll() {
    setQ("");
    setFilters([]);
    setOpen(false);
  }

  const hasState = Boolean(q) || filters.length > 0;

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <div className="flex items-center gap-1.5">
        <div className="relative flex-1">
          <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar…"
            aria-label="Buscar na tabela"
            className="h-8 pl-7 text-sm"
          />
        </div>
        <Button
          type="button"
          variant={open || activeCount > 0 ? "secondary" : "ghost"}
          size="sm"
          className="h-8 shrink-0 gap-1 px-2"
          onClick={() => setOpen((v) => !v)}
          aria-label="Filtros"
        >
          <SlidersHorizontal className="size-3.5" />
          {activeCount > 0 ? (
            <span className="tabular-nums">{activeCount}</span>
          ) : null}
        </Button>
        {hasState ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-8 shrink-0"
            onClick={clearAll}
            aria-label="Limpar busca e filtros"
          >
            <X className="size-3.5" />
          </Button>
        ) : null}
      </div>

      {open ? (
        <div className="flex flex-col gap-1.5 rounded-md border p-2">
          {filters.length === 0 ? (
            <p className="text-muted-foreground text-xs">
              Nenhum filtro. Adicione um campo, operador e valor.
            </p>
          ) : null}
          {filters.map((f, i) => (
            <div key={i} className="flex items-center gap-1.5">
              <Combobox
                className="min-w-0 flex-1"
                options={fieldOptions}
                chips={fieldSourceChips}
                value={f.field}
                placeholder="— campo —"
                onValueChange={(field) => updateFilter(i, { field })}
                aria-label="Campo do filtro"
              />
              <Combobox
                className="w-24 shrink-0"
                searchable={false}
                options={FILTER_OP_OPTIONS}
                value={f.op}
                onValueChange={(op) => updateFilter(i, { op: op as FilterOp })}
                aria-label="Operador do filtro"
              />
              {!opHasNoValue(f.op) ? (
                <Input
                  className="h-8 w-28 shrink-0 text-sm"
                  value={String(f.value ?? "")}
                  onChange={(e) => updateFilter(i, { value: e.target.value })}
                  placeholder="valor"
                  aria-label="Valor do filtro"
                />
              ) : null}
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-8 shrink-0"
                onClick={() => removeFilter(i)}
                aria-label="Remover filtro"
              >
                <Trash2 className="size-3.5" />
              </Button>
            </div>
          ))}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 w-fit gap-1 px-2"
            onClick={addFilter}
          >
            <Plus className="size-3.5" /> Adicionar filtro
          </Button>
        </div>
      ) : null}
    </div>
  );
}
