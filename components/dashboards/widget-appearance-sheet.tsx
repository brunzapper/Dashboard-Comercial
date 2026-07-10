// Versão: 2.0 | Data: 10/07/2026
// Editor de APARÊNCIA de um widget (Sheet), aberto pelo menu "⋮" do card.
// v2.0 (Fase 10.1): a reordenação, a ordenação e as cores por coluna/linha/
// célula/categoria passaram a ser feitas IN-LOCO (direto na tabela/gráfico). Este
// painel mantém os ajustes globais: fundo, grade, preenchimento, cores de série,
// eixos, rótulos, legenda, paleta de pizza, cores globais da tabela e o card KPI.
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

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
import { type AvailableField } from "@/lib/widgets/fields";
import { topWithOther } from "@/lib/widgets/appearance";
import { PALETTES } from "@/lib/widgets/palettes";
import type {
  AppearanceSettings,
  AxisSide,
  GridLines,
  Widget,
  WidgetData,
} from "@/lib/widgets/types";
import type { WidgetInput } from "@/app/(app)/dashboards/actions";
import { updateWidget } from "@/app/(app)/dashboards/actions";

export function WidgetAppearanceSheet({
  dashboardId,
  widget,
  data,
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
  const slices =
    isPie && dimKey && metrics[0]
      ? topWithOther(data.rows, dimKey, metrics[0].key)
      : [];

  const patch = (p: Partial<AppearanceSettings>) =>
    setAp((prev) => ({ ...prev, ...p }));
  const patchRecord = (
    field: "seriesColors" | "sliceColors" | "seriesAxis",
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
            {widget.title ?? "Widget"} — ajustes visuais. Reordenar, ordenar e
            colorir colunas/linhas é feito direto na tabela/gráfico
            (arraste/duplo-clique).
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
                  patch({ gridLines: v === "default" ? undefined : (v as GridLines) })
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
                  onChange={(v) => patch({ fillMode: v as "solid" | "gradient" })}
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
                    onClear={() => patchRecord("seriesColors", m.key, undefined)}
                  />
                ))}
                {isBar ? (
                  <p className="text-muted-foreground text-xs">
                    Dica: para colorir barras individuais, dê duplo-clique na
                    categoria (chips acima do gráfico).
                  </p>
                ) : null}
              </Section>

              {metrics.length >= 2 ? (
                <Section title="Eixo por série (combo)">
                  {metrics.map((m) => (
                    <SelectRow
                      key={m.key}
                      label={m.label}
                      value={ap.seriesAxis?.[m.key] ?? "left"}
                      onChange={(v) => patchRecord("seriesAxis", m.key, v as AxisSide)}
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
                    onChange={(c) => patch({ dataLabels: { ...ap.dataLabels, show: c } })}
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
                          patch({ dataLabels: { ...ap.dataLabels, color: v } })
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
                  onChange={(c) => patch({ legend: { ...ap.legend, show: c } })}
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

          {/* ---------- Tabela (cores globais + grade) ---------- */}
          {isTable ? (
            <>
              <Section title="Cores globais">
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
              <p className="text-muted-foreground text-xs">
                Reordenar colunas/linhas, ordenar e colorir coluna/linha/célula:
                arraste a alça ou dê duplo-clique direto na tabela.
              </p>
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
                onClear={() => patch({ kpi: { ...ap.kpi, border: undefined } })}
              />
              <ColorField
                label="Cor de destaque (abinha)"
                value={ap.kpi?.accent}
                onChange={(v) => patch({ kpi: { ...ap.kpi, accent: v } })}
                onClear={() => patch({ kpi: { ...ap.kpi, accent: undefined } })}
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
      <Checkbox checked={checked} onCheckedChange={(c) => onChange(c === true)} />
      {label}
    </label>
  );
}
