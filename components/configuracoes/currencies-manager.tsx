// Versão: 1.0 | Data: 12/07/2026
// Configurações → Moedas (admin): habilita as moedas do sistema e edita as taxas
// de conversão (R$ por 1 unidade) por ano/trimestre — manual ou pelo PTAX. BRL é
// a base (taxa 1, não editável). Regra = último a escrever vence.
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

export function CurrenciesManager({
  currencies,
  rates,
}: {
  currencies: SystemCurrency[];
  rates: CurrencyRateRow[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [refreshing, setRefreshing] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState(currentYear);
  const yearOptions = [];
  for (let y = currentYear + 1; y >= currentYear - 5; y--) {
    yearOptions.push({ value: String(y), label: String(y) });
  }

  // Taxa atual de (code, quarter) no ano selecionado, se houver.
  const rateOf = (code: string, quarter: number): CurrencyRateRow | undefined =>
    rates.find((r) => r.code === code && r.year === year && r.quarter === quarter);

  function commitRate(code: string, quarter: number, raw: string) {
    const trimmed = raw.trim().replace(/\./g, "").replace(",", ".");
    const current = rateOf(code, quarter);
    if (trimmed === "") {
      if (!current) return;
      startTransition(async () => {
        await upsertCurrencyRate(code, year, quarter, null);
        router.refresh();
      });
      return;
    }
    const n = Number(trimmed);
    if (!Number.isFinite(n)) return;
    if (current && current.rate === n) return;
    startTransition(async () => {
      await upsertCurrencyRate(code, year, quarter, n);
      router.refresh();
    });
  }

  function refresh(code: string) {
    setMessage(null);
    setRefreshing(code);
    startTransition(async () => {
      const res = await refreshRatesFromPtax(code, year);
      setRefreshing(null);
      setMessage(res.message ?? null);
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
                  disabled={locked || pending}
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
              onValueChange={(v) => setYear(Number(v))}
              className="w-28"
              aria-label="Ano das taxas"
            />
          </div>
        </div>

        {rateCurrencies.length === 0 ? (
          <p className="text-muted-foreground rounded-lg border p-6 text-center text-sm">
            Habilite uma moeda estrangeira acima para informar suas taxas.
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
                  <TableHead className="text-right">PTAX</TableHead>
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
                      return (
                        <TableCell key={quarter} className="text-right">
                          <Input
                            // key inclui o ano p/ resetar ao trocar de ano
                            key={`${c.code}:${year}:${quarter}`}
                            type="text"
                            inputMode="decimal"
                            defaultValue={cur ? String(cur.rate) : ""}
                            placeholder="—"
                            title={cur?.source === "ptax" ? "Origem: PTAX" : cur ? "Origem: manual" : undefined}
                            onBlur={(e) => commitRate(c.code, quarter, e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") e.currentTarget.blur();
                            }}
                            className="h-8 w-24 text-right tabular-nums"
                            aria-label={`Taxa ${c.code} ${QUARTER_LABELS[quarter]} ${year}`}
                          />
                        </TableCell>
                      );
                    })}
                    <TableCell className="text-right">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={pending}
                        onClick={() => refresh(c.code)}
                      >
                        <RefreshCw
                          className={
                            refreshing === c.code ? "size-4 animate-spin" : "size-4"
                          }
                        />
                        Atualizar agora
                      </Button>
                    </TableCell>
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
        <p className="text-muted-foreground text-xs">
          A taxa do trimestre, quando preenchida, tem prioridade sobre a anual. O
          preenchimento manual e o &quot;Atualizar agora&quot; se sobrescrevem.
        </p>
      </div>
    </div>
  );
}
