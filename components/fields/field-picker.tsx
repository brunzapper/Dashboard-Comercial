// Versão: 1.0 | Data: 19/11/2026
// SELETOR DE CAMPOS do construtor (esquema por Base, fase 5). Mesmo contrato
// do Combobox (options/value/onValueChange/chips) — troca direta nos pontos de
// dimensão, métrica e filtro —, com três diferenças pensadas para quem procura
// um campo entre centenas:
//   - os GRUPOS aparecem sempre (Base · tipo — ver lib/widgets/field-picker.ts),
//     inclusive na visão "Todas", com o nome limpo do campo;
//   - "Recentes" no topo (por contexto, neste navegador — conveniência, nunca
//     dado: localStorage com try/catch);
//   - a busca casa também o código da origem (`searchText`, ex.: UF_CRM_…).
// Opção com `disabledReason` segue visível e explicada (política do app).
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
import type { ComboboxChip, ComboboxOption } from "@/components/ui/combobox";

const ALL_CHIP_KEY = "__all__";
const RECENTS_GROUP = "★ Recentes";
const MAX_RECENTS = 6;

type PickerOption = ComboboxOption & { searchText?: string };

function recentsStorageKey(context: string): string {
  return `field-picker:recent:${context}`;
}

function readRecents(context: string): string[] {
  try {
    const raw = window.localStorage.getItem(recentsStorageKey(context));
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(parsed) ? parsed.filter((v) => typeof v === "string") : [];
  } catch {
    return [];
  }
}

function pushRecent(context: string, value: string): void {
  try {
    const next = [value, ...readRecents(context).filter((v) => v !== value)].slice(
      0,
      MAX_RECENTS
    );
    window.localStorage.setItem(recentsStorageKey(context), JSON.stringify(next));
  } catch {
    // sem storage: sem recentes
  }
}

export interface FieldPickerProps {
  options: PickerOption[];
  value: string;
  onValueChange: (value: string) => void;
  chips?: ComboboxChip[];
  /** "dimension" | "metric" | "filter"… — separa os Recentes por uso. */
  context?: string;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  "aria-label"?: string;
}

export function FieldPicker({
  options,
  value,
  onValueChange,
  chips,
  context = "campo",
  placeholder = "— campo —",
  className,
  disabled = false,
  "aria-label": ariaLabel,
}: FieldPickerProps) {
  const [open, setOpen] = useState(false);
  const [activeChip, setActiveChip] = useState(ALL_CHIP_KEY);
  const [recents, setRecents] = useState<string[]>([]);

  const selected = options.find((o) => o.value === value);
  const hasChips = Boolean(chips && chips.length > 0);
  const chipActive = hasChips && activeChip !== ALL_CHIP_KEY;

  const groups = useMemo(() => {
    const visible = chipActive
      ? options.filter((o) => !o.chips || o.chips.includes(activeChip))
      : options;
    const byValue = new Map(visible.map((o) => [o.value, o]));
    const out: { key: string; items: PickerOption[]; recent?: boolean }[] = [];
    const recentItems = recents
      .map((v) => byValue.get(v))
      .filter((o): o is PickerOption => Boolean(o));
    if (recentItems.length > 0) {
      out.push({ key: RECENTS_GROUP, items: recentItems, recent: true });
    }
    const byGroup = new Map<string, PickerOption[]>();
    const order: string[] = [];
    for (const opt of visible) {
      const key = opt.group ?? "";
      if (!byGroup.has(key)) {
        byGroup.set(key, []);
        order.push(key);
      }
      byGroup.get(key)!.push(opt);
    }
    for (const key of order) out.push({ key, items: byGroup.get(key)! });
    return out;
  }, [options, chipActive, activeChip, recents]);

  const onOpenChange = (next: boolean) => {
    setOpen(next);
    if (next) setRecents(readRecents(context));
  };

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <Button
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
        className="w-[var(--radix-popover-trigger-width)] min-w-80 p-0"
        align="start"
      >
        <Command>
          <CommandInput placeholder="Buscar campo ou código (UF_CRM…)" />
          {hasChips ? (
            <div className="flex flex-wrap gap-1 border-b p-1.5">
              {[{ key: ALL_CHIP_KEY, label: "Todas" }, ...(chips ?? [])].map((chip) => (
                <button
                  key={chip.key}
                  type="button"
                  onClick={() => setActiveChip(chip.key)}
                  className={cn(
                    "rounded-full border px-2 py-0.5 text-xs transition-colors",
                    activeChip === chip.key
                      ? "border-brand bg-brand text-brand-foreground"
                      : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                  )}
                >
                  {chip.label}
                </button>
              ))}
            </div>
          ) : null}
          <CommandList className="max-h-96">
            <CommandEmpty>Nenhum campo.</CommandEmpty>
            {groups.map((group) => (
              <CommandGroup key={group.key} heading={group.key || undefined}>
                {group.items.map((opt) => {
                  // Nome limpo: o grupo já diz a Base.
                  const shown = opt.cleanLabel ?? opt.label;
                  const tooltip = opt.disabledReason ?? opt.title;
                  return (
                    <CommandItem
                      key={`${group.recent ? "r:" : ""}${opt.value}`}
                      value={`${group.recent ? "★" : ""}${opt.label}\u0000${opt.value}\u0000${opt.searchText ?? ""}\u0000${opt.group ?? ""}`}
                      aria-disabled={Boolean(opt.disabledReason)}
                      className={cn(opt.disabledReason && "cursor-not-allowed opacity-50")}
                      onSelect={() => {
                        if (opt.disabledReason) return;
                        pushRecent(context, opt.value);
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
                      {opt.searchText ? (
                        <span className="text-muted-foreground ml-auto truncate pl-2 text-xs">
                          {opt.searchText}
                        </span>
                      ) : null}
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
