// Versão: 1.0 | Data: 10/07/2026
// Fase 10: editor de APARÊNCIA de um widget (Sheet), aberto pelo menu "⋮" do
// card. Controles condicionais ao visual_type; monta AppearanceSettings e salva
// reusando updateWidget (preserva as demais chaves de settings). Não altera
// dimensões/métricas/filtros — só a camada visual.
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { GripVertical } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { ColorField } from "./appearance-controls";
import { fieldLabel, type AvailableField } from "@/lib/widgets/fields";
import { topWithOther } from "@/lib/widgets/appearance";
import { PALETTES } from "@/lib/widgets/palettes";
import type {
  AppearanceSettings,
  AxisSide,
  GridLines,
  TableSortDir,
  Widget,
  WidgetData,
} from "@/lib/widgets/types";
import type { WidgetInput } from "@/app/(app)/dashboards/actions";
import { updateWidget } from "@/app/(app)/dashboards/actions";

interface Col {
  key: string;
  label: string;
}

function widgetColumns(
  widget: Widget,
  data: WidgetData,
  available: AvailableField[]
): Col[] {
  if (widget.settings?.rowMode === "records") {
    return (widget.settings.columns ?? [])
      .filter((c) => c.field)
      .map((c) => ({ key: c.field, label: fieldLabel(c.field, available) }));
  }
  return [
    ...data.dimensions.map((d) => ({ key: d.key, label: d.label })),
    ...data.metrics.map((m) => ({ key: m.key, label: m.label })),
  ];
}

export function WidgetAppearanceSheet({
  dashboardId,
  widget,
  data,
  available,
  open,
  onOpenChange,
}: {
  dashboardId: string;
  widget: Widget;
  data: WidgetData;
  available: AvailableField[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [ap, setAp] = useState<AppearanceSettings>(
    widget.settings?.appearance ?? {}
  );

  const vt = widget.visual_type;
  const isBar = vt === "barra" || vt === "barra_horizontal";
  const isChart = isBar || vt === "linha";
  const isPie = vt === "pizza" || vt === "funil";
  const isTable = vt === "tabela";
  const isKpi = vt === "kpi";

  const metrics = data.metrics;
  const dimKey = data.dimensions[0]?.key;
  const categories =
    isBar && metrics.length === 1 && dimKey
      ? data.rows.slice(0, 16).map((r, i) => ({
          i,
          name: String(r[dimKey] ?? "—"),
        }))
      : [];
  const slices =
    isPie && dimKey && metrics[0]
      ? topWithOther(data.rows, dimKey, metrics[0].key)
      : [];
  const cols = isTable ? widgetColumns(widget, data, available) : [];
  const orderedCols = (() => {
    const order = ap.table?.columnOrder;
    if (!order) return cols;
    const byKey = new Map(cols.map((c) => [c.key, c]));
    const inOrder = order
      .map((k) => byKey.get(k))
      .filter((c): c is Col => Boolean(c));
    const rest = cols.filter((c) => !order.includes(c.key));
    return [...inOrder, ...rest];
  })();

  // Helpers de patch imutável.
  const patch = (p: Partial<AppearanceSettings>) =>
    setAp((prev) => ({ ...prev, ...p }));
  const patchRecord = (
    field: "seriesColors" | "columnColors" | "sliceColors" | "seriesAxis",
    key: string | number,
    value: string | AxisSide | undefined
  ) =>
    setAp((prev) => {
      const next = { ...(prev[field] as Record<string, unknown>) };
      if (value == null || value === "") delete next[key];
      else next[key] = value;
      return { ...prev, [field]: next };
    });
  const patchTable = (p: Partial<NonNullable<AppearanceSettings["table"]>>) =>
    setAp((prev) => ({ ...prev, table: { ...prev.table, ...p } }));
  const patchTableColor = (
    field: "columnColors" | "rowColors" | "cellColors",
    key: string | number,
    value: string | undefined
  ) =>
    setAp((prev) => {
      const t = prev.table ?? {};
      const next = { ...(t[field] as Record<string, unknown> | undefined) };
      if (value == null || value === "") delete next[key];
      else next[key] = value;
      return { ...prev, table: { ...t, [field]: next } };
    });

  // Reordenação de colunas por drag (HTML5 nativo).
  const [dragKey, setDragKey] = useState<string | null>(null);
  function reorder(target: string) {
    if (!dragKey || dragKey === target) return;
    const keys = orderedCols.map((c) => c.key);
    const from = keys.indexOf(dragKey);
    const to = keys.indexOf(target);
    if (from < 0 || to < 0) return;
    keys.splice(to, 0, keys.splice(from, 1)[0]);
    patchTable({ columnOrder: keys });
  }

  function save() {
    const input: WidgetInput = {
      title: widget.title,
      visual_type: widget.visual_type,
      sources: widget.sources,
      splitBySource: widget.split_by_source,
      dimensions: widget.dimensions,
      metrics: widget.metrics,
      filters: widget.filters,
      settings: { ...widget.settings, appearance: ap },
    };
    startTransition(async () => {
      await updateWidget(widget.id, dashboardId, input);
      router.refresh();
      onOpenChange(false);
    });
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Aparência</SheetTitle>
          <SheetDescription>
            {widget.title ?? "Widget"} — ajustes visuais (não altera os dados).
          </SheetDescription>
        </SheetHeader>

        <div className="flex flex-col gap-4 px-4 pb-8">
          {/* ---------- Gráficos (barra/linha) ---------- */}
          {isChart ? (
            <>
              <ColorField
                label="Fundo do gráfico"
                value={ap.chartBackground}
                onChange={(v) => patch({ chartBackground: v })}
                onClear={() => patch({ chartBackground: undefined })}
              />
              <SelectRow
                label="Linhas de grade"
                value={ap.gridLines ?? "default"}
                onChange={(v) =>
                  patch({
                    gridLines:
                      v === "default" ? undefined : (v as GridLines),
                  })
                }
                options={[
                  { value: "default", label: "Padrão" },
                  { value: "none", label: "Nenhuma" },
                  { value: "horizontal", label: "Horizontais" },
                  { value: "vertical", label: "Verticais" },
                  { value: "both", label: "Ambas" },
                ]}
              />
              {isBar ? (
                <SelectRow
                  label="Preenchimento das barras"
                  value={ap.fillMode ?? "solid"}
                  onChange={(v) =>
                    patch({ fillMode: v as "solid" | "gradient" })
                  }
                  options={[
                    { value: "solid", label: "Sólido" },
                    { value: "gradient", label: "Gradiente (sutil)" },
                  ]}
                />
              ) : null}

              <Section title="Cores das séries">
                {metrics.map((m) => (
                  <ColorField
                    key={m.key}
                    label={m.label}
                    value={ap.seriesColors?.[m.key]}
                    onChange={(v) => patchRecord("seriesColors", m.key, v)}
                    onClear={() =>
                      patchRecord("seriesColors", m.key, undefined)
                    }
                  />
                ))}
                {categories.length > 0 ? (
                  <p className="text-muted-foreground text-xs">
                    Cores por coluna (série única):
                  </p>
                ) : null}
                {categories.map((c) => (
                  <ColorField
                    key={c.i}
                    label={c.name}
                    value={ap.columnColors?.[c.i]}
                    onChange={(v) => patchRecord("columnColors", c.i, v)}
                    onClear={() =>
                      patchRecord("columnColors", c.i, undefined)
                    }
                  />
                ))}
              </Section>

              {metrics.length >= 2 ? (
                <Section title="Eixo por série (combo)">
                  {metrics.map((m) => (
                    <SelectRow
                      key={m.key}
                      label={m.label}
                      value={ap.seriesAxis?.[m.key] ?? "left"}
                      onChange={(v) =>
                        patchRecord("seriesAxis", m.key, v as AxisSide)
                      }
                      options={[
                        { value: "left", label: "Esquerda" },
                        { value: "right", label: "Direita" },
                      ]}
                    />
                  ))}
                </Section>
              ) : null}

              {isBar ? (
                <Section title="Legenda de dados (rótulos nas barras)">
                  <CheckRow
                    label="Exibir valores"
                    checked={ap.dataLabels?.show ?? false}
                    onChange={(c) =>
                      patch({
                        dataLabels: { ...ap.dataLabels, show: c },
                      })
                    }
                  />
                  {ap.dataLabels?.show ? (
                    <>
                      <SelectRow
                        label="Posição"
                        value={ap.dataLabels?.position ?? "top"}
                        onChange={(v) =>
                          patch({
                            dataLabels: {
                              ...ap.dataLabels,
                              position: v as "inside" | "top",
                            },
                          })
                        }
                        options={[
                          { value: "top", label: "Acima" },
                          { value: "inside", label: "Dentro" },
                        ]}
                      />
                      <ColorField
                        label="Cor do rótulo"
                        value={ap.dataLabels?.color}
                        onChange={(v) =>
                          patch({
                            dataLabels: { ...ap.dataLabels, color: v },
                          })
                        }
                      />
                    </>
                  ) : null}
                </Section>
              ) : null}

              <Section title="Legenda do gráfico (séries)">
                <CheckRow
                  label="Exibir legenda"
                  checked={ap.legend?.show ?? metrics.length > 1}
                  onChange={(c) =>
                    patch({ legend: { ...ap.legend, show: c } })
                  }
                />
                <ColorField
                  label="Cor do texto da legenda"
                  value={ap.legend?.color}
                  onChange={(v) => patch({ legend: { ...ap.legend, color: v } })}
                />
              </Section>
            </>
          ) : null}

          {/* ---------- Pizza / Funil ---------- */}
          {isPie ? (
            <>
              <SelectRow
                label="Paleta"
                value={ap.palette ?? "design"}
                onChange={(v) => patch({ palette: v })}
                options={Object.entries(PALETTES).map(([k, p]) => ({
                  value: k,
                  label: p.label,
                }))}
              />
              <SelectRow
                label="Preenchimento"
                value={ap.fillMode ?? "solid"}
                onChange={(v) => patch({ fillMode: v as "solid" | "gradient" })}
                options={[
                  { value: "solid", label: "Sólido" },
                  { value: "gradient", label: "Gradiente (sutil)" },
                ]}
              />
              <Section title="Cor por fatia">
                {slices.map((s, i) => (
                  <ColorField
                    key={i}
                    label={s.name}
                    value={ap.sliceColors?.[i]}
                    onChange={(v) => patchRecord("sliceColors", i, v)}
                    onClear={() => patchRecord("sliceColors", i, undefined)}
                  />
                ))}
              </Section>
            </>
          ) : null}

          {/* ---------- Tabela ---------- */}
          {isTable ? (
            <>
              <Section title="Cores">
                <ColorField
                  label="Fundo do cabeçalho"
                  value={ap.table?.headerBg}
                  onChange={(v) => patchTable({ headerBg: v })}
                  onClear={() => patchTable({ headerBg: undefined })}
                />
                <ColorField
                  label="Texto do cabeçalho"
                  value={ap.table?.headerColor}
                  onChange={(v) => patchTable({ headerColor: v })}
                  onClear={() => patchTable({ headerColor: undefined })}
                />
                <ColorField
                  label="Fundo do corpo"
                  value={ap.table?.bodyBg}
                  onChange={(v) => patchTable({ bodyBg: v })}
                  onClear={() => patchTable({ bodyBg: undefined })}
                />
                <ColorField
                  label="Texto do corpo"
                  value={ap.table?.bodyColor}
                  onChange={(v) => patchTable({ bodyColor: v })}
                  onClear={() => patchTable({ bodyColor: undefined })}
                />
                <ColorField
                  label="Bordas"
                  value={ap.table?.borderColor}
                  onChange={(v) => patchTable({ borderColor: v })}
                  onClear={() => patchTable({ borderColor: undefined })}
                />
              </Section>
              <SelectRow
                label="Linhas de grade"
                value={ap.table?.gridLines ?? "both"}
                onChange={(v) => patchTable({ gridLines: v as GridLines })}
                options={[
                  { value: "both", label: "Ambas" },
                  { value: "horizontal", label: "Horizontais" },
                  { value: "vertical", label: "Verticais" },
                  { value: "none", label: "Nenhuma" },
                ]}
              />

              <Section title="Colunas (arraste para reordenar)">
                {orderedCols.map((c) => (
                  <div
                    key={c.key}
                    draggable
                    onDragStart={() => setDragKey(c.key)}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={() => {
                      reorder(c.key);
                      setDragKey(null);
                    }}
                    className="flex items-center gap-2 rounded-md border px-2 py-1"
                  >
                    <GripVertical className="text-muted-foreground size-4 cursor-move" />
                    <span className="flex-1 truncate text-xs">{c.label}</span>
                    <input
                      type="color"
                      aria-label={`Cor da coluna ${c.label}`}
                      value={ap.table?.columnColors?.[c.key] ?? "#000000"}
                      onChange={(e) =>
                        patchTableColor("columnColors", c.key, e.target.value)
                      }
                      className="border-input h-6 w-8 cursor-pointer rounded border p-0.5"
                    />
                    {ap.table?.columnColors?.[c.key] ? (
                      <button
                        type="button"
                        onClick={() =>
                          patchTableColor("columnColors", c.key, undefined)
                        }
                        className="text-muted-foreground text-xs underline"
                      >
                        x
                      </button>
                    ) : null}
                  </div>
                ))}
              </Section>

              <Section title="Ordenar por">
                <SelectRow
                  label="Coluna"
                  value={ap.table?.sort?.column ?? "none"}
                  onChange={(v) =>
                    patchTable({
                      sort:
                        v === "none"
                          ? undefined
                          : {
                              column: v,
                              dir: ap.table?.sort?.dir ?? "asc",
                            },
                    })
                  }
                  options={[
                    { value: "none", label: "Sem ordenação" },
                    ...cols.map((c) => ({ value: c.key, label: c.label })),
                  ]}
                />
                {ap.table?.sort?.column ? (
                  <SelectRow
                    label="Direção"
                    value={ap.table.sort.dir}
                    onChange={(v) =>
                      patchTable({
                        sort: {
                          column: ap.table!.sort!.column,
                          dir: v as TableSortDir,
                        },
                      })
                    }
                    options={[
                      { value: "asc", label: "Crescente" },
                      { value: "desc", label: "Decrescente" },
                      { value: "alpha", label: "Alfabética" },
                      { value: "color", label: "Por cor" },
                    ]}
                  />
                ) : null}
              </Section>
            </>
          ) : null}

          {/* ---------- KPI ---------- */}
          {isKpi ? (
            <Section title="Card KPI">
              <ColorField
                label="Fundo"
                value={ap.kpi?.bg}
                onChange={(v) => patch({ kpi: { ...ap.kpi, bg: v } })}
                onClear={() => patch({ kpi: { ...ap.kpi, bg: undefined } })}
              />
              <ColorField
                label="Borda"
                value={ap.kpi?.border}
                onChange={(v) => patch({ kpi: { ...ap.kpi, border: v } })}
                onClear={() =>
                  patch({ kpi: { ...ap.kpi, border: undefined } })
                }
              />
              <ColorField
                label="Cor de destaque (abinha)"
                value={ap.kpi?.accent}
                onChange={(v) => patch({ kpi: { ...ap.kpi, accent: v } })}
                onClear={() =>
                  patch({ kpi: { ...ap.kpi, accent: undefined } })
                }
              />
            </Section>
          ) : null}

          <Button onClick={save} disabled={pending}>
            {pending ? "Salvando…" : "Aplicar"}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2 border-t pt-3">
      <p className="text-sm font-medium">{title}</p>
      {children}
    </div>
  );
}

function SelectRow({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <Label className="text-xs">{label}</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="h-8 w-40">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function CheckRow({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (c: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-2 text-xs">
      <Checkbox
        checked={checked}
        onCheckedChange={(c) => onChange(c === true)}
      />
      {label}
    </label>
  );
}
