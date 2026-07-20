// Versão: 1.1 | Data: 20/07/2026
// Runtime do widget "Filtro por campo" (visual_type 'filtro_campo'): caixa de
// busca + um controle por campo configurado. Grava o estado ({q, filters}) na
// URL sob `paramKey` (ff_<widgetId>) com debounce; o servidor aplica os filtros
// a todos os widgets de dados com fonte sobreposta (menos os desmarcados),
// recomputando-os. Espelha o padrão de URL do filtro de período.
// v1.1: persiste o estado por usuário (user_preferences.lastFieldFilters via
// saveLastFieldFilter, fire-and-forget no mesmo debounce) — a page reidrata
// quando a URL não traz o parâmetro; a URL sempre vence.
"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Search } from "lucide-react";

import { Checkbox } from "@/components/ui/checkbox";
import { Combobox } from "@/components/ui/combobox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { AvailableField } from "@/lib/widgets/fields";
import { fieldLabel } from "@/lib/widgets/fields";
import type {
  FieldFilterEntry,
  FieldFilterOptions,
  FilterOp,
  WidgetFilter,
} from "@/lib/widgets/types";
import { opHasNoValue } from "@/lib/widgets/filter-ops";
import { encodeViewFilter, parseViewFilter } from "@/lib/widgets/view-filters";
import { saveLastFieldFilter } from "@/app/(app)/dashboards/actions";
import { useSnapshotMode } from "@/components/snapshots/snapshot-mode";
import { useNavPending } from "./pending-context";

// Reconstrói os valores iniciais dos controles a partir dos filtros da URL,
// casando pelo campo+operador de cada entrada configurada.
function initialValues(
  entries: FieldFilterEntry[],
  urlFilters: WidgetFilter[]
): string[] {
  return entries.map((entry) => {
    const op = entry.op ?? "eq";
    const match = urlFilters.find(
      (f) => f.field === entry.field && (f.op ?? "eq") === op
    );
    if (!match) return "";
    if (opHasNoValue(op)) return "1";
    if (op === "in" && Array.isArray(match.value)) return match.value.join(",");
    return String(match.value ?? "");
  });
}

function buildFilters(
  entries: FieldFilterEntry[],
  values: string[]
): WidgetFilter[] {
  const out: WidgetFilter[] = [];
  entries.forEach((entry, i) => {
    const op = (entry.op ?? "eq") as FilterOp;
    const raw = values[i] ?? "";
    if (opHasNoValue(op)) {
      if (raw === "1") out.push({ field: entry.field, op });
      return;
    }
    const v = raw.trim();
    if (!v) return;
    if (op === "in") {
      out.push({
        field: entry.field,
        op,
        value: v.split(",").map((s) => s.trim()).filter(Boolean),
      });
      return;
    }
    out.push({ field: entry.field, op, value: v });
  });
  return out;
}

export function FieldFilterControls({
  paramKey,
  fields,
  searchFields,
  available,
  options,
  savedValue,
  dashboardId,
  widgetId,
}: {
  paramKey: string;
  fields: FieldFilterEntry[];
  searchFields?: string[];
  available: AvailableField[];
  // Opções de dropdown por campo (responsável/operação/etapa). Ausente = <Input>.
  options?: FieldFilterOptions;
  // Valor salvo do usuário (lastFieldFilters), usado como seed quando a URL
  // não traz o parâmetro — o servidor já aplicou este mesmo valor aos widgets;
  // o primeiro debounce sincroniza a URL. URL presente vence.
  savedValue?: string;
  // Presentes no dashboard autenticado: habilitam a persistência por usuário
  // (lastFieldFilters). O viewer público de snapshots não os passa (URL-only).
  dashboardId?: string;
  widgetId?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const { run } = useNavPending();
  // Viewer de snapshot: filtros seguem funcionando via URL, mas NUNCA
  // persistem preferência (visitante pode nem ter sessão; e um usuário
  // autenticado vendo o snapshot não pode poluir o dashboard vivo).
  const { snapshot } = useSnapshotMode();

  const initial = parseViewFilter(sp.get(paramKey) ?? savedValue ?? null);
  const [q, setQ] = useState(initial.q ?? "");
  const [values, setValues] = useState<string[]>(() =>
    initialValues(fields, initial.filters)
  );

  const showSearch = (searchFields?.length ?? 0) > 0 || fields.length === 0;

  const encoded = encodeViewFilter({ q, filters: buildFilters(fields, values) });
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
      // Persistência por usuário (fire-and-forget): encoded vazio LIMPA a
      // preferência (o usuário removeu o filtro — não pode ressuscitar).
      if (!snapshot && dashboardId && widgetId) {
        void saveLastFieldFilter(dashboardId, widgetId, encoded || null);
      }
    }, 350);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [encoded]);

  const setValue = (i: number, v: string) =>
    setValues((prev) => {
      const next = [...prev];
      next[i] = v;
      return next;
    });

  return (
    <div className="flex h-full flex-col gap-2 overflow-auto p-1">
      {showSearch ? (
        <div className="relative">
          <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar…"
            aria-label="Buscar"
            className="h-8 pl-7 text-sm"
          />
        </div>
      ) : null}

      {fields.map((entry, i) => {
        const label = entry.label || fieldLabel(entry.field, available);
        const op = (entry.op ?? "eq") as FilterOp;
        if (opHasNoValue(op)) {
          return (
            <label key={i} className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={values[i] === "1"}
                onCheckedChange={(c) => setValue(i, c ? "1" : "")}
              />
              {label} {op === "is_null" ? "(vazio)" : "(preenchido)"}
            </label>
          );
        }
        const opts = options?.[entry.field];
        // Campo com opções (responsável/operação/etapa): dropdown fechado. Para o
        // operador "em (lista)" vira multi-seleção por checkbox (valores em CSV,
        // que buildFilters já divide); os demais operadores usam um select único.
        if (opts && opts.length > 0) {
          if (op === "in") {
            const chosen = new Set(
              (values[i] ?? "").split(",").map((s) => s.trim()).filter(Boolean)
            );
            const toggle = (v: string) => {
              const next = new Set(chosen);
              if (next.has(v)) next.delete(v);
              else next.add(v);
              setValue(i, [...next].join(","));
            };
            return (
              <div key={i} className="flex flex-col gap-1">
                <Label className="text-xs">{label}</Label>
                <div className="flex max-h-40 flex-col gap-1 overflow-auto rounded-md border p-2">
                  {opts.map((o) => (
                    <label
                      key={o.value}
                      className="flex items-center gap-2 text-sm"
                    >
                      <Checkbox
                        checked={chosen.has(o.value)}
                        onCheckedChange={() => toggle(o.value)}
                      />
                      <span className="truncate">{o.label}</span>
                    </label>
                  ))}
                </div>
              </div>
            );
          }
          return (
            <div key={i} className="flex flex-col gap-1">
              <Label className="text-xs">{label}</Label>
              <Combobox
                options={[{ value: "", label: "— todos —" }, ...opts]}
                value={values[i] ?? ""}
                onValueChange={(v) => setValue(i, v)}
                placeholder="— todos —"
                className="h-8 text-sm"
                aria-label={label}
              />
            </div>
          );
        }
        return (
          <div key={i} className="flex flex-col gap-1">
            <Label className="text-xs">{label}</Label>
            <Input
              value={values[i] ?? ""}
              onChange={(e) => setValue(i, e.target.value)}
              placeholder={op === "in" ? "valores separados por vírgula" : "valor"}
              aria-label={label}
              className="h-8 text-sm"
            />
          </div>
        );
      })}
    </div>
  );
}
