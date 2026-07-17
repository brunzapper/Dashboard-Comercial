// Versão: 2.3 | Data: 17/07/2026
// v2.3 (17/07/2026): todas as seções recolhíveis abrem fechadas (sem
//   defaultValue no Accordion) — expandir sob demanda; badges seguem resumindo.
// v2.2 (15/07/2026): seções de cores dos widgets calculadora (card/visor/
//   teclas), nota (papel/texto/links/fonte/sem moldura) e forma (preenchimento/
//   contorno/texto). "Título e borda" fica oculto na forma (sem cromo).
// v2.1 (13/07/2026): UX — controles organizados em seções recolhíveis
//   (Accordion, mesmo padrão do construtor). Seções raras abrem fechadas;
//   as já configuradas (rótulos/legenda) abrem expandidas. Sem mudança de
//   comportamento/salvamento.
// Editor de APARÊNCIA de um widget (Sheet), aberto pelo menu "⋮" do card.
// v2.0 (Fase 10.1): a reordenação, a ordenação e as cores por coluna/linha/
// célula/categoria passaram a ser feitas IN-LOCO (direto na tabela/gráfico). Este
// painel mantém os ajustes globais: fundo, grade, preenchimento, cores de série,
// eixos, rótulos, legenda, paleta de pizza, cores globais da tabela e o card KPI.
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Accordion } from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import { BuilderSection } from "@/components/dashboards/widget-builder-rows";
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
import { KanbanAppearanceSection } from "@/components/kanban/kanban-appearance-section";
import { fieldLabel, type AvailableField } from "@/lib/widgets/fields";
import type { ComboboxOption } from "@/components/ui/combobox";
import { ConditionalFormatSection } from "@/components/dashboards/conditional-format-section";
import { topWithOther } from "@/lib/widgets/appearance";
import type { KanbanAppearance } from "@/lib/kanban/types";
import { PALETTES } from "@/lib/widgets/palettes";
import type {
  AppearanceSettings,
  AxisSide,
  GridLines,
  TableAlign,
  Widget,
  WidgetData,
} from "@/lib/widgets/types";
import type { WidgetInput } from "@/app/(app)/dashboards/actions";
import { updateWidget } from "@/app/(app)/dashboards/actions";

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
  // Aparência do kanban vive DENTRO de settings.kanban (compartilhada com a
  // página dedicada) — estado separado, merge no save.
  const [kap, setKap] = useState<KanbanAppearance>(
    widget.settings?.kanban?.appearance ?? {}
  );

  const vt = widget.visual_type;
  const isBar = vt === "barra" || vt === "barra_horizontal";
  const isChart = isBar || vt === "linha";
  const isPie = vt === "pizza" || vt === "funil";
  // A Tabela Livre reusa a seção de tabela (cores globais/grade/alinhamento).
  const isTable = vt === "tabela" || vt === "tabela_editavel";
  const isKpi = vt === "kpi";
  const isCalculator = vt === "calculadora";
  const isNote = vt === "nota";
  const isShape = vt === "forma";
  const isKanban = vt === "kanban";

  const metrics = data.metrics;
  const dimKey = data.dimensions[0]?.key;
  const slices =
    isPie && dimKey && metrics[0]
      ? topWithOther(data.rows, dimKey, metrics[0].key)
      : [];

  // Alvos da formatação condicional (ver lib/widgets/conditional.ts): tabela
  // agregada/gráficos usam as chaves de data (dim_n/metric_n, + Δ quando a
  // comparação está em coluna exclusiva); modo lista usa o field da coluna;
  // Card/calculado usam a chave especial "value".
  const isRecordListW = vt === "tabela" && widget.settings?.rowMode === "records";
  const cmpColumns =
    widget.settings?.comparison?.enabled &&
    widget.settings.comparison.tablePlacement === "column";
  const listColumns = widget.settings?.columns ?? [];
  const condTargets: ComboboxOption[] =
    vt === "calculado" || isKpi
      ? [
          { value: "value", label: "Valor do card" },
          ...data.dimensions.map((d) => ({ value: d.key, label: d.label })),
          ...data.metrics.map((m) => ({ value: m.key, label: m.label })),
        ]
      : isRecordListW
        ? listColumns.map((c) => ({
            value: c.field,
            label: c.label?.trim() || fieldLabel(c.field, available),
          }))
        : vt === "tabela" || isChart || isPie
          ? [
              ...data.dimensions.map((d) => ({ value: d.key, label: d.label })),
              ...data.metrics.flatMap((m) => [
                { value: m.key, label: m.label },
                ...(cmpColumns
                  ? [{ value: `${m.key}__var`, label: `Δ ${m.label}` }]
                  : []),
              ]),
            ]
          : [];
  const condNumericTargets: ComboboxOption[] = isRecordListW
    ? listColumns
        .filter(
          (c) => available.find((a) => a.field === c.field)?.isNumeric
        )
        .map((c) => ({
          value: c.field,
          label: c.label?.trim() || fieldLabel(c.field, available),
        }))
    : condTargets.filter(
        (t) => typeof t.value === "string" && t.value.startsWith("metric_")
      );

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
      settings: {
        ...widget.settings,
        appearance: ap,
        // Kanban: aparência dentro de settings.kanban (config preservada).
        ...(isKanban && widget.settings?.kanban
          ? { kanban: { ...widget.settings.kanban, appearance: kap } }
          : {}),
      },
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
          {/* Seções recolhíveis: todas abrem fechadas — o usuário expande sob
              demanda; os badges resumem o que está configurado (nada some). */}
          <Accordion type="multiple" className="-mt-2">
          {/* ---------- Kanban (quadro/colunas/cards/abas de visão) ---------- */}
          {isKanban ? (
            <BuilderSection value="kanban" title="Kanban">
              <KanbanAppearanceSection value={kap} onChange={setKap} />
            </BuilderSection>
          ) : null}
          {/* ---------- Formatação condicional (valor→estilo + heatmap) ---------- */}
          {condTargets.length > 0 ? (
            <ConditionalFormatSection
              value={ap.conditional}
              onChange={(v) => patch({ conditional: v })}
              targets={condTargets}
              numericTargets={condNumericTargets}
              hasComparison={Boolean(widget.settings?.comparison?.enabled)}
            />
          ) : null}
          {/* ---------- Título e borda (todos os tipos com cromo) ---------- */}
          {!isShape ? (
          <BuilderSection value="titulo" title="Título e borda">
            <ColorField
              label="Cor do texto do título"
              value={ap.title?.color}
              onChange={(v) => patch({ title: { ...ap.title, color: v } })}
              onClear={() => patch({ title: { ...ap.title, color: undefined } })}
            />
            <ColorField
              label="Fundo da barra de título"
              value={ap.title?.bg}
              onChange={(v) => patch({ title: { ...ap.title, bg: v } })}
              onClear={() => patch({ title: { ...ap.title, bg: undefined } })}
            />
            <ColorField
              label="Cor da borda / contorno"
              value={ap.title?.border}
              onChange={(v) => patch({ title: { ...ap.title, border: v } })}
              onClear={() => patch({ title: { ...ap.title, border: undefined } })}
            />
          </BuilderSection>
          ) : null}

          {/* ---------- Calculadora ---------- */}
          {isCalculator ? (
            <BuilderSection value="calculadora" title="Calculadora">
              <ColorField
                label="Fundo do card"
                value={ap.calculator?.bg}
                onChange={(v) => patch({ calculator: { ...ap.calculator, bg: v } })}
                onClear={() =>
                  patch({ calculator: { ...ap.calculator, bg: undefined } })
                }
              />
              <ColorField
                label="Fundo do visor"
                value={ap.calculator?.displayBg}
                onChange={(v) =>
                  patch({ calculator: { ...ap.calculator, displayBg: v } })
                }
                onClear={() =>
                  patch({ calculator: { ...ap.calculator, displayBg: undefined } })
                }
              />
              <ColorField
                label="Texto do visor"
                value={ap.calculator?.displayText}
                onChange={(v) =>
                  patch({ calculator: { ...ap.calculator, displayText: v } })
                }
                onClear={() =>
                  patch({
                    calculator: { ...ap.calculator, displayText: undefined },
                  })
                }
              />
              <ColorField
                label="Fundo das teclas"
                value={ap.calculator?.keyBg}
                onChange={(v) =>
                  patch({ calculator: { ...ap.calculator, keyBg: v } })
                }
                onClear={() =>
                  patch({ calculator: { ...ap.calculator, keyBg: undefined } })
                }
              />
              <ColorField
                label="Texto das teclas"
                value={ap.calculator?.keyText}
                onChange={(v) =>
                  patch({ calculator: { ...ap.calculator, keyText: v } })
                }
                onClear={() =>
                  patch({ calculator: { ...ap.calculator, keyText: undefined } })
                }
              />
              <ColorField
                label="Fundo das teclas de operação"
                value={ap.calculator?.opKeyBg}
                onChange={(v) =>
                  patch({ calculator: { ...ap.calculator, opKeyBg: v } })
                }
                onClear={() =>
                  patch({ calculator: { ...ap.calculator, opKeyBg: undefined } })
                }
              />
              <ColorField
                label="Texto das teclas de operação"
                value={ap.calculator?.opKeyText}
                onChange={(v) =>
                  patch({ calculator: { ...ap.calculator, opKeyText: v } })
                }
                onClear={() =>
                  patch({ calculator: { ...ap.calculator, opKeyText: undefined } })
                }
              />
            </BuilderSection>
          ) : null}

          {/* ---------- Nota (post-it) ---------- */}
          {isNote ? (
            <BuilderSection value="nota" title="Nota (post-it)">
              <ColorField
                label="Fundo do papel"
                value={ap.note?.bg}
                onChange={(v) => patch({ note: { ...ap.note, bg: v } })}
                onClear={() => patch({ note: { ...ap.note, bg: undefined } })}
              />
              <ColorField
                label="Cor do texto"
                value={ap.note?.color}
                onChange={(v) => patch({ note: { ...ap.note, color: v } })}
                onClear={() => patch({ note: { ...ap.note, color: undefined } })}
              />
              <ColorField
                label="Cor dos links"
                value={ap.note?.linkColor}
                onChange={(v) => patch({ note: { ...ap.note, linkColor: v } })}
                onClear={() =>
                  patch({ note: { ...ap.note, linkColor: undefined } })
                }
              />
              <div className="flex flex-col gap-1">
                <Label className="text-xs">Tamanho da fonte (px)</Label>
                <input
                  type="number"
                  min={10}
                  max={48}
                  value={ap.note?.fontSize ?? 14}
                  onChange={(e) =>
                    patch({
                      note: {
                        ...ap.note,
                        fontSize: Number(e.target.value) || undefined,
                      },
                    })
                  }
                  className="border-input h-8 w-24 rounded-md border bg-transparent px-2 text-xs tabular-nums outline-none"
                  aria-label="Tamanho da fonte"
                />
              </div>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={ap.note?.frameless ?? false}
                  onCheckedChange={(v) =>
                    patch({ note: { ...ap.note, frameless: v === true } })
                  }
                />
                Sem moldura (só o papel)
              </label>
            </BuilderSection>
          ) : null}

          {/* ---------- Forma ---------- */}
          {isShape ? (
            <BuilderSection value="forma" title="Forma">
              <ColorField
                label="Preenchimento"
                value={ap.shape?.fill}
                onChange={(v) => patch({ shape: { ...ap.shape, fill: v } })}
                onClear={() => patch({ shape: { ...ap.shape, fill: undefined } })}
              />
              <ColorField
                label="Contorno"
                value={ap.shape?.stroke}
                onChange={(v) => patch({ shape: { ...ap.shape, stroke: v } })}
                onClear={() =>
                  patch({ shape: { ...ap.shape, stroke: undefined } })
                }
              />
              <div className="flex flex-col gap-1">
                <Label className="text-xs">Espessura do contorno (px)</Label>
                <input
                  type="number"
                  min={0}
                  max={12}
                  value={ap.shape?.strokeWidth ?? 2}
                  onChange={(e) =>
                    patch({
                      shape: {
                        ...ap.shape,
                        strokeWidth: Math.max(0, Number(e.target.value) || 0),
                      },
                    })
                  }
                  className="border-input h-8 w-24 rounded-md border bg-transparent px-2 text-xs tabular-nums outline-none"
                  aria-label="Espessura do contorno"
                />
              </div>
              <ColorField
                label="Cor do texto"
                value={ap.shape?.textColor}
                onChange={(v) => patch({ shape: { ...ap.shape, textColor: v } })}
                onClear={() =>
                  patch({ shape: { ...ap.shape, textColor: undefined } })
                }
              />
              <div className="flex flex-col gap-1">
                <Label className="text-xs">Tamanho da fonte (px)</Label>
                <input
                  type="number"
                  min={10}
                  max={64}
                  value={ap.shape?.fontSize ?? 14}
                  onChange={(e) =>
                    patch({
                      shape: {
                        ...ap.shape,
                        fontSize: Number(e.target.value) || undefined,
                      },
                    })
                  }
                  className="border-input h-8 w-24 rounded-md border bg-transparent px-2 text-xs tabular-nums outline-none"
                  aria-label="Tamanho da fonte da forma"
                />
              </div>
            </BuilderSection>
          ) : null}

          {/* ---------- Gráficos (barra/linha) ---------- */}
          {isChart ? (
            <>
              <BuilderSection value="grafico" title="Gráfico">
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
              </BuilderSection>

              <BuilderSection value="series" title="Cores das séries">
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
              </BuilderSection>

              {metrics.length >= 2 ? (
                <BuilderSection value="eixos" title="Eixo por série (combo)">
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
                </BuilderSection>
              ) : null}

              {isBar ? (
                <BuilderSection
                  value="rotulos"
                  title="Legenda de dados (rótulos nas barras)"
                  badge={ap.dataLabels?.show ? "Ativos" : null}
                >
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
                </BuilderSection>
              ) : null}

              <BuilderSection
                value="legenda"
                title="Legenda do gráfico (séries)"
                badge={(ap.legend?.show ?? metrics.length > 1) ? "Ativa" : null}
              >
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
              </BuilderSection>
            </>
          ) : null}

          {/* ---------- Pizza / Funil ---------- */}
          {isPie ? (
            <>
              <BuilderSection value="pizza" title="Paleta e preenchimento">
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
              </BuilderSection>
              <BuilderSection value="fatias" title="Cor por fatia">
                {slices.map((s, i) => (
                  <ColorField
                    key={i}
                    label={s.name}
                    value={ap.sliceColors?.[i]}
                    onChange={(v) => patchRecord("sliceColors", i, v)}
                    onClear={() => patchRecord("sliceColors", i, undefined)}
                  />
                ))}
              </BuilderSection>
            </>
          ) : null}

          {/* ---------- Tabela (cores globais + grade) ---------- */}
          {isTable ? (
            <>
              <BuilderSection value="cores" title="Cores globais">
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
              </BuilderSection>
              <BuilderSection value="grade" title="Grade e texto">
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
                <SelectRow
                  label="Texto que excede a célula"
                  value={ap.table?.cellText ?? "clip"}
                  onChange={(v) =>
                    patchTable({ cellText: v as "clip" | "wrap" })
                  }
                  options={[
                    { value: "clip", label: "Cortar (…)" },
                    { value: "wrap", label: "Quebrar linha" },
                  ]}
                />
                <SelectRow
                  label="Alinhamento das colunas"
                  value={ap.table?.align ?? "default"}
                  onChange={(v) =>
                    patchTable({
                      align: v === "default" ? undefined : (v as TableAlign),
                    })
                  }
                  options={[
                    { value: "default", label: "Padrão" },
                    { value: "left", label: "Esquerda" },
                    { value: "center", label: "Centro" },
                    { value: "right", label: "Direita" },
                  ]}
                />
                <p className="text-muted-foreground text-xs">
                  Reordenar colunas/linhas, ordenar e colorir coluna/linha/célula:
                  arraste a alça ou dê duplo-clique direto na tabela.
                </p>
              </BuilderSection>
            </>
          ) : null}

          {/* ---------- KPI ---------- */}
          {isKpi ? (
            <BuilderSection value="kpi" title="Card">
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
            </BuilderSection>
          ) : null}
          </Accordion>

          <Button onClick={save} disabled={pending}>
            {pending ? "Salvando…" : "Aplicar"}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
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
