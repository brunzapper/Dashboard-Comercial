// Versão: 1.0 | Data: 30/07/2026
// Editor do plano de remuneração (0112): nome/ativo/base default/membros e a
// tabela de FATORES (rótulo, peso %, fontes, métrica de meta, cap/floor,
// fórmula do realizado via FormulaEditor contexto "aggregate" — o MESMO
// catálogo/validação do widget-builder). Seção avançada: fórmula LIVRE do
// total (contexto "record" sobre o catálogo comp:* derivado do rascunho —
// operandos aparecem/somem em sincronia com os fatores). Ids de fator são
// ESTÁVEIS (chave de overrides/alvos) — editar nunca os regenera.
"use client";

import { useMemo, useState, useTransition } from "react";
import { Plus, Trash2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { FormulaEditor } from "@/components/formula/formula-editor";
import { useSourceLabels } from "@/components/source-labels-context";
import { notifyActionError } from "@/lib/feedback/notify";
import type { GoalMetricDef } from "@/lib/metas/metrics";
import type { Formula } from "@/lib/records/formulas";
import type { FieldDefinition } from "@/lib/records/types";
import type { RefOption } from "@/lib/records/date-operands";
import type { SourceDef } from "@/lib/sources";
import {
  availableAggCatalogInput,
  buildAggOperandCatalog,
} from "@/lib/widgets/agg-catalog";
import type { AvailableField } from "@/lib/widgets/fields";
import { decorateRefOptions } from "@/lib/widgets/filter-ops";
import {
  compOperandCatalog,
  MAX_FACTORS,
  type CompPlanConfig,
} from "@/lib/comp/model";
import {
  deletePlan,
  savePlan,
} from "@/app/(app)/configuracoes/remuneracao/actions";
import { previewAggregateFormula } from "@/app/(app)/dashboards/formula-preview-actions";
import type { CompPlanClientRow } from "./remuneracao-manager";

// Sentinela do select de métrica: o savePlan gera a chave automática.
const AUTO_METRIC = "__auto__";

interface FactorDraft {
  id: string;
  label: string;
  weightPct: string; // texto do input; parse no save
  metricKey: string;
  money: boolean;
  formula: Formula;
  sources: string[];
  capPct: string;
  floorPct: string;
}

function newFactorId(): string {
  return `f_${Math.random().toString(36).slice(2, 10)}`;
}

function emptyFactor(): FactorDraft {
  return {
    id: newFactorId(),
    label: "",
    weightPct: "",
    metricKey: AUTO_METRIC,
    money: true,
    formula: { tokens: [] },
    sources: [],
    capPct: "",
    floorPct: "",
  };
}

function draftsFromConfig(config: CompPlanConfig | null): FactorDraft[] {
  if (!config || config.factors.length === 0) return [emptyFactor()];
  return config.factors.map((f) => ({
    id: f.id,
    label: f.label,
    weightPct: String(f.weightPct),
    metricKey: f.metricKey,
    money: f.money,
    formula: f.formula,
    sources: f.sources,
    capPct: f.capPct != null ? String(f.capPct) : "",
    floorPct: f.floorPct != null ? String(f.floorPct) : "",
  }));
}

const numOrNull = (s: string): number | null => {
  const v = s.trim() === "" ? NaN : Number(s.replace(",", "."));
  return Number.isFinite(v) ? v : null;
};

export interface PlanEditorProps {
  plan: CompPlanClientRow | null; // null = novo plano
  config: CompPlanConfig | null;
  metrics: GoalMetricDef[];
  responsibles: { id: string; label: string }[];
  available: AvailableField[];
  allFields: FieldDefinition[];
  sources: SourceDef[];
  onSaved: (planId: string) => void;
  onDeleted: () => void;
}

export function PlanEditor(props: PlanEditorProps) {
  const sourceLabels = useSourceLabels();
  const [pending, startTransition] = useTransition();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [name, setName] = useState(props.plan?.name ?? "");
  const [active, setActive] = useState(props.plan?.active ?? true);
  const [baseDefault, setBaseDefault] = useState(
    props.plan?.base_amount_default != null
      ? String(props.plan.base_amount_default)
      : ""
  );
  const [memberIds, setMemberIds] = useState<string[]>(
    props.config?.memberIds ?? []
  );
  const [factors, setFactors] = useState<FactorDraft[]>(
    draftsFromConfig(props.config)
  );
  const [useTotalFormula, setUseTotalFormula] = useState(
    Boolean(props.config?.totalFormula)
  );
  const [totalFormula, setTotalFormula] = useState<Formula | null>(
    props.config?.totalFormula ?? null
  );

  // Catálogo agregado (realizado) — mesma montagem do widget-builder.
  const aggCatalog: RefOption[] = useMemo(
    () =>
      decorateRefOptions(
        buildAggOperandCatalog(
          availableAggCatalogInput(props.available, props.allFields, props.sources, {
            withNested: true,
          })
        ),
        props.available,
        sourceLabels
      ),
    [props.available, props.allFields, props.sources, sourceLabels]
  );

  // Catálogo comp:* da fórmula do total — derivado do RASCUNHO (sincronia:
  // renomear/excluir fator atualiza os operandos na hora).
  const compCatalog: RefOption[] = useMemo(() => {
    const draftConfig: CompPlanConfig = {
      v: 1,
      factors: factors
        .filter((f) => f.label.trim() !== "")
        .map((f) => ({
          id: f.id,
          label: f.label.trim(),
          weightPct: numOrNull(f.weightPct) ?? 0,
          metricKey: f.metricKey || AUTO_METRIC,
          money: f.money,
          formula: f.formula,
          sources: f.sources,
        })),
    };
    return compOperandCatalog(draftConfig);
  }, [factors]);

  const weightSum = factors.reduce(
    (acc, f) => acc + (numOrNull(f.weightPct) ?? 0),
    0
  );

  const metricOptions: ComboboxOption[] = [
    { value: AUTO_METRIC, label: "(criar métrica automática)" },
    ...props.metrics.map((m) => ({
      value: m.key,
      label: `${m.label} (${m.key})`,
    })),
  ];

  const patchFactor = (id: string, patch: Partial<FactorDraft>) =>
    setFactors((cur) => cur.map((f) => (f.id === id ? { ...f, ...patch } : f)));

  const save = () =>
    startTransition(async () => {
      const config = {
        v: 1,
        factors: factors.map((f) => ({
          id: f.id,
          label: f.label.trim(),
          weightPct: numOrNull(f.weightPct) ?? -1,
          metricKey: f.metricKey || AUTO_METRIC,
          money: f.money,
          formula: f.formula,
          sources: f.sources,
          ...(numOrNull(f.capPct) != null ? { capPct: numOrNull(f.capPct) } : {}),
          ...(numOrNull(f.floorPct) != null
            ? { floorPct: numOrNull(f.floorPct) }
            : {}),
        })),
        ...(memberIds.length > 0 ? { memberIds } : {}),
        ...(useTotalFormula && totalFormula && totalFormula.tokens.length > 0
          ? { totalFormula }
          : {}),
      };
      const res = await savePlan({
        planId: props.plan?.id ?? null,
        name,
        active,
        baseAmountDefault: numOrNull(baseDefault),
        config,
      });
      if (!res.ok) {
        notifyActionError("Salvar plano", res.message);
        return;
      }
      if (res.planId) props.onSaved(res.planId);
    });

  return (
    <div className="flex flex-col gap-6">
      {/* Identidade do plano */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="comp-plan-name">Nome do plano</Label>
          <Input
            id="comp-plan-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Ex.: Comercial 2026"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="comp-plan-base">Base variável padrão (R$)</Label>
          <Input
            id="comp-plan-base"
            inputMode="decimal"
            value={baseDefault}
            onChange={(e) => setBaseDefault(e.target.value)}
            placeholder="Ex.: 2000"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>Membros</Label>
          <MemberPicker
            responsibles={props.responsibles}
            value={memberIds}
            onChange={setMemberIds}
          />
        </div>
        <label className="flex items-center gap-2 pt-6 text-sm">
          <Checkbox
            checked={active}
            onCheckedChange={(v) => setActive(v === true)}
          />
          Plano ativo
        </label>
      </div>

      {/* Fatores */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-medium">Fatores</h2>
          <Badge variant={Math.round(weightSum) === 100 ? "secondary" : "outline"}>
            Σ pesos: {weightSum.toLocaleString("pt-BR")}%
          </Badge>
          {Math.round(weightSum) !== 100 ? (
            <span className="text-xs text-amber-600">
              Os pesos não somam 100% — a conta usa os pesos literais.
            </span>
          ) : null}
        </div>
        {factors.map((f, idx) => (
          <div key={f.id} className="bg-card flex flex-col gap-3 rounded-md border p-3">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
              <div className="flex flex-col gap-1.5 lg:col-span-2">
                <Label>Nome do fator</Label>
                <Input
                  value={f.label}
                  onChange={(e) => patchFactor(f.id, { label: e.target.value })}
                  placeholder={`Ex.: Vendas`}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>Peso (%)</Label>
                <Input
                  inputMode="decimal"
                  value={f.weightPct}
                  onChange={(e) => patchFactor(f.id, { weightPct: e.target.value })}
                  placeholder="Ex.: 60"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>Fontes</Label>
                <SourcePicker
                  sources={props.sources}
                  value={f.sources}
                  onChange={(v) => patchFactor(f.id, { sources: v })}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>Teto ating. (%)</Label>
                <Input
                  inputMode="decimal"
                  value={f.capPct}
                  onChange={(e) => patchFactor(f.id, { capPct: e.target.value })}
                  placeholder="Ex.: 120"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>Piso ating. (%)</Label>
                <Input
                  inputMode="decimal"
                  value={f.floorPct}
                  onChange={(e) => patchFactor(f.id, { floorPct: e.target.value })}
                  placeholder="Ex.: 0"
                />
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <Label>Métrica de meta (alvos)</Label>
                <Combobox
                  options={metricOptions}
                  value={f.metricKey}
                  onValueChange={(v) =>
                    patchFactor(f.id, { metricKey: v || AUTO_METRIC })
                  }
                />
                <p className="text-muted-foreground text-xs">
                  Os alvos digitados na grade viram METAS desta métrica — também
                  gerenciáveis em Configurações → Metas.
                </p>
              </div>
              <label className="flex items-center gap-2 pt-6 text-sm">
                <Checkbox
                  checked={f.money}
                  onCheckedChange={(v) => patchFactor(f.id, { money: v === true })}
                />
                Valores em R$ (realizado/alvo monetários)
              </label>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Fórmula do realizado</Label>
              <FormulaEditor
                context="aggregate"
                catalog={aggCatalog}
                sources={props.sources}
                initial={f.formula}
                onChange={(formula) => patchFactor(f.id, { formula })}
                preview={{
                  title: "Prévia do realizado (todo período, sem recorte de responsável)",
                  manualStart: true,
                  run: (formula) =>
                    previewAggregateFormula({
                      formulaJson: JSON.stringify(formula),
                      sources: f.sources,
                      filters: [],
                      resultPercent: false,
                      resultCurrency: f.money ? "BRL" : null,
                    }),
                }}
              />
            </div>
            <div className="flex justify-end">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="text-destructive"
                disabled={factors.length <= 1}
                onClick={() =>
                  setFactors((cur) => cur.filter((x) => x.id !== f.id))
                }
              >
                <Trash2 className="size-4" /> Remover fator {idx + 1}
              </Button>
            </div>
          </div>
        ))}
        <div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={factors.length >= MAX_FACTORS}
            onClick={() => setFactors((cur) => [...cur, emptyFactor()])}
          >
            <Plus className="size-4" /> Adicionar fator
          </Button>
        </div>
      </div>

      {/* Fórmula livre do total (avançado) */}
      <div className="flex flex-col gap-2 rounded-md border p-3">
        <label className="flex items-center gap-2 text-sm font-medium">
          <Checkbox
            checked={useTotalFormula}
            onCheckedChange={(v) => setUseTotalFormula(v === true)}
          />
          Fórmula do total (avançado)
        </label>
        <p className="text-muted-foreground text-xs">
          Desligado, o total é: base × Σ(peso × atingimento) + bônus. Ligado, a
          fórmula compõe as MESMAS variáveis (realizado/alvo/atingimento/valor
          de cada fator, base, bônus) — overrides manuais continuam valendo.
        </p>
        {useTotalFormula ? (
          <FormulaEditor
            context="record"
            catalog={compCatalog}
            initial={totalFormula}
            onChange={(formula) => setTotalFormula(formula)}
          />
        ) : null}
      </div>

      <div className="flex items-center gap-2">
        <Button type="button" onClick={save} disabled={pending}>
          {pending ? "Salvando…" : props.plan ? "Salvar plano" : "Criar plano"}
        </Button>
        {props.plan ? (
          <>
            <Button
              type="button"
              variant="ghost"
              className="text-destructive"
              onClick={() => setConfirmDelete(true)}
            >
              <Trash2 className="size-4" /> Excluir plano
            </Button>
            <ConfirmDialog
              open={confirmDelete}
              onOpenChange={setConfirmDelete}
              title="Excluir plano?"
              description="Os lançamentos do plano serão excluídos. Registros já publicados na base Remuneração FICAM (histórico) — remova-os em Registros se necessário."
              actionLabel="Excluir"
              onConfirm={() =>
                startTransition(async () => {
                  const res = await deletePlan(props.plan!.id);
                  if (!res.ok) notifyActionError("Excluir plano", res.message);
                  else props.onDeleted();
                })
              }
            />
          </>
        ) : null}
      </div>
    </div>
  );
}

// Multi-select simples de membros (popover + checkboxes). Vazio = todos os
// responsáveis ativos.
function MemberPicker(props: {
  responsibles: { id: string; label: string }[];
  value: string[];
  onChange: (v: string[]) => void;
}) {
  const label =
    props.value.length === 0
      ? "Todos os responsáveis ativos"
      : `${props.value.length} selecionado(s)`;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" className="justify-start font-normal">
          {label}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="max-h-72 w-72 overflow-auto p-2">
        <div className="flex flex-col gap-1">
          {props.responsibles.map((r) => {
            const checked = props.value.includes(r.id);
            return (
              <label key={r.id} className="flex items-center gap-2 rounded px-1 py-0.5 text-sm hover:bg-muted">
                <Checkbox
                  checked={checked}
                  onCheckedChange={(v) =>
                    props.onChange(
                      v === true
                        ? [...props.value, r.id]
                        : props.value.filter((x) => x !== r.id)
                    )
                  }
                />
                {r.label}
              </label>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}

// Multi-select de fontes (raízes e sub-bases). Vazio = todas as fontes.
function SourcePicker(props: {
  sources: SourceDef[];
  value: string[];
  onChange: (v: string[]) => void;
}) {
  const label =
    props.value.length === 0
      ? "Todas as fontes"
      : props.value.length === 1
        ? (props.sources.find((s) => s.key === props.value[0])?.label ??
          props.value[0])
        : `${props.value.length} fontes`;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" className="justify-start font-normal">
          {label}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="max-h-72 w-72 overflow-auto p-2">
        <div className="flex flex-col gap-1">
          {props.sources.map((s) => {
            const checked = props.value.includes(s.key);
            return (
              <label key={s.key} className="flex items-center gap-2 rounded px-1 py-0.5 text-sm hover:bg-muted">
                <Checkbox
                  checked={checked}
                  onCheckedChange={(v) =>
                    props.onChange(
                      v === true
                        ? [...props.value, s.key]
                        : props.value.filter((x) => x !== s.key)
                    )
                  }
                />
                <span className={s.parentKey ? "pl-3" : undefined}>
                  {s.label}
                  {s.parentKey ? (
                    <span className="text-muted-foreground"> (sub)</span>
                  ) : null}
                </span>
              </label>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
