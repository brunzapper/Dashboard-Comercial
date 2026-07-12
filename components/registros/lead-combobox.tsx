// Versão: 1.0 | Data: 05/07/2026
// Combobox pesquisável de lead relacionado (Popover + Command + searchLeads).
"use client";

import { useEffect, useState, useTransition } from "react";
import { Check, ChevronsUpDown } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { searchLeads, type LeadOption } from "@/lib/records/actions";

export function LeadCombobox({
  name,
  defaultId,
  defaultLabel,
  onChange,
  disabled,
}: {
  name?: string;
  defaultId: string | null;
  defaultLabel: string | null;
  // Quando informado, é chamado ao escolher/remover um lead (edição inline). Sem
  // ele, o combobox só atualiza o input escondido `name` (uso em formulário).
  onChange?: (lead: LeadOption | null) => void;
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
        setResults(await searchLeads(query));
      });
    }, 250);
    return () => clearTimeout(handle);
  }, [query, open]);

  return (
    <div className="flex flex-col gap-1">
      {/* valor submetido no form (quando usado em formulário) */}
      {name ? (
        <input type="hidden" name={name} value={selected?.id ?? ""} />
      ) : null}
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
              {selected ? selected.label : "Selecionar lead..."}
            </span>
            <ChevronsUpDown className="size-4 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[320px] p-0" align="start">
          <Command shouldFilter={false}>
            <CommandInput
              placeholder="Buscar lead por nome..."
              value={query}
              onValueChange={setQuery}
            />
            <CommandList>
              <CommandEmpty>
                {isPending ? "Buscando..." : "Nenhum lead encontrado."}
              </CommandEmpty>
              <CommandGroup>
                {selected ? (
                  <CommandItem
                    value="__none__"
                    onSelect={() => {
                      setSelected(null);
                      setOpen(false);
                      onChange?.(null);
                    }}
                  >
                    <span className="text-muted-foreground">Remover vínculo</span>
                  </CommandItem>
                ) : null}
                {results.map((lead) => (
                  <CommandItem
                    key={lead.id}
                    value={lead.id}
                    onSelect={() => {
                      setSelected(lead);
                      setOpen(false);
                      onChange?.(lead);
                    }}
                  >
                    <Check
                      className={cn(
                        "size-4",
                        selected?.id === lead.id ? "opacity-100" : "opacity-0"
                      )}
                    />
                    <span className="truncate">{lead.label}</span>
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
