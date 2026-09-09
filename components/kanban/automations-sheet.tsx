// Versão: 1.5 | Data: 09/09/2026
// v1.5 (09/09/2026): ação "Série de tarefas" (create_task_series) — a cobrança
//   RECORRENTE. O editor separa as duas datas que o pedido separa: a condição
//   diz QUEM entra (etapa = Nutrição) e a ÂNCORA diz de quando contar (a
//   mudança de etapa). A cadência aqui é o PADRÃO; as exceções por responsável,
//   registro ou campo são dado, editáveis fora do construtor.
// Versão: 1.4 | Data: 09/09/2026
// v1.4 (09/09/2026): o painel aceita dono de BASE (`AutomationOwner`, não
//   `KanbanOwner`) — é ele que o Workflow monta para criar a regra sem quadro
//   que a 0127 tornou possível e nenhuma tela oferecia. Sem colunas, as opções
//   que exigem quadro aparecem DESABILITADAS com motivo, nunca escondidas
//   (precedente do editor de fórmulas).
// Versão: 1.3 | Data: 09/09/2026
// v1.3 (09/09/2026): ação "Executar esquema" (run_schema). Nasce em SIMULAÇÃO —
//   o switch começa marcado e desarmá-lo é um ato do admin, porque esta é a
//   única ação que produz efeito fora do sistema sozinha. O aviso de esquema
//   IRREVERSÍVEL (que cria algo) vem do catálogo, derivado dos passos. Sem
//   esquema disponível a opção aparece DESABILITADA com motivo, nunca oculta
//   (precedente do editor de fórmulas).
// Versão: 1.2 | Data: 08/09/2026
// v1.2 (08/09/2026): ação "Abrir tarefa" (create_task). Idempotente por regra ×
//   registro (índice único da 0129) — reexecutar não duplica; concluída a
//   tarefa, a regra cobra de novo se a condição voltar a valer.
// Painel "Automações" do kanban (modo registros, sem bucket de data): lista de
// regras (ordem = ordem de avaliação; primeira que casa vence), editor de
// condições das 4 famílias — Campo do registro / Registros conectados /
// Tarefas / Tempo — mescláveis em E na MESMA regra, ações "Mover para a
// coluna" e "Definir campo" e "Executar agora" (fora do tick). Status por
// regra (última execução / ações / erro) vem do bookkeeping do engine. Campos
// via getAutomationFieldOptions (buildAvailableFields + toFieldOptions —
// nunca listas paralelas; alvos do "Definir campo" em settableFields, mesma
// régua de setFieldTargetError). Feedback inline (role="status"/"alert").
// v1.2 (31/07/2026): ação set_field — seletor de ação, picker de campo
//   gravável e editor de valor por tipo (seleção usa o picker de rótulos;
//   booleano vira Sim/Não; número vira input numérico).
// v1.1 (31/07/2026): valor de condição AMIGÁVEL — responsável/operação/etapa e
//   campos seleção ganham picker de rótulos (FilterValuePicker). A avaliação
//   compara a coluna CRUA (evaluate.ts, fora do pipeline do engine — sem
//   expansão de grupo canônico, limitação documentada), então relações GRAVAM
//   O ID (storeAs "value") e o picker exibe o rótulo; `in` guarda array.
"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { ArrowDown, ArrowUp, Pencil, Play, Plus, Trash2, Zap } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Sheet,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { ResizableSheetContent } from "@/components/ui/resizable-sheet-content";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { notifyOnError } from "@/lib/feedback/notify";
import { FILTER_OPS, opHasNoValue } from "@/lib/widgets/filter-ops";
import type { SourceKey } from "@/lib/sources";
import type { FilterOp, WidgetFilter } from "@/lib/widgets/types";
import type { KanbanColumn } from "@/lib/kanban/types";
import {
  FilterValuePicker,
  type FilterValueSource,
} from "@/components/filters/filter-value-picker";
import { listFilterOptionCandidates } from "@/app/(app)/dashboards/actions";
import {
  deleteAutomation,
  getAutomationFieldOptions,
  listAutomations,
  reorderAutomations,
  runAutomationsNow,
  saveAutomation,
  type AutomationFieldCatalog,
} from "@/lib/kanban/automations/actions";
import {
  MAX_RULE_CONDITIONS,
  type AutomationCondition,
  type AutomationOwner,
  type AutomationRow,
  type AutomationRule,
} from "@/lib/kanban/automations/types";

const OP_OPTIONS: ComboboxOption[] = FILTER_OPS.map((o) => ({
  value: o.op,
  label: o.label,
}));

const NUM_OP_OPTIONS: ComboboxOption[] = [
  { value: "gte", label: "pelo menos (≥)" },
  { value: "lte", label: "no máximo (≤)" },
  { value: "eq", label: "exatamente (=)" },
];

const KIND_OPTIONS: ComboboxOption[] = [
  { value: "field", label: "Campo do registro" },
  { value: "related_count", label: "Registros conectados" },
  { value: "tasks", label: "Tarefas do card" },
  { value: "time", label: "Tempo" },
];

const TASK_METRIC_OPTIONS: ComboboxOption[] = [
  { value: "open", label: "Tarefas abertas" },
  { value: "overdue", label: "Tarefas atrasadas" },
];

const TIME_OP_OPTIONS: ComboboxOption[] = [
  { value: "gte", label: "há pelo menos" },
  { value: "lte", label: "há no máximo" },
];

// ---------- rascunho de UI ⇄ regra persistida ----------

interface RelFilterDraft {
  field: string;
  op: string;
  // Array quando veio do picker de valor (`in`); string no texto livre.
  value: string | string[];
}

interface CondDraft {
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

function emptyCond(): CondDraft {
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

interface RuleDraft {
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
  seriesUntilKind: "nunca" | "field" | "date";
  seriesUntilValue: string;
  seriesGrantAttribute: string;
}

const ACTION_OPTIONS: ComboboxOption[] = [
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
function toWidgetFilter(d: RelFilterDraft): WidgetFilter | null {
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

function draftToRule(draft: RuleDraft): AutomationRule | null {
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
                    : { kind: "field" as const, field: draft.seriesUntilValue },
              }
            : {}),
          ...(draft.seriesGrantAttribute
            ? { grantAttribute: draft.seriesGrantAttribute }
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

function ruleToDraft(row: AutomationRow, fieldOptions: ComboboxOption[]): RuleDraft {
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
function autoFilterValueSource(
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

function fmtWhen(iso: string | null): string {
  if (!iso) return "nunca";
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

// ---------- componente ----------

export function AutomationsSheet({
  owner,
  source,
  columns,
  isCustomColumns,
}: {
  // AutomationOwner, não KanbanOwner: desde a 0127 a regra pode ter uma BASE
  // como dono, e o painel é o mesmo — quem monta a tela é que muda (o quadro,
  // ou o Workflow). `owner` aqui só é repassado às actions de automação.
  owner: AutomationOwner;
  source?: string;
  columns: KanbanColumn[];
  // Colunas "Personalizar": habilita a base de tempo "Na coluna atual".
  isCustomColumns: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<AutomationRow[]>([]);
  const [catalog, setCatalog] = useState<AutomationFieldCatalog | null>(null);
  const [draft, setDraft] = useState<RuleDraft | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(
    null
  );
  const [confirmDelete, setConfirmDelete] = useState<AutomationRow | null>(
    null
  );
  const [pending, startTransition] = useTransition();

  const targetOptions: ComboboxOption[] = columns
    .filter((c) => !c.noDrop)
    .map((c) => ({ value: c.key, label: c.label }));

  const reload = useCallback(() => {
    startTransition(async () => {
      const res = await listAutomations(owner);
      if (res.ok && res.rows) setRows(res.rows);
      else if (res.message) setMessage({ ok: false, text: res.message });
    });
  }, [owner]);

  useEffect(() => {
    if (!open) return;
    reload();
    if (!catalog) {
      // `owner` resolve o allocationFieldKey (filtra o campo espelho do
      // picker de "Definir campo").
      void getAutomationFieldOptions(source, owner).then((res) => {
        if (res.ok && res.catalog) setCatalog(res.catalog);
      });
    }
  }, [open, reload, catalog, source, owner]);

  const fieldOptions = (catalog?.fields ?? []) as ComboboxOption[];
  // "Desde a última alteração de…": só refs com carimbo em field_modified_at
  // (coluna core/custom — unificados/casados ficam de fora).
  const fmodFieldOptions = fieldOptions.filter(
    (o) => !o.value.startsWith("unified:") && !o.value.startsWith("match:")
  );
  const relSourceOptions: ComboboxOption[] = (catalog?.sources ?? []).map(
    (s) => ({ value: s.value, label: s.label })
  );

  // Sem quadro (dono de Base) não há posição para medir; com colunas derivadas
  // de campo também não. A opção aparece DESABILITADA com o motivo — esconder
  // faria a pessoa procurar o que não existe (precedente do editor de fórmulas).
  const semQuadro = columns.length === 0;
  const timeBasisOptions: ComboboxOption[] = [
    { value: "created", label: "Desde a criação" },
    { value: "field_changed", label: "Desde a última alteração de um campo" },
    {
      value: "in_column",
      label: "Na coluna atual",
      ...(isCustomColumns
        ? {}
        : {
            disabledReason: semQuadro
              ? "Esta automação é de uma Base: não há quadro, e sem posição não há tempo de coluna para medir."
              : "Só em quadro com colunas “Personalizar” — nas demais, a coluna sai de um campo e não há entrada para cronometrar.",
          }),
    },
  ];

  const actionOptions: ComboboxOption[] = ACTION_OPTIONS.map((o) =>
    o.value === "move_to_column" && semQuadro
      ? {
          ...o,
          disabledReason:
            "Esta automação é de uma Base: não há quadro para onde mover. Use “Definir campo” ou “Abrir tarefa”.",
        }
      : o
  );

  function saveDraft() {
    if (!draft) return;
    const rule = draftToRule(draft);
    if (!rule) {
      setMessage({
        ok: false,
        text: "Regra incompleta: confira as condições e a ação (coluna de destino ou campo + valor).",
      });
      return;
    }
    startTransition(async () => {
      const res = await saveAutomation(owner, {
        id: draft.id,
        name: draft.name,
        enabled: draft.enabled,
        position: draft.id
          ? (rows.find((r) => r.id === draft.id)?.position ?? rows.length)
          : rows.length,
        rule,
      });
      setMessage({
        ok: Boolean(res.ok),
        text: res.message ?? (res.ok ? "Regra salva." : "Falha ao salvar."),
      });
      if (res.ok) {
        setDraft(null);
        reload();
      }
    });
  }

  function toggleEnabled(row: AutomationRow) {
    startTransition(async () => {
      const res = await saveAutomation(owner, {
        id: row.id,
        name: row.name,
        enabled: !row.enabled,
        position: row.position,
        rule: row.rule,
      });
      if (!res.ok && res.message) setMessage({ ok: false, text: res.message });
      reload();
    });
  }

  function remove(row: AutomationRow) {
    setConfirmDelete(row);
  }

  function moveRule(index: number, dir: -1 | 1) {
    const next = [...rows];
    const j = index + dir;
    if (j < 0 || j >= next.length) return;
    [next[index], next[j]] = [next[j], next[index]];
    setRows(next);
    startTransition(async () => {
      // reload() ressincroniza a ordem do banco; a falha precisa aparecer
      // (antes o resultado era descartado e a lista "voltava" sem explicação).
      await notifyOnError(
        reorderAutomations(
          owner,
          next.map((r) => r.id)
        ),
        "Não foi possível reordenar as regras"
      );
      reload();
    });
  }

  function runNow() {
    startTransition(async () => {
      const res = await runAutomationsNow(owner);
      setMessage({
        ok: Boolean(res.ok),
        text: res.message ?? (res.ok ? "Executado." : "Falha ao executar."),
      });
      reload();
    });
  }

  const patchCond = (i: number, p: Partial<CondDraft>) =>
    setDraft((d) =>
      d
        ? { ...d, conds: d.conds.map((c, j) => (j === i ? { ...c, ...p } : c)) }
        : d
    );

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="outline" size="sm" className="h-8 gap-1">
          <Zap className="size-4" />
          Automações
        </Button>
      </SheetTrigger>
      <ResizableSheetContent
        storageKey="panel-w:kanban-automations"
        defaultWidth={576}
        className="flex flex-col gap-4 overflow-y-auto"
      >
        <SheetHeader>
          <SheetTitle>Automações do quadro</SheetTitle>
          <SheetDescription>
            Regras são avaliadas em ordem — a primeira que casar vence. Rodam
            automaticamente (a cada minuto e após cada Sync) e movem cards para
            a coluna configurada ou definem um campo do registro.
          </SheetDescription>
        </SheetHeader>

        <div className="flex items-center gap-2 px-4">
          <Button
            size="sm"
            variant="outline"
            className="gap-1"
            onClick={runNow}
            disabled={pending || rows.length === 0}
          >
            <Play className="size-4" />
            Executar agora
          </Button>
          <Button
            size="sm"
            className="gap-1"
            onClick={() =>
              setDraft({
                id: null,
                name: "",
                enabled: true,
                conds: [emptyCond()],
                actionType: "move_to_column",
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
              })
            }
            disabled={pending || draft != null}
          >
            <Plus className="size-4" />
            Nova regra
          </Button>
        </div>

        {message ? (
          <p
            role={message.ok ? "status" : "alert"}
            className={`px-4 text-sm ${message.ok ? "text-muted-foreground" : "text-destructive"}`}
          >
            {message.text}
          </p>
        ) : null}

        {/* ---- lista de regras ---- */}
        {draft == null ? (
          <div className="flex flex-col gap-2 px-4 pb-6">
            {rows.length === 0 ? (
              <p className="text-muted-foreground text-sm">
                Nenhuma regra ainda. Crie a primeira — ex.: “se o parceiro
                tiver 5 ou mais leads conectados, mover para Ativo”.
              </p>
            ) : null}
            {rows.map((row, i) => (
              <div key={row.id} className="rounded-md border p-3">
                <div className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">
                    {row.name || "Regra sem nome"}
                  </span>
                  <label className="flex items-center gap-1 text-xs">
                    <Checkbox
                      checked={row.enabled}
                      onCheckedChange={() => toggleEnabled(row)}
                      aria-label={`Regra ${row.name || i + 1} ativa`}
                    />
                    Ativa
                  </label>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-7"
                    title="Subir"
                    onClick={() => moveRule(i, -1)}
                    disabled={i === 0 || pending}
                  >
                    <ArrowUp className="size-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-7"
                    title="Descer"
                    onClick={() => moveRule(i, 1)}
                    disabled={i === rows.length - 1 || pending}
                  >
                    <ArrowDown className="size-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-7"
                    title="Editar"
                    onClick={() => setDraft(ruleToDraft(row, fieldOptions))}
                    disabled={pending}
                  >
                    <Pencil className="size-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="text-destructive size-7"
                    title="Excluir"
                    onClick={() => remove(row)}
                    disabled={pending}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
                <p className="text-muted-foreground mt-1 text-xs">
                  {row.rule.conditions.length} condição(ões) →{" "}
                  {row.rule.action.type === "move_to_column" ? (
                    <>
                      mover para{" "}
                      <span className="font-medium">
                        {targetOptions.find(
                          (o) =>
                            row.rule.action.type === "move_to_column" &&
                            o.value === row.rule.action.targetKey
                        )?.label ??
                          (row.rule.action.type === "move_to_column"
                            ? row.rule.action.targetKey
                            : "")}
                      </span>
                    </>
                  ) : row.rule.action.type === "create_task" ? (
                    <>
                      abrir a tarefa{" "}
                      <span className="font-medium">
                        {row.rule.action.title}
                      </span>
                      {row.rule.action.dueInDays != null
                        ? ` (prazo ${row.rule.action.dueInDays} dia(s))`
                        : ""}
                    </>
                  ) : row.rule.action.type === "run_schema" ? (
                    <>
                      executar o esquema{" "}
                      <span className="font-medium">
                        {catalog?.schemas.find(
                          (o) =>
                            row.rule.action.type === "run_schema" &&
                            o.key === row.rule.action.schemaKey
                        )?.label ?? row.rule.action.schemaKey}
                      </span>
                      {row.rule.action.simulate ? " (apenas simulação)" : ""}
                    </>
                  ) : row.rule.action.type === "create_task_series" ? (
                    <>
                      abrir a cobrança{" "}
                      <span className="font-medium">
                        {String(row.rule.action.series.title)}
                      </span>{" "}
                      a cada {row.rule.action.series.cadence.defaultDays} dia(s)
                    </>
                  ) : (
                    <>
                      definir{" "}
                      <span className="font-medium">
                        {catalog?.settableFields.find(
                          (o) =>
                            row.rule.action.type === "set_field" &&
                            o.value === row.rule.action.field
                        )?.cleanLabel ?? row.rule.action.field}
                      </span>{" "}
                      = {row.rule.action.value}
                    </>
                  )}
                  {" · "}Última execução: {fmtWhen(row.last_run_at)}
                  {row.last_run_at != null
                    ? ` · ${row.last_moved_count} ação(ões)`
                    : ""}
                </p>
                {row.last_error ? (
                  <p role="alert" className="text-destructive mt-1 text-xs">
                    {row.last_error}
                  </p>
                ) : null}
              </div>
            ))}
          </div>
        ) : (
          /* ---- editor ---- */
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
                      <Label className="text-xs">Título da cobrança</Label>
                      <Input
                        value={draft.seriesTitle}
                        onChange={(e) =>
                          setDraft((d) =>
                            d ? { ...d, seriesTitle: e.target.value } : d
                          )
                        }
                        placeholder="Ex.: Follow-up de nutrição"
                        aria-label="Título da cobrança"
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

                  <div className="flex flex-wrap items-end gap-2">
                    <div className="flex w-56 flex-col gap-1">
                      <Label className="text-xs">Primeira cobrança</Label>
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
                        aria-label="Primeira cobrança"
                      />
                    </div>
                    <div className="flex w-44 flex-col gap-1">
                      <Label className="text-xs">Parar de cobrar</Label>
                      <Combobox
                        options={[
                          { value: "nunca", label: "Sem prazo" },
                          { value: "field", label: "Numa data do registro" },
                          { value: "date", label: "Numa data fixa" },
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
                    {draft.seriesUntilKind === "field" ? (
                      <div className="flex min-w-48 flex-1 flex-col gap-1">
                        <Label className="text-xs">Campo de data</Label>
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
              <Button onClick={saveDraft} disabled={pending}>
                Salvar regra
              </Button>
              <Button
                variant="outline"
                onClick={() => setDraft(null)}
                disabled={pending}
              >
                Cancelar
              </Button>
            </div>
          </div>
        )}

        <ConfirmDialog
          open={!!confirmDelete}
          onOpenChange={(o) => !o && setConfirmDelete(null)}
          title="Excluir regra?"
          description={
            <>
              A regra <strong>{confirmDelete?.name || "sem nome"}</strong> será
              removida e deixará de mover cards. Esta ação não pode ser
              desfeita.
            </>
          }
          onConfirm={() => {
            const target = confirmDelete;
            setConfirmDelete(null);
            if (!target) return;
            startTransition(async () => {
              const res = await deleteAutomation(owner, target.id);
              if (!res.ok && res.message)
                setMessage({ ok: false, text: res.message });
              reload();
            });
          }}
        />
      </ResizableSheetContent>
    </Sheet>
  );
}
