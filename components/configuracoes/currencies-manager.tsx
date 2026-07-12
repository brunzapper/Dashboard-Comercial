// Versão: 2.0 | Data: 12/07/2026
// Configurações → Moedas: habilita as moedas do sistema e edita as taxas de
// conversão (R$ por 1 unidade) por ano/trimestre — manual ou pelo PTAX. BRL é a
// base (taxa 1, não editável).
// v2.0: as taxas viram rascunho local e só são gravadas ao clicar "Aplicar"
//   (antes commitava no onBlur). O parser aceita vírgula OU ponto como separador
//   decimal ("5,85" e "5.85" viram 5.85) — antes removia todo ponto, gravando 585
//   e "perdendo os centavos" ao recarregar. `readOnly` = visão de não-admin
//   (gestor/vendedor): tabela só de leitura, sem checkboxes/botões.
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
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
import type { SystemCurrency } from "@/lib/widgets/currency";
import {
  refreshRatesFromPtax,
  toggleCurrencyEnabled,
  upsertCurrencyRate,
} from "@/app/(app)/configuracoes/moedas/actions";

export interface CurrencyRateRow {
  code: string;
  year: number;
  quarter: number; // 0 = anual; 1..4 = trimestral
  rate: number;
  source: string | null;
}

const QUARTER_LABELS = ["Anual", "T1", "T2", "T3", "T4"];

/**
 * Interpreta um valor digitado (pt-BR ou en) como número. Aceita "5,85", "5.85"
 * e "1.234,56". Regra: quando há vírgula E ponto, o separador mais à direita é o
 * decimal e o outro é milhar; só vírgula = decimal; só ponto = decimal (taxas são
 * pequenas, "5.85" é 5,85 e não 585). Vazio/ inválido → null.
 */
function parseRate(raw: string): number | null {
  const s = raw.trim();
  if (s === "") return null;
  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");
  let normalized: string;
  if (lastComma !== -1 && lastDot !== -1) {
    const decimalSep = lastComma > lastDot ? "," : ".";
    const thousandSep = decimalSep === "," ? "." : ",";
    normalized = s.split(thousandSep).join("").replace(decimalSep, ".");
  } else if (lastComma !== -1) {
    normalized = s.replace(",", ".");
  } else {
    normalized = s; // só ponto (ou nenhum): já é decimal
  }
  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
}

/** Exibe a taxa em pt-BR (vírgula decimal, sem milhar) — round-trip com parseRate. */
function formatRate(n: number): string {
  return n.toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 6,
    useGrouping: false,
  });
}

export function CurrenciesManager({
  currencies,
  rates,
  readOnly = false,
}: {
  currencies: SystemCurrency[];
  rates: CurrencyRateRow[];
  readOnly?: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [refreshing, setRefreshing] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  // Rascunho por célula: `${code}:${quarter}` -> texto. Só o que o usuário tocou;
  // as demais células mostram o valor gravado formatado.
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState(currentYear);
  const yearOptions = [];
  for (let y = currentYear + 1; y >= currentYear - 5; y--) {
    yearOptions.push({ value: String(y), label: String(y) });
  }

  // Taxa atual de (code, quarter) no ano selecionado, se houver.
  const rateOf = (code: string, quarter: number): CurrencyRateRow | undefined =>
    rates.find((r) => r.code === code && r.year === year && r.quarter === quarter);

  const cellKey = (code: string, quarter: number) => `${code}:${quarter}`;

  // Valor exibido: rascunho se tocado; senão a taxa gravada formatada.
  const displayValue = (code: string, quarter: number): string => {
    const k = cellKey(code, quarter);
    if (k in drafts) return drafts[k];
    const cur = rateOf(code, quarter);
    return cur ? formatRate(cur.rate) : "";
  };

  function setDraft(code: string, quarter: number, value: string) {
    setDrafts((d) => ({ ...d, [cellKey(code, quarter)]: value }));
  }

  // Grava todas as células alteradas de uma moeda (botão "Aplicar" da linha).
  function applyRow(code: string) {
    if (readOnly) return;
    const ops: { quarter: number; rate: number | null }[] = [];
    for (let quarter = 0; quarter < QUARTER_LABELS.length; quarter++) {
      const k = cellKey(code, quarter);
      if (!(k in drafts)) continue; // não tocado
      const parsed = parseRate(drafts[k]);
      const current = rateOf(code, quarter);
      const currentRate = current ? current.rate : null;
      if (parsed === currentRate) continue; // sem mudança efetiva
      ops.push({ quarter, rate: parsed });
    }
    if (ops.length === 0) return;
    setMessage(null);
    startTransition(async () => {
      for (const op of ops) {
        await upsertCurrencyRate(code, year, op.quarter, op.rate);
      }
      // Limpa o rascunho da linha (os valores recarregados viram a fonte).
      setDrafts((d) => {
        const next = { ...d };
        for (let q = 0; q < QUARTER_LABELS.length; q++) delete next[cellKey(code, q)];
        return next;
      });
      router.refresh();
    });
  }

  function refresh(code: string) {
    if (readOnly) return;
    setMessage(null);
    setRefreshing(code);
    startTransition(async () => {
      const res = await refreshRatesFromPtax(code, year);
      setRefreshing(null);
      setMessage(res.message ?? null);
      setDrafts((d) => {
        const next = { ...d };
        for (let q = 0; q < QUARTER_LABELS.length; q++) delete next[cellKey(code, q)];
        return next;
      });
      router.refresh();
    });
  }

  const rateCurrencies = currencies.filter((c) => c.enabled && c.code !== "BRL");

  return (
    <div className="flex flex-col gap-6">
      {/* Habilitar moedas */}
      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold">Moedas habilitadas</h3>
        <div className="flex flex-wrap gap-4 rounded-lg border p-4">
          {currencies.map((c) => {
            const locked = c.code === "BRL"; // base, sempre habilitada
            return (
              <label
                key={c.code}
                className="flex items-center gap-2 text-sm"
                title={locked ? "Moeda base do sistema" : undefined}
              >
                <input
                  type="checkbox"
                  className="size-4 accent-primary"
                  defaultChecked={c.enabled}
                  disabled={locked || pending || readOnly}
                  onChange={(e) =>
                    startTransition(async () => {
                      await toggleCurrencyEnabled(c.code, e.target.checked);
                      router.refresh();
                    })
                  }
                />
                {c.label}
              </label>
            );
          })}
        </div>
      </div>

      {/* Taxas por ano/trimestre */}
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">
            Taxas de conversão (R$ por 1 unidade)
          </h3>
          <div className="flex items-center gap-2">
            <Label htmlFor="year" className="text-sm">
              Ano
            </Label>
            <Combobox
              id="year"
              searchable={false}
              options={yearOptions}
              value={String(year)}
              onValueChange={(v) => {
                setYear(Number(v));
                setDrafts({}); // troca de ano descarta rascunhos
              }}
              className="w-28"
              aria-label="Ano das taxas"
            />
          </div>
        </div>

        {rateCurrencies.length === 0 ? (
          <p className="text-muted-foreground rounded-lg border p-6 text-center text-sm">
            {readOnly
              ? "Nenhuma moeda estrangeira habilitada."
              : "Habilite uma moeda estrangeira acima para informar suas taxas."}
          </p>
        ) : (
          <div className="rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Moeda</TableHead>
                  {QUARTER_LABELS.map((q) => (
                    <TableHead key={q} className="text-right">
                      {q}
                    </TableHead>
                  ))}
                  {!readOnly ? <TableHead className="text-right">Ações</TableHead> : null}
                </TableRow>
              </TableHeader>
              <TableBody>
                {rateCurrencies.map((c) => (
                  <TableRow key={c.code}>
                    <TableCell className="font-medium whitespace-nowrap">
                      {c.label}
                    </TableCell>
                    {QUARTER_LABELS.map((_, quarter) => {
                      const cur = rateOf(c.code, quarter);
                      if (readOnly) {
                        return (
                          <TableCell
                            key={quarter}
                            className="text-right tabular-nums"
                            title={
                              cur?.source === "ptax"
                                ? "Origem: PTAX"
                                : cur
                                  ? "Origem: manual"
                                  : undefined
                            }
                          >
                            {cur ? formatRate(cur.rate) : "—"}
                          </TableCell>
                        );
                      }
                      return (
                        <TableCell key={quarter} className="text-right">
                          <Input
                            type="text"
                            inputMode="decimal"
                            value={displayValue(c.code, quarter)}
                            placeholder="—"
                            title={
                              cur?.source === "ptax"
                                ? "Origem: PTAX"
                                : cur
                                  ? "Origem: manual"
                                  : undefined
                            }
                            onChange={(e) => setDraft(c.code, quarter, e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") applyRow(c.code);
                            }}
                            disabled={pending}
                            className="h-8 w-24 text-right tabular-nums"
                            aria-label={`Taxa ${c.code} ${QUARTER_LABELS[quarter]} ${year}`}
                          />
                        </TableCell>
                      );
                    })}
                    {!readOnly ? (
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-2">
                          <Button
                            type="button"
                            size="sm"
                            disabled={pending}
                            onClick={() => applyRow(c.code)}
                          >
                            Aplicar
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={pending}
                            onClick={() => refresh(c.code)}
                            title="Preencher pela média PTAX do Banco Central"
                          >
                            <RefreshCw
                              className={
                                refreshing === c.code ? "size-4 animate-spin" : "size-4"
                              }
                            />
                            Atualizar agora
                          </Button>
                        </div>
                      </TableCell>
                    ) : null}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
        {message ? (
          <p className="text-muted-foreground text-sm" role="status">
            {message}
          </p>
        ) : null}
        {!readOnly ? (
          <p className="text-muted-foreground text-xs">
            Digite a taxa (ex.: 5,85) e clique <strong>Aplicar</strong> para gravar.
            A taxa do trimestre, quando preenchida, tem prioridade sobre a anual. O
            preenchimento manual e o &quot;Atualizar agora&quot; se sobrescrevem.
          </p>
        ) : (
          <p className="text-muted-foreground text-xs">
            Taxa em R$ por 1 unidade da moeda. A do trimestre, quando preenchida, tem
            prioridade sobre a anual. Apenas administradores podem alterar.
          </p>
        )}
      </div>
    </div>
  );
}
