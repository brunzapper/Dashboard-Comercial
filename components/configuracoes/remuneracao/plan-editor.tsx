// Versão: 1.6 | Data: 02/08/2026
// v1.6: validação amigável POR FATOR no save (nome/peso/fórmula vazios têm
// mensagem própria — antes morriam no parse fail-closed do servidor com o
// genérico "Configuração do plano inválida."; peso 0 é válido e o texto diz
// isso); o sentinel -1 do peso saiu (valor validado segue ao servidor).
// Versão: 1.5 | Data: 01/08/2026
// v1.5: "Condições do recorte" por fator (factor.filters) — linhas FilterRow
// (mesmo card do widget-builder, sem fontes-alvo por filtro) com picker de
// valor (responsável grava NOME — o engine resolve nome→id→grupo; etapa/
// seleção gravam o rótulo). O save RE-EMITE os filtros (regra do presetKey —
// antes o round-trip os destruía em silêncio) e a prévia da fórmula passa a
// aplicá-los. Operação não é filtrável aqui (coluna derivada — savePlan
// rejeita e o dropdown nem oferece).
// v1.4: seletor "Apuração" na identidade do plano (mes_anterior = realizado/
// metas do mês anterior ao lançamento; plano NOVO nasce mes_anterior). O
// save RE-EMITE config.apuracao quando mes_anterior (regra do presetKey —
// o parse normaliza mes_corrente p/ ausência da chave).
// v1.3: comissão MULTI-BLOCO — lista de blocos (cap MAX_COMMISSION_BLOCKS),
// cada um com rótulo/gatilho/tierBy (atingimento × realizado)/kind (% × R$
// fixo × R$ por unidade)/base/faixas + tabela por membro; TierTable com
// colunas cientes de kind/tierBy. Fator ganha linha "Avançado": campo de
// membro (memberField — match por nome via engine), alvo padrão
// (defaultTarget) e moeda do alvo (targetCurrency). O save RE-EMITE
// config.presetKey (identidade de plano criado por preset — sem isso o 1º
// save quebraria o ensure-only do re-apply).
// v1.2: membros por OPERAÇÃO — OperationPicker + bloco "Membros efetivos"
// (manual ∪ subárvore viva, helpers do model com os ids resolvidos no server
// via props); operação órfã vira chip com remover; aviso quando a seleção
// resolve zero membros (parceria profile-only não conta).
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
import { FilterRow } from "@/components/dashboards/widget-builder-rows";
import type { FilterValueSource } from "@/components/filters/filter-value-picker";
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
import {
  cleanFilters,
  decorateRefOptions,
  FILTER_OPS,
  opHasNoValue,
  sourceChips,
  toFieldOptions,
} from "@/lib/widgets/filter-ops";
import { splitCoreDefs } from "@/lib/records/core-defs";
import type { WidgetFilter } from "@/lib/widgets/types";
import {
  COMP_COMMISSION_REF,
  compOperandCatalog,
  explicitMemberIds,
  MAX_COMMISSION_BLOCKS,
  MAX_COMMISSION_TIERS,
  MAX_FACTOR_FILTERS,
  MAX_FACTORS,
  resolveOperationMembers,
  type CompCommissionBlock,
  type CompCommissionTier,
  type CompPlanConfig,
  type CompTierKind,
} from "@/lib/comp/model";
import {
  deletePlan,
  savePlan,
} from "@/app/(app)/operacao/remuneracao/actions";
import { listFilterOptionCandidates } from "@/app/(app)/dashboards/actions";
import { previewAggregateFormula } from "@/app/(app)/dashboards/formula-preview-actions";
import type { CompPlanClientRow } from "./remuneracao-manager";

// Operadores das condições do recorte — SEMPRE de FILTER_OPS (nunca lista
// paralela; mesma régua do parse do model e da barra da tabela).
const FILTER_OP_OPTIONS: ComboboxOption[] = FILTER_OPS.map((o) => ({
  value: o.op,
  label: o.label,
}));

// Sentinela do select de métrica: o savePlan gera a chave automática.
const AUTO_METRIC = "__auto__";
// Sentinelas dos selects avançados do fator (draft guarda "" nos defaults).
const MEMBER_DEFAULT = "__resp__";
const CURRENCY_DEFAULT = "__brl__";

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
  memberField: string; // "" = Responsável (padrão)
  defaultTarget: string;
  targetCurrency: string; // "" = R$ (sem conversão)
  filters: WidgetFilter[]; // condições do recorte (linhas cruas da UI)
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
    memberField: "",
    defaultTarget: "",
    targetCurrency: "",
    filters: [],
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
    memberField: f.memberField ?? "",
    defaultTarget: f.defaultTarget != null ? String(f.defaultTarget) : "",
    targetCurrency: f.targetCurrency ?? "",
    // Clona (nunca mutar o config das props) — e RE-EMITIR no save é
    // obrigatório: sem isso o round-trip destruiria os filtros em silêncio.
    filters: (f.filters ?? []).map((x) => ({ ...x })),
  }));
}

const numOrNull = (s: string): number | null => {
  const v = s.trim() === "" ? NaN : Number(s.replace(",", "."));
  return Number.isFinite(v) ? v : null;
};

// Sentinela da base da comissão: % incide sobre a base variável da linha.
const BASIS_BASE = "__base__";

// Rascunho de faixa: `value` é a 2ª coluna, cuja semântica segue o kind do
// bloco (% p/ pct; R$ p/ flat/per_unit).
interface TierDraft {
  fromPct: string; // texto do input; parse no save
  value: string;
}

const tierDrafts = (tiers: CompCommissionTier[] | undefined): TierDraft[] =>
  tiers && tiers.length > 0
    ? tiers.map((t) => ({
        fromPct: String(t.fromPct),
        value: String(t.ratePct ?? t.amount ?? ""),
      }))
    : [{ fromPct: "", value: "" }];

// Linha toda vazia é ignorada; número inválido/negativo ou limiar duplicado
// reprova (mensagem específica); ordena asc — o parse do servidor exige. A 2ª
// coluna vira ratePct (kind pct) ou amount (flat/per_unit).
function parseTierDrafts(
  rows: TierDraft[],
  kind: CompTierKind
): { tiers: CompCommissionTier[] } | { error: string } {
  const out: CompCommissionTier[] = [];
  const seen = new Set<number>();
  for (const r of rows) {
    if (r.fromPct.trim() === "" && r.value.trim() === "") continue;
    const fromPct = numOrNull(r.fromPct);
    const value = numOrNull(r.value);
    if (fromPct == null || value == null || fromPct < 0 || value < 0)
      return { error: "Faixa de comissão com número inválido." };
    if (seen.has(fromPct))
      return { error: "Duas faixas com o mesmo limiar." };
    seen.add(fromPct);
    out.push(kind === "pct" ? { fromPct, ratePct: value } : { fromPct, amount: value });
  }
  if (out.length === 0)
    return { error: "Adicione ao menos uma faixa de comissão." };
  out.sort((a, b) => a.fromPct - b.fromPct);
  return { tiers: out };
}

// Rascunho de um BLOCO de comissão (id estável — chave do breakdown).
interface CommissionBlockDraft {
  id: string;
  label: string;
  trigger: string;
  basis: string; // BASIS_BASE | id de fator | "" (erro inline)
  tierBy: "attainment" | "realized";
  kind: CompTierKind;
  tiers: TierDraft[];
  memberTiers: Record<string, TierDraft[]>;
}

function newBlockId(): string {
  return `c_${Math.random().toString(36).slice(2, 10)}`;
}

function emptyBlock(): CommissionBlockDraft {
  return {
    id: newBlockId(),
    label: "",
    trigger: "",
    basis: BASIS_BASE,
    tierBy: "attainment",
    kind: "pct",
    tiers: [{ fromPct: "", value: "" }],
    memberTiers: {},
  };
}

function blockDraftsFromConfig(config: CompPlanConfig | null): CommissionBlockDraft[] {
  return (config?.commissions ?? []).map((b) => {
    const memberTiers: Record<string, TierDraft[]> = {};
    for (const [id, tiers] of Object.entries(b.memberTiers ?? {}))
      memberTiers[id] = tierDrafts(tiers);
    return {
      id: b.id,
      label: b.label ?? "",
      trigger: b.triggerFactorId,
      basis: b.basisKind === "base" ? BASIS_BASE : (b.basisFactorId ?? ""),
      tierBy: b.tierBy ?? "attainment",
      kind: b.kind ?? "pct",
      tiers: tierDrafts(b.tiers),
      memberTiers,
    };
  });
}

export interface PlanEditorProps {
  plan: CompPlanClientRow | null; // null = novo plano
  config: CompPlanConfig | null;
  metrics: GoalMetricDef[];
  responsibles: { id: string; label: string }[];
  available: AvailableField[];
  allFields: FieldDefinition[];
  sources: SourceDef[];
  // Operações da org + membros CANÔNICOS por operação (resolvidos no server).
  operations: { id: string; name: string; active: boolean }[];
  operationMembersById: Record<string, string[]>;
  // Moedas HABILITADAS (Campos → Moedas) p/ a moeda do alvo do fator.
  currencies: { value: string; label: string }[];
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
  // Plano NOVO nasce apurando o mês anterior (padrão da casa); plano
  // existente sem a chave segue no mês do lançamento (compat).
  const [apuracao, setApuracao] = useState<"mes_corrente" | "mes_anterior">(
    props.config?.apuracao ?? (props.plan ? "mes_corrente" : "mes_anterior")
  );
  const [memberOperationIds, setMemberOperationIds] = useState<string[]>(
    props.config?.memberOperationIds ?? []
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
  const [commBlocks, setCommBlocks] = useState<CommissionBlockDraft[]>(() =>
    blockDraftsFromConfig(props.config)
  );

  // Catálogo agregado (realizado) — mesma montagem do widget-builder.
  const aggCatalog: RefOption[] = useMemo(
    () =>
      decorateRefOptions(
        buildAggOperandCatalog(
          availableAggCatalogInput(
            props.available,
            props.allFields,
            props.sources,
            props.metrics,
            { withNested: true }
          )
        ),
        props.available,
        sourceLabels
      ),
    [props.available, props.allFields, props.sources, props.metrics, sourceLabels]
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
      ...(commBlocks.length > 0
        ? {
            commissions: [
              {
                id: "dummy",
                triggerFactorId: "",
                basisKind: "base",
                tiers: [],
              } satisfies CompCommissionBlock,
            ],
          }
        : {}),
    };
    return compOperandCatalog(draftConfig);
  }, [factors, commBlocks.length]);

  const weightSum = factors.reduce(
    (acc, f) => acc + (numOrNull(f.weightPct) ?? 0),
    0
  );

  // Membros EFETIVOS do rascunho (manual ∪ operações; null = todos os
  // ativos) — mesmos helpers puros do servidor/grade, ids do server via props.
  const effectiveIds = useMemo(
    () =>
      explicitMemberIds(
        {
          v: 1,
          factors: [],
          ...(memberIds.length > 0 ? { memberIds } : {}),
          ...(memberOperationIds.length > 0 ? { memberOperationIds } : {}),
        },
        resolveOperationMembers(
          memberOperationIds.length > 0 ? memberOperationIds : undefined,
          props.operationMembersById
        )
      ),
    [memberIds, memberOperationIds, props.operationMembersById]
  );
  // Operações órfãs (excluídas depois do save): chip com id cru + remover.
  const orphanOperationIds = memberOperationIds.filter(
    (id) => !props.operations.some((o) => o.id === id)
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
  const commissionMembers = useMemo(() => {
    if (effectiveIds === null) return props.responsibles;
    const byId = new Map(props.responsibles.map((r) => [r.id, r]));
    return effectiveIds
      .map((id) => byId.get(id))
      .filter((r): r is { id: string; label: string } => Boolean(r));
  }, [effectiveIds, props.responsibles]);
  const formulaLacksCommission =
    commBlocks.length > 0 &&
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
  // Campo de membro: refs de texto/seleção do catálogo (numérico/data/
  // sintético/agregado não identificam pessoa) — mesma regra do savePlan.
  const memberFieldOptions: ComboboxOption[] = [
    { value: MEMBER_DEFAULT, label: "Responsável (padrão)" },
    ...props.available
      .filter((a) => !a.isNumeric && !a.isDate && !a.displayOnly && !a.aggCalc)
      .map((a) => ({ value: a.field, label: a.label })),
  ];
  const currencyOptions: ComboboxOption[] = [
    { value: CURRENCY_DEFAULT, label: "R$ (sem conversão)" },
    ...props.currencies.filter((c) => c.value !== "BRL"),
  ];

  // Condições do recorte: campos filtráveis (sintético/agregado ficam fora —
  // não são consultáveis no RPC; operação idem, coluna derivada que o savePlan
  // rejeita) com chips de fonte, mesma montagem do widget-builder.
  const filterFieldOptions = useMemo(
    () =>
      toFieldOptions(
        props.available.filter(
          (a) => !a.displayOnly && !a.aggCalc && a.field !== "operation_id"
        ),
        sourceLabels
      ),
    [props.available, sourceLabels]
  );
  const filterFieldChips = useMemo(
    () => sourceChips(sourceLabels),
    [sourceLabels]
  );
  // Picker de VALOR (mesma régua do widget-builder): responsável GRAVA O NOME
  // (o engine resolve nome→id→grupo em runtime — resolveFkFilterNames + canon);
  // etapa/seleção gravam o próprio rótulo. Cache por render do editor: a
  // action só dispara no primeiro open (etapas variam com as fontes do fator).
  const fieldDefSplit = useMemo(
    () => splitCoreDefs(props.allFields),
    [props.allFields]
  );
  const customDefsByKey = useMemo(
    () => new Map(fieldDefSplit.custom.map((d) => [d.field_key, d])),
    [fieldDefSplit]
  );
  // Map ESTÁVEL via useState (não useRef: o lint do compiler barra ref lido
  // em função chamada no render; a mutação do Map não precisa re-render).
  const [optionCandidatesCache] = useState(
    () => new Map<string, Promise<{ value: string; label: string }[]>>()
  );
  const filterValueSource = (
    field: string,
    factorSources: string[]
  ): FilterValueSource | null => {
    const cachedLoad =
      (key: string, kind: "responsible" | "stage") =>
      (): Promise<{ value: string; label: string }[]> => {
        const cached = optionCandidatesCache.get(key);
        if (cached) return cached;
        const p = listFilterOptionCandidates(
          kind,
          kind === "stage" && factorSources.length > 0
            ? factorSources
            : undefined
        );
        optionCandidatesCache.set(key, p);
        return p;
      };
    if (field === "responsible_id")
      return {
        kind: "responsible",
        storeAs: "label",
        load: cachedLoad("responsible", "responsible"),
      };
    if (field === "stage")
      return {
        kind: "stage",
        storeAs: "value",
        load: cachedLoad(
          `stage:${[...factorSources].sort().join(",")}`,
          "stage"
        ),
      };
    const def = field.startsWith("custom:")
      ? customDefsByKey.get(field.slice("custom:".length))
      : fieldDefSplit.core.get(field);
    if (def?.data_type !== "selecao") return null;
    const opts = def.options ?? [];
    if (opts.length === 0) return null;
    return {
      kind: "static",
      storeAs: "value",
      load: () =>
        Promise.resolve(opts.map((o) => ({ value: o, label: o }))),
    };
  };

  const patchFactor = (id: string, patch: Partial<FactorDraft>) =>
    setFactors((cur) => cur.map((f) => (f.id === id ? { ...f, ...patch } : f)));
  const patchBlock = (id: string, patch: Partial<CommissionBlockDraft>) =>
    setCommBlocks((cur) => cur.map((b) => (b.id === id ? { ...b, ...patch } : b)));

  // Monta e valida os blocos de comissão do rascunho (string = erro de
  // validação com mensagem própria — o parse do servidor é o backstop).
  const buildCommissions = (): CompCommissionBlock[] | string => {
    const factorIds = new Set(factors.map((f) => f.id));
    const out: CompCommissionBlock[] = [];
    for (const [i, b] of commBlocks.entries()) {
      const who = b.label.trim() || `Comissão ${i + 1}`;
      if (!factorIds.has(b.trigger))
        return `Escolha o fator gatilho (${who}).`;
      if (b.kind === "per_unit" && (b.basis === BASIS_BASE || b.basis === ""))
        return `"R$ por unidade" exige um fator como base (${who}).`;
      if (b.basis !== BASIS_BASE && !factorIds.has(b.basis))
        return `Escolha a base da comissão (${who}).`;
      const parsed = parseTierDrafts(b.tiers, b.kind);
      if ("error" in parsed) return `${parsed.error} (${who})`;
      const memberTiers: Record<string, CompCommissionTier[]> = {};
      for (const [id, rows] of Object.entries(b.memberTiers)) {
        const p = parseTierDrafts(rows, b.kind);
        if ("error" in p) {
          const member = props.responsibles.find((r) => r.id === id)?.label ?? id;
          return `${p.error} (faixas de ${member}, ${who})`;
        }
        memberTiers[id] = p.tiers;
      }
      out.push({
        id: b.id,
        ...(b.label.trim() !== "" ? { label: b.label.trim() } : {}),
        triggerFactorId: b.trigger,
        basisKind: b.basis === BASIS_BASE ? "base" : "factor",
        ...(b.basis === BASIS_BASE ? {} : { basisFactorId: b.basis }),
        tierBy: b.tierBy,
        kind: b.kind,
        tiers: parsed.tiers,
        ...(Object.keys(memberTiers).length > 0 ? { memberTiers } : {}),
      });
    }
    return out;
  };

  // Condições do recorte prontas p/ o config: cleanFilters (linha sem campo
  // some; `in` vira array; op sem valor perde o valor) + fontes-alvo por
  // filtro fora do contrato do fator + valor obrigatório (string = erro).
  const buildFactorFilters = (
    f: FactorDraft,
    who: string
  ): WidgetFilter[] | string => {
    const cleaned = cleanFilters(f.filters).map(
      ({ sources: _sources, ...rest }) => rest
    );
    for (const flt of cleaned) {
      if (opHasNoValue(flt.op)) continue;
      const empty = Array.isArray(flt.value)
        ? flt.value.length === 0
        : String(flt.value ?? "").trim() === "";
      if (empty) return `Condição sem valor no fator "${who}".`;
    }
    return cleaned;
  };

  const save = () =>
    startTransition(async () => {
      // Identidade básica de cada fator ANTES do config: sem isto, peso
      // vazio/label vazio/fórmula vazia morriam no parse fail-closed do
      // servidor com o genérico "Configuração do plano inválida.".
      for (const [i, f] of factors.entries()) {
        const who = f.label.trim() || `Fator ${i + 1}`;
        if (f.label.trim() === "") {
          notifyActionError("Salvar plano", `Dê um nome ao fator ${i + 1}.`);
          return;
        }
        const w = numOrNull(f.weightPct);
        if (w == null || w < 0) {
          notifyActionError(
            "Salvar plano",
            `Informe o peso do fator "${who}" — 0 vale (fator só de gatilho/base de comissão).`
          );
          return;
        }
        if (f.formula.tokens.length === 0) {
          notifyActionError(
            "Salvar plano",
            `Monte a fórmula do realizado do fator "${who}".`
          );
          return;
        }
      }
      const commissions = buildCommissions();
      if (typeof commissions === "string") {
        notifyActionError("Salvar plano", commissions);
        return;
      }
      const factorFilters = new Map<string, WidgetFilter[]>();
      for (const [i, f] of factors.entries()) {
        const built = buildFactorFilters(
          f,
          f.label.trim() || `Fator ${i + 1}`
        );
        if (typeof built === "string") {
          notifyActionError("Salvar plano", built);
          return;
        }
        factorFilters.set(f.id, built);
      }
      const config = {
        v: 1,
        factors: factors.map((f) => ({
          id: f.id,
          label: f.label.trim(),
          // Validado acima (não-nulo e >= 0) — o parse do servidor segue
          // como muralha.
          weightPct: numOrNull(f.weightPct) ?? 0,
          metricKey: f.metricKey || AUTO_METRIC,
          money: f.money,
          formula: f.formula,
          sources: f.sources,
          ...(numOrNull(f.capPct) != null ? { capPct: numOrNull(f.capPct) } : {}),
          ...(numOrNull(f.floorPct) != null
            ? { floorPct: numOrNull(f.floorPct) }
            : {}),
          ...(f.memberField !== "" ? { memberField: f.memberField } : {}),
          ...(numOrNull(f.defaultTarget) != null
            ? { defaultTarget: numOrNull(f.defaultTarget) }
            : {}),
          ...(f.targetCurrency !== "" ? { targetCurrency: f.targetCurrency } : {}),
          // RE-EMITIR as condições do recorte (regra do presetKey/apuracao):
          // sem isso o round-trip do save as destruiria em silêncio.
          ...((factorFilters.get(f.id) ?? []).length > 0
            ? { filters: factorFilters.get(f.id) }
            : {}),
        })),
        ...(memberIds.length > 0 ? { memberIds } : {}),
        ...(memberOperationIds.length > 0 ? { memberOperationIds } : {}),
        ...(useTotalFormula && totalFormula && totalFormula.tokens.length > 0
          ? { totalFormula }
          : {}),
        ...(commissions.length > 0 ? { commissions } : {}),
        // Apuração sobre o mês anterior: RE-EMITIR no save (o parse normaliza
        // mes_corrente p/ ausência; sem re-emissão o round-trip derrubaria a
        // chave em silêncio — mesma regra do presetKey).
        ...(apuracao === "mes_anterior"
          ? { apuracao: "mes_anterior" as const }
          : {}),
        // Identidade de plano criado por preset SOBREVIVE ao round-trip do
        // save — sem isso o re-apply do preset duplicaria o plano.
        ...(props.config?.presetKey ? { presetKey: props.config.presetKey } : {}),
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
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
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
        <div className="flex flex-col gap-1.5">
          <Label>Operações (vínculo vivo)</Label>
          <OperationPicker
            operations={props.operations}
            value={memberOperationIds}
            onChange={setMemberOperationIds}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>Apuração</Label>
          <Combobox
            options={[
              { value: "mes_anterior", label: "Mês anterior ao lançamento" },
              { value: "mes_corrente", label: "Mês do lançamento" },
            ]}
            value={apuracao}
            onValueChange={(v) =>
              setApuracao(v === "mes_anterior" ? "mes_anterior" : "mes_corrente")
            }
            searchable={false}
          />
          <p className="text-muted-foreground text-xs">
            Mês de referência do realizado e das metas. Alterar exige
            Recalcular.
          </p>
        </div>
        <label className="flex items-center gap-2 pt-6 text-sm">
          <Checkbox
            checked={active}
            onCheckedChange={(v) => setActive(v === true)}
          />
          Plano ativo
        </label>
      </div>

      {/* Membros efetivos (derivação viva do rascunho) */}
      <div className="text-muted-foreground -mt-3 flex flex-col gap-1 text-xs">
        {orphanOperationIds.map((id) => (
          <span key={id} className="flex items-center gap-2">
            <span className="rounded border border-dashed px-1.5 py-0.5">
              Operação removida ({id}) — contribui zero membros.
            </span>
            <button
              type="button"
              className="text-destructive underline-offset-2 hover:underline"
              onClick={() =>
                setMemberOperationIds((cur) => cur.filter((x) => x !== id))
              }
            >
              Remover
            </button>
          </span>
        ))}
        {effectiveIds === null ? (
          <span>Membros efetivos: todos os responsáveis ativos.</span>
        ) : effectiveIds.length === 0 ? (
          <span className="text-destructive">
            Nenhum membro efetivo — as operações escolhidas não têm responsáveis
            vinculados (sub-operações de parceria não contam). O recálculo
            falhará até ajustar membros/operações.
          </span>
        ) : (
          <span>
            Membros efetivos ({commissionMembers.length}):{" "}
            {commissionMembers.map((r) => r.label).join(", ")}
            {memberOperationIds.length > 0
              ? " — atualiza sozinho quando os vínculos das operações mudarem."
              : ""}
          </span>
        )}
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
                  title:
                    "Prévia do realizado (todo período, com as condições do fator, sem recorte de membro)",
                  manualStart: true,
                  run: (formula) =>
                    previewAggregateFormula({
                      formulaJson: JSON.stringify(formula),
                      sources: f.sources,
                      filters: cleanFilters(f.filters),
                      resultPercent: false,
                      resultCurrency: f.money ? "BRL" : null,
                    }),
                }}
              />
            </div>
            {/* Condições do recorte (factor.filters): em E, aplicadas ao
                realizado ANTES do filtro de membro (mesma consulta). */}
            <div className="flex flex-col gap-1.5">
              <Label>Condições do recorte</Label>
              {f.filters.length > 0 ? (
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {f.filters.map((flt, fi) => (
                    <FilterRow
                      key={fi}
                      filter={flt}
                      fieldOptions={filterFieldOptions}
                      fieldChips={filterFieldChips}
                      opOptions={FILTER_OP_OPTIONS}
                      valueSource={filterValueSource(flt.field, f.sources)}
                      onChange={(patch) =>
                        patchFactor(f.id, {
                          filters: f.filters.map((x, xi) =>
                            xi === fi ? { ...x, ...patch } : x
                          ),
                        })
                      }
                      onRemove={() =>
                        patchFactor(f.id, {
                          filters: f.filters.filter((_, xi) => xi !== fi),
                        })
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
                  disabled={f.filters.length >= MAX_FACTOR_FILTERS}
                  onClick={() =>
                    patchFactor(f.id, {
                      filters: [
                        ...f.filters,
                        { field: "", op: "eq", value: "" },
                      ],
                    })
                  }
                >
                  <Plus className="size-4" /> Adicionar condição
                </Button>
              </div>
              <p className="text-muted-foreground text-xs">
                Condições em E aplicadas ao realizado deste fator, antes do
                recorte de membro. Um fator com peso 0 pode servir só de
                gatilho de comissão.
              </p>
            </div>
            {/* Avançado: campo de membro / alvo padrão / moeda do alvo */}
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <div className="flex flex-col gap-1.5">
                <Label>Crédito do membro (campo)</Label>
                <Combobox
                  options={memberFieldOptions}
                  value={f.memberField || MEMBER_DEFAULT}
                  onValueChange={(v) =>
                    patchFactor(f.id, {
                      memberField: v === MEMBER_DEFAULT ? "" : v,
                    })
                  }
                />
                <p className="text-muted-foreground text-xs">
                  Padrão: Responsável do registro. Com um campo escolhido, o
                  realizado do membro conta registros cujo campo tem o NOME
                  dele (ex.: SDR da Reunião).
                </p>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>Alvo padrão do plano</Label>
                <Input
                  inputMode="decimal"
                  value={f.defaultTarget}
                  onChange={(e) =>
                    patchFactor(f.id, { defaultTarget: e.target.value })
                  }
                  placeholder="Ex.: 35000"
                />
                <p className="text-muted-foreground text-xs">
                  Usado quando o mês não tem meta digitada; digitar na grade
                  fixa a meta do mês, limpar volta ao padrão.
                </p>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>Moeda do alvo</Label>
                <Combobox
                  options={currencyOptions}
                  value={f.targetCurrency || CURRENCY_DEFAULT}
                  onValueChange={(v) =>
                    patchFactor(f.id, {
                      targetCurrency: v === CURRENCY_DEFAULT ? "" : v,
                    })
                  }
                />
                <p className="text-muted-foreground text-xs">
                  Alvos digitados nesta moeda são convertidos a R$ pela
                  cotação do trimestre (Campos → Moedas). Sem cotação, o
                  atingimento fica em erro — nunca converte 1:1.
                </p>
              </div>
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
                  // Gatilho/base de bloco apontando o fator excluído zera o
                  // select — erro inline até escolher outro (nunca silencioso).
                  setCommBlocks((cur) =>
                    cur.map((b) => ({
                      ...b,
                      trigger: b.trigger === f.id ? "" : b.trigger,
                      basis: b.basis === f.id ? "" : b.basis,
                    }))
                  );
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

      {/* Comissões por faixa (multi-bloco) */}
      <div className="flex flex-col gap-2 rounded-md border p-3">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-medium">Comissões por faixa</h2>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={commBlocks.length >= MAX_COMMISSION_BLOCKS}
            onClick={() => setCommBlocks((cur) => [...cur, emptyBlock()])}
          >
            <Plus className="size-4" /> Adicionar comissão
          </Button>
        </div>
        <p className="text-muted-foreground text-xs">
          Cada comissão escolhe a faixa pelo gatilho (atingimento % ou
          realizado absoluto — maior limiar satisfeito vence, ≥) e paga
          conforme o tipo: % sobre a base, prêmio fixo em R$, ou R$ por
          unidade do realizado. Abaixo da menor faixa (ou gatilho sem valor) o
          valor é 0. Os blocos SOMAM no total.
        </p>
        {commBlocks.map((b, bi) => {
          const orphanTierIds = Object.keys(b.memberTiers).filter(
            (id) => !commissionMembers.some((r) => r.id === id)
          );
          return (
            <div key={b.id} className="bg-card flex flex-col gap-3 rounded-md border p-3">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <div className="flex flex-col gap-1.5">
                  <Label>Nome (opcional)</Label>
                  <Input
                    value={b.label}
                    onChange={(e) => patchBlock(b.id, { label: e.target.value })}
                    placeholder={`Comissão ${bi + 1}`}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label>Fator gatilho</Label>
                  <Combobox
                    options={factorOptions}
                    value={b.trigger}
                    onValueChange={(v) => patchBlock(b.id, { trigger: v })}
                  />
                  {b.trigger === "" ? (
                    <p className="text-destructive text-xs">
                      Escolha o fator que decide a faixa.
                    </p>
                  ) : null}
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label>Faixa escolhida por</Label>
                  <Combobox
                    options={[
                      { value: "attainment", label: "Atingimento do gatilho (%)" },
                      { value: "realized", label: "Realizado do gatilho (absoluto)" },
                    ]}
                    value={b.tierBy}
                    onValueChange={(v) =>
                      patchBlock(b.id, {
                        tierBy: v === "realized" ? "realized" : "attainment",
                      })
                    }
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label>Tipo de pagamento</Label>
                  <Combobox
                    options={[
                      { value: "pct", label: "% sobre a base" },
                      { value: "flat", label: "Prêmio fixo (R$)" },
                      { value: "per_unit", label: "R$ por unidade do realizado" },
                    ]}
                    value={b.kind}
                    onValueChange={(v) =>
                      patchBlock(b.id, {
                        kind: v === "flat" || v === "per_unit" ? v : "pct",
                        // per_unit exige fator-base; sai do sentinela "base".
                        ...(v === "per_unit" && b.basis === BASIS_BASE
                          ? { basis: "" }
                          : {}),
                      })
                    }
                  />
                </div>
              </div>
              {b.kind !== "flat" ? (
                <div className="flex max-w-md flex-col gap-1.5">
                  <Label>
                    {b.kind === "per_unit"
                      ? "R$ por unidade do realizado de"
                      : "Comissão incide sobre"}
                  </Label>
                  <Combobox
                    options={
                      b.kind === "per_unit"
                        ? basisOptions.filter((o) => o.value !== BASIS_BASE)
                        : basisOptions
                    }
                    value={b.basis}
                    onValueChange={(v) => patchBlock(b.id, { basis: v })}
                  />
                  {b.basis === "" ? (
                    <p className="text-destructive text-xs">
                      {b.kind === "per_unit"
                        ? "Escolha o fator cujo realizado multiplica o R$ da faixa."
                        : "Escolha sobre o que a % incide."}
                    </p>
                  ) : null}
                </div>
              ) : null}
              <div className="flex flex-col gap-1.5">
                <Label>Faixas do plano</Label>
                <TierTable
                  tiers={b.tiers}
                  kind={b.kind}
                  tierBy={b.tierBy}
                  onChange={(rows) => patchBlock(b.id, { tiers: rows })}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>Faixas por membro</Label>
                <p className="text-muted-foreground text-xs">
                  Personalizar substitui a tabela INTEIRA do plano para o
                  membro (começa como cópia — edite para qualquer valor,
                  inclusive zerar). Sem personalização, vale a tabela acima.
                </p>
                <div className="flex flex-col gap-2">
                  {commissionMembers.map((r) => {
                    const custom = b.memberTiers[r.id] != null;
                    return (
                      <div key={r.id} className="rounded border p-2">
                        <label className="flex items-center gap-2 text-sm">
                          <Checkbox
                            checked={custom}
                            onCheckedChange={(v) =>
                              setCommBlocks((cur) =>
                                cur.map((x) => {
                                  if (x.id !== b.id) return x;
                                  const next = { ...x.memberTiers };
                                  if (v === true)
                                    next[r.id] = x.tiers.map((t) => ({ ...t }));
                                  else delete next[r.id];
                                  return { ...x, memberTiers: next };
                                })
                              )
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
                              tiers={b.memberTiers[r.id]}
                              kind={b.kind}
                              tierBy={b.tierBy}
                              onChange={(rows) =>
                                setCommBlocks((cur) =>
                                  cur.map((x) =>
                                    x.id === b.id
                                      ? {
                                          ...x,
                                          memberTiers: {
                                            ...x.memberTiers,
                                            [r.id]: rows,
                                          },
                                        }
                                      : x
                                  )
                                )
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
                          setCommBlocks((cur) =>
                            cur.map((x) => {
                              if (x.id !== b.id) return x;
                              const next = { ...x.memberTiers };
                              delete next[id];
                              return { ...x, memberTiers: next };
                            })
                          )
                        }
                      >
                        Remover
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
              <div className="flex justify-end">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="text-destructive"
                  onClick={() =>
                    setCommBlocks((cur) => cur.filter((x) => x.id !== b.id))
                  }
                >
                  <Trash2 className="size-4" /> Remover comissão {bi + 1}
                </Button>
              </div>
            </div>
          );
        })}
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

// Tabela editável de faixas: colunas cientes do kind (% × R$) e do tierBy
// (limiar em atingimento % ou realizado absoluto). Linha toda vazia é
// ignorada no save; ordenação acontece no parse.
function TierTable(props: {
  tiers: TierDraft[];
  kind: CompTierKind;
  tierBy: "attainment" | "realized";
  onChange: (rows: TierDraft[]) => void;
}) {
  const patch = (i: number, p: Partial<TierDraft>) =>
    props.onChange(props.tiers.map((t, j) => (j === i ? { ...t, ...p } : t)));
  const fromLabel =
    props.tierBy === "attainment"
      ? "Atingimento a partir de (%)"
      : "Realizado a partir de";
  const valueLabel =
    props.kind === "pct"
      ? "Comissão (%)"
      : props.kind === "flat"
        ? "Prêmio (R$)"
        : "R$ por unidade";
  return (
    <div className="flex max-w-md flex-col gap-1.5">
      <div className="text-muted-foreground grid grid-cols-[1fr_1fr_2.5rem] gap-2 text-xs">
        <span>{fromLabel}</span>
        <span>{valueLabel}</span>
        <span />
      </div>
      {props.tiers.map((t, i) => (
        <div key={i} className="grid grid-cols-[1fr_1fr_2.5rem] items-center gap-2">
          <Input
            inputMode="decimal"
            value={t.fromPct}
            onChange={(e) => patch(i, { fromPct: e.target.value })}
            placeholder={props.tierBy === "attainment" ? "Ex.: 80" : "Ex.: 26"}
          />
          <Input
            inputMode="decimal"
            value={t.value}
            onChange={(e) => patch(i, { value: e.target.value })}
            placeholder={
              props.kind === "pct"
                ? "Ex.: 3"
                : props.kind === "flat"
                  ? "Ex.: 500"
                  : "Ex.: 12,50"
            }
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
            props.onChange([...props.tiers, { fromPct: "", value: "" }])
          }
        >
          <Plus className="size-4" /> Adicionar faixa
        </Button>
      </div>
    </div>
  );
}

// Multi-select de operações (popover + checkboxes). Membros = subárvore VIVA
// de responsible_operations, resolvida no server; vazio = nenhuma operação.
function OperationPicker(props: {
  operations: { id: string; name: string; active: boolean }[];
  value: string[];
  onChange: (v: string[]) => void;
}) {
  const label =
    props.value.length === 0
      ? "Nenhuma operação"
      : props.value.length === 1
        ? (props.operations.find((o) => o.id === props.value[0])?.name ??
          "1 operação")
        : `${props.value.length} operações`;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" className="justify-start font-normal">
          {label}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="max-h-72 w-72 overflow-auto p-2">
        <div className="flex flex-col gap-1">
          {props.operations.length === 0 ? (
            <p className="text-muted-foreground p-1 text-xs">
              Nenhuma operação cadastrada (Configurações → Operações).
            </p>
          ) : null}
          {props.operations.map((o) => {
            const checked = props.value.includes(o.id);
            return (
              <label key={o.id} className="flex items-center gap-2 rounded px-1 py-0.5 text-sm hover:bg-muted">
                <Checkbox
                  checked={checked}
                  onCheckedChange={(v) =>
                    props.onChange(
                      v === true
                        ? [...props.value, o.id]
                        : props.value.filter((x) => x !== o.id)
                    )
                  }
                />
                {o.name}
                {!o.active ? (
                  <span className="text-muted-foreground"> (inativa)</span>
                ) : null}
              </label>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
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
