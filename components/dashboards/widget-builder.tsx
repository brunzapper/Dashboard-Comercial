// Versão: 1.1 | Data: 09/07/2026
// v1.1 (09/07/2026): Fase 8 — bloco "Fontes" (multi-seleção) + toggle "Quebrar
//   por fonte"; os campos unificados (correspondências) já vêm em `available`.
// Construtor de widget (Sheet): fontes→dimensões→métricas→filtros→visual.
// Monta um WidgetConfig e salva via create/updateWidget.
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FieldForm } from "@/components/campos/field-form";
import { SOURCE_KEYS, SOURCE_LABELS, type SourceKey } from "@/lib/sources";
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
  type MatrixAxis,
  type Metric,
  type RecordListColumn,
  type Transform,
  type VisualType,
  type Widget,
  type WidgetFilter,
} from "@/lib/widgets/types";
import {
  createWidget,
  updateWidget,
} from "@/app/(app)/dashboards/actions";

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

const FILTER_OP_OPTIONS: ComboboxOption[] = FILTER_OPS.map((o) => ({
  value: o.op,
  label: o.label,
}));

// Agrupa os campos do catálogo por origem para os seletores pesquisáveis.
function fieldGroup(field: string): string {
  if (field.startsWith("custom:")) return "Personalizados";
  if (field.startsWith("unified:")) return "Unificados";
  return "Núcleo";
}
function toFieldOptions(fields: AvailableField[]): ComboboxOption[] {
  return fields.map((f) => ({
    value: f.field,
    label: f.label,
    group: fieldGroup(f.field),
  }));
}

export function WidgetBuilder({
  dashboardId,
  available,
  widget,
  siblings = [],
  trigger,
  canManageFields = false,
}: {
  dashboardId: string;
  available: AvailableField[];
  widget?: Widget;
  siblings?: Widget[];
  trigger: React.ReactNode;
  canManageFields?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [fieldSheetOpen, setFieldSheetOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // Operandos numéricos para fórmula ao criar um campo aqui: colunas numéricas
  // do catálogo, exceto as unificadas (não são operandos válidos).
  const fieldFormNumericRefs = available
    .filter((f) => f.isNumeric && !f.field.startsWith("unified:"))
    .map((f) => ({ ref: f.field, label: f.label }));

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
  const [sources, setSources] = useState<SourceKey[]>(widget?.sources ?? []);
  const [splitBySource, setSplitBySource] = useState<boolean>(
    widget?.split_by_source ?? false
  );

  // Modo "registros individuais" (Fase 1): tabela lista 1 linha por registro e
  // colunas personalizadas marcadas como editáveis gravam de volta no registro.
  const [recordsMode, setRecordsMode] = useState<boolean>(
    widget?.settings?.rowMode === "records"
  );
  const [columns, setColumns] = useState<RecordListColumn[]>(
    widget?.settings?.columns ?? []
  );
  const isRecordList = visualType === "tabela" && recordsMode;

  function setColumnField(i: number, field: string) {
    setColumns((prev) => {
      const next = [...prev];
      // Editável só faz sentido em campos personalizados.
      const editable = field.startsWith("custom:") ? next[i]?.editable : false;
      next[i] = { field, editable };
      return next;
    });
  }
  function setColumnEditable(i: number, editable: boolean) {
    setColumns((prev) => {
      const next = [...prev];
      next[i] = { ...next[i], editable };
      return next;
    });
  }

  // Estrutura da "Tabela editável" (visual_type 'tabela_editavel'). key estável
  // (gerado no add) + label livre; renomear não órfã as células gravadas.
  const [matrixRows, setMatrixRows] = useState<MatrixAxis[]>(
    widget?.settings?.matrix?.rows ?? []
  );
  const [matrixCols, setMatrixCols] = useState<MatrixAxis[]>(
    widget?.settings?.matrix?.cols ?? []
  );
  const [matrixCellType, setMatrixCellType] = useState<"numero" | "texto">(
    widget?.settings?.matrix?.cellType ?? "numero"
  );
  const newAxis = (): MatrixAxis => ({ key: crypto.randomUUID(), label: "" });
  function setAxisLabel(
    setter: React.Dispatch<React.SetStateAction<MatrixAxis[]>>,
    i: number,
    label: string
  ) {
    setter((prev) => {
      const next = [...prev];
      next[i] = { ...next[i], label };
      return next;
    });
  }

  function toggleSource(key: SourceKey) {
    setSources((prev) =>
      prev.includes(key) ? prev.filter((s) => s !== key) : [...prev, key]
    );
  }

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

  const availableOptions = toFieldOptions(available);
  const metricOptions: ComboboxOption[] = [
    { value: "*", label: "Contagem de registros" },
    ...toFieldOptions(numericFields),
  ];
  const visualOptions: ComboboxOption[] = (
    Object.keys(VISUAL_TYPE_LABELS) as VisualType[]
  ).map((v) => ({ value: v, label: VISUAL_TYPE_LABELS[v] }));
  const transformOptions: ComboboxOption[] = (
    Object.keys(TRANSFORM_LABELS) as Transform[]
  ).map((t) => ({ value: t, label: TRANSFORM_LABELS[t] }));
  const aggOptions: ComboboxOption[] = (
    Object.keys(AGG_LABELS) as Aggregation[]
  ).map((a) => ({ value: a, label: AGG_LABELS[a] }));
  const presetOptions: ComboboxOption[] = [
    { value: "", label: "Todo o período" },
    ...(Object.keys(PERIOD_PRESETS) as PeriodPresetKey[]).map((k) => ({
      value: k,
      label: PERIOD_PRESETS[k],
    })),
  ];
  const dateFieldOptions: ComboboxOption[] = dateFields.map((f) => ({
    value: f.field,
    label: f.label,
  }));

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

    // Tabela editável: só a estrutura (matrix) vai em settings; sem dados de
    // registros. Os valores das células vivem em dashboard_table_cells.
    if (visualType === "tabela_editavel") {
      const input = {
        title: title.trim() || null,
        visual_type: visualType,
        sources: [],
        splitBySource: false,
        dimensions: [],
        metrics: [],
        filters: [],
        settings: {
          ...(widget?.settings ?? {}),
          matrix: {
            rows: matrixRows.filter((r) => r.label.trim()),
            cols: matrixCols.filter((c) => c.label.trim()),
            cellType: matrixCellType,
          },
        },
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
    // Preserva settings existentes (ex.: KPI meta/razão) e liga/desliga o modo
    // lista de registros (Fase 1) conforme o toggle.
    let settings = { ...(widget?.settings ?? {}) };
    if (isRecordList) {
      settings = {
        ...settings,
        rowMode: "records",
        columns: columns.filter((c) => c.field),
      };
    } else {
      delete settings.rowMode;
      delete settings.columns;
    }

    const input = {
      title: title.trim() || null,
      visual_type: visualType,
      sources,
      splitBySource,
      dimensions: dimensions.filter((d) => d.field),
      metrics: metrics.filter((m) => m.field),
      filters: cleanFilters,
      settings,
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
            Escolha as fontes, dimensões, métricas, filtros e o visual.
          </SheetDescription>
        </SheetHeader>

        <div className="flex flex-col gap-5 px-4 pb-6">
          <div className="flex flex-col gap-1.5">
            <Label>Título</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>Visual</Label>
            <Combobox
              options={visualOptions}
              value={visualType}
              onValueChange={(v) => setVisualType(v as VisualType)}
              aria-label="Visual"
            />
          </div>

          {/* Config do widget de filtro de período */}
          {visualType === "filtro" ? (
            <>
              <div className="flex flex-col gap-1.5">
                <Label>Campo de data</Label>
                <Combobox
                  options={dateFieldOptions}
                  value={filterField}
                  onValueChange={setFilterField}
                  aria-label="Campo de data"
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <Label>Período padrão</Label>
                <Combobox
                  options={presetOptions}
                  value={filterPreset}
                  onValueChange={setFilterPreset}
                  aria-label="Período padrão"
                />
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

          {/* Estrutura da Tabela editável */}
          {visualType === "tabela_editavel" ? (
            <>
              <div className="flex flex-col gap-1.5">
                <Label>Tipo de célula</Label>
                <Combobox
                  searchable={false}
                  options={[
                    { value: "numero", label: "Número" },
                    { value: "texto", label: "Texto" },
                  ]}
                  value={matrixCellType}
                  onValueChange={(v) =>
                    setMatrixCellType(v as "numero" | "texto")
                  }
                  aria-label="Tipo de célula"
                />
              </div>

              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <Label>Linhas</Label>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setMatrixRows([...matrixRows, newAxis()])}
                  >
                    <Plus className="size-4" /> Adicionar
                  </Button>
                </div>
                {matrixRows.map((r, i) => (
                  <div key={r.key} className="flex items-center gap-2">
                    <Input
                      className="flex-1"
                      value={r.label}
                      placeholder="Nome da linha"
                      onChange={(e) =>
                        setAxisLabel(setMatrixRows, i, e.target.value)
                      }
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() =>
                        setMatrixRows(matrixRows.filter((_, j) => j !== i))
                      }
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                ))}
              </div>

              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <Label>Colunas</Label>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setMatrixCols([...matrixCols, newAxis()])}
                  >
                    <Plus className="size-4" /> Adicionar
                  </Button>
                </div>
                {matrixCols.map((c, i) => (
                  <div key={c.key} className="flex items-center gap-2">
                    <Input
                      className="flex-1"
                      value={c.label}
                      placeholder="Nome da coluna"
                      onChange={(e) =>
                        setAxisLabel(setMatrixCols, i, e.target.value)
                      }
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() =>
                        setMatrixCols(matrixCols.filter((_, j) => j !== i))
                      }
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                ))}
              </div>
            </>
          ) : null}

          {/* Fontes + modo de combinação */}
          {visualType !== "filtro" && visualType !== "tabela_editavel" ? (
          <>
          <div className="flex flex-col gap-2">
            <Label>Fontes</Label>
            <p className="text-muted-foreground text-xs">
              Sem seleção = todas as fontes. Colunas correspondidas (↔) somam
              entre as fontes escolhidas.
            </p>
            <div className="flex flex-col gap-2 rounded-md border p-3">
              {SOURCE_KEYS.map((key) => (
                <label key={key} className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={sources.includes(key)}
                    onCheckedChange={() => toggleSource(key)}
                  />
                  {SOURCE_LABELS[key]}
                </label>
              ))}
            </div>
            <label className="mt-1 flex items-center gap-2 text-sm">
              <Checkbox
                checked={splitBySource}
                onCheckedChange={(v) => setSplitBySource(v === true)}
              />
              Quebrar por fonte (uma série por fonte)
            </label>
          </div>

          {/* Modo lista de registros (só para Tabela) */}
          {visualType === "tabela" ? (
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={recordsMode}
                onCheckedChange={(v) => setRecordsMode(v === true)}
              />
              Linhas = registros individuais (permite editar valores)
            </label>
          ) : null}

          {/* Criar coluna direto no editor (admins) */}
          {canManageFields ? (
            <div className="flex items-center justify-between rounded-md border border-dashed px-3 py-2">
              <span className="text-muted-foreground text-xs">
                Falta uma coluna? Crie sem sair do editor.
              </span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setFieldSheetOpen(true)}
              >
                <Plus className="size-4" /> Novo campo
              </Button>
            </div>
          ) : null}

          {!isRecordList ? (
          <>
          {/* Dimensões */}
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
                <Combobox
                  className="flex-1"
                  options={availableOptions}
                  value={d.field}
                  placeholder="— campo —"
                  onValueChange={(field) => {
                    const next = [...dimensions];
                    next[i] = { ...d, field };
                    setDimensions(next);
                  }}
                  aria-label="Campo da dimensão"
                />
                {isDate(d.field) ? (
                  <Combobox
                    className="w-32 shrink-0"
                    searchable={false}
                    options={transformOptions}
                    value={d.transform ?? "none"}
                    onValueChange={(t) => {
                      const next = [...dimensions];
                      next[i] = { ...d, transform: t as Transform };
                      setDimensions(next);
                    }}
                    aria-label="Transformação de data"
                  />
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
                <Combobox
                  className="flex-1"
                  options={metricOptions}
                  value={m.field}
                  onValueChange={(field) => {
                    const next = [...metrics];
                    next[i] = { ...m, field, agg: field === "*" ? "count" : m.agg };
                    setMetrics(next);
                  }}
                  aria-label="Campo da métrica"
                />
                <Combobox
                  className="w-28 shrink-0"
                  searchable={false}
                  options={aggOptions}
                  value={m.agg}
                  disabled={m.field === "*"}
                  onValueChange={(a) => {
                    const next = [...metrics];
                    next[i] = { ...m, agg: a as Aggregation };
                    setMetrics(next);
                  }}
                  aria-label="Agregação"
                />
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
          </>
          ) : null}

          {/* Colunas (modo lista de registros) */}
          {isRecordList ? (
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <Label>Colunas</Label>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setColumns([...columns, { field: "" }])}
                >
                  <Plus className="size-4" /> Adicionar
                </Button>
              </div>
              <p className="text-muted-foreground text-xs">
                Marque “editável” para gravar o valor no registro (só campos
                personalizados; respeita as permissões de cada campo).
              </p>
              {columns.map((c, i) => (
                <div key={i} className="flex items-center gap-2">
                  <Combobox
                    className="flex-1"
                    options={availableOptions}
                    value={c.field}
                    placeholder="— campo —"
                    onValueChange={(field) => setColumnField(i, field)}
                    aria-label="Campo da coluna"
                  />
                  <label className="flex items-center gap-1.5 text-xs whitespace-nowrap">
                    <Checkbox
                      checked={c.editable === true}
                      disabled={!c.field.startsWith("custom:")}
                      onCheckedChange={(v) => setColumnEditable(i, v === true)}
                    />
                    editável
                  </label>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => setColumns(columns.filter((_, j) => j !== i))}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              ))}
            </div>
          ) : null}

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
                <Combobox
                  className="flex-1"
                  options={availableOptions}
                  value={f.field}
                  placeholder="— campo —"
                  onValueChange={(field) => {
                    const next = [...filters];
                    next[i] = { ...f, field };
                    setFilters(next);
                  }}
                  aria-label="Campo do filtro"
                />
                <Combobox
                  className="w-28 shrink-0"
                  searchable={false}
                  options={FILTER_OP_OPTIONS}
                  value={f.op}
                  onValueChange={(op) => {
                    const next = [...filters];
                    next[i] = { ...f, op: op as FilterOp };
                    setFilters(next);
                  }}
                  aria-label="Operador do filtro"
                />
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

      {/* Criar campo sem sair do editor: reusa o FieldForm de /campos; ao salvar,
          router.refresh() recomputa `available` (novo campo entra nos seletores). */}
      {canManageFields ? (
        <Sheet open={fieldSheetOpen} onOpenChange={setFieldSheetOpen}>
          <SheetContent className="overflow-y-auto">
            <SheetHeader>
              <SheetTitle>Novo campo</SheetTitle>
              <SheetDescription>
                A coluna nasce disponível nos seletores (Exibir ligado). Atualizamos
                a lista automaticamente ao salvar.
              </SheetDescription>
            </SheetHeader>
            <div className="px-4 pb-4">
              <FieldForm
                key={fieldSheetOpen ? "open" : "closed"}
                numericRefs={fieldFormNumericRefs}
                onDone={() => {
                  setFieldSheetOpen(false);
                  router.refresh();
                }}
              />
            </div>
          </SheetContent>
        </Sheet>
      ) : null}
    </Sheet>
  );
}
