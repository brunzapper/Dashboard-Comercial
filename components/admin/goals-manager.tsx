// Versão: 1.0 | Data: 05/07/2026
// Gerência de Metas (goals) — admin. Escopo global/operação/responsável,
// período (mês/ano), métrica e alvo. As metas "se comunicam" (roll-up) na leitura.
"use client";

import { useActionState, useState, useTransition } from "react";
import { Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
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
import {
  createGoal,
  deleteGoal,
  type GoalState,
} from "@/app/(app)/admin/metas/actions";

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
const METRIC_LABELS: Record<string, string> = { mrr: "MRR", clientes: "Clientes" };
const selectClass =
  "border-input h-9 rounded-md border bg-transparent px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]";
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
}: {
  goals: GoalRow[];
  operations: OptionItem[];
  responsibles: OptionItem[];
}) {
  const [state, formAction, pending] = useActionState(createGoal, initial);
  const [scope, setScope] = useState("global");
  const [, startTransition] = useTransition();
  const year = new Date().getFullYear();

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
          <select name="period_month" className={selectClass} defaultValue="">
            <option value="">Anual</option>
            {MONTHS.map((m, i) => (
              <option key={i} value={i + 1}>
                {m}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>Escopo</Label>
          <select
            name="scope"
            className={selectClass}
            value={scope}
            onChange={(e) => setScope(e.target.value)}
          >
            <option value="global">Global</option>
            <option value="operation">Operação</option>
            <option value="responsible">Responsável</option>
          </select>
        </div>
        {scope === "operation" ? (
          <div className="flex flex-col gap-1.5">
            <Label>Operação</Label>
            <select name="operation_id" className={selectClass}>
              <option value="">—</option>
              {operations.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
        ) : null}
        {scope === "responsible" ? (
          <div className="flex flex-col gap-1.5">
            <Label>Responsável</Label>
            <select name="responsible_id" className={selectClass}>
              <option value="">—</option>
              {responsibles.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.label}
                </option>
              ))}
            </select>
          </div>
        ) : null}
        <div className="flex flex-col gap-1.5">
          <Label>Métrica</Label>
          <select name="metric" className={selectClass}>
            <option value="mrr">MRR</option>
            <option value="clientes">Clientes</option>
          </select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>Alvo</Label>
          <Input name="target" type="number" step="0.01" required />
        </div>
        <div className="col-span-2 flex items-center gap-3 sm:col-span-3 lg:col-span-6">
          <Button type="submit" disabled={pending}>
            <Plus className="size-4" /> Salvar meta
          </Button>
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
                  <TableCell>{METRIC_LABELS[g.metric] ?? g.metric}</TableCell>
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
