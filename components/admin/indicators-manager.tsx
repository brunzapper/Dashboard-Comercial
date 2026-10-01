// Versão: 1.0 | Data: 01/10/2026
// Catálogo de INDICADORES (0149) — Configurações → Metas.
//
// Um indicador explica uma chave de meta: unidade, regra de total entre meses,
// direção, tolerância de desvio, dono e a fórmula do REALIZADO. Definido aqui
// UMA vez, ele alimenta a Tabela de metas e os nós de indicador da Tree.
//
// O editor do realizado é o MESMO `FormulaEditor` agregado do construtor e da
// Remuneração, com o MESMO catálogo (`buildAggOperandCatalog` +
// `availableAggCatalogInput`, metas e Base manual inclusas) que o servidor usa
// para validar (lib/indicators/validate.ts) — o save nunca recusa o que o
// editor aceitou.
"use client";

import { useMemo, useState, useTransition } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { FilterRow } from "@/components/dashboards/widget-builder-rows";
import { FormulaEditor } from "@/components/formula/formula-editor";
import { SourcePicker } from "@/components/configuracoes/remuneracao/plan-editor";
import { useSourceLabels } from "@/components/source-labels-context";
import { notifyActionError } from "@/lib/feedback/notify";
import {
  INDICATOR_DIRECTION_LABELS,
  INDICATOR_ROLLUP_LABELS,
  INDICATOR_UNIT_LABELS,
  MAX_INDICATOR_FILTERS,
  type IndicatorDef,
} from "@/lib/indicators/model";
import { goalMetricKeyFromLabel, type GoalMetricDef } from "@/lib/metas/metrics";
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
  cleanFilters,
  decorateRefOptions,
  FILTER_OPS,
  sourceChips,
  toFieldOptions,
} from "@/lib/widgets/filter-ops";
import type { WidgetFilter } from "@/lib/widgets/types";
import {
  deleteIndicator,
  saveIndicator,
} from "@/app/(app)/configuracoes/metas/indicator-actions";

const FILTER_OP_OPTIONS: ComboboxOption[] = FILTER_OPS.map((o) => ({
  value: o.op,
  label: o.label,
}));
const UNIT_OPTIONS = Object.entries(INDICATOR_UNIT_LABELS).map(([value, label]) => ({ value, label }));
const ROLLUP_OPTIONS = Object.entries(INDICATOR_ROLLUP_LABELS).map(([value, label]) => ({ value, label }));
const DIRECTION_OPTIONS = Object.entries(INDICATOR_DIRECTION_LABELS).map(([value, label]) => ({ value, label }));
const NO_OWNER = "__none__";

export interface IndicatorsCatalogProps {
  available: AvailableField[];
  allFields: FieldDefinition[];
  sources: SourceDef[];
  metrics: GoalMetricDef[];
  manualSeries: ManualSeries[];
  manualAxes: ManualAxisCatalog;
}

interface Draft {
  id: string | null;
  key: string;
  keyTouched: boolean;
  label: string;
  description: string;
  unit: string;
  rollup: string;
  direction: string;
  tolerancePct: string;
  ownerResponsibleId: string;
  withRealized: boolean;
  formula: Formula | null;
  sources: string[];
  filters: WidgetFilter[];
  sortOrder: number;
}

function draftOf(def: IndicatorDef | null, nextOrder: number): Draft {
  return {
    id: def?.id ?? null,
    key: def?.key ?? "",
    keyTouched: Boolean(def),
    label: def?.label ?? "",
    description: def?.description ?? "",
    unit: def?.unit ?? "quantidade",
    rollup: def?.rollup ?? "soma",
    direction: def?.direction ?? "maior_melhor",
    tolerancePct: String(def?.tolerancePct ?? 5),
    ownerResponsibleId: def?.ownerResponsibleId ?? "",
    withRealized: Boolean(def?.realized),
    formula: def?.realized?.formula ?? null,
    sources: def?.realized?.sources ?? [],
    filters: def?.realized?.filters ?? [],
    sortOrder: def?.sortOrder ?? nextOrder,
  };
}

export function IndicatorsManager({
  indicators,
  responsibles,
  catalog,
}: {
  indicators: IndicatorDef[];
  responsibles: { id: string; label: string }[];
  catalog: IndicatorsCatalogProps;
}) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [toDelete, setToDelete] = useState<IndicatorDef | null>(null);
  const [pending, startTransition] = useTransition();
  const ownerName = useMemo(
    () => new Map(responsibles.map((r) => [r.id, r.label])),
    [responsibles]
  );

  const nextOrder = indicators.reduce((m, d) => Math.max(m, d.sortOrder), 0) + 10;

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Indicadores</h2>
          <p className="text-muted-foreground text-sm">
            O que cada meta mede e como se calcula o realizado. A chave do
            indicador é a chave da meta: defina uma vez e use na Tabela de metas,
            na Tree e em fórmulas (<code>[meta:chave]</code>).
          </p>
        </div>
        <Button size="sm" onClick={() => setDraft(draftOf(null, nextOrder))}>
          <Plus className="size-4" /> Novo indicador
        </Button>
      </div>
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Indicador</TableHead>
              <TableHead>Chave</TableHead>
              <TableHead>Unidade</TableHead>
              <TableHead>Total</TableHead>
              <TableHead>Dono</TableHead>
              <TableHead>Realizado</TableHead>
              <TableHead className="w-20" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {indicators.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="text-muted-foreground text-sm">
                  Nenhum indicador ainda. Crie um ou aplique um preset de metas.
                </TableCell>
              </TableRow>
            ) : (
              indicators.map((d) => (
                <TableRow key={d.key}>
                  <TableCell className="font-medium">{d.label}</TableCell>
                  <TableCell>
                    <code className="text-xs">{d.key}</code>
                  </TableCell>
                  <TableCell>{INDICATOR_UNIT_LABELS[d.unit]}</TableCell>
                  <TableCell>{INDICATOR_ROLLUP_LABELS[d.rollup]}</TableCell>
                  <TableCell>
                    {d.ownerResponsibleId ? ownerName.get(d.ownerResponsibleId) ?? "—" : "—"}
                  </TableCell>
                  <TableCell>
                    {d.realized ? (
                      <Badge variant="secondary">Calculado</Badge>
                    ) : (
                      <Badge variant="outline">Só meta</Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-1">
                      <Button
                        size="icon"
                        variant="ghost"
                        aria-label={`Editar ${d.label}`}
                        onClick={() => setDraft(draftOf(d, nextOrder))}
                      >
                        <Pencil className="size-4" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        aria-label={`Excluir ${d.label}`}
                        onClick={() => setToDelete(d)}
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {draft ? (
        <IndicatorSheet
          draft={draft}
          setDraft={setDraft}
          responsibles={responsibles}
          catalog={catalog}
        />
      ) : null}

      <ConfirmDialog
        open={toDelete != null}
        onOpenChange={(o) => {
          if (!o) setToDelete(null);
        }}
        title="Excluir indicador?"
        description="As metas com esta chave continuam valendo; só a definição (unidade, dono e realizado) é removida."
        actionLabel="Excluir"
        pending={pending}
        onConfirm={() => {
          const target = toDelete;
          if (!target?.id) return;
          startTransition(async () => {
            const res = await deleteIndicator(target.id!);
            if (!res.ok) notifyActionError("Não foi possível excluir o indicador.", res.message);
            setToDelete(null);
          });
        }}
      />
    </section>
  );
}

function IndicatorSheet({
  draft,
  setDraft,
  responsibles,
  catalog,
}: {
  draft: Draft;
  setDraft: (d: Draft | null) => void;
  responsibles: { id: string; label: string }[];
  catalog: IndicatorsCatalogProps;
}) {
  const sourceLabels = useSourceLabels();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const patch = (p: Partial<Draft>) => setDraft({ ...draft, ...p });

  const aggCatalog: RefOption[] = useMemo(
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
  const filterFieldOptions = useMemo(
    () =>
      toFieldOptions(
        catalog.available.filter(
          (a) => !a.displayOnly && !a.aggCalc && a.field !== "operation_id"
        ),
        sourceLabels
      ),
    [catalog.available, sourceLabels]
  );
  const ownerOptions: ComboboxOption[] = useMemo(
    () => [
      { value: NO_OWNER, label: "Sem dono" },
      ...responsibles.map((r) => ({ value: r.id, label: r.label })),
    ],
    [responsibles]
  );

  const submit = () => {
    setError(null);
    const formulaOk = draft.formula && draft.formula.tokens.length > 0;
    if (draft.withRealized && !formulaOk) {
      setError("Informe a fórmula do realizado ou desmarque “Calcular realizado”.");
      return;
    }
    startTransition(async () => {
      const res = await saveIndicator(draft.id, {
        key: draft.key,
        label: draft.label,
        description: draft.description,
        unit: draft.unit,
        rollup: draft.rollup,
        direction: draft.direction,
        tolerancePct: Number(draft.tolerancePct.replace(",", ".")),
        ownerResponsibleId: draft.ownerResponsibleId || null,
        sortOrder: draft.sortOrder,
        realized: draft.withRealized
          ? {
              v: 1,
              formula: draft.formula,
              sources: draft.sources,
              filters: cleanFilters(draft.filters),
            }
          : null,
      });
      if (!res.ok) {
        setError(res.message ?? "Não foi possível salvar.");
        return;
      }
      setDraft(null);
    });
  };

  return (
    <Sheet open onOpenChange={(o) => (o ? null : setDraft(null))}>
      <SheetContent className="flex flex-col gap-4 overflow-y-auto sm:max-w-2xl">
        <SheetHeader>
          <SheetTitle>{draft.id ? "Editar indicador" : "Novo indicador"}</SheetTitle>
          <SheetDescription>
            A meta mensal vem das Metas (mesma chave); aqui você define o que o
            número significa e como o realizado é calculado.
          </SheetDescription>
        </SheetHeader>
        <div className="flex flex-col gap-4 px-4 pb-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ind-label">Nome</Label>
              <Input
                id="ind-label"
                value={draft.label}
                onChange={(e) =>
                  patch({
                    label: e.target.value,
                    ...(draft.keyTouched
                      ? {}
                      : { key: goalMetricKeyFromLabel(e.target.value) }),
                  })
                }
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ind-key">Chave</Label>
              <Input
                id="ind-key"
                value={draft.key}
                disabled={draft.id != null}
                onChange={(e) => patch({ key: e.target.value, keyTouched: true })}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Unidade</Label>
              <Combobox
                options={UNIT_OPTIONS}
                value={draft.unit}
                onValueChange={(v) => patch({ unit: v })}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Total entre meses</Label>
              <Combobox
                options={ROLLUP_OPTIONS}
                value={draft.rollup}
                onValueChange={(v) => patch({ rollup: v })}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Direção</Label>
              <Combobox
                options={DIRECTION_OPTIONS}
                value={draft.direction}
                onValueChange={(v) => patch({ direction: v })}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ind-tol">Tolerância de desvio (%)</Label>
              <Input
                id="ind-tol"
                inputMode="decimal"
                value={draft.tolerancePct}
                onChange={(e) => patch({ tolerancePct: e.target.value })}
              />
            </div>
            <div className="flex flex-col gap-1.5 sm:col-span-2">
              <Label>Dono</Label>
              <Combobox
                options={ownerOptions}
                value={draft.ownerResponsibleId || NO_OWNER}
                onValueChange={(v) => patch({ ownerResponsibleId: v === NO_OWNER ? "" : v })}
              />
            </div>
            <div className="flex flex-col gap-1.5 sm:col-span-2">
              <Label htmlFor="ind-desc">Descrição / regra de cálculo</Label>
              <Textarea
                id="ind-desc"
                rows={2}
                value={draft.description}
                onChange={(e) => patch({ description: e.target.value })}
              />
            </div>
          </div>

          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={draft.withRealized}
              onCheckedChange={(v) => patch({ withRealized: v === true })}
            />
            Calcular realizado (sem isso o indicador é só meta/premissa)
          </label>

          {draft.withRealized ? (
            <div className="flex flex-col gap-3 rounded-md border p-3">
              <div className="flex flex-col gap-1.5">
                <Label>Bases</Label>
                <SourcePicker
                  sources={catalog.sources}
                  value={draft.sources}
                  onChange={(v) => patch({ sources: v })}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>Fórmula do realizado</Label>
                <FormulaEditor
                  context="aggregate"
                  catalog={aggCatalog}
                  chips={sourceChips(sourceLabels)}
                  sources={catalog.sources}
                  initial={draft.formula}
                  onChange={(f) => patch({ formula: f })}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>Condições do recorte</Label>
                {draft.filters.length > 0 ? (
                  <div className="grid gap-2 sm:grid-cols-2">
                    {draft.filters.map((flt, fi) => (
                      <FilterRow
                        key={fi}
                        filter={flt}
                        fieldOptions={filterFieldOptions}
                        fieldChips={sourceChips(sourceLabels)}
                        opOptions={FILTER_OP_OPTIONS}
                        valueSource={null}
                        onChange={(p) =>
                          patch({
                            filters: draft.filters.map((x, xi) =>
                              xi === fi ? { ...x, ...p } : x
                            ),
                          })
                        }
                        onRemove={() =>
                          patch({ filters: draft.filters.filter((_, xi) => xi !== fi) })
                        }
                      />
                    ))}
                  </div>
                ) : null}
                <div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={draft.filters.length >= MAX_INDICATOR_FILTERS}
                    onClick={() =>
                      patch({ filters: [...draft.filters, { field: "", op: "eq", value: "" }] })
                    }
                  >
                    <Plus className="size-4" /> Adicionar condição
                  </Button>
                </div>
              </div>
            </div>
          ) : null}

          {error ? <p className="text-destructive text-sm">{error}</p> : null}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setDraft(null)} disabled={pending}>
              Cancelar
            </Button>
            <Button onClick={submit} disabled={pending}>
              {pending ? "Salvando…" : "Salvar"}
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
