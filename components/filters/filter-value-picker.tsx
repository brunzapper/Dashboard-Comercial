// Versão: 1.0 | Data: 31/07/2026
// Picker de VALOR de filtro (campos de relação/etapa/seleção): substitui o
// input de texto cru nos editores de filtro — o usuário escolhe o RÓTULO,
// nunca digita id interno. Padrão do VisibleOptionsPicker: opções carregadas
// LAZY no primeiro open (load() — cache no chamador); valor selecionado fora
// da lista aparece como "(valor antigo)" e pode ser removido.
// `storeAs` decide o que é GRAVADO ao selecionar:
//   - "label": o NOME (filtros de widget/tabela — o engine resolve nome→id
//     em runtime, resolveFkFilterNames); valor legado em UUID é exibido pelo
//     rótulo (match por option.value) e trocado pelo nome ao reselecionar.
//   - "value": o id/valor da opção (sub-bases/perfis/automações — predicados
//     comparam a coluna crua fora do pipeline do engine).
// `multi` (op "in"): checklist que grava ARRAY; valor string legado "a,b" é
// parseado só p/ exibição — a primeira mudança grava array de verdade.
"use client";

import { useEffect, useState } from "react";
import { ChevronDown, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

export interface FilterValueOption {
  value: string;
  label: string;
}

export interface FilterValueSource {
  kind: "responsible" | "operation" | "stage" | "static";
  load: () => Promise<FilterValueOption[]>;
  storeAs: "label" | "value";
}

function selectedItems(value: unknown, multi: boolean): string[] {
  if (Array.isArray(value)) return value.map((v) => String(v)).filter(Boolean);
  const s = String(value ?? "").trim();
  if (s === "") return [];
  // String legada de `in` ("a,b") — só p/ exibição; a 1ª mudança grava array.
  if (multi) return s.split(",").map((x) => x.trim()).filter(Boolean);
  return [s];
}

// Um item selecionado "casa" a opção pelas DUAS representações — cobre o
// valor legado (UUID gravado antes do storeAs "label") e o nome atual.
const matches = (item: string, o: FilterValueOption) =>
  item === o.value || item === o.label;

export function FilterValuePicker({
  source,
  multi,
  value,
  onChange,
  ariaLabel,
}: {
  source: FilterValueSource;
  multi: boolean;
  value: unknown;
  onChange: (v: string | string[]) => void;
  ariaLabel?: string;
}) {
  const [options, setOptions] = useState<FilterValueOption[] | null>(null);
  const [open, setOpen] = useState(false);
  const items = selectedItems(value, multi);

  const ensureLoaded = () => {
    if (options) return;
    source.load().then(setOptions);
  };
  // Eager quando JÁ há valor: o botão precisa exibir o RÓTULO de um id/nome
  // gravado (senão o UUID legado ficaria cru até o primeiro clique). O cache
  // do chamador dedupa — no máx. 1 chamada por tipo de opção.
  const hasItems = items.length > 0;
  useEffect(() => {
    if (hasItems) ensureLoaded();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasItems]);

  const stored = (o: FilterValueOption) =>
    source.storeAs === "label" ? o.label : o.value;
  const labelOf = (item: string) =>
    options?.find((o) => matches(item, o))?.label ?? item;
  const isChecked = (o: FilterValueOption) => items.some((i) => matches(i, o));
  const stale = options ? items.filter((i) => !options.some((o) => matches(i, o))) : [];

  const toggleMulti = (o: FilterValueOption, checked: boolean) => {
    const rest = items.filter((i) => !matches(i, o));
    onChange(checked ? [...rest, stored(o)] : rest);
  };
  const removeItem = (item: string) => {
    if (multi) onChange(items.filter((i) => i !== item));
    else onChange("");
  };
  const pickSingle = (o: FilterValueOption) => {
    onChange(stored(o));
    setOpen(false);
  };

  const buttonText =
    items.length === 0
      ? "— valor —"
      : items.length === 1
        ? labelOf(items[0])
        : `${items.length} selecionados`;

  return (
    <Popover open={open} onOpenChange={(v) => setOpen(v)}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          className="h-9 min-w-0 flex-1 justify-between gap-1 px-3 font-normal"
          onClick={ensureLoaded}
          aria-label={ariaLabel ?? "Valor do filtro"}
        >
          <span className="truncate">{buttonText}</span>
          <ChevronDown className="size-3.5 shrink-0 opacity-60" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="flex w-64 flex-col gap-2 p-2">
        <div className="flex max-h-56 flex-col gap-1 overflow-auto">
          {options == null ? (
            <p className="text-muted-foreground p-1 text-xs">Carregando…</p>
          ) : options.length === 0 && stale.length === 0 ? (
            <p className="text-muted-foreground p-1 text-xs">
              Nenhuma opção disponível.
            </p>
          ) : (
            <>
              {options.map((o) =>
                multi ? (
                  <label
                    key={o.value}
                    className="hover:bg-accent flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-sm"
                  >
                    <Checkbox
                      checked={isChecked(o)}
                      onCheckedChange={(c) => toggleMulti(o, c === true)}
                    />
                    <span className="truncate">{o.label}</span>
                  </label>
                ) : (
                  <button
                    key={o.value}
                    type="button"
                    className={`hover:bg-accent flex items-center gap-2 rounded px-1.5 py-1 text-left text-sm ${
                      isChecked(o) ? "bg-accent/60 font-medium" : ""
                    }`}
                    onClick={() => pickSingle(o)}
                  >
                    <span className="truncate">{o.label}</span>
                  </button>
                )
              )}
              {stale.map((item) => (
                <div
                  key={item}
                  className="text-muted-foreground flex items-center gap-2 rounded px-1.5 py-1 text-sm"
                >
                  <span className="truncate">{item} (valor antigo)</span>
                  <button
                    type="button"
                    aria-label={`Remover ${item}`}
                    className="hover:text-destructive ml-auto"
                    onClick={() => removeItem(item)}
                  >
                    <X className="size-3.5" />
                  </button>
                </div>
              ))}
            </>
          )}
        </div>
        {!multi && items.length > 0 ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 text-xs"
            onClick={() => {
              onChange("");
              setOpen(false);
            }}
          >
            Limpar
          </Button>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
