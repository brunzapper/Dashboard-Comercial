// Versão: 1.3 | Data: 31/07/2026
// v1.3: navegação de mês LEVE (useMonthDraft/MonthNav — rascunho + commit
// debounced, picker de mês/ano + "Hoje", replace/useNavPending; cards
// esmaecidos durante a troca) e badge "Apurado sobre <mês>" em plano com
// config.apuracao = "mes_anterior".
// v1.2: comissão multi-bloco (uma linha por bloco + soma quando há override)
// e alvo em moeda própria (exibe na moeda digitada + convertido; cotação
// ausente = aviso, atingimento vazio) via targetRatesByPlan do server.
// "Minha remuneração" (0112) — visão READ-ONLY do vendedor: a RLS de
// comp_entries entrega só as linhas do PRÓPRIO grupo canônico; o detalhamento
// é derivado pelo MESMO computeEntry do gestor (transparência: célula com
// override manual mostra o ponto âmbar; v1.1: linha de Comissão com a faixa
// aplicada — o responsible_id da entry seleciona a tabela do membro). Nada é
// editável; sem Recalcular/Publicar. Navegação de mês via searchParams.
"use client";

import { usePathname, useRouter } from "next/navigation";

import { useNavPending } from "@/components/dashboards/pending-context";
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
import { ApuracaoBadge } from "./remuneracao-manager";
import { MonthNav, useMonthDraft } from "./month-nav";

const fmtMoney = (v: number): string =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const fmtNum = (v: number): string =>
  v.toLocaleString("pt-BR", { maximumFractionDigits: 2 });
function fmtMoneyIn(currency: string, v: number): string {
  try {
    return v.toLocaleString("pt-BR", { style: "currency", currency });
  } catch {
    return `${currency} ${fmtNum(v)}`;
  }
}

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
  // Moeda do alvo → R$/unidade no trimestre, por plano (server).
  targetRatesByPlan: Record<string, Record<string, number | null>>;
  year: number;
  month: number;
  linked: boolean; // usuário tem responsável vinculado?
}

export function MyCompView(props: MyCompViewProps) {
  const router = useRouter();
  const pathname = usePathname();
  const { pending, run } = useNavPending();
  const draft = useMonthDraft(props.year, props.month, (y, m) =>
    run(() =>
      router.replace(`${pathname}?ano=${y}&mes=${m}`, { scroll: false })
    )
  );
  const busy = draft.dirty || pending;

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
      <MonthNav draft={draft} pending={pending} />

      <div
        className={busy ? "pointer-events-none opacity-60" : undefined}
        aria-busy={busy}
      >
        {cards.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            Nenhum lançamento de remuneração para você neste mês.
          </p>
        ) : (
          <div className="flex flex-col gap-4">
            {cards.map(({ plan, entry }) => (
              <PlanCard
                key={plan.id}
                plan={plan}
                entry={entry!}
                year={props.year}
                month={props.month}
                targets={props.targetsByPlan[plan.id] ?? {}}
                targetRates={props.targetRatesByPlan[plan.id] ?? {}}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function PlanCard(props: {
  plan: CompPlanClientRow;
  entry: CompEntryClientRow;
  year: number;
  month: number;
  targets: Record<string, number | null>;
  targetRates: Record<string, number | null>;
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
    props.entry.responsible_id,
    props.targetRates
  );

  return (
    <div className="bg-card rounded-md border p-4">
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <h2 className="flex items-baseline gap-2 text-lg font-medium">
          {props.plan.name}
          {config.apuracao === "mes_anterior" ? (
            <ApuracaoBadge year={props.year} month={props.month} />
          ) : null}
        </h2>
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
                  {b.target == null ? (
                    "—"
                  ) : f.targetCurrency ? (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span
                          className={
                            b.targetRateMissing ? "text-destructive" : undefined
                          }
                        >
                          {fmtMoneyIn(f.targetCurrency, b.target)}
                        </span>
                      </TooltipTrigger>
                      <TooltipContent>
                        {b.targetRateMissing
                          ? `Sem cotação ${f.targetCurrency} para o trimestre — atingimento fica vazio.`
                          : b.targetBRL != null
                            ? `≈ ${fmtMoney(b.targetBRL)} na cotação do trimestre`
                            : null}
                      </TooltipContent>
                    </Tooltip>
                  ) : (
                    fmt(b.target)
                  )}
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
          {breakdown.commissionBlocks.map((cb) => {
            const unit = cb.tierBy === "attainment" ? "%" : "";
            return (
              <TableRow key={cb.blockId}>
                <TableCell className="text-muted-foreground">
                  {cb.label}
                  <span className="ml-1 text-xs">
                    {cb.tier
                      ? `(faixa ≥ ${fmtNum(cb.tier.fromPct)}${unit} ⇒ ${
                          cb.kind === "pct"
                            ? `${fmtNum(cb.tier.ratePct ?? 0)}%`
                            : cb.kind === "flat"
                              ? fmtMoney(cb.tier.amount ?? 0)
                              : `${fmtMoney(cb.tier.amount ?? 0)}/un.`
                        })`
                      : "(nenhuma faixa atingida)"}
                  </span>
                </TableCell>
                <TableCell colSpan={4} className="text-right tabular-nums">
                  {fmtMoney(cb.value)}
                </TableCell>
              </TableRow>
            );
          })}
          {/* Soma/override da comissão: linha extra só quando há override ou
              mais de um bloco (com um bloco sem override, a linha acima já diz). */}
          {breakdown.commission != null &&
          (breakdown.commission.overridden || breakdown.commissionBlocks.length > 1) ? (
            <TableRow>
              <TableCell className="text-muted-foreground">
                Comissão (total)
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
