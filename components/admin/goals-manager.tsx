// Versão: 1.1 | Data: 20/07/2026
// Gerência de Metas (goals) — admin. Escopo global/operação/responsável,
// período (mês/ano), métrica e alvo. As metas "se comunicam" (roll-up) na leitura.
// v1.1 (20/07/2026): métricas de meta arbitrárias — as opções vêm do registry
// (builtins + sync_config 'goal_metrics') e o combobox ganha "+ Nova métrica…".
"use client";

import { useActionState, useState, useTransition } from "react";
import { Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { OptionItem } from "@/lib/records/types";
import type { GoalMetricDef } from "@/lib/metas/metrics";
import { goalMetricKeyFromLabel, goalMetricLabel } from "@/lib/metas/metrics";
import {
  createGoal,
  createGoalMetric,
  deleteGoal,
  type GoalState,
} from "@/app/(app)/configuracoes/metas/actions";

export interface GoalRow {
  id: string;
  period_year: number;
  period_month: number | null;
  scope: string;
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
  const [state, formAction, pending] = useActionState(createGoal, initial);
  const [scope, setScope] = useState("global");
  const [month, setMonth] = useState("");
  const [operationId, setOperationId] = useState("");
  const [responsibleId, setResponsibleId] = useState("");
  const [metric, setMetric] = useState("mrr");
  const [newMetricLabel, setNewMetricLabel] = useState("");
  const [metricMsg, setMetricMsg] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const year = new Date().getFullYear();

  const metricOptions: ComboboxOption[] = [
    ...metrics.map((m) => ({ value: m.key, label: m.label })),
    { value: NEW_METRIC, label: "+ Nova métrica…" },
  ];

  return (
    <div className="flex flex-col gap-4">
      <form
        action={formAction}
        className="grid grid-cols-2 gap-3 rounded-lg border p-4 sm:grid-cols-3 lg:grid-cols-6"
      >
        <div className="flex flex-col gap-1.5">
          <Label>Ano</Label>
          <Input name="period_year" type="number" defaultValue={year} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>Mês</Label>
          <Combobox
            name="period_month"
            options={MONTH_OPTIONS}
            value={month}
            onValueChange={setMonth}
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
            value={scope}
            onValueChange={setScope}
            searchable={false}
            aria-label="Escopo"
          />
        </div>
        {scope === "operation" ? (
          <div className="flex flex-col gap-1.5">
            <Label>Operação</Label>
            <Combobox
              name="operation_id"
              options={[
                { value: "", label: "—" },
                ...operations.map((o) => ({ value: o.id, label: o.label })),
              ]}
              value={operationId}
              onValueChange={setOperationId}
              placeholder="—"
              aria-label="Operação"
            />
          </div>
        ) : null}
        {scope === "responsible" ? (
          <div className="flex flex-col gap-1.5">
            <Label>Responsável</Label>
            <Combobox
              name="responsible_id"
              options={[
                { value: "", label: "—" },
                ...responsibles.map((r) => ({ value: r.id, label: r.label })),
              ]}
              value={responsibleId}
              onValueChange={setResponsibleId}
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
            value={metric}
            onValueChange={(v) => {
              setMetric(v);
              setMetricMsg(null);
            }}
            searchable={false}
            aria-label="Métrica"
          />
        </div>
        {metric === NEW_METRIC ? (
          <div className="col-span-2 flex items-end gap-2 sm:col-span-3 lg:col-span-3">
            <div className="flex flex-1 flex-col gap-1.5">
              <Label htmlFor="new-metric-label">Nome da nova métrica</Label>
              <Input
                id="new-metric-label"
                value={newMetricLabel}
                placeholder="Ex.: SQL"
                onChange={(e) => setNewMetricLabel(e.target.value)}
              />
            </div>
            <Button
              type="button"
              variant="outline"
              disabled={pending || !newMetricLabel.trim()}
              onClick={() =>
                startTransition(async () => {
                  const res = await createGoalMetric(newMetricLabel);
                  setMetricMsg(res.message ?? null);
                  if (res.ok) {
                    setMetric(goalMetricKeyFromLabel(newMetricLabel));
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
          <Input name="target" type="number" step="0.01" required />
        </div>
        <div className="col-span-2 flex items-center gap-3 sm:col-span-3 lg:col-span-6">
          <Button type="submit" disabled={pending || metric === NEW_METRIC}>
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
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="Excluir"
                      onClick={() =>
                        startTransition(async () => {
                          await deleteGoal(g.id);
                        })
                      }
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
