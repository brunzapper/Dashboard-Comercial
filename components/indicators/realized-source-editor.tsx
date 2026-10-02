// Versão: 1.0 | Data: 02/10/2026
// v1.0 (02/10/2026): EDITOR DA FONTE DO REALIZADO — compartilhado pelo
//   catálogo de Indicadores (Configurações → Metas), pelo editor do nó de
//   indicador da Tree e pelo painel de linha de meta da Tabela Livre. Antes o
//   editor vivia só no catálogo e o card da Tree mostrava um realizado cuja
//   origem nenhuma tela explicava.
//
//   * `RealizedFormulaFields` — bases + fórmula AGREGADA (o MESMO
//     `FormulaEditor`/catálogo do construtor: `buildAggOperandCatalog` +
//     `availableAggCatalogInput`, metas e Base manual inclusas) + condições do
//     recorte. É o bloco que o catálogo de indicadores já tinha, extraído sem
//     mudar o comportamento.
//   * `RealizedSourceEditor` — a escolha "fórmula do indicador × métrica
//     própria", recortes extras com "mostrar no card" e a quebra por dimensão.
//     Grava `RealizedSource` (lib/indicators/realized-source.ts); o servidor
//     valida pela mesma régua (lib/indicators/validate.ts).
"use client";

import { useMemo } from "react";
import { Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import { Label } from "@/components/ui/label";
import { FilterRow } from "@/components/dashboards/widget-builder-rows";
import { FormulaEditor } from "@/components/formula/formula-editor";
import { SourcePicker } from "@/components/configuracoes/remuneracao/plan-editor";
import { useSourceLabels } from "@/components/source-labels-context";
import { MAX_INDICATOR_FILTERS } from "@/lib/indicators/model";
import {
  DEFAULT_BREAKDOWN_LIMIT,
  MAX_BREAKDOWN_LIMIT,
  type RealizedFilter,
  type RealizedSource,
} from "@/lib/indicators/realized-source";
import type { GoalMetricDef } from "@/lib/metas/metrics";
import type { ManualAxisCatalog } from "@/lib/manual-base/families";
import type { ManualSeries } from "@/lib/manual-base/types";
import type { RefOption } from "@/lib/records/date-operands";
import type { Formula } from "@/lib/records/formulas";
import type { FieldDefinition } from "@/lib/records/types";
import type { SourceDef } from "@/lib/sources";
import {
  availableAggCatalogInput,
  buildAggOperandCatalog,
} from "@/lib/widgets/agg-catalog";
import type { AvailableField } from "@/lib/widgets/fields";
import {
  decorateRefOptions,
  FILTER_OPS,
  sourceChips,
  toFieldOptions,
} from "@/lib/widgets/filter-ops";
import { TRANSFORM_LABELS, type Transform, type WidgetFilter } from "@/lib/widgets/types";

/** O catálogo que os editores de fórmula agregada precisam (um só shape). */
export interface RealizedCatalog {
  available: AvailableField[];
  allFields: FieldDefinition[];
  sources: SourceDef[];
  metrics: GoalMetricDef[];
  manualSeries: ManualSeries[];
  manualAxes: ManualAxisCatalog;
}

const FILTER_OP_OPTIONS: ComboboxOption[] = FILTER_OPS.map((o) => ({
  value: o.op,
  label: o.label,
}));

/** Operandos do editor — a MESMA montagem do construtor e do servidor. */
export function useRealizedRefs(catalog: RealizedCatalog): RefOption[] {
  const sourceLabels = useSourceLabels();
  return useMemo(
    () =>
      decorateRefOptions(
        buildAggOperandCatalog(
          availableAggCatalogInput(
            catalog.available,
            catalog.allFields,
            catalog.sources,
            catalog.metrics,
            catalog.manualSeries,
            catalog.manualAxes,
            { withNested: true }
          )
        ),
        catalog.available,
        sourceLabels
      ),
    [catalog, sourceLabels]
  );
}

function useFilterFieldOptions(catalog: RealizedCatalog): ComboboxOption[] {
  const sourceLabels = useSourceLabels();
  return useMemo(
    () =>
      toFieldOptions(
        catalog.available.filter(
          (a) => !a.displayOnly && !a.aggCalc && a.field !== "operation_id"
        ),
        sourceLabels
      ),
    [catalog.available, sourceLabels]
  );
}

/** Lista de condições; `exposable` liga o "mostrar no card" de cada uma. */
function FilterList({
  filters,
  onChange,
  fieldOptions,
  exposable,
  addLabel,
}: {
  filters: RealizedFilter[];
  onChange: (f: RealizedFilter[]) => void;
  fieldOptions: ComboboxOption[];
  exposable: boolean;
  addLabel: string;
}) {
  const sourceLabels = useSourceLabels();
  return (
    <div className="flex flex-col gap-2">
      {filters.length > 0 ? (
        <div className="grid gap-2 sm:grid-cols-2">
          {filters.map((flt, fi) => (
            <div key={fi} className="flex flex-col gap-1">
              <FilterRow
                filter={flt}
                fieldOptions={fieldOptions}
                fieldChips={sourceChips(sourceLabels)}
                opOptions={FILTER_OP_OPTIONS}
                valueSource={null}
                onChange={(p) =>
                  onChange(filters.map((x, xi) => (xi === fi ? { ...x, ...p } : x)))
                }
                onRemove={() => onChange(filters.filter((_, xi) => xi !== fi))}
              />
              {exposable ? (
                <label className="flex items-center gap-2 text-xs">
                  <Checkbox
                    checked={flt.exposed === true}
                    onCheckedChange={(v) =>
                      onChange(
                        filters.map((x, xi) =>
                          xi === fi ? { ...x, exposed: v === true ? true : undefined } : x
                        )
                      )
                    }
                  />
                  Mostrar este recorte no card
                </label>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
      <div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={filters.length >= MAX_INDICATOR_FILTERS}
          onClick={() => onChange([...filters, { field: "", op: "eq", value: "" }])}
        >
          <Plus className="size-4" /> {addLabel}
        </Button>
      </div>
    </div>
  );
}

/** Bases + fórmula + condições — o bloco do realizado de um indicador. */
export function RealizedFormulaFields({
  catalog,
  sources,
  onSources,
  formula,
  onFormula,
  filters,
  onFilters,
  formulaLabel = "Fórmula do realizado",
}: {
  catalog: RealizedCatalog;
  sources: string[];
  onSources: (v: string[]) => void;
  formula: Formula | null;
  onFormula: (f: Formula | null) => void;
  filters: WidgetFilter[];
  onFilters: (f: WidgetFilter[]) => void;
  formulaLabel?: string;
}) {
  const sourceLabels = useSourceLabels();
  const refs = useRealizedRefs(catalog);
  const fieldOptions = useFilterFieldOptions(catalog);
  return (
    <div className="flex flex-col gap-3 rounded-md border p-3">
      <div className="flex flex-col gap-1.5">
        <Label>Bases</Label>
        <SourcePicker sources={catalog.sources} value={sources} onChange={onSources} />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label>{formulaLabel}</Label>
        <FormulaEditor
          context="aggregate"
          catalog={refs}
          chips={sourceChips(sourceLabels)}
          sources={catalog.sources}
          initial={formula}
          onChange={(f) => onFormula(f)}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label>Condições do recorte</Label>
        <FilterList
          filters={filters}
          onChange={onFilters}
          fieldOptions={fieldOptions}
          exposable={false}
          addLabel="Adicionar condição"
        />
      </div>
    </div>
  );
}

const NONE = "__none__";

/**
 * A fonte do realizado de um nó/linha. `indicatorLabel`/`indicatorFormula`
 * explicam o padrão (o que se usa sem configurar nada).
 */
export function RealizedSourceEditor({
  catalog,
  value,
  onChange,
  indicatorLabel,
  indicatorFormula,
}: {
  catalog: RealizedCatalog;
  value: RealizedSource | null | undefined;
  onChange: (v: RealizedSource | null) => void;
  indicatorLabel?: string | null;
  /** Texto da fórmula do catálogo (null = o indicador não calcula realizado). */
  indicatorFormula?: string | null;
}) {
  const fieldOptions = useFilterFieldOptions(catalog);
  const rs: RealizedSource = value ?? { v: 1 };
  const own = rs.override != null;
  const set = (patch: Partial<RealizedSource>) => {
    const next: RealizedSource = { ...rs, ...patch };
    for (const k of ["override", "filters", "breakdown"] as const) {
      if (next[k] === undefined || (Array.isArray(next[k]) && (next[k] as unknown[]).length === 0))
        delete next[k];
    }
    onChange(next.override || next.filters || next.breakdown ? next : null);
  };
  const breakdownOptions: ComboboxOption[] = useMemo(
    () => [{ value: NONE, label: "Sem quebra" }, ...fieldOptions],
    [fieldOptions]
  );
  const breakdownIsDate =
    rs.breakdown != null &&
    (catalog.available.find((a) => a.field === rs.breakdown!.field)?.isDate ?? false);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-2" role="radiogroup" aria-label="Origem do realizado">
        <label className="flex items-start gap-2 text-sm">
          <input
            type="radio"
            className="mt-1"
            checked={!own}
            onChange={() => set({ override: undefined })}
          />
          <span>
            <span className="font-medium">Fórmula do indicador</span>
            <span className="text-muted-foreground block text-xs">
              {indicatorFormula
                ? `${indicatorLabel ?? "Indicador"}: ${indicatorFormula} — editável em Configurações → Metas → Indicadores.`
                : indicatorLabel
                  ? `${indicatorLabel} não calcula realizado (só meta). Defina a fórmula em Configurações → Metas → Indicadores ou use uma métrica própria.`
                  : "Escolha um indicador acima, ou use uma métrica própria."}
            </span>
          </span>
        </label>
        <label className="flex items-start gap-2 text-sm">
          <input
            type="radio"
            className="mt-1"
            checked={own}
            onChange={() =>
              set({ override: rs.override ?? { formula: { tokens: [] }, sources: [] } })
            }
          />
          <span>
            <span className="font-medium">Métrica própria</span>
            <span className="text-muted-foreground block text-xs">
              Qualquer métrica calculada sobre os registros (as mesmas operações
              do construtor de widgets) — atualiza sozinha com os dados.
            </span>
          </span>
        </label>
      </div>

      {own && rs.override ? (
        <RealizedFormulaFields
          catalog={catalog}
          sources={rs.override.sources}
          onSources={(v) => set({ override: { ...rs.override!, sources: v } })}
          formula={rs.override.formula.tokens.length > 0 ? rs.override.formula : null}
          onFormula={(f) =>
            set({ override: { ...rs.override!, formula: f ?? { tokens: [] } } })
          }
          filters={[]}
          onFilters={() => {}}
          formulaLabel="Métrica do realizado"
        />
      ) : null}

      <div className="flex flex-col gap-1.5">
        <Label>Recorte por dimensão</Label>
        <p className="text-muted-foreground text-xs">
          Somam-se ao recorte da fórmula (E). Marque “mostrar no card” para o
          recorte aparecer como etiqueta (ex.: Responsável: Gabriella Salles).
        </p>
        <FilterList
          filters={rs.filters ?? []}
          onChange={(f) => set({ filters: f.length ? f : undefined })}
          fieldOptions={fieldOptions}
          exposable
          addLabel="Adicionar recorte"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label>Quebra por dimensão</Label>
        <p className="text-muted-foreground text-xs">
          Abre o realizado em sub-linhas (ex.: por vendedor, por fonte).
        </p>
        <div className="grid gap-2 sm:grid-cols-2">
          <Combobox
            options={breakdownOptions}
            value={rs.breakdown?.field ?? NONE}
            onValueChange={(v) =>
              set({
                breakdown:
                  v === NONE
                    ? undefined
                    : { field: v, display: rs.breakdown?.display ?? "exposto" },
              })
            }
            aria-label="Dimensão da quebra"
          />
          {rs.breakdown ? (
            <select
              className="border-input h-9 rounded-md border bg-transparent px-2 text-sm"
              value={rs.breakdown.display}
              onChange={(e) =>
                set({
                  breakdown: {
                    ...rs.breakdown!,
                    display: e.target.value === "recolhido" ? "recolhido" : "exposto",
                  },
                })
              }
              aria-label="Exibição da quebra"
            >
              <option value="exposto">Aberta no card</option>
              <option value="recolhido">Recolhida (abre ao clicar)</option>
            </select>
          ) : null}
          {rs.breakdown && breakdownIsDate ? (
            <select
              className="border-input h-9 rounded-md border bg-transparent px-2 text-sm"
              value={rs.breakdown.transform ?? "none"}
              onChange={(e) =>
                set({
                  breakdown: {
                    ...rs.breakdown!,
                    transform:
                      e.target.value === "none" ? undefined : (e.target.value as Transform),
                  },
                })
              }
              aria-label="Formato da data na quebra"
            >
              {Object.entries(TRANSFORM_LABELS).map(([k, label]) => (
                <option key={k} value={k}>
                  {label}
                </option>
              ))}
            </select>
          ) : null}
          {rs.breakdown ? (
            <label className="flex items-center gap-2 text-xs">
              Até
              <input
                type="number"
                min={1}
                max={MAX_BREAKDOWN_LIMIT}
                className="border-input h-8 w-16 rounded-md border bg-transparent px-2"
                value={rs.breakdown.limit ?? DEFAULT_BREAKDOWN_LIMIT}
                onChange={(e) => {
                  const n = Number(e.target.value);
                  set({
                    breakdown: {
                      ...rs.breakdown!,
                      limit:
                        Number.isInteger(n) && n >= 1 && n <= MAX_BREAKDOWN_LIMIT
                          ? n
                          : undefined,
                    },
                  });
                }}
              />
              valores (o resto vira “Outros”)
            </label>
          ) : null}
        </div>
      </div>
    </div>
  );
}
