// Versão: 1.1 | Data: 31/07/2026
// "Minha remuneração" (0112) — visão READ-ONLY do vendedor: a RLS de
// comp_entries entrega só as linhas do PRÓPRIO grupo canônico; o detalhamento
// é derivado pelo MESMO computeEntry do gestor (transparência: célula com
// override manual mostra o ponto âmbar; v1.1: linha de Comissão com a faixa
// aplicada — o responsible_id da entry seleciona a tabela do membro). Nada é
// editável; sem Recalcular/Publicar. Navegação de mês via searchParams.
"use client";

import { usePathname, useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  computeEntry,
  parseCompEntryInputs,
  parseCompPlanConfig,
  type CompComputedRaw,
} from "@/lib/comp/model";
import type {
  CompEntryClientRow,
  CompPlanClientRow,
} from "./remuneracao-manager";
import { MONTH_LABELS } from "./remuneracao-manager";

const fmtMoney = (v: number): string =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const fmtNum = (v: number): string =>
  v.toLocaleString("pt-BR", { maximumFractionDigits: 2 });

function OverrideDot() {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="mr-1 inline-block size-1.5 rounded-full bg-amber-500" />
      </TooltipTrigger>
      <TooltipContent>Valor ajustado manualmente pelo gestor.</TooltipContent>
    </Tooltip>
  );
}

export interface MyCompViewProps {
  plans: CompPlanClientRow[];
  // Entries do PRÓPRIO usuário (RLS já filtrou), qualquer plano do mês.
  entries: (CompEntryClientRow & { plan_id: string })[];
  // Alvos do mês por plano → factorId (já dobrados p/ o canônico).
  targetsByPlan: Record<string, Record<string, number | null>>;
  year: number;
  month: number;
  linked: boolean; // usuário tem responsável vinculado?
}

export function MyCompView(props: MyCompViewProps) {
  const router = useRouter();
  const pathname = usePathname();
  const shiftMonth = (delta: number) => {
    const d = new Date(Date.UTC(props.year, props.month - 1 + delta, 1));
    router.push(
      `${pathname}?ano=${d.getUTCFullYear()}&mes=${d.getUTCMonth() + 1}`
    );
  };

  if (!props.linked) {
    return (
      <p className="text-muted-foreground text-sm">
        Seu usuário não está vinculado a um responsável — fale com um
        administrador (Configurações → Responsáveis).
      </p>
    );
  }

  const entryByPlan = new Map(props.entries.map((e) => [e.plan_id, e]));
  const cards = props.plans
    .filter((p) => p.active)
    .map((plan) => ({ plan, entry: entryByPlan.get(plan.id) ?? null }))
    .filter((c) => c.entry != null);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-1">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Mês anterior"
          onClick={() => shiftMonth(-1)}
        >
          <ChevronLeft className="size-4" />
        </Button>
        <span className="min-w-36 text-center text-sm font-medium">
          {MONTH_LABELS[props.month - 1]}/{props.year}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Próximo mês"
          onClick={() => shiftMonth(1)}
        >
          <ChevronRight className="size-4" />
        </Button>
      </div>

      {cards.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          Nenhum lançamento de remuneração para você neste mês.
        </p>
      ) : (
        cards.map(({ plan, entry }) => (
          <PlanCard
            key={plan.id}
            plan={plan}
            entry={entry!}
            targets={props.targetsByPlan[plan.id] ?? {}}
          />
        ))
      )}
    </div>
  );
}

function PlanCard(props: {
  plan: CompPlanClientRow;
  entry: CompEntryClientRow;
  targets: Record<string, number | null>;
}) {
  const config = parseCompPlanConfig(props.plan.config);
  if (!config) return null;
  const computed = (props.entry.computed ?? null) as CompComputedRaw | null;
  const inputs = parseCompEntryInputs(props.entry.inputs);
  const breakdown = computeEntry(
    config,
    props.entry.base_amount ?? props.plan.base_amount_default,
    inputs,
    computed?.realized ?? {},
    props.targets,
    props.entry.responsible_id
  );

  return (
    <div className="bg-card rounded-md border p-4">
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="text-lg font-medium">{props.plan.name}</h2>
        <span className="text-xl font-semibold">
          {breakdown.total != null ? fmtMoney(breakdown.total) : "—"}
          {breakdown.totalOverridden ? <OverrideDot /> : null}
        </span>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Fator</TableHead>
            <TableHead className="text-right">Alvo</TableHead>
            <TableHead className="text-right">Realizado</TableHead>
            <TableHead className="text-right">Ating.%</TableHead>
            <TableHead className="text-right">Valor</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {config.factors.map((f) => {
            const b = breakdown.byFactor[f.id];
            const fmt = f.money ? fmtMoney : fmtNum;
            return (
              <TableRow key={f.id}>
                <TableCell>
                  {f.label}{" "}
                  <span className="text-muted-foreground text-xs">
                    ({f.weightPct.toLocaleString("pt-BR")}%)
                  </span>
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {b.target != null ? fmt(b.target) : "—"}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {b.overridden.realized ? <OverrideDot /> : null}
                  {b.realized != null ? fmt(b.realized) : "—"}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {b.overridden.attainmentPct ? <OverrideDot /> : null}
                  {b.attainmentPct != null ? `${fmtNum(b.attainmentPct)}%` : "—"}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {b.overridden.payout ? <OverrideDot /> : null}
                  {fmtMoney(b.payout)}
                </TableCell>
              </TableRow>
            );
          })}
          {breakdown.commission != null ? (
            <TableRow>
              <TableCell className="text-muted-foreground">
                Comissão
                <span className="ml-1 text-xs">
                  {breakdown.commission.tier
                    ? `(faixa ≥ ${fmtNum(breakdown.commission.tier.fromPct)}% ⇒ ${fmtNum(
                        breakdown.commission.tier.ratePct
                      )}%)`
                    : "(nenhuma faixa atingida)"}
                </span>
              </TableCell>
              <TableCell colSpan={4} className="text-right tabular-nums">
                {breakdown.commission.overridden ? <OverrideDot /> : null}
                {fmtMoney(breakdown.commission.value)}
              </TableCell>
            </TableRow>
          ) : null}
          <TableRow>
            <TableCell className="text-muted-foreground">Base variável</TableCell>
            <TableCell colSpan={4} className="text-right tabular-nums">
              {fmtMoney(breakdown.base)}
            </TableCell>
          </TableRow>
          <TableRow>
            <TableCell className="text-muted-foreground">
              Bônus
              {inputs.bonuses.length > 0 ? (
                <span className="ml-1 text-xs">
                  ({inputs.bonuses.map((b) => b.label).join(", ")})
                </span>
              ) : null}
            </TableCell>
            <TableCell colSpan={4} className="text-right tabular-nums">
              {fmtMoney(breakdown.bonusTotal)}
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </div>
  );
}
