// Versão: 1.2 | Data: 03/10/2026
// Gerência de Metas (goals) — admin. Escopo global/operação/responsável,
// período (mês/ano), métrica e alvo. As metas "se comunicam" (roll-up) na leitura.
// v1.2 (03/10/2026): metas EDITÁVEIS (antes só criar/excluir) — ✏️ por linha
// abre um Sheet no molde do editor de Indicadores. Os campos vivem em
// `GoalFields` (controlado), compartilhado entre o formulário de criação e o
// editor; o save do editor vai por `updateGoal` (chave natural nova checada
// contra conflito em lib/metas/upsert.ts).
// v1.1 (20/07/2026): métricas de meta arbitrárias — as opções vêm do registry
// (builtins + sync_config 'goal_metrics') e o combobox ganha "+ Nova métrica…".
"use client";

import { useActionState, useState, useTransition } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
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
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { notifyOnError } from "@/lib/feedback/notify";
import type { OptionItem } from "@/lib/records/types";
import type { GoalMetricDef } from "@/lib/metas/metrics";
import { goalMetricKeyFromLabel, goalMetricLabel } from "@/lib/metas/metrics";
import {
  createGoal,
  createGoalMetric,
  deleteGoal,
  updateGoal,
  type GoalState,
} from "@/app/(app)/configuracoes/metas/actions";

export interface GoalRow {
  id: string;
  period_year: number;
  period_month: number | null;
  scope: string;
  // v1.2 (03/10/2026): ids p/ o editor pré-selecionar os combos.
  operation_id: string | null;
  responsible_id: string | null;
  operation_name: string | null;
  responsible_name: string | null;
  metric: string;
  target: number;
}

const MONTHS = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];
const MONTH_OPTIONS: ComboboxOption[] = [
  { value: "", label: "Anual" },
  ...MONTHS.map((m, i) => ({ value: String(i + 1), label: m })),
];
const SCOPE_OPTIONS: ComboboxOption[] = [
  { value: "global", label: "Global" },
  { value: "operation", label: "Operação" },
  { value: "responsible", label: "Responsável" },
];
// Sentinela do combobox de métrica que abre o formulário de métrica nova.
const NEW_METRIC = "__new__";
const initial: GoalState = {};

function periodLabel(g: GoalRow): string {
  return g.period_month ? `${MONTHS[g.period_month - 1]}/${g.period_year}` : `${g.period_year} (anual)`;
}
function scopeLabel(g: GoalRow): string {
  if (g.scope === "global") return "Global";
  if (g.scope === "operation") return `Operação: ${g.operation_name ?? "—"}`;
  return `Responsável: ${g.responsible_name ?? "—"}`;
}

/** v1.2 (03/10/2026): valores controlados do formulário de meta. */
interface GoalValues {
  year: string;
  month: string;
  scope: string;
  operationId: string;
  responsibleId: string;
  metric: string;
  target: string;
}

function emptyValues(): GoalValues {
  return {
    year: String(new Date().getFullYear()),
    month: "",
    scope: "global",
    operationId: "",
    responsibleId: "",
    metric: "mrr",
    target: "",
  };
}

function valuesOf(g: GoalRow): GoalValues {
  return {
    year: String(g.period_year),
    month: g.period_month ? String(g.period_month) : "",
    scope: g.scope,
    operationId: g.operation_id ?? "",
    responsibleId: g.responsible_id ?? "",
    metric: g.metric,
    target: String(g.target),
  };
}

/**
 * v1.2 (03/10/2026): campos do formulário de meta — os MESMOS na criação e na
 * edição. Os `name` alimentam o FormData de `createGoal`/`updateGoal`.
 */
function GoalFields({
  values,
  onChange,
  operations,
  responsibles,
  metrics,
  pending,
  onMessage,
  wide,
}: {
  values: GoalValues;
  onChange: (p: Partial<GoalValues>) => void;
  operations: OptionItem[];
  responsibles: OptionItem[];
  metrics: GoalMetricDef[];
  pending: boolean;
  onMessage: (msg: string | null) => void;
  /** Grade larga (formulário da página) × estreita (Sheet). */
  wide: boolean;
}) {
  const [newMetricLabel, setNewMetricLabel] = useState("");
  const [creating, startTransition] = useTransition();
  const metricOptions: ComboboxOption[] = [
    ...metrics.map((m) => ({ value: m.key, label: m.label })),
    { value: NEW_METRIC, label: "+ Nova métrica…" },
  ];
  const spanAll = wide ? "col-span-2 sm:col-span-3 lg:col-span-3" : "col-span-2";

  return (
    <>
      <div className="flex flex-col gap-1.5">
        <Label>Ano</Label>
        <Input
          name="period_year"
          type="number"
          value={values.year}
          onChange={(e) => onChange({ year: e.target.value })}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label>Mês</Label>
        <Combobox
          name="period_month"
          options={MONTH_OPTIONS}
          value={values.month}
          onValueChange={(v) => onChange({ month: v })}
          searchable={false}
          placeholder="Anual"
          aria-label="Mês"
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label>Escopo</Label>
        <Combobox
          name="scope"
          options={SCOPE_OPTIONS}
          value={values.scope}
          onValueChange={(v) => onChange({ scope: v })}
          searchable={false}
          aria-label="Escopo"
        />
      </div>
      {values.scope === "operation" ? (
        <div className="flex flex-col gap-1.5">
          <Label>Operação</Label>
          <Combobox
            name="operation_id"
            options={[
              { value: "", label: "—" },
              ...operations.map((o) => ({ value: o.id, label: o.label })),
            ]}
            value={values.operationId}
            onValueChange={(v) => onChange({ operationId: v })}
            placeholder="—"
            aria-label="Operação"
          />
        </div>
      ) : null}
      {values.scope === "responsible" ? (
        <div className="flex flex-col gap-1.5">
          <Label>Responsável</Label>
          <Combobox
            name="responsible_id"
            options={[
              { value: "", label: "—" },
              ...responsibles.map((r) => ({ value: r.id, label: r.label })),
            ]}
            value={values.responsibleId}
            onValueChange={(v) => onChange({ responsibleId: v })}
            placeholder="—"
            aria-label="Responsável"
          />
        </div>
      ) : null}
      <div className="flex flex-col gap-1.5">
        <Label>Métrica</Label>
        <Combobox
          name="metric"
          options={metricOptions}
          value={values.metric}
          onValueChange={(v) => {
            onChange({ metric: v });
            onMessage(null);
          }}
          searchable={false}
          aria-label="Métrica"
        />
      </div>
      {values.metric === NEW_METRIC ? (
        <div className={`${spanAll} flex items-end gap-2`}>
          <div className="flex flex-1 flex-col gap-1.5">
            <Label>Nome da nova métrica</Label>
            <Input
              aria-label="Nome da nova métrica"
              value={newMetricLabel}
              placeholder="Ex.: SQL"
              onChange={(e) => setNewMetricLabel(e.target.value)}
            />
          </div>
          <Button
            type="button"
            variant="outline"
            disabled={pending || creating || !newMetricLabel.trim()}
            onClick={() =>
              startTransition(async () => {
                const res = await createGoalMetric(newMetricLabel);
                onMessage(res.message ?? null);
                if (res.ok) {
                  onChange({ metric: goalMetricKeyFromLabel(newMetricLabel) });
                  setNewMetricLabel("");
                }
              })
            }
          >
            Criar métrica
          </Button>
        </div>
      ) : null}
      <div className="flex flex-col gap-1.5">
        <Label>Alvo</Label>
        <Input
          name="target"
          type="number"
          step="0.01"
          required
          value={values.target}
          onChange={(e) => onChange({ target: e.target.value })}
        />
      </div>
    </>
  );
}

export function GoalsManager({
  goals,
  operations,
  responsibles,
  metrics,
}: {
  goals: GoalRow[];
  operations: OptionItem[];
  responsibles: OptionItem[];
  metrics: GoalMetricDef[];
}) {
  const [values, setValues] = useState<GoalValues>(emptyValues);
  // v1.2 (03/10/2026): campos controlados não são limpos pelo reset nativo do
  // form — o alvo é zerado à mão após salvar (como antes).
  const [state, formAction, pending] = useActionState(
    async (prev: GoalState, formData: FormData) => {
      const res = await createGoal(prev, formData);
      if (res.ok) setValues((v) => ({ ...v, target: "" }));
      return res;
    },
    initial
  );
  const [metricMsg, setMetricMsg] = useState<string | null>(null);
  const [editing, setEditing] = useState<GoalRow | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<GoalRow | null>(null);
  const [, startTransition] = useTransition();

  return (
    <div className="flex flex-col gap-4">
      <form
        action={formAction}
        className="grid grid-cols-2 gap-3 rounded-lg border p-4 sm:grid-cols-3 lg:grid-cols-6"
      >
        <GoalFields
          values={values}
          onChange={(p) => setValues((v) => ({ ...v, ...p }))}
          operations={operations}
          responsibles={responsibles}
          metrics={metrics}
          pending={pending}
          onMessage={setMetricMsg}
          wide
        />
        <div className="col-span-2 flex items-center gap-3 sm:col-span-3 lg:col-span-6">
          <Button type="submit" disabled={pending || values.metric === NEW_METRIC}>
            <Plus className="size-4" /> Salvar meta
          </Button>
          {metricMsg ? (
            <span className="text-muted-foreground text-sm">{metricMsg}</span>
          ) : null}
          {state.message ? (
            <span
              className={state.ok ? "text-muted-foreground text-sm" : "text-destructive text-sm"}
            >
              {state.message}
            </span>
          ) : null}
        </div>
      </form>

      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Período</TableHead>
              <TableHead>Escopo</TableHead>
              <TableHead>Métrica</TableHead>
              <TableHead className="text-right">Alvo</TableHead>
              <TableHead className="text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {goals.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-muted-foreground text-center">
                  Nenhuma meta definida.
                </TableCell>
              </TableRow>
            ) : (
              goals.map((g) => (
                <TableRow key={g.id}>
                  <TableCell>{periodLabel(g)}</TableCell>
                  <TableCell>{scopeLabel(g)}</TableCell>
                  <TableCell>{goalMetricLabel(g.metric, metrics)}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {g.target.toLocaleString("pt-BR")}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      {/* v1.2 (03/10/2026): editar a meta. */}
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label="Editar"
                        onClick={() => setEditing(g)}
                      >
                        <Pencil className="size-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label="Excluir"
                        onClick={() => setConfirmDelete(g)}
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

      {editing ? (
        <GoalEditSheet
          key={editing.id}
          goal={editing}
          onClose={() => setEditing(null)}
          operations={operations}
          responsibles={responsibles}
          metrics={metrics}
        />
      ) : null}

      <ConfirmDialog
        open={!!confirmDelete}
        onOpenChange={(o) => !o && setConfirmDelete(null)}
        title="Excluir meta?"
        description={
          confirmDelete ? (
            <>
              A meta de{" "}
              <strong>{goalMetricLabel(confirmDelete.metric, metrics)}</strong>{" "}
              ({confirmDelete.period_month
                ? `${MONTHS[confirmDelete.period_month - 1]}/`
                : ""}
              {confirmDelete.period_year}) será removida. Esta ação não pode
              ser desfeita.
            </>
          ) : undefined
        }
        onConfirm={() => {
          const target = confirmDelete;
          setConfirmDelete(null);
          if (!target) return;
          startTransition(async () => {
            await notifyOnError(
              deleteGoal(target.id),
              "Não foi possível excluir a meta"
            );
          });
        }}
      />
    </div>
  );
}

/**
 * v1.2 (03/10/2026): editor de uma meta existente (molde do IndicatorSheet).
 * Sucesso fecha o Sheet; erro (ex.: chave já ocupada por outra meta) fica nele.
 */
function GoalEditSheet({
  goal,
  onClose,
  operations,
  responsibles,
  metrics,
}: {
  goal: GoalRow;
  onClose: () => void;
  operations: OptionItem[];
  responsibles: OptionItem[];
  metrics: GoalMetricDef[];
}) {
  const [values, setValues] = useState<GoalValues>(() => valuesOf(goal));
  const [metricMsg, setMetricMsg] = useState<string | null>(null);
  const [state, formAction, pending] = useActionState(
    async (prev: GoalState, formData: FormData) => {
      const res = await updateGoal(prev, formData);
      if (res.ok) onClose();
      return res;
    },
    initial
  );

  return (
    <Sheet open onOpenChange={(o) => (o ? null : onClose())}>
      <SheetContent className="flex flex-col gap-4 overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>Editar meta</SheetTitle>
          <SheetDescription>
            Ajuste período, escopo, métrica ou alvo. Não pode haver duas metas
            com o mesmo período, escopo e métrica.
          </SheetDescription>
        </SheetHeader>
        <form action={formAction} className="flex flex-col gap-4 px-4 pb-4">
          <input type="hidden" name="id" value={goal.id} />
          <div className="grid grid-cols-2 gap-3">
            <GoalFields
              values={values}
              onChange={(p) => setValues((v) => ({ ...v, ...p }))}
              operations={operations}
              responsibles={responsibles}
              metrics={metrics}
              pending={pending}
              onMessage={setMetricMsg}
              wide={false}
            />
          </div>
          {metricMsg ? (
            <p className="text-muted-foreground text-sm">{metricMsg}</p>
          ) : null}
          {state.message && !state.ok ? (
            <p className="text-destructive text-sm">{state.message}</p>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
              Cancelar
            </Button>
            <Button type="submit" disabled={pending || values.metric === NEW_METRIC}>
              {pending ? "Salvando…" : "Salvar"}
            </Button>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  );
}
