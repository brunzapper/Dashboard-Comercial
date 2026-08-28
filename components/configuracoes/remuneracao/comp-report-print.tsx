// Versão: 1.0 | Data: 02/08/2026
// Visão de IMPRESSÃO do relatório de Remuneração ("Exportar PDF" = impressão
// do navegador; sem lib de PDF). Portal em document.body com [data-print-root]
// oculto em tela: enquanto montado, body[data-printing="comp"] fica setado e o
// @media print de globals.css esconde o resto do shell (regra só ativa com o
// flag — Ctrl+P nas demais páginas segue intocado). Reusa o CompPlanCard (card
// único) + entryMemoryLines/fmtMoneyBRL (commission-label, dono dos textos);
// totais/subtotais derivam do MESMO computeEntry — nunca entry.total. Uma
// seção por página (break-after-page). window.print() dispara após
// double-rAF (layout assentado) com guarda fire-once (StrictMode do React 19
// roda mount→cleanup→mount) e o desmonte é do caller via `afterprint`
// (Safari: print() não bloqueia).
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import {
  fmtMoneyBRL as fmtMoney,
  SHEET_LEGEND,
} from "@/lib/comp/commission-label";
import {
  computeEntry,
  parseCompEntryInputs,
  parseCompPlanConfig,
  type CompComputedRaw,
} from "@/lib/comp/model";
import { CompPlanCard } from "./comp-plan-card";
import type {
  CompEntryClientRow,
  CompPlanClientRow,
} from "./remuneracao-manager";

export interface CompReportCard {
  key: string;
  // Cabeçalho do card (repasse do title do CompPlanCard; default = plano).
  title?: string;
  plan: CompPlanClientRow;
  entry: CompEntryClientRow | null; // null = "sem lançamento no mês"
  targets: Record<string, number | null>;
  targetRates: Record<string, number | null>;
}

export interface CompReportSection {
  key: string;
  heading?: string; // seção única (vendedor) fica sem heading
  cards: CompReportCard[];
}

export function CompReportPrint(props: {
  title: string; // "Remuneração — Agosto de 2026"
  groupingLabel?: string; // "Agrupado por plano" | "Agrupado por pessoa"
  sections: CompReportSection[];
  year: number;
  month: number;
  onDone: () => void; // caller desmonta (limpa o alvo de impressão)
}) {
  const [generatedAt] = useState(() => new Date());
  const onDoneRef = useRef(props.onDone);
  useEffect(() => {
    onDoneRef.current = props.onDone;
  });

  // Total por card, derivado uma vez (mesmo call do CompPlanCard). A memória
  // saiu daqui na v1.1 — quem a renderiza agora é o próprio card.
  const derived = useMemo(() => {
    const map = new Map<string, { total: number | null }>();
    for (const s of props.sections) {
      for (const c of s.cards) {
        if (!c.entry) continue;
        const config = parseCompPlanConfig(c.plan.config);
        if (!config) continue;
        const computed = (c.entry.computed ?? null) as CompComputedRaw | null;
        const breakdown = computeEntry(
          config,
          c.entry.base_amount ?? c.plan.base_amount_default,
          parseCompEntryInputs(c.entry.inputs),
          computed?.realized ?? {},
          c.targets,
          c.entry.responsible_id,
          c.targetRates
        );
        map.set(c.key, { total: breakdown.total });
      }
    }
    return map;
  }, [props.sections]);

  const subtotal = (s: CompReportSection) =>
    s.cards.reduce((a, c) => a + (derived.get(c.key)?.total ?? 0), 0);
  const grandTotal = props.sections.reduce((a, s) => a + subtotal(s), 0);

  const firedRef = useRef(false);
  useEffect(() => {
    document.body.dataset.printing = "comp";
    const done = () => onDoneRef.current();
    window.addEventListener("afterprint", done);
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        if (firedRef.current) return;
        firedRef.current = true;
        window.print();
      });
    });
    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
      window.removeEventListener("afterprint", done);
      delete document.body.dataset.printing;
    };
  }, []);

  return createPortal(
    <div
      data-print-root
      className="bg-background text-foreground hidden p-2 text-sm print:block"
    >
      <div className="mb-4">
        <h1 className="text-2xl font-semibold">{props.title}</h1>
        <p className="text-muted-foreground text-sm">
          {props.groupingLabel ? `${props.groupingLabel} · ` : null}
          Gerado em {generatedAt.toLocaleDateString("pt-BR")} · Total do mês:{" "}
          <span className="text-foreground font-semibold">
            {fmtMoney(grandTotal)}
          </span>
        </p>
      </div>
      {/* Legenda impressa: papel não tem tooltip, e o PDF é o formato que mais
          circula fora da equipe. Mesma fonte de verdade da planilha. */}
      <dl className="text-muted-foreground mb-4 grid grid-cols-2 gap-x-6 gap-y-0.5 border-y py-2 text-[10px]">
        {SHEET_LEGEND.map(([term, meaning]) => (
          <div key={term} className="flex gap-1">
            <dt className="text-foreground font-medium whitespace-nowrap">
              {term}
            </dt>
            <dd>{meaning}</dd>
          </div>
        ))}
      </dl>
      {props.sections.map((s) => (
        <section
          key={s.key}
          className="break-after-page last:break-after-auto mb-6 flex flex-col gap-3"
        >
          {s.heading ? (
            <div className="flex flex-wrap items-baseline justify-between gap-2 border-b pb-1">
              <h2 className="text-lg font-medium">{s.heading}</h2>
              <span className="text-muted-foreground text-sm">
                Subtotal:{" "}
                <span className="text-foreground font-semibold">
                  {fmtMoney(subtotal(s))}
                </span>
              </span>
            </div>
          ) : null}
          {s.cards.map((c) => {
            return (
              <div key={c.key} className="break-inside-avoid">
                {c.entry ? (
                  // A memória de cálculo saiu daqui: o CompPlanCard passou a
                  // renderizá-la em tela (v1.3), e mantê-la aqui a imprimiria
                  // duas vezes.
                  <CompPlanCard
                    plan={c.plan}
                    entry={c.entry}
                    year={props.year}
                    month={props.month}
                    targets={c.targets}
                    targetRates={c.targetRates}
                    title={c.title}
                  />
                ) : (
                  <div className="text-muted-foreground rounded-md border border-dashed p-4 text-sm">
                    <span className="text-foreground font-medium">
                      {c.title ?? c.plan.name}
                    </span>{" "}
                    — sem lançamento no mês.
                  </div>
                )}
              </div>
            );
          })}
        </section>
      ))}
    </div>,
    document.body
  );
}
