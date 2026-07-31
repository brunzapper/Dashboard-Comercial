// Versão: 1.1 | Data: 31/07/2026
// Editor do plano de remuneração (0112): nome/ativo/base default/membros e a
// tabela de FATORES (rótulo, peso %, fontes, métrica de meta, cap/floor,
// fórmula do realizado via FormulaEditor contexto "aggregate" — o MESMO
// catálogo/validação do widget-builder). Seção avançada: fórmula LIVRE do
// total (contexto "record" sobre o catálogo comp:* derivado do rascunho —
// operandos aparecem/somem em sincronia com os fatores). Ids de fator são
// ESTÁVEIS (chave de overrides/alvos) — editar nunca os regenera.
// v1.1: seção "Comissão por faixa de atingimento" — gatilho + base + tabela
// de faixas (maior limiar >= vence) e tabela PRÓPRIA por membro (substitui a
// do plano inteira; personalizar semeia cópia). Excluir fator usado como
// gatilho/base zera o select (erro inline até escolher outro).
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
  COMP_COMMISSION_REF,
  compOperandCatalog,
  MAX_COMMISSION_TIERS,
  MAX_FACTORS,
  type CompCommissionConfig,
  type CompCommissionTier,
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

// Sentinela da base da comissão: % incide sobre a base variável da linha.
const BASIS_BASE = "__base__";

interface TierDraft {
  fromPct: string; // texto do input; parse no save
  ratePct: string;
}

const tierDrafts = (tiers: CompCommissionTier[] | undefined): TierDraft[] =>
  tiers && tiers.length > 0
    ? tiers.map((t) => ({ fromPct: String(t.fromPct), ratePct: String(t.ratePct) }))
    : [{ fromPct: "", ratePct: "" }];

// Linha toda vazia é ignorada; número inválido/negativo ou limiar duplicado
// reprova (mensagem específica); ordena asc — o parse do servidor exige.
function parseTierDrafts(
  rows: TierDraft[]
): { tiers: CompCommissionTier[] } | { error: string } {
  const out: CompCommissionTier[] = [];
  const seen = new Set<number>();
  for (const r of rows) {
    if (r.fromPct.trim() === "" && r.ratePct.trim() === "") continue;
    const fromPct = numOrNull(r.fromPct);
    const ratePct = numOrNull(r.ratePct);
    if (fromPct == null || ratePct == null || fromPct < 0 || ratePct < 0)
      return { error: "Faixa de comissão com número inválido." };
    if (seen.has(fromPct))
      return { error: "Duas faixas com o mesmo limiar de atingimento." };
    seen.add(fromPct);
    out.push({ fromPct, ratePct });
  }
  if (out.length === 0)
    return { error: "Adicione ao menos uma faixa de comissão." };
  out.sort((a, b) => a.fromPct - b.fromPct);
  return { tiers: out };
}

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
  const savedCommission = props.config?.commission ?? null;
  const [commissionOn, setCommissionOn] = useState(Boolean(savedCommission));
  const [commTrigger, setCommTrigger] = useState<string>(
    savedCommission?.triggerFactorId ?? ""
  );
  // "" = sem escolha (erro inline); BASIS_BASE = base variável; senão id do fator.
  const [commBasis, setCommBasis] = useState<string>(
    savedCommission == null
      ? BASIS_BASE
      : savedCommission.basisKind === "base"
        ? BASIS_BASE
        : (savedCommission.basisFactorId ?? "")
  );
  const [commTiers, setCommTiers] = useState<TierDraft[]>(
    tierDrafts(savedCommission?.tiers)
  );
  const [commMemberTiers, setCommMemberTiers] = useState<
    Record<string, TierDraft[]>
  >(() => {
    const out: Record<string, TierDraft[]> = {};
    for (const [id, tiers] of Object.entries(savedCommission?.memberTiers ?? {}))
      out[id] = tierDrafts(tiers);
    return out;
  });

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
  // renomear/excluir fator ou ligar/desligar a comissão atualiza os operandos
  // na hora; o bloco dummy só sinaliza a presença p/ o comp:comissao).
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
      ...(commissionOn
        ? {
            commission: {
              triggerFactorId: "",
              basisKind: "base",
              tiers: [],
            } satisfies CompCommissionConfig,
          }
        : {}),
    };
    return compOperandCatalog(draftConfig);
  }, [factors, commissionOn]);

  const weightSum = factors.reduce(
    (acc, f) => acc + (numOrNull(f.weightPct) ?? 0),
    0
  );

  const factorOptions: ComboboxOption[] = factors.map((f, i) => ({
    value: f.id,
    label: f.label.trim() || `Fator ${i + 1}`,
  }));
  const basisOptions: ComboboxOption[] = [
    { value: BASIS_BASE, label: "Base variável (R$)" },
    ...factors.map((f, i) => ({
      value: f.id,
      label: `Realizado de: ${f.label.trim() || `Fator ${i + 1}`}`,
    })),
  ];
  const commissionMembers =
    memberIds.length > 0
      ? props.responsibles.filter((r) => memberIds.includes(r.id))
      : props.responsibles;
  // Órfãos (membro saiu do plano/inativo): nunca usados no cálculo, nunca
  // podados em silêncio — visíveis com o id cru + remover.
  const orphanTierIds = Object.keys(commMemberTiers).filter(
    (id) => !commissionMembers.some((r) => r.id === id)
  );
  const formulaLacksCommission =
    commissionOn &&
    useTotalFormula &&
    totalFormula != null &&
    totalFormula.tokens.length > 0 &&
    !totalFormula.tokens.some(
      (t) => t.kind === "field" && t.ref === COMP_COMMISSION_REF
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

  // Monta e valida o bloco de comissão do rascunho (null = desligado; string =
  // erro de validação com mensagem própria — o parse do servidor é o backstop).
  const buildCommission = (): CompCommissionConfig | string | null => {
    if (!commissionOn) return null;
    const factorIds = new Set(factors.map((f) => f.id));
    if (!factorIds.has(commTrigger))
      return "Escolha o fator gatilho da comissão.";
    if (commBasis !== BASIS_BASE && !factorIds.has(commBasis))
      return "Escolha a base da comissão.";
    const parsed = parseTierDrafts(commTiers);
    if ("error" in parsed) return parsed.error;
    const memberTiers: Record<string, CompCommissionTier[]> = {};
    for (const [id, rows] of Object.entries(commMemberTiers)) {
      const p = parseTierDrafts(rows);
      if ("error" in p) {
        const who =
          props.responsibles.find((r) => r.id === id)?.label ?? id;
        return `${p.error} (faixas de ${who})`;
      }
      memberTiers[id] = p.tiers;
    }
    return {
      triggerFactorId: commTrigger,
      basisKind: commBasis === BASIS_BASE ? "base" : "factor",
      ...(commBasis === BASIS_BASE ? {} : { basisFactorId: commBasis }),
      tiers: parsed.tiers,
      ...(Object.keys(memberTiers).length > 0 ? { memberTiers } : {}),
    };
  };

  const save = () =>
    startTransition(async () => {
      const commission = buildCommission();
      if (typeof commission === "string") {
        notifyActionError("Salvar plano", commission);
        return;
      }
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
        ...(commission ? { commission } : {}),
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
                onClick={() => {
                  setFactors((cur) => cur.filter((x) => x.id !== f.id));
                  // Gatilho/base da comissão apontando o fator excluído zera o
                  // select — erro inline até escolher outro (nunca silencioso).
                  if (commTrigger === f.id) setCommTrigger("");
                  if (commBasis === f.id) setCommBasis("");
                }}
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

      {/* Comissão por faixas de atingimento */}
      <div className="flex flex-col gap-2 rounded-md border p-3">
        <label className="flex items-center gap-2 text-sm font-medium">
          <Checkbox
            checked={commissionOn}
            onCheckedChange={(v) => setCommissionOn(v === true)}
          />
          Comissão por faixa de atingimento
        </label>
        <p className="text-muted-foreground text-xs">
          O atingimento do fator gatilho escolhe a faixa e a % dela incide
          sobre a base escolhida, somando ao total. Maior limiar satisfeito
          vence (≥). Abaixo da menor faixa (ou sem atingimento no gatilho) a
          comissão é 0.
        </p>
        {commissionOn ? (
          <div className="flex flex-col gap-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <Label>Fator gatilho (atingimento)</Label>
                <Combobox
                  options={factorOptions}
                  value={commTrigger}
                  onValueChange={(v) => setCommTrigger(v)}
                />
                {commTrigger === "" ? (
                  <p className="text-destructive text-xs">
                    Escolha o fator cujo atingimento decide a faixa.
                  </p>
                ) : null}
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>Comissão incide sobre</Label>
                <Combobox
                  options={basisOptions}
                  value={commBasis}
                  onValueChange={(v) => setCommBasis(v)}
                />
                {commBasis === "" ? (
                  <p className="text-destructive text-xs">
                    Escolha sobre o que a % incide.
                  </p>
                ) : null}
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Faixas do plano</Label>
              <TierTable tiers={commTiers} onChange={setCommTiers} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Percentuais por membro</Label>
              <p className="text-muted-foreground text-xs">
                Personalizar substitui a tabela INTEIRA do plano para o membro
                (começa como cópia). Sem personalização, vale a tabela acima.
              </p>
              <div className="flex flex-col gap-2">
                {commissionMembers.map((r) => {
                  const custom = commMemberTiers[r.id] != null;
                  return (
                    <div key={r.id} className="rounded border p-2">
                      <label className="flex items-center gap-2 text-sm">
                        <Checkbox
                          checked={custom}
                          onCheckedChange={(v) =>
                            setCommMemberTiers((cur) => {
                              const next = { ...cur };
                              if (v === true)
                                next[r.id] = commTiers.map((t) => ({ ...t }));
                              else delete next[r.id];
                              return next;
                            })
                          }
                        />
                        {r.label}
                        <span className="text-muted-foreground text-xs">
                          {custom ? "faixas personalizadas" : "padrão do plano"}
                        </span>
                      </label>
                      {custom ? (
                        <div className="mt-2">
                          <TierTable
                            tiers={commMemberTiers[r.id]}
                            onChange={(rows) =>
                              setCommMemberTiers((cur) => ({
                                ...cur,
                                [r.id]: rows,
                              }))
                            }
                          />
                        </div>
                      ) : null}
                    </div>
                  );
                })}
                {orphanTierIds.map((id) => (
                  <div
                    key={id}
                    className="flex items-center gap-2 rounded border border-dashed p-2 text-xs"
                  >
                    <span className="text-muted-foreground">
                      Faixas de um membro fora do plano ({id}) — preservadas,
                      nunca usadas no cálculo.
                    </span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="text-destructive"
                      onClick={() =>
                        setCommMemberTiers((cur) => {
                          const next = { ...cur };
                          delete next[id];
                          return next;
                        })
                      }
                    >
                      Remover
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        ) : null}
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
        {formulaLacksCommission ? (
          <p className="text-xs text-amber-600">
            A fórmula do total não referencia [Comissão (R$)] — com fórmula
            ligada, a comissão só entra no total se a fórmula a incluir.
          </p>
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

// Tabela editável de faixas: "atingimento a partir de (%)" → "comissão (%)".
// Linha toda vazia é ignorada no save; ordenação acontece no parse.
function TierTable(props: {
  tiers: TierDraft[];
  onChange: (rows: TierDraft[]) => void;
}) {
  const patch = (i: number, p: Partial<TierDraft>) =>
    props.onChange(props.tiers.map((t, j) => (j === i ? { ...t, ...p } : t)));
  return (
    <div className="flex max-w-md flex-col gap-1.5">
      <div className="text-muted-foreground grid grid-cols-[1fr_1fr_2.5rem] gap-2 text-xs">
        <span>Atingimento a partir de (%)</span>
        <span>Comissão (%)</span>
        <span />
      </div>
      {props.tiers.map((t, i) => (
        <div key={i} className="grid grid-cols-[1fr_1fr_2.5rem] items-center gap-2">
          <Input
            inputMode="decimal"
            value={t.fromPct}
            onChange={(e) => patch(i, { fromPct: e.target.value })}
            placeholder="Ex.: 80"
          />
          <Input
            inputMode="decimal"
            value={t.ratePct}
            onChange={(e) => patch(i, { ratePct: e.target.value })}
            placeholder="Ex.: 3"
          />
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="text-destructive"
            disabled={props.tiers.length <= 1}
            onClick={() => props.onChange(props.tiers.filter((_, j) => j !== i))}
          >
            <Trash2 className="size-4" />
          </Button>
        </div>
      ))}
      <div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={props.tiers.length >= MAX_COMMISSION_TIERS}
          onClick={() =>
            props.onChange([...props.tiers, { fromPct: "", ratePct: "" }])
          }
        >
          <Plus className="size-4" /> Adicionar faixa
        </Button>
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
