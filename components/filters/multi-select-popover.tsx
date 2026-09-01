// Versão: 1.0 | Data: 01/09/2026
// Popover de MULTI-SELEÇÃO por checkbox: gatilho compacto com o resumo da
// seleção ("todos" / rótulo único / "N selecionados") + lista rolável com
// checkboxes e "Limpar (N)". Extraído do MultiQuickFilter da barra de filtros
// rápidos (components/dashboards/quick-filters-bar.tsx) para ser o controle
// ÚNICO de multi-seleção dos filtros de VISUALIZAÇÃO — hoje a barra de
// filtros rápidos (__qf__) e o widget "Filtro por campo" (ff_/__ff__).
//
// - Recebe as opções JÁ prontas (o chamador aplica visibleOptions/hiddenOptions
//   antes: opção oculta mas SELECIONADA precisa continuar na lista para dar
//   para desmarcar) e devolve sempre um array — vazio = "todos" (sem filtro).
// - `label` prefixa o resumo no gatilho ("Responsável: 3 selecionados"); os
//   chamadores que já rotulam o controle por fora (o Filtro por campo tem um
//   <Label> acima) simplesmente não passam.
// Diferente do FilterValuePicker (components/filters/filter-value-picker.tsx),
// que é o picker dos EDITORES: aquele carrega opções lazy por load(), tem a
// semântica storeAs e não conhece hiddenOptions.
"use client";

import { ChevronDown, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export interface MultiSelectOption {
  value: string;
  label: string;
}

export function MultiSelectPopover({
  label,
  options,
  values,
  onChange,
  className,
  emptyText = "Nenhuma opção disponível.",
  ariaLabel,
}: {
  /** Prefixo do resumo no gatilho. Omitido = só o resumo. */
  label?: string;
  options: MultiSelectOption[];
  values: string[];
  onChange: (next: string[]) => void;
  /** Classes do gatilho (largura/altura por chamador). */
  className?: string;
  emptyText?: string;
  /**
   * Nome do controle para leitores de tela, quando o rótulo visível fica FORA
   * do gatilho. O resumo da seleção é concatenado — um aria-label cru
   * substituiria o texto do botão e apagaria "3 selecionados" do nome
   * acessível.
   */
  ariaLabel?: string;
}) {
  const chosen = new Set(values);
  const count = chosen.size;

  const toggle = (v: string) => {
    const next = new Set(chosen);
    if (next.has(v)) next.delete(v);
    else next.add(v);
    onChange([...next]);
  };

  // Resumo no gatilho: 1 seleção mostra o nome; várias, a contagem.
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
          className={cn("h-8 max-w-56 gap-1 px-2 text-xs", className)}
          aria-label={ariaLabel ? `${ariaLabel}: ${summary}` : undefined}
        >
          <span className="truncate">
            {label ? `${label}: ` : null}
            <span className="font-semibold">{summary}</span>
          </span>
          <ChevronDown className="size-3.5 shrink-0 opacity-60" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="flex w-64 flex-col gap-2 p-2">
        <div className="flex max-h-56 flex-col gap-1 overflow-auto">
          {options.length === 0 ? (
            <p className="text-muted-foreground p-1 text-xs">{emptyText}</p>
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
            onClick={() => onChange([])}
          >
            <X className="size-3.5" /> Limpar ({count})
          </Button>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
