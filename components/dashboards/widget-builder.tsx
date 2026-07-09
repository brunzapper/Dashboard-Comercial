// Versão: 1.0 | Data: 05/07/2026
// Construtor de widget (Sheet): fonte→dimensões→métricas→filtros→visual.
// Monta um WidgetConfig e salva via create/updateWidget.
"use client";

import { useState, useTransition } from "react";
import { Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import type { AvailableField } from "@/lib/widgets/fields";
import {
  DEFAULT_PERIOD_FIELD,
  PERIOD_PRESETS,
  type PeriodPresetKey,
} from "@/lib/widgets/period";
import {
  AGG_LABELS,
  TRANSFORM_LABELS,
  VISUAL_TYPE_LABELS,
  type Aggregation,
  type Dimension,
  type FilterOp,
  type FilterSettings,
  type Metric,
  type Transform,
  type VisualType,
  type Widget,
  type WidgetFilter,
} from "@/lib/widgets/types";
import {
  createWidget,
  updateWidget,
} from "@/app/(app)/dashboards/actions";

const selectClass =
  "border-input flex h-9 w-full rounded-md border bg-transparent px-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]";

const FILTER_OPS: { op: FilterOp; label: string }[] = [
  { op: "eq", label: "=" },
  { op: "neq", label: "≠" },
  { op: "gt", label: ">" },
  { op: "gte", label: "≥" },
  { op: "lt", label: "<" },
  { op: "lte", label: "≤" },
  { op: "in", label: "em (lista)" },
  { op: "is_null", label: "é vazio" },
  { op: "not_null", label: "não vazio" },
];

export function WidgetBuilder({
  dashboardId,
  available,
  widget,
  siblings = [],
  trigger,
}: {
  dashboardId: string;
  available: AvailableField[];
  widget?: Widget;
  siblings?: Widget[];
  trigger: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [title, setTitle] = useState(widget?.title ?? "");
  const [visualType, setVisualType] = useState<VisualType>(
    widget?.visual_type ?? "barra"
  );
  const [dimensions, setDimensions] = useState<Dimension[]>(
    widget?.dimensions ?? []
  );
  const [metrics, setMetrics] = useState<Metric[]>(
    widget?.metrics ?? [{ field: "*", agg: "count" }]
  );
  const [filters, setFilters] = useState<WidgetFilter[]>(widget?.filters ?? []);

  // Config do widget de filtro de período (visual_type 'filtro').
  const dateFields = available.filter((f) => f.isDate);
  const [filterField, setFilterField] = useState(
    widget?.settings?.field ?? DEFAULT_PERIOD_FIELD
  );
  const [filterTargets, setFilterTargets] = useState<string[]>(
    widget?.settings?.targets ?? []
  );
  const [filterPreset, setFilterPreset] = useState(
    widget?.settings?.defaultPreset ?? ""
  );
  // Widgets que este filtro pode controlar (exclui a si mesmo e outros filtros).
  const targetable = siblings.filter(
    (s) => s.id !== widget?.id && s.visual_type !== "filtro"
  );

  function toggleTarget(id: string) {
    setFilterTargets((prev) =>
      prev.includes(id) ? prev.filter((t) => t !== id) : [...prev, id]
    );
  }

  const numericFields = available.filter((f) => f.isNumeric);

  function isDate(field: string): boolean {
    return available.find((a) => a.field === field)?.isDate ?? false;
  }

  function save() {
    setError(null);

    // Widget de filtro: sem dimensões/métricas/filtros; config vai em settings.
    if (visualType === "filtro") {
      const settings: FilterSettings = {
        kind: "period",
        field: filterField,
        targets: filterTargets,
        defaultPreset: filterPreset,
      };
      const input = {
        title: title.trim() || null,
        visual_type: visualType,
        dimensions: [],
        metrics: [],
        filters: [],
        settings,
      };
      startTransition(async () => {
        const res = widget
          ? await updateWidget(widget.id, dashboardId, input)
          : await createWidget(dashboardId, input);
        if (res.ok) setOpen(false);
        else setError(res.message ?? "Falha ao salvar.");
      });
      return;
    }

    const cleanFilters = filters
      .filter((f) => f.field)
      .map((f) => {
        if (f.op === "in") {
          return {
            field: f.field,
            op: f.op,
            value: String(f.value ?? "")
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean),
          };
        }
        if (f.op === "is_null" || f.op === "not_null") {
          return { field: f.field, op: f.op };
        }
        return { field: f.field, op: f.op, value: f.value };
      });
    const input = {
      title: title.trim() || null,
      visual_type: visualType,
      dimensions: dimensions.filter((d) => d.field),
      metrics: metrics.filter((m) => m.field),
      filters: cleanFilters,
      // Preserva settings existentes (ex.: KPI meta/razão) ao editar.
      settings: widget?.settings ?? {},
    };
    startTransition(async () => {
      const res = widget
        ? await updateWidget(widget.id, dashboardId, input)
        : await createWidget(dashboardId, input);
      if (res.ok) {
        setOpen(false);
      } else {
        setError(res.message ?? "Falha ao salvar.");
      }
    });
  }

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>{trigger}</SheetTrigger>
      <SheetContent className="overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>{widget ? "Editar widget" : "Novo widget"}</SheetTitle>
          <SheetDescription>
            Fonte: registros. Escolha dimensões, métricas, filtros e o visual.
          </SheetDescription>
        </SheetHeader>

        <div className="flex flex-col gap-5 px-4 pb-6">
          <div className="flex flex-col gap-1.5">
            <Label>Título</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>Visual</Label>
            <select
              className={selectClass + " px-3"}
              value={visualType}
              onChange={(e) => setVisualType(e.target.value as VisualType)}
            >
              {(Object.keys(VISUAL_TYPE_LABELS) as VisualType[]).map((v) => (
                <option key={v} value={v}>
                  {VISUAL_TYPE_LABELS[v]}
                </option>
              ))}
            </select>
          </div>

          {/* Config do widget de filtro de período */}
          {visualType === "filtro" ? (
            <>
              <div className="flex flex-col gap-1.5">
                <Label>Campo de data</Label>
                <select
                  className={selectClass + " px-3"}
                  value={filterField}
                  onChange={(e) => setFilterField(e.target.value)}
                >
                  {dateFields.map((f) => (
                    <option key={f.field} value={f.field}>
                      {f.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex flex-col gap-1.5">
                <Label>Período padrão</Label>
                <select
                  className={selectClass + " px-3"}
                  value={filterPreset}
                  onChange={(e) => setFilterPreset(e.target.value)}
                >
                  <option value="">Todo o período</option>
                  {(Object.keys(PERIOD_PRESETS) as PeriodPresetKey[]).map((k) => (
                    <option key={k} value={k}>
                      {PERIOD_PRESETS[k]}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex flex-col gap-2">
                <Label>Vincular a</Label>
                <p className="text-muted-foreground text-xs">
                  Escolha quais widgets este filtro controla. Sem seleção, ele
                  controla o dashboard inteiro.
                </p>
                {targetable.length === 0 ? (
                  <p className="text-muted-foreground text-sm">
                    Nenhum outro widget para vincular ainda.
                  </p>
                ) : (
                  <div className="flex flex-col gap-2 rounded-md border p-3">
                    {targetable.map((s) => (
                      <label
                        key={s.id}
                        className="flex items-center gap-2 text-sm"
                      >
                        <Checkbox
                          checked={filterTargets.includes(s.id)}
                          onCheckedChange={() => toggleTarget(s.id)}
                        />
                        {s.title ?? "Sem título"}
                      </label>
                    ))}
                  </div>
                )}
              </div>
            </>
          ) : null}

          {/* Dimensões */}
          {visualType !== "filtro" ? (
          <>
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <Label>Dimensões (agrupar por)</Label>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setDimensions([...dimensions, { field: "", transform: "none" }])}
              >
                <Plus className="size-4" /> Adicionar
              </Button>
            </div>
            {dimensions.map((d, i) => (
              <div key={i} className="flex items-center gap-2">
                <select
                  className={selectClass}
                  value={d.field}
                  onChange={(e) => {
                    const next = [...dimensions];
                    next[i] = { ...d, field: e.target.value };
                    setDimensions(next);
                  }}
                >
                  <option value="">— campo —</option>
                  {available.map((a) => (
                    <option key={a.field} value={a.field}>
                      {a.label}
                    </option>
                  ))}
                </select>
                {isDate(d.field) ? (
                  <select
                    className={selectClass + " w-32"}
                    value={d.transform ?? "none"}
                    onChange={(e) => {
                      const next = [...dimensions];
                      next[i] = { ...d, transform: e.target.value as Transform };
                      setDimensions(next);
                    }}
                  >
                    {(Object.keys(TRANSFORM_LABELS) as Transform[]).map((t) => (
                      <option key={t} value={t}>
                        {TRANSFORM_LABELS[t]}
                      </option>
                    ))}
                  </select>
                ) : null}
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => setDimensions(dimensions.filter((_, j) => j !== i))}
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
            ))}
          </div>

          {/* Métricas */}
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <Label>Métricas</Label>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setMetrics([...metrics, { field: "*", agg: "count" }])}
              >
                <Plus className="size-4" /> Adicionar
              </Button>
            </div>
            {metrics.map((m, i) => (
              <div key={i} className="flex items-center gap-2">
                <select
                  className={selectClass}
                  value={m.field}
                  onChange={(e) => {
                    const next = [...metrics];
                    const field = e.target.value;
                    next[i] = { ...m, field, agg: field === "*" ? "count" : m.agg };
                    setMetrics(next);
                  }}
                >
                  <option value="*">Contagem de registros</option>
                  {numericFields.map((a) => (
                    <option key={a.field} value={a.field}>
                      {a.label}
                    </option>
                  ))}
                </select>
                <select
                  className={selectClass + " w-28"}
                  value={m.agg}
                  disabled={m.field === "*"}
                  onChange={(e) => {
                    const next = [...metrics];
                    next[i] = { ...m, agg: e.target.value as Aggregation };
                    setMetrics(next);
                  }}
                >
                  {(Object.keys(AGG_LABELS) as Aggregation[]).map((a) => (
                    <option key={a} value={a}>
                      {AGG_LABELS[a]}
                    </option>
                  ))}
                </select>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => setMetrics(metrics.filter((_, j) => j !== i))}
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
            ))}
          </div>

          {/* Filtros */}
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <Label>Filtros</Label>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setFilters([...filters, { field: "", op: "eq", value: "" }])}
              >
                <Plus className="size-4" /> Adicionar
              </Button>
            </div>
            {filters.map((f, i) => (
              <div key={i} className="flex items-center gap-2">
                <select
                  className={selectClass}
                  value={f.field}
                  onChange={(e) => {
                    const next = [...filters];
                    next[i] = { ...f, field: e.target.value };
                    setFilters(next);
                  }}
                >
                  <option value="">— campo —</option>
                  {available.map((a) => (
                    <option key={a.field} value={a.field}>
                      {a.label}
                    </option>
                  ))}
                </select>
                <select
                  className={selectClass + " w-28"}
                  value={f.op}
                  onChange={(e) => {
                    const next = [...filters];
                    next[i] = { ...f, op: e.target.value as FilterOp };
                    setFilters(next);
                  }}
                >
                  {FILTER_OPS.map((o) => (
                    <option key={o.op} value={o.op}>
                      {o.label}
                    </option>
                  ))}
                </select>
                {f.op !== "is_null" && f.op !== "not_null" ? (
                  <Input
                    value={String(f.value ?? "")}
                    onChange={(e) => {
                      const next = [...filters];
                      next[i] = { ...f, value: e.target.value };
                      setFilters(next);
                    }}
                    placeholder="valor"
                  />
                ) : null}
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => setFilters(filters.filter((_, j) => j !== i))}
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
            ))}
          </div>
          </>
          ) : null}

          {error ? <p className="text-destructive text-sm">{error}</p> : null}

          <Button onClick={save} disabled={pending}>
            {pending ? "Salvando..." : "Salvar widget"}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
