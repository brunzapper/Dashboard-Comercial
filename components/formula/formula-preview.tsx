// Versão: 1.0 | Data: 20/07/2026
// Painel de PRÉVIA do FormulaEditor: executa a fórmula VÁLIDA corrente via um
// adapter (server action) com debounce e mostra o resultado antes do save —
// por-registro (linhas de registros reais, com operandos e nota de casado
// ausente) ou agregado (valor único; 1º cálculo por clique quando manualStart,
// por custar RPCs como um widget). O editor decide QUANDO chamar; o adapter
// decide COMO calcular — sempre pelos mesmos choke points da materialização.
"use client";

import { useEffect, useRef, useState } from "react";
import { LoaderCircle, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { Formula } from "@/lib/records/formulas";

export interface FormulaPreviewRow {
  title: string;
  source?: string;
  operands: { label: string; value: string }[];
  result: string;
  note?: string;
}

export interface FormulaPreviewData {
  ok: boolean;
  message?: string;
  // Por-registro: linhas de amostra. Agregado: valor único.
  rows?: FormulaPreviewRow[];
  value?: string;
  // Ex.: "prévia sem o período da barra".
  badge?: string;
}

export interface FormulaPreviewAdapter {
  run: (formula: Formula) => Promise<FormulaPreviewData>;
  title?: string;
  // Agregado: o 1º cálculo é por clique (custa RPCs como renderizar um
  // widget); depois segue auto com debounce enquanto o painel está ativo.
  manualStart?: boolean;
}

const DEBOUNCE_MS = 700;

export function FormulaPreviewPanel({
  adapter,
  formula,
  valid,
}: {
  adapter: FormulaPreviewAdapter;
  // Fórmula corrente (null = vazia/erro de tokenização).
  formula: Formula | null;
  valid: boolean;
}) {
  const [started, setStarted] = useState(!adapter.manualStart);
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<FormulaPreviewData | null>(null);
  // Recalcular manual: incrementa e o efeito roda de novo mesmo com a mesma
  // fórmula (lastSig é zerado junto).
  const [tick, setTick] = useState(0);
  // O host recria o adapter a cada render — ref evita re-disparo por identidade
  // (atualizada em efeito, nunca durante o render).
  const adapterRef = useRef(adapter);
  useEffect(() => {
    adapterRef.current = adapter;
  }, [adapter]);
  const lastSig = useRef<string | null>(null);
  const seq = useRef(0);

  useEffect(() => {
    if (!started || !valid || !formula) return;
    const sig = JSON.stringify(formula);
    if (sig === lastSig.current) return;
    const t = setTimeout(async () => {
      lastSig.current = sig;
      const mySeq = ++seq.current;
      setLoading(true);
      try {
        const res = await adapterRef.current.run(formula);
        if (mySeq === seq.current) setData(res);
      } catch {
        if (mySeq === seq.current) {
          setData({ ok: false, message: "Falha ao calcular a prévia." });
        }
      } finally {
        if (mySeq === seq.current) setLoading(false);
      }
    }, DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [started, valid, formula, tick]);

  return (
    <div className="bg-muted/30 flex flex-col gap-1.5 rounded-md border p-2">
      <div className="flex items-center gap-2">
        <span className="text-xs font-medium">
          {adapter.title ?? "Prévia"}
        </span>
        {data?.badge ? (
          <span className="text-muted-foreground text-xs">({data.badge})</span>
        ) : null}
        {loading ? (
          <LoaderCircle className="text-muted-foreground size-3.5 animate-spin" />
        ) : started && data ? (
          <button
            type="button"
            aria-label="Recalcular prévia"
            className="text-muted-foreground hover:text-foreground"
            onClick={() => {
              lastSig.current = null;
              setTick((t) => t + 1);
            }}
          >
            <RefreshCw className="size-3.5" />
          </button>
        ) : null}
      </div>

      {!started ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="self-start"
          disabled={!valid || !formula}
          onClick={() => setStarted(true)}
        >
          Calcular prévia
        </Button>
      ) : !valid || !formula ? (
        <p className="text-muted-foreground text-xs">
          Complete a fórmula (status verde acima) para ver a prévia.
        </p>
      ) : !data ? (
        <p className="text-muted-foreground text-xs">Calculando…</p>
      ) : !data.ok ? (
        <p className="text-destructive text-xs">{data.message}</p>
      ) : data.value != null ? (
        <p className="text-lg font-semibold tabular-nums">{data.value}</p>
      ) : (
        <div className="flex flex-col gap-1">
          {(data.rows ?? []).map((r, i) => (
            <div
              key={i}
              className={cn(
                "bg-background flex flex-col gap-0.5 rounded border px-2 py-1",
                r.note && "border-amber-500/40"
              )}
            >
              <div className="flex items-baseline justify-between gap-2">
                <span className="truncate text-xs font-medium">
                  {r.title}
                  {r.source ? (
                    <span className="text-muted-foreground font-normal">
                      {" "}
                      · {r.source}
                    </span>
                  ) : null}
                </span>
                <span className="shrink-0 text-sm font-semibold tabular-nums">
                  {r.result}
                </span>
              </div>
              {r.operands.length > 0 ? (
                <span className="text-muted-foreground truncate text-xs">
                  {r.operands.map((o) => `${o.label}: ${o.value}`).join(" · ")}
                </span>
              ) : null}
              {r.note ? (
                <span className="text-xs text-amber-600">{r.note}</span>
              ) : null}
            </div>
          ))}
          {(data.rows ?? []).length === 0 ? (
            <p className="text-muted-foreground text-xs">
              Nenhum registro para pré-visualizar.
            </p>
          ) : null}
        </div>
      )}
    </div>
  );
}
