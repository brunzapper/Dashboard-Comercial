// Versão: 1.4 | Data: 04/09/2026
// v1.4 (04/09/2026): a escrita na URL SOBREVIVE ao desmonte da barra. A troca
//   de aba do dashboard desmonta os widgets da aba anterior e o cleanup do
//   debounce (350ms) matava o timer — o filtro recém-aplicado/limpo era
//   descartado. O payload pendente passa a viver em pendingRef e um effect
//   MOUNT-ONLY o FLUSHA no desmonte; nesse flush o replace vai direto ao
//   router, sem o overlay do useNavPending (o componente já morreu).
// v1.3 (12/08/2026): prop `actions` — slot de ações do widget (ex.: botão "+"
//   de criação manual) renderizado ao lado do botão de filtros.
// v1.2 (31/07/2026): valor de filtro AMIGÁVEL — responsável/operação/etapa
//   ganham picker de rótulos (FilterValuePicker; options lazy via a server
//   action listFilterOptionCandidates, cache local). Relações GRAVAM O NOME
//   na URL (legível/shareável) — o engine resolve nome→id em runtime
//   (resolveFkFilterNames). Demais campos seguem no input de texto.
// v1.1 (17/07/2026): busca client-side — nova prop `onSearchChange`; quando
//   presente, digitar filtra no cliente na hora e o `q` vai pra URL com
//   history.replaceState raso (shareável, SEM navegação RSC). Filtros
//   estruturados seguem navegando via router.replace como antes.
// Barra de busca/filtro embutida nas tabelas (registros e agregada), usável na
// VISUALIZAÇÃO do dashboard. Grava o estado ({q, filters}) na URL sob `paramKey`
// (tf_<widgetId>) com debounce; o servidor (page.tsx) lê o parâmetro e mescla os
// filtros em config.filters, recomputando o widget. Mesmo padrão de URL do
// filtro de período (period-controls.tsx). Visível a todos os visualizadores.
"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
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
import {
  FilterValuePicker,
  type FilterValueSource,
} from "@/components/filters/filter-value-picker";
import { listFilterOptionCandidates } from "@/app/(app)/dashboards/actions";
import { useNavPending } from "./pending-context";

const FILTER_OP_OPTIONS = FILTER_OPS.map((o) => ({ value: o.op, label: o.label }));

// Cache de MÓDULO das listas de opções (responsável/operação/etapa global):
// compartilhado entre todas as barras da página — 1 chamada por tipo.
const optionCache = new Map<
  string,
  Promise<{ value: string; label: string }[]>
>();

export function TableFilterBar({
  paramKey,
  available,
  className,
  onSearchChange,
  actions,
}: {
  paramKey: string;
  available: AvailableField[];
  className?: string;
  // Busca client-side (searchHandledOnClient): presença liga o modo — cada
  // tecla filtra na hora via callback e o `q` sincroniza com a URL de forma
  // RASA (history.replaceState), sem navegação RSC. Ausente = tudo no servidor.
  onSearchChange?: (q: string) => void;
  // Ações do widget (ex.: botão "+" de criação manual), renderizadas ao lado
  // do botão de filtros. O conteúdo vem pronto do WidgetCard.
  actions?: React.ReactNode;
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

  // Picker de VALOR (31/07/2026): relação/etapa com rótulos no lugar do texto
  // cru. A barra não conhece as fontes do widget — a lista de etapas é global
  // (documentado); campos selecao custom seguem texto (o valor já é rótulo).
  const filterValueSource = (field: string): FilterValueSource | null => {
    const af = available.find((a) => a.field === field);
    const kind =
      af?.fk === "responsible"
        ? ("responsible" as const)
        : af?.fk === "operation"
          ? ("operation" as const)
          : field === "stage"
            ? ("stage" as const)
            : null;
    if (!kind) return null;
    return {
      kind,
      storeAs: "label",
      load: () => {
        const cached = optionCache.get(kind);
        if (cached) return cached;
        const p = listFilterOptionCandidates(kind);
        optionCache.set(kind, p);
        return p;
      },
    };
  };

  // Estado efetivo (normalizado) → parâmetro de URL. Debounce p/ não navegar a
  // cada tecla. Só escreve quando o valor muda de fato. Com onSearchChange
  // (busca client-side), mudanças SÓ de `q` sincronizam a URL com
  // history.replaceState raso (integrado ao router do Next, sem RSC); mudanças
  // nos filtros estruturados seguem via router.replace (o `encoded` carrega o
  // `q` atual junto — nada se perde). A URL é lida de window.location dentro do
  // timer: vale para os dois caminhos de escrita.
  const clientSearch = Boolean(onSearchChange);
  const encoded = encodeViewFilter({ q, filters: cleanFilters(filters) });
  const filtersKey = JSON.stringify(cleanFilters(filters));
  const lastNavFiltersKey = useRef(filtersKey); // filtros da última navegação RSC
  // Payload pendente do debounce: o timer o CONSOME e o effect mount-only abaixo
  // o FLUSHA no desmonte (troca de aba). Sem isso os 350ms pendentes morriam
  // junto com o card e o filtro nunca chegava à URL.
  const pendingRef = useRef<((viaUnmount?: boolean) => void) | null>(null);
  // Só o payload armado por uma mudança do USUÁRIO é flushado. O primeiro
  // disparo do effect de debounce acontece na MONTAGEM e pode armar um payload
  // de mera sincronização (seed que não round-tripa numa config antiga dos
  // campos); flushá-lo no desmonte gravaria sem ninguém ter mexido — e em dev o
  // StrictMode (monta → desmonta → monta) faria isso em toda montagem.
  const armedByUserRef = useRef(false);
  useEffect(
    () => () => {
      const pending = pendingRef.current;
      pendingRef.current = null;
      if (armedByUserRef.current) pending?.(true);
    },
    []
  );
  const firstEffectRunRef = useRef(true);
  useEffect(() => {
    const bySeed = firstEffectRunRef.current;
    firstEffectRunRef.current = false;
    const currentVal =
      new URLSearchParams(window.location.search).get(paramKey) ?? "";
    if (encoded === currentVal) {
      // Já está na URL: nada pendente pode sobreviver ao desmonte.
      pendingRef.current = null;
      return;
    }
    const dispatch = (viaUnmount = false) => {
      const params = new URLSearchParams(window.location.search);
      if (encoded) params.set(paramKey, encoded);
      else params.delete(paramKey);
      const qs = params.toString();
      const url = qs ? `${pathname}?${qs}` : pathname;
      if (clientSearch && filtersKey === lastNavFiltersKey.current) {
        window.history.replaceState(null, "", url);
      } else {
        lastNavFiltersKey.current = filtersKey;
        // No flush do desmonte o overlay não faz sentido (o componente já
        // morreu) — a navegação vai direto ao router.
        if (viaUnmount) router.replace(url, { scroll: false });
        else run(() => router.replace(url, { scroll: false }));
      }
    };
    pendingRef.current = dispatch;
    armedByUserRef.current = !bySeed;
    const timer = setTimeout(() => {
      // Só o agendamento VIGENTE dispara (um `encoded` mais novo o substituiu).
      if (pendingRef.current !== dispatch) return;
      pendingRef.current = null;
      dispatch();
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
    onSearchChange?.("");
  }

  const hasState = Boolean(q) || filters.length > 0;

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <div className="flex items-center gap-1.5">
        <div className="relative flex-1">
          <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2" />
          <Input
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              // Sem debounce: a filtragem client-side é instantânea; o debounce
              // acima vale só para a escrita na URL.
              onSearchChange?.(e.target.value);
            }}
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
        {actions}
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
                filterValueSource(f.field) &&
                ["eq", "neq", "in"].includes(f.op) ? (
                  <FilterValuePicker
                    source={filterValueSource(f.field)!}
                    multi={f.op === "in"}
                    value={f.value}
                    onChange={(value) => updateFilter(i, { value })}
                    ariaLabel="Valor do filtro"
                  />
                ) : (
                  <Input
                    className="h-8 w-28 shrink-0 text-sm"
                    value={String(f.value ?? "")}
                    onChange={(e) => updateFilter(i, { value: e.target.value })}
                    placeholder="valor"
                    aria-label="Valor do filtro"
                  />
                )
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
