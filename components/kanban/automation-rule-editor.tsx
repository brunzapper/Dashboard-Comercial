// Versão: 1.4 | Data: 10/09/2026
// v1.4 (10/09/2026): `emptyRuleDraft()` — o rascunho em branco virou função
//   exportada. Ele estava escrito por extenso no "Nova regra" do sheet do
//   quadro, e a Tree passou a precisar do MESMO ponto de partida para criar uma
//   série de dentro da árvore. Duas cópias de um literal de trinta campos
//   divergiriam no primeiro campo novo — e a semente do "Novo esquema" do
//   Workflow já era prova disso: ela montava um `set_field` de campo e valor
//   VAZIOS, que `parseAutomationRule` recusa, então aquele caminho nunca criou
//   uma regra. Quem cria agora parte daqui.
// v1.3 (10/09/2026): "Espelhar com (dias)" — a antecedência com que a
//   ocorrência vira atividade no Bitrix (`SeriesConfig.mirrorLeadDays`). Junto
//   com "Quantas adiantar", são os dois números que decidem o que o vendedor vê
//   aqui e o que o CRM recebe, e ambos passam a ser da regra, não do código.
// v1.2 (10/09/2026): o SUBSTANTIVO da ocorrência virou controle ("Como chamar
//   cada uma"). Ele estava escrito no fonte, e a palavra não era a que este
//   projeto usa — vocabulário de domínio é do usuário, não do código. Padrão
//   "Tarefa" (DEFAULT_SERIES_NOUN); a tarefa individual ainda sobrepõe.
// v1.1 (09/09/2026): os controles da série que faltavam. `grantAttribute` tinha
//   campo no rascunho e NENHUM controle (a receita do manual — conceder o
//   atributo `tree` — era impossível de seguir pela tela), e
//   `from`/`description`/`maxOccurrences` não eram lidos de volta por
//   `draftFromRule`: qualquer save pela UI apagava os três em silêncio.
//   Entram também `lookahead` (ocorrências futuras) e `anchorFallback`.
// O EDITOR de uma regra de automação — extraído do painel do quadro para que a
// tela de construção do Workflow renderize exatamente ele.
//
// Por que extrair em vez de reescrever: uma automação e um fluxo têm de ser
// montados com o MESMO banco de peças (os seletores de campo de
// `getAutomationFieldOptions`, os operadores de `FILTER_OPS`, o catálogo de
// ações). Uma segunda tela com um segundo editor seria a régua paralela que a
// invariante 25 proíbe, e divergiria no primeiro campo novo.
//
// O componente não sabe ONDE está: quem o hospeda (o sheet do quadro ou a
// página do Workflow) traz o rascunho, o catálogo e o que fazer no salvar.
"use client";

import { Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FILTER_OPS, opHasNoValue } from "@/lib/widgets/filter-ops";
import type { SourceKey } from "@/lib/sources";
import { ATTRIBUTE_REGISTRY } from "@/lib/attributes/registry";
import {
  MIRROR_CHOICE_LABELS,
  type MirrorChoice,
} from "@/lib/tasks/mirror-config";
import {
  DEFAULT_MIRROR_LEAD_DAYS,
  DEFAULT_SERIES_LOOKAHEAD,
  DEFAULT_SERIES_NOUN,
  MAX_MIRROR_LEAD_DAYS,
  MAX_SERIES_LOOKAHEAD,
  MAX_SERIES_NOUN_LEN,
  seriesKeyFromLabel,
} from "@/lib/series/types";
import type { FilterOp, WidgetFilter } from "@/lib/widgets/types";
import {
  FilterValuePicker,
  type FilterValueSource,
} from "@/components/filters/filter-value-picker";
import { listFilterOptionCandidates } from "@/app/(app)/dashboards/actions";
import type { AutomationFieldCatalog } from "@/lib/kanban/automations/actions";
import {
  MAX_RULE_CONDITIONS,
  type AutomationCondition,
  type AutomationRow,
  type AutomationRule,
} from "@/lib/kanban/automations/types";

export const OP_OPTIONS: ComboboxOption[] = FILTER_OPS.map((o) => ({
  value: o.op,
  label: o.label,
}));

export const NUM_OP_OPTIONS: ComboboxOption[] = [
  { value: "gte", label: "pelo menos (≥)" },
  { value: "lte", label: "no máximo (≤)" },
  { value: "eq", label: "exatamente (=)" },
];

export const KIND_OPTIONS: ComboboxOption[] = [
  { value: "field", label: "Campo do registro" },
  { value: "related_count", label: "Registros conectados" },
  { value: "tasks", label: "Tarefas do card" },
  { value: "time", label: "Tempo" },
];

export const TASK_METRIC_OPTIONS: ComboboxOption[] = [
  { value: "open", label: "Tarefas abertas" },
  { value: "overdue", label: "Tarefas atrasadas" },
];

export const TIME_OP_OPTIONS: ComboboxOption[] = [
  { value: "gte", label: "há pelo menos" },
  { value: "lte", label: "há no máximo" },
];

// ---------- rascunho de UI ⇄ regra persistida ----------

export interface RelFilterDraft {
  field: string;
  op: string;
  // Array quando veio do picker de valor (`in`); string no texto livre.
  value: string | string[];
}

export interface CondDraft {
  kind: "field" | "related_count" | "tasks" | "time";
  field: string;
  op: string;
  value: string | string[];
  relSource: string;
  relFilters: RelFilterDraft[];
  numOp: "gte" | "lte" | "eq";
  numValue: string;
  taskMetric: "open" | "overdue";
  timeBasis: "created" | "in_column" | "field_changed";
  timeField: string; // ref do catálogo (custom:<k> | coluna core)
  timeOp: "gte" | "lte";
  timeDays: string;
}

export function emptyCond(): CondDraft {
  return {
    kind: "field",
    field: "",
    op: "eq",
    value: "",
    relSource: "",
    relFilters: [],
    numOp: "gte",
    numValue: "1",
    taskMetric: "open",
    timeBasis: "created",
    timeField: "",
    timeOp: "gte",
    timeDays: "7",
  };
}

export interface RuleDraft {
  id: string | null;
  name: string;
  enabled: boolean;
  conds: CondDraft[];
  actionType:
    | "move_to_column"
    | "set_field"
    | "create_task"
    | "run_schema"
    | "create_task_series";
  targetKey: string;
  setField: string;
  setValue: string;
  taskTitle: string;
  /** Vazio = sem prazo. */
  taskDueDays: string;
  schemaKey: string;
  /** Ensaio: avalia e grava o que faria, sem enviar nada. Começa LIGADO. */
  schemaSimulate: boolean;
  // --- Série periódica ---
  seriesTitle: string;
  /** Chave da série: identidade das exceções e do tronco da Tree. */
  seriesKey: string;
  seriesAnchorKind: "field_changed" | "created" | "field";
  seriesAnchorField: string;
  seriesCadenceDays: string;
  /** Escopos que podem sobrescrever a cadência, na ordem de precedência. */
  seriesScopes: { kind: "record" | "responsible" | "field"; field: string }[];
  seriesFirstAt: "apos_um_ciclo" | "imediato";
  /** Término: vazio, um campo de data, ou uma data fixa (YYYY-MM-DD). */
  seriesUntilKind: "nunca" | "field" | "date" | "field_changed";
  seriesUntilValue: string;
  seriesGrantAttribute: string;
  // v1.1 (09/09/2026): os quatro abaixo EXISTIAM no jsonb e não tinham
  // controle nenhum. `grantAttribute` só tinha campo de rascunho (sem JSX), e
  // `from`/`description`/`maxOccurrences` nem eram lidos de volta por
  // draftFromRule — ou seja, qualquer save pela UI APAGAVA os três em
  // silêncio. Sem o primeiro, a receita do manual (conceder o atributo `tree`)
  // era impossível de seguir pela tela.
  /** Início da janela: adia o começo da série sem mover a âncora. */
  seriesFromKind: "sempre" | "field" | "date" | "field_changed";
  seriesFromValue: string;
  seriesDescription: string;
  /** Teto de ocorrências por registro; vazio = sem teto. */
  seriesMaxOccurrences: string;
  /** Quantas futuras manter abertas além da devida hoje. */
  seriesLookahead: string;
  /** Âncora que não resolve: não gerar nada, ou contar da criação. */
  seriesAnchorFallback: "nenhum" | "criacao";
  /** Espelho no Bitrix (0136), nível 2: herda da Base por padrão. */
  seriesMirrorBitrix: MirrorChoice;
  seriesMirrorLeadDays: string;
  /**
   * v1.2: como esta série chama cada ocorrência. Vazio = DEFAULT_SERIES_NOUN.
   * É rótulo de exibição (o tronco da Tree) — não entra em chave nem consulta.
   */
  seriesNoun: string;
}

/**
 * O rascunho EM BRANCO — o ponto de partida de toda regra nova.
 *
 * Dono único (v1.4): o sheet do quadro, a tela do Workflow e a Tree criam a
 * partir daqui. Os defaults são os do pedido original da série (quinzenal,
 * concedendo o atributo `tree`), e o `actionType` é parâmetro porque quem cria
 * de dentro da árvore já sabe que quer uma série.
 */
export function emptyRuleDraft(
  actionType: RuleDraft["actionType"] = "move_to_column"
): RuleDraft {
  return {
    id: null,
    name: "",
    enabled: true,
    conds: [emptyCond()],
    actionType,
    taskTitle: "",
    taskDueDays: "",
    targetKey: "",
    setField: "",
    setValue: "",
    schemaKey: "",
    // Nasce em ensaio: armar é sempre um ato explícito.
    schemaSimulate: true,
    seriesTitle: "",
    seriesKey: "",
    seriesAnchorKind: "field_changed",
    seriesAnchorField: "",
    // Quinzenal: o padrão que o pedido descreve.
    seriesCadenceDays: "14",
    seriesScopes: [],
    seriesFirstAt: "apos_um_ciclo",
    seriesUntilKind: "nunca",
    seriesUntilValue: "",
    seriesGrantAttribute: "tree",
    seriesFromKind: "sempre",
    seriesFromValue: "",
    seriesDescription: "",
    seriesMaxOccurrences: "",
    seriesLookahead: String(DEFAULT_SERIES_LOOKAHEAD),
    seriesAnchorFallback: "nenhum",
    seriesMirrorBitrix: "herdar",
    seriesMirrorLeadDays: String(DEFAULT_MIRROR_LEAD_DAYS),
    seriesNoun: DEFAULT_SERIES_NOUN,
  };
}

/**
 * O rascunho de uma SÉRIE nova, já convertível por `draftToRule`.
 *
 * v1.4: existe porque duas telas criam série sem passar pelo construtor antes
 * — o "Novo esquema" do Workflow e a Tree. As duas precisavam de um ponto de
 * partida VÁLIDO: a semente anterior do Workflow montava um `set_field` de
 * campo e valor vazios, que `parseAutomationRule` recusa, então o botão
 * "Criar" daquela tela nunca criou regra nenhuma.
 *
 * A condição semeada ("criado há 0 dias ou mais") casa com todo registro da
 * Base de propósito: a regra nasce DESLIGADA, e quem a liga passa pelo
 * construtor para dizer quais registros participam.
 */
export function seedSeriesDraft(name: string): RuleDraft {
  const label = name.trim();
  return {
    ...emptyRuleDraft("create_task_series"),
    name: label,
    conds: [
      { ...emptyCond(), kind: "time", timeBasis: "created", timeOp: "gte", timeDays: "0" },
    ],
    seriesTitle: label || "Acompanhamento",
    seriesKey: seriesKeyFromLabel(label),
    // `created` não pede campo: a âncora que exige um (`field_changed`) faria
    // a semente nascer inválida, que é o defeito que este helper corrige.
    seriesAnchorKind: "created",
  };
}

/**
 * Atributos que a série pode conceder — do REGISTRY, nunca de uma lista
 * paralela. v1.1 (09/09/2026): antes não havia controle nenhum, e sem conceder
 * o atributo a Tree do registro simplesmente não existia.
 */
/** Nível 2 do espelho (0136). "herdar" é o padrão: segue a Base. */
const MIRROR_CHOICES: ComboboxOption[] = (
  ["herdar", "sempre", "nunca"] as MirrorChoice[]
).map((v) => ({ value: v, label: MIRROR_CHOICE_LABELS[v] }));

const ATTRIBUTE_OPTIONS: ComboboxOption[] = ATTRIBUTE_REGISTRY.map((a) => ({
  value: a.key,
  label: a.label,
  description: a.description,
}));

export const ACTION_OPTIONS: ComboboxOption[] = [
  { value: "move_to_column", label: "Mover para a coluna" },
  { value: "set_field", label: "Definir campo" },
  { value: "create_task", label: "Abrir tarefa" },
  { value: "run_schema", label: "Executar esquema" },
  { value: "create_task_series", label: "Série de tarefas (recorrente)" },
];

const ANCHOR_OPTIONS: ComboboxOption[] = [
  { value: "field_changed", label: "Desde a última alteração de um campo" },
  { value: "created", label: "Desde a criação do registro" },
  { value: "field", label: "A partir de uma data do registro" },
];

const SCOPE_OPTIONS: ComboboxOption[] = [
  { value: "record", label: "Registro" },
  { value: "responsible", label: "Responsável" },
  { value: "field", label: "Campo do registro" },
];

const BOOL_OPTIONS: ComboboxOption[] = [
  { value: "true", label: "Sim" },
  { value: "false", label: "Não" },
];

// Serializa rascunho → WidgetFilter. `in` em ARRAY (picker) passa intacto
// (valor com vírgula sobrevive); string divide por vírgula (digitação manual).
export function toWidgetFilter(d: RelFilterDraft): WidgetFilter | null {
  if (!d.field || !d.op) return null;
  const op = d.op as FilterOp;
  if (opHasNoValue(op)) return { field: d.field, op };
  if (op === "in") {
    const list = (Array.isArray(d.value) ? d.value : d.value.split(","))
      .map((s) => String(s).trim())
      .filter(Boolean);
    return list.length > 0 ? { field: d.field, op, value: list } : null;
  }
  const value = Array.isArray(d.value) ? (d.value[0] ?? "") : d.value;
  if (value === "") return null;
  return { field: d.field, op, value };
}

const refToFmodKey = (ref: string) =>
  ref.startsWith("custom:") ? ref.slice("custom:".length) : ref;

export function draftToRule(draft: RuleDraft): AutomationRule | null {
  const conditions: AutomationCondition[] = [];
  for (const c of draft.conds) {
    if (c.kind === "field") {
      const filter = toWidgetFilter(c);
      if (!filter) return null;
      conditions.push({ kind: "field", filter });
    } else if (c.kind === "related_count") {
      const n = Number(c.numValue);
      if (!c.relSource || !Number.isFinite(n) || n < 0) return null;
      const filters: WidgetFilter[] = [];
      for (const f of c.relFilters) {
        const empty = Array.isArray(f.value) ? f.value.length === 0 : !f.value;
        if (!f.field && empty) continue; // linha vazia
        const parsed = toWidgetFilter(f);
        if (!parsed) return null;
        filters.push(parsed);
      }
      conditions.push({
        kind: "related_count",
        source: c.relSource,
        filters,
        op: c.numOp,
        value: n,
      });
    } else if (c.kind === "tasks") {
      const n = Number(c.numValue);
      if (!Number.isFinite(n) || n < 0) return null;
      conditions.push({ kind: "tasks", metric: c.taskMetric, op: c.numOp, value: n });
    } else {
      const days = Number(c.timeDays);
      if (!Number.isFinite(days) || days < 0) return null;
      if (c.timeBasis === "field_changed" && !c.timeField) return null;
      conditions.push({
        kind: "time",
        basis:
          c.timeBasis === "field_changed"
            ? { type: "field_changed", field: refToFmodKey(c.timeField) }
            : { type: c.timeBasis },
        op: c.timeOp,
        days,
      });
    }
  }
  if (conditions.length === 0) return null;
  if (draft.actionType === "create_task") {
    if (draft.taskTitle.trim() === "") return null;
    const days = draft.taskDueDays.trim();
    const dueInDays = days === "" ? null : Number(days);
    if (dueInDays != null && (!Number.isFinite(dueInDays) || dueInDays < 0)) {
      return null;
    }
    return {
      v: 1,
      conditions,
      action: {
        type: "create_task",
        title: draft.taskTitle.trim(),
        dueInDays,
        // O responsável do REGISTRO é o padrão: a tarefa nasce com quem já
        // cuida daquele lead, não numa fila anônima.
        responsibleFrom: "record",
      },
    };
  }
  if (draft.actionType === "create_task_series") {
    const days = Number(draft.seriesCadenceDays);
    if (draft.seriesTitle.trim() === "") return null;
    if (!Number.isFinite(days) || days < 1) return null;
    if (
      (draft.seriesAnchorKind === "field_changed" ||
        draft.seriesAnchorKind === "field") &&
      draft.seriesAnchorField === ""
    ) {
      return null;
    }
    // A chave sai do título quando o usuário não a informa — ela é identidade
    // (as exceções e o tronco da Tree apontam para ela), não rótulo.
    const key =
      draft.seriesKey.trim() ||
      draft.seriesTitle
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "")
        .slice(0, 40);
    return {
      v: 1,
      conditions,
      action: {
        type: "create_task_series",
        series: {
          key: /^[a-z]/.test(key) ? key : `serie_${key}`.slice(0, 40),
          title: draft.seriesTitle.trim(),
          anchor:
            draft.seriesAnchorKind === "created"
              ? { kind: "created" }
              : {
                  kind: draft.seriesAnchorKind,
                  field: draft.seriesAnchorField,
                },
          cadence: {
            defaultDays: Math.floor(days),
            overrideScopes: draft.seriesScopes
              .filter((sc) => sc.kind !== "field" || sc.field !== "")
              .map((sc) =>
                sc.kind === "field"
                  ? { kind: "field" as const, field: sc.field }
                  : { kind: sc.kind }
              ),
          },
          firstAt: draft.seriesFirstAt,
          ...(draft.seriesUntilKind !== "nunca" && draft.seriesUntilValue
            ? {
                until:
                  draft.seriesUntilKind === "date"
                    ? { kind: "date" as const, date: draft.seriesUntilValue }
                    : draft.seriesUntilKind === "field_changed"
                      ? {
                          kind: "field_changed" as const,
                          field: draft.seriesUntilValue,
                        }
                      : { kind: "field" as const, field: draft.seriesUntilValue },
              }
            : {}),
          // v1.1: os campos que a UI perdia no round-trip.
          ...(draft.seriesFromKind !== "sempre" && draft.seriesFromValue
            ? {
                from:
                  draft.seriesFromKind === "date"
                    ? { kind: "date" as const, date: draft.seriesFromValue }
                    : draft.seriesFromKind === "field_changed"
                      ? {
                          kind: "field_changed" as const,
                          field: draft.seriesFromValue,
                        }
                      : { kind: "field" as const, field: draft.seriesFromValue },
              }
            : {}),
          ...(draft.seriesDescription.trim()
            ? { description: draft.seriesDescription.trim() }
            : {}),
          ...(Number(draft.seriesMaxOccurrences) > 0
            ? { maxOccurrences: Math.floor(Number(draft.seriesMaxOccurrences)) }
            : {}),
          lookahead: Math.min(
            Math.max(Math.floor(Number(draft.seriesLookahead) || 0), 0),
            MAX_SERIES_LOOKAHEAD
          ),
          ...(draft.seriesAnchorFallback === "criacao"
            ? { anchorFallback: "criacao" as const }
            : {}),
          ...(draft.seriesMirrorBitrix !== "herdar"
            ? { mirrorBitrix: draft.seriesMirrorBitrix }
            : {}),
          mirrorLeadDays: Math.min(
            Math.max(Math.floor(Number(draft.seriesMirrorLeadDays) || 0), 0),
            MAX_MIRROR_LEAD_DAYS
          ),
          ...(draft.seriesGrantAttribute
            ? { grantAttribute: draft.seriesGrantAttribute }
            : {}),
          // v1.2: só grava quando o usuário escolheu OUTRO nome — regra sem a
          // chave segue com o padrão, e o jsonb não engorda com o default.
          ...(draft.seriesNoun.trim() &&
          draft.seriesNoun.trim() !== DEFAULT_SERIES_NOUN
            ? { noun: draft.seriesNoun.trim().slice(0, MAX_SERIES_NOUN_LEN) }
            : {}),
        },
      },
    };
  }
  if (draft.actionType === "run_schema") {
    if (!draft.schemaKey) return null;
    return {
      v: 1,
      conditions,
      action: {
        type: "run_schema",
        schemaKey: draft.schemaKey,
        simulate: draft.schemaSimulate,
      },
    };
  }
  if (draft.actionType === "set_field") {
    if (!draft.setField || draft.setValue.trim() === "") return null;
    return {
      v: 1,
      conditions,
      action: {
        type: "set_field",
        field: draft.setField,
        value: draft.setValue,
      },
    };
  }
  if (!draft.targetKey) return null;
  return {
    v: 1,
    conditions,
    action: { type: "move_to_column", targetKey: draft.targetKey },
  };
}

export function ruleToDraft(row: AutomationRow, fieldOptions: ComboboxOption[]): RuleDraft {
  const fmodKeyToRef = (key: string) =>
    fieldOptions.some((o) => o.value === key) ? key : `custom:${key}`;
  const conds: CondDraft[] = row.rule.conditions.map((c) => {
    const d = emptyCond();
    if (c.kind === "field") {
      d.kind = "field";
      d.field = c.filter.field;
      d.op = c.filter.op;
      d.value = Array.isArray(c.filter.value)
        ? c.filter.value.map((v) => String(v))
        : c.filter.value == null
          ? ""
          : String(c.filter.value);
    } else if (c.kind === "related_count") {
      d.kind = "related_count";
      d.relSource = c.source;
      d.numOp = c.op;
      d.numValue = String(c.value);
      d.relFilters = c.filters.map((f) => ({
        field: f.field,
        op: f.op,
        value: Array.isArray(f.value)
          ? f.value.map((v) => String(v))
          : f.value == null
            ? ""
            : String(f.value),
      }));
    } else if (c.kind === "tasks") {
      d.kind = "tasks";
      d.taskMetric = c.metric;
      d.numOp = c.op;
      d.numValue = String(c.value);
    } else {
      d.kind = "time";
      d.timeBasis = c.basis.type;
      d.timeField =
        c.basis.type === "field_changed" ? fmodKeyToRef(c.basis.field) : "";
      d.timeOp = c.op;
      d.timeDays = String(c.days);
    }
    return d;
  });
  const action = row.rule.action;
  return {
    id: row.id,
    name: row.name,
    enabled: row.enabled,
    conds,
    actionType: action.type,
    targetKey: action.type === "move_to_column" ? action.targetKey : "",
    setField: action.type === "set_field" ? action.field : "",
    setValue: action.type === "set_field" ? action.value : "",
    taskTitle: action.type === "create_task" ? action.title : "",
    taskDueDays:
      action.type === "create_task" && action.dueInDays != null
        ? String(action.dueInDays)
        : "",
    schemaKey: action.type === "run_schema" ? action.schemaKey : "",
    // Regra que não é de esquema volta ao editor com o ensaio ligado: trocar a
    // ação para "Executar esquema" nunca arma sozinha.
    schemaSimulate: action.type === "run_schema" ? action.simulate : true,
    seriesTitle:
      action.type === "create_task_series" ? String(action.series.title) : "",
    seriesKey: action.type === "create_task_series" ? action.series.key : "",
    seriesAnchorKind:
      action.type === "create_task_series" ? action.series.anchor.kind : "field_changed",
    seriesAnchorField:
      action.type === "create_task_series" && action.series.anchor.kind !== "created"
        ? action.series.anchor.field
        : "",
    seriesCadenceDays:
      action.type === "create_task_series"
        ? String(action.series.cadence.defaultDays)
        : "14",
    seriesScopes:
      action.type === "create_task_series"
        ? action.series.cadence.overrideScopes.map((sc) => ({
            kind: sc.kind,
            field: sc.field ?? "",
          }))
        : [],
    seriesFirstAt:
      action.type === "create_task_series" ? action.series.firstAt : "apos_um_ciclo",
    seriesUntilKind:
      action.type === "create_task_series" && action.series.until
        ? action.series.until.kind
        : "nunca",
    seriesUntilValue:
      action.type === "create_task_series" && action.series.until
        ? action.series.until.kind === "date"
          ? action.series.until.date
          : action.series.until.field
        : "",
    seriesGrantAttribute:
      action.type === "create_task_series"
        ? (action.series.grantAttribute ?? "")
        : "tree",
    // v1.1: sem estas quatro leituras, editar e salvar a regra APAGAVA o que
    // estava gravado no jsonb.
    seriesFromKind:
      action.type === "create_task_series" && action.series.from
        ? action.series.from.kind
        : "sempre",
    seriesFromValue:
      action.type === "create_task_series" && action.series.from
        ? action.series.from.kind === "date"
          ? action.series.from.date
          : action.series.from.field
        : "",
    seriesDescription:
      action.type === "create_task_series"
        ? (action.series.description ?? "")
        : "",
    seriesMaxOccurrences:
      action.type === "create_task_series" && action.series.maxOccurrences
        ? String(action.series.maxOccurrences)
        : "",
    seriesLookahead:
      action.type === "create_task_series"
        ? String(action.series.lookahead ?? DEFAULT_SERIES_LOOKAHEAD)
        : String(DEFAULT_SERIES_LOOKAHEAD),
    seriesAnchorFallback:
      action.type === "create_task_series"
        ? (action.series.anchorFallback ?? "nenhum")
        : "nenhum",
    seriesMirrorLeadDays: String(
      action?.type === "create_task_series"
        ? (action.series.mirrorLeadDays ?? DEFAULT_MIRROR_LEAD_DAYS)
        : DEFAULT_MIRROR_LEAD_DAYS
    ),
    seriesMirrorBitrix:
      action.type === "create_task_series"
        ? (action.series.mirrorBitrix ?? "herdar")
        : "herdar",
    // v1.2: sem esta leitura, salvar a regra apagaria o substantivo escolhido
    // — o mesmo buraco que engoliu from/description/maxOccurrences na v1.1.
    seriesNoun:
      action.type === "create_task_series"
        ? (action.series.noun ?? DEFAULT_SERIES_NOUN)
        : DEFAULT_SERIES_NOUN,
  };
}

// Cache de MÓDULO das listas do picker de valor (responsável/operação por id;
// etapa por base) — compartilhado entre quadros/aberturas do painel.
const autoValueOptionCache = new Map<
  string,
  Promise<{ value: string; label: string }[]>
>();

// Picker de VALOR (31/07/2026): a avaliação das automações compara a COLUNA
// CRUA (evaluate.ts) — relações GRAVAM O ID e o picker exibe o rótulo;
// etapa/seleção gravam o próprio rótulo. `scopeSource` = base do quadro
// (condição de campo) ou base conectada (filtro dos conectados); etapa sem
// base = lista global.
export function autoFilterValueSource(
  field: string,
  scopeSource: string | undefined,
  selectOptionsByField?: Record<string, string[]>
): FilterValueSource | null {
  if (field === "responsible_id" || field === "operation_id" || field === "stage") {
    const kind =
      field === "responsible_id"
        ? ("responsible" as const)
        : field === "operation_id"
          ? ("operation" as const)
          : ("stage" as const);
    const cacheKey = kind === "stage" ? `stage:${scopeSource || "*"}` : kind;
    return {
      kind,
      storeAs: "value",
      load: () => {
        const cached = autoValueOptionCache.get(cacheKey);
        if (cached) return cached;
        const p = listFilterOptionCandidates(
          kind,
          kind === "stage" && scopeSource
            ? [scopeSource as SourceKey]
            : undefined
        );
        autoValueOptionCache.set(cacheKey, p);
        return p;
      },
    };
  }
  const opts = selectOptionsByField?.[field];
  if (!opts || opts.length === 0) return null;
  return {
    kind: "static",
    storeAs: "value",
    load: () => Promise.resolve(opts.map((o) => ({ value: o, label: o }))),
  };
}

/**
 * O corpo do editor. `onSave`/`onCancel` são de quem hospeda: no sheet o
 * cancelar volta para a lista de regras, na tela do Workflow ele volta para a
 * lista de esquemas.
 */
export function AutomationRuleEditor({
  draft,
  setDraft,
  catalog,
  source,
  targetOptions,
  fieldOptions,
  relSourceOptions,
  timeBasisOptions,
  actionOptions,
  saving,
  onSave,
  onCancel,
  saveLabel = "Salvar regra",
}: {
  draft: RuleDraft;
  setDraft: React.Dispatch<React.SetStateAction<RuleDraft | null>>;
  catalog: AutomationFieldCatalog | null;
  source?: string;
  targetOptions: ComboboxOption[];
  fieldOptions: ComboboxOption[];
  /**
   * Listas que dependem do CONTEXTO (há quadro? colunas são "Personalizar"?),
   * montadas por quem hospeda. O editor não adivinha o dono da regra — é o
   * host que sabe se existe posição para cronometrar.
   */
  relSourceOptions: ComboboxOption[];
  timeBasisOptions: ComboboxOption[];
  actionOptions: ComboboxOption[];
  saving: boolean;
  onSave: () => void;
  onCancel: () => void;
  saveLabel?: string;
}) {
  // "Desde a última alteração de…": só refs com carimbo em field_modified_at
  // (unificados/casados não têm). Derivado aqui porque só depende do catálogo.
  const fmodFieldOptions = fieldOptions.filter(
    (o) => !o.value.startsWith("unified:") && !o.value.startsWith("match:")
  );

  const patchCond = (i: number, p: Partial<CondDraft>) =>
    setDraft((d) =>
      d
        ? { ...d, conds: d.conds.map((c, j) => (j === i ? { ...c, ...p } : c)) }
        : d
    );

  return (
          <div className="flex flex-col gap-3 px-4 pb-6">
            <div className="flex flex-col gap-1">
              <Label className="text-xs">Nome da regra</Label>
              <Input
                value={draft.name}
                onChange={(e) =>
                  setDraft((d) => (d ? { ...d, name: e.target.value } : d))
                }
                placeholder="Ex.: Parceiro ativo"
              />
            </div>

            <p className="text-muted-foreground text-xs">
              As condições valem em conjunto (E) — misture campos, conexões,
              tarefas e tempo na mesma regra.
            </p>

            {draft.conds.map((c, i) => (
              <div
                key={i}
                className="flex flex-col gap-2 rounded-md border p-3"
              >
                <div className="flex items-end gap-2">
                  <div className="flex min-w-44 flex-col gap-1">
                    <Label className="text-xs">Tipo de condição</Label>
                    <Combobox
                      options={KIND_OPTIONS}
                      value={c.kind}
                      onValueChange={(v) =>
                        patchCond(i, { kind: v as CondDraft["kind"] })
                      }
                      searchable={false}
                      aria-label="Tipo de condição"
                    />
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="text-destructive size-8"
                    title="Remover condição"
                    onClick={() =>
                      setDraft((d) =>
                        d
                          ? { ...d, conds: d.conds.filter((_, j) => j !== i) }
                          : d
                      )
                    }
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>

                {c.kind === "field" ? (
                  <div className="flex flex-wrap items-end gap-2">
                    <div className="flex min-w-44 flex-1 flex-col gap-1">
                      <Label className="text-xs">Campo</Label>
                      <Combobox
                        options={fieldOptions}
                        value={c.field}
                        onValueChange={(v) => patchCond(i, { field: v })}
                        placeholder="Campo"
                        aria-label="Campo"
                      />
                    </div>
                    <div className="flex min-w-32 flex-col gap-1">
                      <Label className="text-xs">Operador</Label>
                      <Combobox
                        options={OP_OPTIONS}
                        value={c.op}
                        onValueChange={(v) => patchCond(i, { op: v })}
                        searchable={false}
                        aria-label="Operador"
                      />
                    </div>
                    {!opHasNoValue(c.op as FilterOp) ? (
                      <div className="flex min-w-36 flex-1 flex-col gap-1">
                        <Label className="text-xs">Valor</Label>
                        {(() => {
                          const vs = autoFilterValueSource(
                            c.field,
                            source,
                            catalog?.selectOptionsByField
                          );
                          return vs && ["eq", "neq", "in"].includes(c.op) ? (
                            <FilterValuePicker
                              source={vs}
                              multi={c.op === "in"}
                              value={c.value}
                              onChange={(value) => patchCond(i, { value })}
                              ariaLabel="Valor"
                            />
                          ) : (
                            <Input
                              value={
                                Array.isArray(c.value)
                                  ? c.value.join(", ")
                                  : c.value
                              }
                              onChange={(e) =>
                                patchCond(i, { value: e.target.value })
                              }
                              placeholder={
                                c.op === "in" ? "valor1, valor2, ..." : "valor"
                              }
                            />
                          );
                        })()}
                      </div>
                    ) : null}
                  </div>
                ) : null}

                {c.kind === "related_count" ? (
                  <div className="flex flex-col gap-2">
                    <div className="flex flex-wrap items-end gap-2">
                      <div className="flex min-w-40 flex-col gap-1">
                        <Label className="text-xs">Base conectada</Label>
                        <Combobox
                          options={relSourceOptions}
                          value={c.relSource}
                          onValueChange={(v) => patchCond(i, { relSource: v })}
                          placeholder="Base"
                          aria-label="Base conectada"
                        />
                      </div>
                      <div className="flex min-w-36 flex-col gap-1">
                        <Label className="text-xs">Quantidade</Label>
                        <Combobox
                          options={NUM_OP_OPTIONS}
                          value={c.numOp}
                          onValueChange={(v) =>
                            patchCond(i, { numOp: v as CondDraft["numOp"] })
                          }
                          searchable={false}
                          aria-label="Comparação"
                        />
                      </div>
                      <div className="flex w-20 flex-col gap-1">
                        <Label className="text-xs">Nº</Label>
                        <Input
                          type="number"
                          min={0}
                          value={c.numValue}
                          onChange={(e) =>
                            patchCond(i, { numValue: e.target.value })
                          }
                        />
                      </div>
                    </div>
                    {c.relFilters.map((f, k) => (
                      <div key={k} className="flex flex-wrap items-end gap-2 pl-3">
                        <div className="flex min-w-40 flex-1 flex-col gap-1">
                          <Label className="text-xs">Campo do conectado</Label>
                          <Combobox
                            options={
                              (catalog?.fieldsBySource[c.relSource] ??
                                []) as ComboboxOption[]
                            }
                            value={f.field}
                            onValueChange={(v) =>
                              patchCond(i, {
                                relFilters: c.relFilters.map((x, y) =>
                                  y === k ? { ...x, field: v } : x
                                ),
                              })
                            }
                            placeholder="Campo"
                            aria-label="Campo do conectado"
                          />
                        </div>
                        <div className="flex min-w-28 flex-col gap-1">
                          <Label className="text-xs">Operador</Label>
                          <Combobox
                            options={OP_OPTIONS}
                            value={f.op}
                            onValueChange={(v) =>
                              patchCond(i, {
                                relFilters: c.relFilters.map((x, y) =>
                                  y === k ? { ...x, op: v } : x
                                ),
                              })
                            }
                            searchable={false}
                            aria-label="Operador do conectado"
                          />
                        </div>
                        {!opHasNoValue(f.op as FilterOp) ? (
                          <div className="flex min-w-32 flex-1 flex-col gap-1">
                            <Label className="text-xs">Valor</Label>
                            {(() => {
                              const vs = autoFilterValueSource(
                                f.field,
                                c.relSource || undefined,
                                catalog?.selectOptionsByField
                              );
                              const setValue = (value: string | string[]) =>
                                patchCond(i, {
                                  relFilters: c.relFilters.map((x, y) =>
                                    y === k ? { ...x, value } : x
                                  ),
                                });
                              return vs &&
                                ["eq", "neq", "in"].includes(f.op) ? (
                                <FilterValuePicker
                                  source={vs}
                                  multi={f.op === "in"}
                                  value={f.value}
                                  onChange={setValue}
                                  ariaLabel="Valor do conectado"
                                />
                              ) : (
                                <Input
                                  value={
                                    Array.isArray(f.value)
                                      ? f.value.join(", ")
                                      : f.value
                                  }
                                  onChange={(e) => setValue(e.target.value)}
                                />
                              );
                            })()}
                          </div>
                        ) : null}
                        <Button
                          variant="ghost"
                          size="icon"
                          className="text-destructive size-8"
                          title="Remover filtro"
                          onClick={() =>
                            patchCond(i, {
                              relFilters: c.relFilters.filter(
                                (_, y) => y !== k
                              ),
                            })
                          }
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      </div>
                    ))}
                    <Button
                      variant="ghost"
                      size="sm"
                      className="self-start"
                      onClick={() =>
                        patchCond(i, {
                          relFilters: [
                            ...c.relFilters,
                            { field: "", op: "eq", value: "" },
                          ],
                        })
                      }
                      disabled={!c.relSource}
                    >
                      + Filtrar os conectados
                    </Button>
                  </div>
                ) : null}

                {c.kind === "tasks" ? (
                  <div className="flex flex-wrap items-end gap-2">
                    <div className="flex min-w-40 flex-col gap-1">
                      <Label className="text-xs">Métrica</Label>
                      <Combobox
                        options={TASK_METRIC_OPTIONS}
                        value={c.taskMetric}
                        onValueChange={(v) =>
                          patchCond(i, {
                            taskMetric: v as CondDraft["taskMetric"],
                          })
                        }
                        searchable={false}
                        aria-label="Métrica de tarefas"
                      />
                    </div>
                    <div className="flex min-w-36 flex-col gap-1">
                      <Label className="text-xs">Quantidade</Label>
                      <Combobox
                        options={NUM_OP_OPTIONS}
                        value={c.numOp}
                        onValueChange={(v) =>
                          patchCond(i, { numOp: v as CondDraft["numOp"] })
                        }
                        searchable={false}
                        aria-label="Comparação"
                      />
                    </div>
                    <div className="flex w-20 flex-col gap-1">
                      <Label className="text-xs">Nº</Label>
                      <Input
                        type="number"
                        min={0}
                        value={c.numValue}
                        onChange={(e) =>
                          patchCond(i, { numValue: e.target.value })
                        }
                      />
                    </div>
                  </div>
                ) : null}

                {c.kind === "time" ? (
                  <div className="flex flex-wrap items-end gap-2">
                    <div className="flex min-w-48 flex-col gap-1">
                      <Label className="text-xs">Base de tempo</Label>
                      <Combobox
                        options={timeBasisOptions}
                        value={c.timeBasis}
                        onValueChange={(v) =>
                          patchCond(i, {
                            timeBasis: v as CondDraft["timeBasis"],
                          })
                        }
                        searchable={false}
                        aria-label="Base de tempo"
                      />
                    </div>
                    {c.timeBasis === "field_changed" ? (
                      <div className="flex min-w-40 flex-1 flex-col gap-1">
                        <Label className="text-xs">Campo</Label>
                        <Combobox
                          options={fmodFieldOptions}
                          value={c.timeField}
                          onValueChange={(v) => patchCond(i, { timeField: v })}
                          placeholder="Campo"
                          aria-label="Campo da base de tempo"
                        />
                      </div>
                    ) : null}
                    <div className="flex min-w-36 flex-col gap-1">
                      <Label className="text-xs">Condição</Label>
                      <Combobox
                        options={TIME_OP_OPTIONS}
                        value={c.timeOp}
                        onValueChange={(v) =>
                          patchCond(i, { timeOp: v as CondDraft["timeOp"] })
                        }
                        searchable={false}
                        aria-label="Comparação de tempo"
                      />
                    </div>
                    <div className="flex w-20 flex-col gap-1">
                      <Label className="text-xs">Dias</Label>
                      <Input
                        type="number"
                        min={0}
                        value={c.timeDays}
                        onChange={(e) =>
                          patchCond(i, { timeDays: e.target.value })
                        }
                      />
                    </div>
                  </div>
                ) : null}
              </div>
            ))}

            <Button
              variant="outline"
              size="sm"
              className="self-start"
              onClick={() =>
                setDraft((d) =>
                  d ? { ...d, conds: [...d.conds, emptyCond()] } : d
                )
              }
              disabled={draft.conds.length >= MAX_RULE_CONDITIONS}
            >
              + Adicionar condição
            </Button>

            <div className="flex flex-wrap items-end gap-2">
              <div className="flex min-w-44 flex-col gap-1">
                <Label className="text-xs">Então</Label>
                <Combobox
                  options={actionOptions}
                  value={draft.actionType}
                  onValueChange={(v) =>
                    setDraft((d) =>
                      d ? { ...d, actionType: v as RuleDraft["actionType"] } : d
                    )
                  }
                  searchable={false}
                  aria-label="Ação da regra"
                />
              </div>
              {draft.actionType === "move_to_column" ? (
                <div className="flex min-w-48 flex-1 flex-col gap-1">
                  <Label className="text-xs">Coluna de destino</Label>
                  <Combobox
                    options={targetOptions}
                    value={draft.targetKey}
                    onValueChange={(v) =>
                      setDraft((d) => (d ? { ...d, targetKey: v } : d))
                    }
                    placeholder="Coluna de destino"
                    aria-label="Coluna de destino"
                  />
                </div>
              ) : draft.actionType === "create_task_series" ? (
                <div className="flex min-w-56 flex-1 flex-col gap-3">
                  <div className="flex flex-wrap items-end gap-2">
                    <div className="flex min-w-56 flex-1 flex-col gap-1">
                      <Label className="text-xs">Título da tarefa</Label>
                      <Input
                        value={draft.seriesTitle}
                        onChange={(e) =>
                          setDraft((d) =>
                            d ? { ...d, seriesTitle: e.target.value } : d
                          )
                        }
                        placeholder="Ex.: Follow-up de nutrição"
                        aria-label="Título da tarefa da série"
                      />
                    </div>
                    <div className="flex w-32 flex-col gap-1">
                      <Label className="text-xs">A cada (dias)</Label>
                      <Input
                        type="number"
                        min={1}
                        value={draft.seriesCadenceDays}
                        onChange={(e) =>
                          setDraft((d) =>
                            d ? { ...d, seriesCadenceDays: e.target.value } : d
                          )
                        }
                        aria-label="Cadência padrão em dias"
                      />
                    </div>
                  </div>

                  <div className="flex flex-wrap items-end gap-2">
                    <div className="flex min-w-56 flex-1 flex-col gap-1">
                      <Label className="text-xs">Contar a partir de</Label>
                      <Combobox
                        options={ANCHOR_OPTIONS}
                        value={draft.seriesAnchorKind}
                        onValueChange={(v) =>
                          setDraft((d) =>
                            d
                              ? {
                                  ...d,
                                  seriesAnchorKind:
                                    v as RuleDraft["seriesAnchorKind"],
                                }
                              : d
                          )
                        }
                        searchable={false}
                        aria-label="Âncora da contagem"
                      />
                    </div>
                    {draft.seriesAnchorKind !== "created" ? (
                      <div className="flex min-w-48 flex-1 flex-col gap-1">
                        <Label className="text-xs">Campo</Label>
                        <Combobox
                          options={(catalog?.fields ?? []) as ComboboxOption[]}
                          value={draft.seriesAnchorField}
                          onValueChange={(v) =>
                            setDraft((d) =>
                              d ? { ...d, seriesAnchorField: v } : d
                            )
                          }
                          placeholder="Campo"
                          aria-label="Campo da âncora"
                        />
                      </div>
                    ) : null}
                  </div>
                  <p className="text-muted-foreground text-xs">
                    As condições acima dizem QUAIS registros entram; a âncora diz
                    de quando começar a contar. São coisas diferentes: a etapa
                    seleciona, a data da mudança de etapa cronometra.
                  </p>

                  {/* v1.1 (09/09/2026): os controles que faltavam. Sem o de
                      atributo, conceder o `tree` (e portanto ter a Tree do
                      registro) era impossível pela tela; os de janela,
                      descrição e teto existiam no jsonb e eram APAGADOS a cada
                      save, porque draftFromRule não os lia de volta. */}
                  <div className="flex flex-wrap items-end gap-2">
                    <div className="flex w-44 flex-col gap-1">
                      <Label className="text-xs">Como chamar cada uma</Label>
                      <Input
                        value={draft.seriesNoun}
                        maxLength={MAX_SERIES_NOUN_LEN}
                        onChange={(e) =>
                          setDraft((d) =>
                            d ? { ...d, seriesNoun: e.target.value } : d
                          )
                        }
                        placeholder={DEFAULT_SERIES_NOUN}
                        aria-label="Substantivo de cada ocorrência da série"
                      />
                    </div>
                    <div className="flex w-40 flex-col gap-1">
                      <Label className="text-xs">Quantas adiantar</Label>
                      <Input
                        type="number"
                        min={0}
                        max={MAX_SERIES_LOOKAHEAD}
                        value={draft.seriesLookahead}
                        onChange={(e) =>
                          setDraft((d) =>
                            d ? { ...d, seriesLookahead: e.target.value } : d
                          )
                        }
                        aria-label="Ocorrências futuras mantidas abertas"
                      />
                    </div>
                    <div className="flex w-56 flex-col gap-1">
                      <Label className="text-xs">Sem data de início</Label>
                      <Combobox
                        options={[
                          { value: "nenhum", label: "Não gerar nada" },
                          { value: "criacao", label: "Contar da criação" },
                        ]}
                        value={draft.seriesAnchorFallback}
                        onValueChange={(v) =>
                          setDraft((d) =>
                            d
                              ? {
                                  ...d,
                                  seriesAnchorFallback:
                                    v as RuleDraft["seriesAnchorFallback"],
                                }
                              : d
                          )
                        }
                        searchable={false}
                        aria-label="Quando a âncora não resolve"
                      />
                    </div>
                    <div className="flex w-40 flex-col gap-1">
                      <Label className="text-xs">Máximo por registro</Label>
                      <Input
                        type="number"
                        min={0}
                        value={draft.seriesMaxOccurrences}
                        onChange={(e) =>
                          setDraft((d) =>
                            d
                              ? { ...d, seriesMaxOccurrences: e.target.value }
                              : d
                          )
                        }
                        placeholder="sem teto"
                        aria-label="Máximo de ocorrências por registro"
                      />
                    </div>
                  </div>
                  <p className="text-muted-foreground text-xs">
                    Além da devida hoje, a série mantém abertas as próximas —
                    dá para ver e remarcar o que vem pela frente em vez de
                    esperar o dia. O que já venceu e ninguém abriu NÃO é criado
                    retroativamente; aparece na Tree como galho vazio.
                  </p>

                  <div className="flex flex-wrap items-end gap-2">
                    <div className="flex w-44 flex-col gap-1">
                      <Label className="text-xs">Começar em</Label>
                      <Combobox
                        options={[
                          { value: "sempre", label: "Desde a âncora" },
                          { value: "date", label: "A partir de uma data" },
                          { value: "field", label: "A partir de um campo" },
                          {
                            value: "field_changed",
                            label: "Quando um campo mudar",
                          },
                        ]}
                        value={draft.seriesFromKind}
                        onValueChange={(v) =>
                          setDraft((d) =>
                            d
                              ? {
                                  ...d,
                                  seriesFromKind:
                                    v as RuleDraft["seriesFromKind"],
                                  seriesFromValue: "",
                                }
                              : d
                          )
                        }
                        searchable={false}
                        aria-label="Início da janela"
                      />
                    </div>
                    {draft.seriesFromKind === "date" ? (
                      <div className="flex w-44 flex-col gap-1">
                        <Label className="text-xs">Data</Label>
                        <Input
                          type="date"
                          value={draft.seriesFromValue}
                          onChange={(e) =>
                            setDraft((d) =>
                              d ? { ...d, seriesFromValue: e.target.value } : d
                            )
                          }
                          aria-label="Data de início da janela"
                        />
                      </div>
                    ) : draft.seriesFromKind !== "sempre" ? (
                      <div className="flex min-w-48 flex-1 flex-col gap-1">
                        <Label className="text-xs">Campo</Label>
                        <Combobox
                          options={(catalog?.fields ?? []) as ComboboxOption[]}
                          value={draft.seriesFromValue}
                          onValueChange={(v) =>
                            setDraft((d) =>
                              d ? { ...d, seriesFromValue: v } : d
                            )
                          }
                          placeholder="Campo"
                          aria-label="Campo de início da janela"
                        />
                      </div>
                    ) : null}
                  </div>

                  <div className="flex flex-wrap items-end gap-2">
                    <div className="flex w-56 flex-col gap-1">
                      <Label className="text-xs">Primeira ocorrência</Label>
                      <Combobox
                        options={[
                          { value: "apos_um_ciclo", label: "Um ciclo depois" },
                          { value: "imediato", label: "No dia da âncora" },
                        ]}
                        value={draft.seriesFirstAt}
                        onValueChange={(v) =>
                          setDraft((d) =>
                            d
                              ? { ...d, seriesFirstAt: v as RuleDraft["seriesFirstAt"] }
                              : d
                          )
                        }
                        searchable={false}
                        aria-label="Primeira ocorrência"
                      />
                    </div>
                    <div className="flex w-44 flex-col gap-1">
                      <Label className="text-xs">Encerrar em</Label>
                      <Combobox
                        options={[
                          // As quatro formas de parar. "Sem prazo" não é
                          // "para sempre": a regra deixa de casar quando o
                          // registro sai da etapa, e a série para aí.
                          {
                            value: "nunca",
                            label: "Enquanto as condições valerem",
                          },
                          { value: "field", label: "Numa data do registro" },
                          { value: "date", label: "Numa data fixa" },
                          {
                            value: "field_changed",
                            label: "Quando um campo mudar",
                          },
                        ]}
                        value={draft.seriesUntilKind}
                        onValueChange={(v) =>
                          setDraft((d) =>
                            d
                              ? {
                                  ...d,
                                  seriesUntilKind:
                                    v as RuleDraft["seriesUntilKind"],
                                  seriesUntilValue: "",
                                }
                              : d
                          )
                        }
                        searchable={false}
                        aria-label="Término da série"
                      />
                    </div>
                    {draft.seriesUntilKind === "date" ? (
                      <div className="flex w-44 flex-col gap-1">
                        <Label className="text-xs">Data</Label>
                        <Input
                          type="date"
                          value={draft.seriesUntilValue}
                          onChange={(e) =>
                            setDraft((d) =>
                              d ? { ...d, seriesUntilValue: e.target.value } : d
                            )
                          }
                          aria-label="Data de término"
                        />
                      </div>
                    ) : null}
                    {draft.seriesUntilKind === "field" ||
                    draft.seriesUntilKind === "field_changed" ? (
                      <div className="flex min-w-48 flex-1 flex-col gap-1">
                        <Label className="text-xs">
                          {draft.seriesUntilKind === "field_changed"
                            ? "Campo que, ao mudar, encerra"
                            : "Campo de data"}
                        </Label>
                        <Combobox
                          options={(catalog?.fields ?? []) as ComboboxOption[]}
                          value={draft.seriesUntilValue}
                          onValueChange={(v) =>
                            setDraft((d) =>
                              d ? { ...d, seriesUntilValue: v } : d
                            )
                          }
                          placeholder="Campo"
                          aria-label="Campo de término"
                        />
                      </div>
                    ) : null}
                  </div>

                  <div className="flex flex-wrap items-end gap-2 border-t pt-2">
                    <div className="flex min-w-56 flex-1 flex-col gap-1">
                      <Label className="text-xs">
                        Descrição da tarefa (opcional)
                      </Label>
                      <Input
                        value={draft.seriesDescription}
                        onChange={(e) =>
                          setDraft((d) =>
                            d ? { ...d, seriesDescription: e.target.value } : d
                          )
                        }
                        placeholder="Vai no corpo da tarefa"
                        aria-label="Descrição da tarefa da série"
                      />
                    </div>
                    <div className="flex w-56 flex-col gap-1">
                      <Label className="text-xs">Espelhar no Bitrix</Label>
                      <Combobox
                        options={MIRROR_CHOICES}
                        value={draft.seriesMirrorBitrix}
                        onValueChange={(v) =>
                          setDraft((d) =>
                            d
                              ? { ...d, seriesMirrorBitrix: v as MirrorChoice }
                              : d
                          )
                        }
                        searchable={false}
                        aria-label="Espelhar as tarefas da série no Bitrix"
                      />
                    </div>
                    <div className="flex w-44 flex-col gap-1">
                      <Label className="text-xs">Espelhar com (dias)</Label>
                      <Input
                        type="number"
                        min={0}
                        max={MAX_MIRROR_LEAD_DAYS}
                        value={draft.seriesMirrorLeadDays}
                        onChange={(e) =>
                          setDraft((d) =>
                            d
                              ? { ...d, seriesMirrorLeadDays: e.target.value }
                              : d
                          )
                        }
                        aria-label="Dias de antecedência para criar a atividade no Bitrix"
                      />
                      <p className="text-[11px] text-muted-foreground">
                        A tarefa aparece aqui desde já; no Bitrix, só quando
                        faltarem estes dias para vencer.
                      </p>
                    </div>
                    <div className="flex w-56 flex-col gap-1">
                      <Label className="text-xs">Conceder ao registro</Label>
                      <Combobox
                        options={[
                          { value: "", label: "Nada" },
                          ...ATTRIBUTE_OPTIONS,
                        ]}
                        value={draft.seriesGrantAttribute}
                        onValueChange={(v) =>
                          setDraft((d) =>
                            d ? { ...d, seriesGrantAttribute: v } : d
                          )
                        }
                        searchable={false}
                        aria-label="Atributo concedido ao registro"
                      />
                    </div>
                  </div>
                  <p className="text-muted-foreground text-xs">
                    O atributo liga a funcionalidade no registro que entra na
                    série — é ele que faz a Tree do acompanhamento existir e a
                    linha da tabela virar clicável. Pausar o atributo depois
                    interrompe a série sem apagar o histórico.
                  </p>

                  <div className="flex flex-col gap-1 border-t pt-2">
                    <Label className="text-xs">
                      Quem pode ter cadência diferente
                    </Label>
                    <p className="text-muted-foreground text-xs">
                      Na ordem: o primeiro com exceção gravada vence. As
                      exceções em si (&quot;o João é mensal&quot;) são
                      cadastradas fora daqui, sem mexer na regra.
                    </p>
                    {draft.seriesScopes.map((sc, i) => (
                      <div key={i} className="flex flex-wrap items-center gap-2">
                        <span className="text-muted-foreground w-4 text-xs">
                          {i + 1}.
                        </span>
                        <Combobox
                          options={SCOPE_OPTIONS}
                          value={sc.kind}
                          onValueChange={(v) =>
                            setDraft((d) =>
                              d
                                ? {
                                    ...d,
                                    seriesScopes: d.seriesScopes.map((x, j) =>
                                      j === i
                                        ? {
                                            kind: v as typeof sc.kind,
                                            field: "",
                                          }
                                        : x
                                    ),
                                  }
                                : d
                            )
                          }
                          searchable={false}
                          className="w-44"
                          aria-label={`Escopo ${i + 1}`}
                        />
                        {sc.kind === "field" ? (
                          <Combobox
                            options={(catalog?.fields ?? []) as ComboboxOption[]}
                            value={sc.field}
                            onValueChange={(v) =>
                              setDraft((d) =>
                                d
                                  ? {
                                      ...d,
                                      seriesScopes: d.seriesScopes.map((x, j) =>
                                        j === i ? { ...x, field: v } : x
                                      ),
                                    }
                                  : d
                              )
                            }
                            placeholder="Campo"
                            className="w-56"
                            aria-label={`Campo do escopo ${i + 1}`}
                          />
                        ) : null}
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() =>
                            setDraft((d) =>
                              d
                                ? {
                                    ...d,
                                    seriesScopes: d.seriesScopes.filter(
                                      (_, j) => j !== i
                                    ),
                                  }
                                : d
                            )
                          }
                        >
                          Remover
                        </Button>
                      </div>
                    ))}
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="self-start"
                      disabled={draft.seriesScopes.length >= 6}
                      onClick={() =>
                        setDraft((d) =>
                          d
                            ? {
                                ...d,
                                seriesScopes: [
                                  ...d.seriesScopes,
                                  { kind: "record", field: "" },
                                ],
                              }
                            : d
                        )
                      }
                    >
                      Adicionar escopo
                    </Button>
                  </div>
                </div>
              ) : draft.actionType === "run_schema" ? (
                <div className="flex min-w-56 flex-1 flex-col gap-2">
                  <Label className="text-xs">Esquema</Label>
                  <Combobox
                    options={(catalog?.schemas ?? []).map((s) => ({
                      value: s.key,
                      label: s.label,
                    }))}
                    value={draft.schemaKey}
                    onValueChange={(v) =>
                      setDraft((d) => (d ? { ...d, schemaKey: v } : d))
                    }
                    placeholder="Esquema a executar"
                    aria-label="Esquema a executar"
                  />
                  {catalog && catalog.schemas.length === 0 ? (
                    <p className="text-muted-foreground text-xs">
                      Nenhum esquema disponível: em Operação → Workflow, crie um
                      esquema com gatilho de automação e deixe-o ligado.
                    </p>
                  ) : null}
                  <label className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={draft.schemaSimulate}
                      onCheckedChange={(v) =>
                        setDraft((d) =>
                          d ? { ...d, schemaSimulate: v === true } : d
                        )
                      }
                    />
                    Apenas simular (não envia nada)
                  </label>
                  {!draft.schemaSimulate &&
                  catalog?.schemas.find((s) => s.key === draft.schemaKey)
                    ?.irreversible ? (
                    <p className="text-destructive text-xs">
                      Este esquema CRIA registros no destino. Cada registro é
                      executado uma única vez por esta regra — não dá para
                      desfazer pelo sistema.
                    </p>
                  ) : null}
                  <p className="text-muted-foreground text-xs">
                    Os valores que o esquema pediria a uma pessoa saem do
                    próprio registro (configurados no esquema, campo a campo).
                  </p>
                </div>
              ) : draft.actionType === "create_task" ? (
                <>
                  <div className="flex min-w-56 flex-1 flex-col gap-1">
                    <Label className="text-xs">Título da tarefa</Label>
                    <Input
                      value={draft.taskTitle}
                      onChange={(e) =>
                        setDraft((d) =>
                          d ? { ...d, taskTitle: e.target.value } : d
                        )
                      }
                      placeholder="Ex.: Retomar contato"
                      aria-label="Título da tarefa"
                    />
                  </div>
                  <div className="flex min-w-32 flex-col gap-1">
                    <Label className="text-xs">Prazo (dias)</Label>
                    <Input
                      type="number"
                      min={0}
                      value={draft.taskDueDays}
                      onChange={(e) =>
                        setDraft((d) =>
                          d ? { ...d, taskDueDays: e.target.value } : d
                        )
                      }
                      placeholder="sem prazo"
                      aria-label="Prazo em dias"
                    />
                  </div>
                </>
              ) : (
                <>
                  <div className="flex min-w-48 flex-1 flex-col gap-1">
                    <Label className="text-xs">Campo</Label>
                    <Combobox
                      options={
                        (catalog?.settableFields ?? []) as ComboboxOption[]
                      }
                      value={draft.setField}
                      onValueChange={(v) =>
                        setDraft((d) =>
                          d ? { ...d, setField: v, setValue: "" } : d
                        )
                      }
                      placeholder="Campo a gravar"
                      aria-label="Campo a gravar"
                    />
                  </div>
                  <div className="flex min-w-40 flex-1 flex-col gap-1">
                    <Label className="text-xs">Valor</Label>
                    {(() => {
                      if (catalog?.booleanFields.includes(draft.setField)) {
                        return (
                          <Combobox
                            options={BOOL_OPTIONS}
                            value={draft.setValue}
                            onValueChange={(v) =>
                              setDraft((d) => (d ? { ...d, setValue: v } : d))
                            }
                            searchable={false}
                            aria-label="Valor a gravar"
                          />
                        );
                      }
                      const vs = autoFilterValueSource(
                        draft.setField,
                        source,
                        catalog?.selectOptionsByField
                      );
                      if (vs) {
                        return (
                          <FilterValuePicker
                            source={vs}
                            multi={false}
                            value={draft.setValue}
                            onChange={(value) =>
                              setDraft((d) =>
                                d
                                  ? {
                                      ...d,
                                      setValue: Array.isArray(value)
                                        ? (value[0] ?? "")
                                        : value,
                                    }
                                  : d
                              )
                            }
                            ariaLabel="Valor a gravar"
                          />
                        );
                      }
                      return (
                        <Input
                          type={
                            catalog?.numericFields.includes(draft.setField)
                              ? "number"
                              : "text"
                          }
                          value={draft.setValue}
                          onChange={(e) =>
                            setDraft((d) =>
                              d ? { ...d, setValue: e.target.value } : d
                            )
                          }
                          placeholder="valor"
                        />
                      );
                    })()}
                  </div>
                </>
              )}
            </div>

            <div className="flex items-center gap-2">
              <Button onClick={onSave} disabled={saving}>
                {saveLabel}
              </Button>
              <Button
                variant="outline"
                onClick={onCancel}
                disabled={saving}
              >
                Cancelar
              </Button>
            </div>
          </div>
  );
}
