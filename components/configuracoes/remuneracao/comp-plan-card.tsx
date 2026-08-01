// Versão: 1.0 | Data: 01/08/2026
// Card de detalhamento de UM lançamento (plano × membro × mês) — extraído da
// my-comp-view para ser o card ÚNICO da visão do vendedor E da Visão geral do
// admin: 100% por props (entry/targets/targetRates), read-only, deriva tudo
// pelo MESMO computeEntry (o responsible_id da entry seleciona a tabela de
// faixas do membro). `title` opcional troca o cabeçalho (a Visão geral por
// plano exibe o NOME DO MEMBRO; default = nome do plano). ApuracaoBadge mora
// AQUI (importar do manager criaria ciclo manager → overview → card →
// manager); OverrideDot/fmtMoneyIn idem.
"use client";

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
  commissionMemory,
  fmtMoneyBRL as fmtMoney,
  fmtNumBR as fmtNum,
} from "@/lib/comp/commission-label";
import {
  apuracaoRef,
  computeEntry,
  parseCompEntryInputs,
  parseCompPlanConfig,
  type CompComputedRaw,
} from "@/lib/comp/model";
import { MONTH_LABELS } from "@/lib/date/month-labels";
import type {
  CompEntryClientRow,
  CompPlanClientRow,
} from "./remuneracao-manager";

// Moeda do ALVO do fator (targetCurrency) — código desconhecido degrada p/
// prefixo cru (Intl lança em código inválido).
export function fmtMoneyIn(currency: string, v: number): string {
  try {
    return v.toLocaleString("pt-BR", { style: "currency", currency });
  } catch {
    return `${currency} ${fmtNum(v)}`;
  }
}

export function OverrideDot() {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="mr-1 inline-block size-1.5 rounded-full bg-amber-500" />
      </TooltipTrigger>
      <TooltipContent>Valor ajustado manualmente pelo gestor.</TooltipContent>
    </Tooltip>
  );
}

/** Badge "Apurado sobre <mês>" — plano com apuração no mês anterior. */
export function ApuracaoBadge(props: { year: number; month: number }) {
  const ref = apuracaoRef(props.year, props.month, {
    apuracao: "mes_anterior",
  });
  return (
    <span
      className="bg-muted text-muted-foreground rounded-full px-2 py-0.5 text-xs"
      title="Este plano apura o realizado e as metas sobre o mês anterior ao do lançamento."
    >
      Apurado sobre {MONTH_LABELS[ref.month - 1]}/{ref.year}
    </span>
  );
}

export function CompPlanCard(props: {
  plan: CompPlanClientRow;
  entry: CompEntryClientRow;
  year: number;
  month: number;
  targets: Record<string, number | null>;
  targetRates: Record<string, number | null>;
  // Cabeçalho do card — default: nome do plano (Visão geral por plano passa o
  // nome do MEMBRO; por pessoa, o default já serve).
  title?: string;
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
          {props.title ?? props.plan.name}
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
                  {f.weightPct === 0 && !b.overridden.payout ? (
                    <span
                      className="text-muted-foreground"
                      title="Peso 0% — este fator não compõe a parcela por atingimento; serve de gatilho/base de comissão."
                    >
                      —
                    </span>
                  ) : (
                    fmtMoney(b.payout)
                  )}
                </TableCell>
              </TableRow>
            );
          })}
          {/* Comissão: memória de cálculo por bloco (helper único da grade). */}
          {breakdown.commissionBlocks.map((cb) => {
            const mem = commissionMemory(cb);
            return (
              <TableRow key={cb.blockId}>
                <TableCell className="text-muted-foreground">
                  {cb.label}
                  <span className="ml-1 block text-xs">
                    {mem.formula ?? mem.tierNote}
                    {mem.memberTiers ? " · faixas do membro" : ""}
                  </span>
                  {mem.formula != null ? (
                    <span className="block text-xs">{mem.tierNote}</span>
                  ) : null}
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
