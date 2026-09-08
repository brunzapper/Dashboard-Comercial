// Versão: 1.2 | Data: 17/08/2026
// v1.2: prop OPCIONAL onOpenGrouping — engrenagem à direita do total, que abre
// a configuração dos blocos do detalhamento (por PLANO). Ausente, o card segue
// idêntico (é assim que a visão do vendedor fica limpa).
// Versão: 1.1 | Data: 16/08/2026
// v1.1: prop OPCIONAL onOpenFactorDetail — o Realizado do fator vira gatilho
// da conferência dos registros por trás do número (CompDetailPanel). Só a
// Visão geral do admin passa a prop; sem ela o card é idêntico ao de antes.
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

import { Settings2 } from "lucide-react";

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
  entryMemoryLines,
  fmtMoneyBRL as fmtMoney,
  fmtNumBR as fmtNum,
  SHEET_BASE_NOTE,
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

/**
 * Marca de valor ajustado à mão. Cor + tooltip NÃO bastam: é um fato material
 * num documento de pagamento, e tooltip não existe em toque, não é impresso e
 * não chega a leitor de tela. Por isso o ponto carrega nome acessível e, na
 * impressão, vira a palavra "manual" (`print:` do Tailwind).
 */
export function OverrideDot() {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="mr-1 inline-flex items-center align-middle">
          <span
            role="img"
            aria-label="Valor ajustado manualmente pelo gestor"
            className="inline-block size-1.5 rounded-full bg-amber-500 print:hidden"
          />
          <span className="hidden text-[10px] font-normal text-amber-700 print:inline">
            manual{" "}
          </span>
        </span>
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
  // Conferência dos registros por trás do realizado. AUSENTE = card sem
  // gatilho (é assim na visão do vendedor: a RLS de `records` dele não alcança
  // registros de fator casado por memberField, e o detalhe sairia parcial sem
  // explicação). Sem a prop o card renderiza exatamente como antes.
  onOpenFactorDetail?: (factorId: string) => void;
  // Engrenagem do agrupamento dos blocos do detalhamento (config POR PLANO).
  // AUSENTE = card sem engrenagem, como na visão do vendedor.
  onOpenGrouping?: () => void;
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
  const memoryLines = entryMemoryLines(config, breakdown);

  return (
    <div className="bg-card rounded-md border p-4">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
        <h2 className="flex flex-wrap items-baseline gap-2 text-lg font-medium">
          {props.title ?? props.plan.name}
          {/* Com título próprio (o nome da pessoa), o plano vira subtítulo —
              senão o leitor não sabe de qual plano o valor saiu. */}
          {props.title ? (
            <span className="text-muted-foreground text-xs font-normal">
              {props.plan.name}
            </span>
          ) : null}
          {config.apuracao === "mes_anterior" ? (
            <ApuracaoBadge year={props.year} month={props.month} />
          ) : null}
        </h2>
        <span className="flex items-end gap-2">
          {/* O total é o número que o leitor veio buscar — e era o único
              elemento do card sem rótulo. */}
          <span className="flex flex-col items-end leading-tight">
            <span className="text-muted-foreground text-xs">Total do mês</span>
            <span className="text-xl font-semibold">
              {breakdown.totalOverridden ? <OverrideDot /> : null}
              {breakdown.total != null ? fmtMoney(breakdown.total) : "—"}
            </span>
          </span>
          {props.onOpenGrouping ? (
            <button
              type="button"
              aria-label="Configurar os blocos do detalhamento"
              title="Configurar os blocos do detalhamento"
              className="text-muted-foreground hover:text-foreground"
              onClick={props.onOpenGrouping}
            >
              <Settings2 className="size-4" />
            </button>
          ) : null}
        </span>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Indicador</TableHead>
            <TableHead className="text-right">Meta</TableHead>
            <TableHead className="text-right">Realizado</TableHead>
            <TableHead className="text-right">Atingimento</TableHead>
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
                  {/* "(40%)" solto ao lado de uma coluna Atingimento em %
                      confundia as duas porcentagens — o rótulo desfaz isso. */}
                  <span className="text-muted-foreground text-xs">
                    peso {f.weightPct.toLocaleString("pt-BR")}%
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
                  {props.onOpenFactorDetail ? (
                    <button
                      type="button"
                      className="hover:text-primary underline-offset-2 hover:underline"
                      title="Ver os registros que compõem este realizado"
                      onClick={() => props.onOpenFactorDetail?.(f.id)}
                    >
                      {b.realized != null ? fmt(b.realized) : "—"}
                    </button>
                  ) : b.realized != null ? (
                    fmt(b.realized)
                  ) : (
                    "—"
                  )}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {b.overridden.attainmentPct ? <OverrideDot /> : null}
                  {b.attainmentPct != null ? `${fmtNum(b.attainmentPct)}%` : "—"}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {b.overridden.payout ? <OverrideDot /> : null}
                  {f.weightPct === 0 && !b.overridden.payout ? (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="text-muted-foreground cursor-help">
                          —
                        </span>
                      </TooltipTrigger>
                      <TooltipContent>
                        Este indicador não gera valor próprio — ele define a
                        faixa da comissão.
                      </TooltipContent>
                    </Tooltip>
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
          {/* A Base variável NÃO soma no total — ela multiplica dentro de cada
              indicador. Numa coluna de números empilhados, uma linha que se
              comporta diferente sem aviso convida à conta errada; a borda a
              separa das que somam e a nota diz o que ela é. */}
          <TableRow className="border-t-2">
            <TableCell className="text-muted-foreground">
              Base variável
              <span className="block text-xs">{SHEET_BASE_NOTE}</span>
            </TableCell>
            <TableCell
              colSpan={4}
              className="text-muted-foreground text-right align-top tabular-nums"
            >
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
      {/* Memória de cálculo EM TELA. Ela já era derivada e impressa no PDF, mas
          o colaborador só a via se imprimisse — ou seja, a explicação do
          próprio número não chegava a quem mais precisa dela. */}
      {memoryLines.length > 0 ? (
        <div className="mt-3 border-t pt-2">
          <p className="text-muted-foreground mb-1 text-xs font-medium">
            Memória de cálculo
          </p>
          <ul className="text-muted-foreground list-disc space-y-0.5 pl-5 text-xs">
            {memoryLines.map((l, i) => (
              <li key={i}>{l}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
