// Versão: 1.2 | Data: 20/07/2026
// v1.2 (20/07/2026): option.disabledReason — opção visível porém não
//   selecionável, acinzentada, com o motivo no tooltip (nunca escondida).
// Combobox pesquisável reutilizável para listas de opções ESTÁTICAS (Popover +
// Command/cmdk). Substitui os <select>/<Select> do app dando barra de busca a
// qualquer dropdown. Filtragem client-side pelo próprio cmdk (rótulo + valor).
// Suporta agrupamento opcional (option.group) e pode desligar a busca
// (searchable={false}) para listas triviais, mantendo a UI uniforme.
// v1.1 (15/07/2026): chips de filtro (prop `chips` + option.chips) — pílulas
//   entre a busca e a lista, com "Todas" implícito; com um chip ativo a opção
//   exibe `cleanLabel` e os cabeçalhos de grupo; na visão "Todas" a lista fica
//   plana com o `label` completo. Também: tooltip por opção (option.title —
//   ex.: fórmula de campo calculado) e `title` nativo no botão fechado.
"use client";

import { useMemo, useState } from "react";
import { Check, ChevronsUpDown } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";

export interface ComboboxOption {
  value: string;
  label: string;
  group?: string;
  // Rótulo alternativo exibido quando um chip específico está ativo (ex.: nome
  // do campo sem o prefixo de fonte). Ausente = usa `label` sempre.
  cleanLabel?: string;
  // Chaves de chip em que a opção aparece; ausente = aparece em todos os chips.
  chips?: string[];
  // Tooltip da opção (ex.: fórmula legível de um campo calculado).
  title?: string;
  // Presente = opção visível porém NÃO selecionável, com o motivo no tooltip
  // (política: explicar, nunca esconder — ex.: operando que criaria ciclo).
  disabledReason?: string;
}

export interface ComboboxChip {
  key: string;
  label: string;
}

export interface ComboboxProps {
  options: ComboboxOption[];
  value: string;
  onValueChange: (value: string) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  searchable?: boolean;
  disabled?: boolean;
  className?: string;
  contentClassName?: string;
  id?: string;
  // Quando informado, emite um <input type="hidden"> — permite usar em forms
  // nativos (FormData/useActionState) como um <select name> tradicional.
  name?: string;
  // Chips de filtro (ex.: fontes dos campos). "Todas" é acrescentado
  // automaticamente como primeiro chip. Filtro de NAVEGAÇÃO da lista — não
  // altera o valor selecionado.
  chips?: ComboboxChip[];
  "aria-label"?: string;
}

const ALL_CHIP_KEY = "__all__";

export function Combobox({
  options,
  value,
  onValueChange,
  placeholder = "Selecionar...",
  searchPlaceholder = "Buscar...",
  emptyText = "Nenhum resultado.",
  searchable = true,
  disabled = false,
  className,
  contentClassName,
  id,
  name,
  chips,
  "aria-label": ariaLabel,
}: ComboboxProps) {
  const [open, setOpen] = useState(false);
  const [activeChip, setActiveChip] = useState(ALL_CHIP_KEY);

  const selected = options.find((o) => o.value === value);
  const hasChips = Boolean(chips && chips.length > 0);
  const chipActive = hasChips && activeChip !== ALL_CHIP_KEY;

  // Com chip ativo: só as opções do chip (as sem `chips` aparecem sempre) e o
  // rótulo limpo + cabeçalhos de grupo. Na visão "Todas": lista plana (sem
  // cabeçalhos) com o rótulo completo — o prefixo já diz a fonte de cada item.
  const groups = useMemo(() => {
    const visible = chipActive
      ? options.filter((o) => !o.chips || o.chips.includes(activeChip))
      : options;
    const withGroups = !hasChips || chipActive;
    const order: string[] = [];
    const byGroup = new Map<string, ComboboxOption[]>();
    for (const opt of visible) {
      const key = withGroups ? (opt.group ?? "") : "";
      if (!byGroup.has(key)) {
        byGroup.set(key, []);
        order.push(key);
      }
      byGroup.get(key)!.push(opt);
    }
    return order.map((key) => ({ key, items: byGroup.get(key)! }));
  }, [options, hasChips, chipActive, activeChip]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      {name ? <input type="hidden" name={name} value={value} /> : null}
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-label={ariaLabel}
          disabled={disabled}
          title={selected?.title}
          className={cn("h-9 justify-between font-normal", className)}
        >
          <span className={cn("truncate", !selected && "text-muted-foreground")}>
            {selected ? selected.label : placeholder}
          </span>
          <ChevronsUpDown className="size-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className={cn("w-[var(--radix-popover-trigger-width)] min-w-52 p-0", contentClassName)}
        align="start"
      >
        <Command>
          {searchable ? <CommandInput placeholder={searchPlaceholder} /> : null}
          {hasChips ? (
            <div className="flex flex-wrap gap-1 border-b p-1.5">
              {[{ key: ALL_CHIP_KEY, label: "Todas" }, ...(chips ?? [])].map(
                (chip) => (
                  <button
                    key={chip.key}
                    type="button"
                    onClick={() => setActiveChip(chip.key)}
                    className={cn(
                      "rounded-full border px-2 py-0.5 text-xs transition-colors",
                      activeChip === chip.key
                        ? "border-primary bg-primary text-primary-foreground"
                        : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                    )}
                  >
                    {chip.label}
                  </button>
                )
              )}
            </div>
          ) : null}
          <CommandList>
            <CommandEmpty>{emptyText}</CommandEmpty>
            {groups.map((group) => (
              <CommandGroup key={group.key} heading={group.key || undefined}>
                {group.items.map((opt) => {
                  const shown =
                    chipActive && opt.cleanLabel ? opt.cleanLabel : opt.label;
                  const tooltip = opt.disabledReason ?? opt.title;
                  return (
                    <CommandItem
                      // Inclui rótulo completo + valor no texto de busca (permite
                      // buscar por fonte/chave mesmo com o rótulo limpo exibido),
                      // com separador nulo para não poluir o rótulo exibido.
                      key={opt.value}
                      value={`${opt.label}\u0000${opt.value}`}
                      // Desabilitada COM motivo: visível, acinzentada, tooltip
                      // explica; selecionar não faz nada (política do app:
                      // explicar a restrição, nunca esconder a opção).
                      aria-disabled={Boolean(opt.disabledReason)}
                      className={cn(
                        opt.disabledReason && "cursor-not-allowed opacity-50"
                      )}
                      onSelect={() => {
                        if (opt.disabledReason) return;
                        onValueChange(opt.value);
                        setOpen(false);
                      }}
                    >
                      <Check
                        className={cn(
                          "size-4",
                          opt.value === value ? "opacity-100" : "opacity-0"
                        )}
                      />
                      {tooltip ? (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="truncate">{shown}</span>
                          </TooltipTrigger>
                          <TooltipContent
                            side="right"
                            align="start"
                            className="max-w-72 whitespace-pre-wrap"
                          >
                            {tooltip}
                          </TooltipContent>
                        </Tooltip>
                      ) : (
                        <span className="truncate">{shown}</span>
                      )}
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
