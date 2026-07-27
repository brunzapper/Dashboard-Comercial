// Versão: 1.0 | Data: 27/07/2026
// Painel "Automações" do kanban (modo registros, sem bucket de data): lista de
// regras (ordem = ordem de avaliação; primeira que casa vence), editor de
// condições das 4 famílias — Campo do registro / Registros conectados /
// Tarefas / Tempo — mescláveis em E na MESMA regra, ação "Mover para a
// coluna" e "Executar agora" (fora do tick). Status por regra (última
// execução / movidos / erro) vem do bookkeeping do engine. Campos via
// getAutomationFieldOptions (buildAvailableFields + toFieldOptions — nunca
// listas paralelas). Feedback inline (role="status"/"alert" — sem toasts).
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
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { FILTER_OPS, opHasNoValue } from "@/lib/widgets/filter-ops";
import type { FilterOp, WidgetFilter } from "@/lib/widgets/types";
import type { KanbanColumn } from "@/lib/kanban/types";
import type { KanbanOwner } from "@/lib/kanban/data";
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
  value: string;
}

interface CondDraft {
  kind: "field" | "related_count" | "tasks" | "time";
  field: string;
  op: string;
  value: string;
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
  targetKey: string;
}

function toWidgetFilter(d: RelFilterDraft): WidgetFilter | null {
  if (!d.field || !d.op) return null;
  const op = d.op as FilterOp;
  if (opHasNoValue(op)) return { field: d.field, op };
  if (op === "in") {
    const list = d.value
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    return list.length > 0 ? { field: d.field, op, value: list } : null;
  }
  if (d.value === "") return null;
  return { field: d.field, op, value: d.value };
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
        if (!f.field && !f.value) continue; // linha vazia
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
  if (conditions.length === 0 || !draft.targetKey) return null;
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
        ? c.filter.value.join(", ")
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
          ? f.value.join(", ")
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
  return {
    id: row.id,
    name: row.name,
    enabled: row.enabled,
    conds,
    targetKey: row.rule.action.targetKey,
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
  owner: KanbanOwner;
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
      void getAutomationFieldOptions(source).then((res) => {
        if (res.ok && res.catalog) setCatalog(res.catalog);
      });
    }
  }, [open, reload, catalog, source]);

  const fieldOptions = (catalog?.fields ?? []) as ComboboxOption[];
  // "Desde a última alteração de…": só refs com carimbo em field_modified_at
  // (coluna core/custom — unificados/casados ficam de fora).
  const fmodFieldOptions = fieldOptions.filter(
    (o) => !o.value.startsWith("unified:") && !o.value.startsWith("match:")
  );
  const relSourceOptions: ComboboxOption[] = (catalog?.sources ?? []).map(
    (s) => ({ value: s.value, label: s.label })
  );

  const timeBasisOptions: ComboboxOption[] = [
    { value: "created", label: "Desde a criação" },
    { value: "field_changed", label: "Desde a última alteração de um campo" },
    ...(isCustomColumns
      ? [{ value: "in_column", label: "Na coluna atual" }]
      : []),
  ];

  function saveDraft() {
    if (!draft) return;
    const rule = draftToRule(draft);
    if (!rule) {
      setMessage({
        ok: false,
        text: "Regra incompleta: confira as condições e a coluna de destino.",
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
    if (!window.confirm(`Excluir a regra "${row.name || "sem nome"}"?`)) return;
    startTransition(async () => {
      const res = await deleteAutomation(owner, row.id);
      if (!res.ok && res.message) setMessage({ ok: false, text: res.message });
      reload();
    });
  }

  function moveRule(index: number, dir: -1 | 1) {
    const next = [...rows];
    const j = index + dir;
    if (j < 0 || j >= next.length) return;
    [next[index], next[j]] = [next[j], next[index]];
    setRows(next);
    startTransition(async () => {
      await reorderAutomations(
        owner,
        next.map((r) => r.id)
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
      <SheetContent className="flex flex-col gap-4 overflow-y-auto sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>Automações do quadro</SheetTitle>
          <SheetDescription>
            Regras são avaliadas em ordem — a primeira que casar vence. Rodam
            automaticamente (a cada minuto e após cada Sync) e movem cards para
            a coluna configurada.
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
                targetKey: "",
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
                  {row.rule.conditions.length} condição(ões) → mover para{" "}
                  <span className="font-medium">
                    {targetOptions.find(
                      (o) => o.value === row.rule.action.targetKey
                    )?.label ?? row.rule.action.targetKey}
                  </span>
                  {" · "}Última execução: {fmtWhen(row.last_run_at)}
                  {row.last_run_at != null
                    ? ` · moveu ${row.last_moved_count} card(s)`
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
                        <Input
                          value={c.value}
                          onChange={(e) =>
                            patchCond(i, { value: e.target.value })
                          }
                          placeholder={
                            c.op === "in" ? "valor1, valor2, ..." : "valor"
                          }
                        />
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
                            <Input
                              value={f.value}
                              onChange={(e) =>
                                patchCond(i, {
                                  relFilters: c.relFilters.map((x, y) =>
                                    y === k
                                      ? { ...x, value: e.target.value }
                                      : x
                                  ),
                                })
                              }
                            />
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

            <div className="flex flex-col gap-1">
              <Label className="text-xs">Então: mover para a coluna</Label>
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
      </SheetContent>
    </Sheet>
  );
}
