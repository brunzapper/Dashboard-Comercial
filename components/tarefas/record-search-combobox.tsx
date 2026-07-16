// Versão: 1.0 | Data: 16/07/2026
// Combobox pesquisável de REGISTRO (vínculo tarefa ↔ registro): Popover +
// Command + searchRecords (todas as fontes; RLS decide o que aparece). Mesmo
// padrão do LeadCombobox.
"use client";

import { useEffect, useState, useTransition } from "react";
import { Check, ChevronsUpDown } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { searchRecords, type LeadOption } from "@/lib/records/actions";

export function RecordSearchCombobox({
  name,
  defaultId,
  defaultLabel,
  disabled,
}: {
  name: string;
  defaultId: string | null;
  defaultLabel: string | null;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<LeadOption[]>([]);
  const [selected, setSelected] = useState<LeadOption | null>(
    defaultId ? { id: defaultId, label: defaultLabel ?? defaultId } : null
  );
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    if (!open) return;
    const handle = setTimeout(() => {
      startTransition(async () => {
        setResults(await searchRecords(null, query));
      });
    }, 250);
    return () => clearTimeout(handle);
  }, [query, open]);

  return (
    <div className="flex flex-col gap-1">
      <input type="hidden" name={name} value={selected?.id ?? ""} />
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            disabled={disabled}
            className="justify-between font-normal"
          >
            <span className="truncate">
              {selected ? selected.label : "Vincular a um registro..."}
            </span>
            <ChevronsUpDown className="size-4 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[320px] p-0" align="start">
          <Command shouldFilter={false}>
            <CommandInput
              placeholder="Buscar registro por nome..."
              value={query}
              onValueChange={setQuery}
            />
            <CommandList>
              <CommandEmpty>
                {isPending ? "Buscando..." : "Nenhum registro encontrado."}
              </CommandEmpty>
              <CommandGroup>
                {selected ? (
                  <CommandItem
                    value="__none__"
                    onSelect={() => {
                      setSelected(null);
                      setOpen(false);
                    }}
                  >
                    <span className="text-muted-foreground">Remover vínculo</span>
                  </CommandItem>
                ) : null}
                {results.map((rec) => (
                  <CommandItem
                    key={rec.id}
                    value={rec.id}
                    onSelect={() => {
                      setSelected(rec);
                      setOpen(false);
                    }}
                  >
                    <Check
                      className={cn(
                        "size-4",
                        selected?.id === rec.id ? "opacity-100" : "opacity-0"
                      )}
                    />
                    <span className="truncate">{rec.label}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}
