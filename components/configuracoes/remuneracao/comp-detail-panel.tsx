// Versão: 1.1 | Data: 16/08/2026
// v1.1: um bloco por OPERANDO da fórmula (o cálculo consulta assim — ver
// lib/comp/detail.ts): cada bloco tem sua tabela, sua paginação e seu
// subtotal. O confronto com o realizado só aparece quando existe um número
// único a comparar (fórmula de um operando puro).
// Painel de CONFERÊNCIA: "quais registros compõem o realizado deste membro ×
// fator × mês". Casca de UI sobre a action loadCompFactorDetail, que roda o
// núcleo ÚNICO lib/comp/detail.ts — o mesmo das abas Det-<Nome> do export p/
// Google Planilhas (tela e planilha nunca divergem).
//
// A listagem é EVIDÊNCIA: o painel mostra lado a lado o REALIZADO OFICIAL (do
// cálculo) e a SOMA dos registros listados, e as frases de conferência/avisos
// saem todas de lib/comp/commission-label.ts (dono único da prosa) — nunca
// texto novo aqui além de rótulo de coluna, que é layout.
//
// Leitura pura: estado local + efeito (não usa useBackgroundSave, que é o
// padrão de SAVE otimista). A janela inteira do fator já vem numa chamada; a
// paginação é client-side.
"use client";

import { AlertTriangle } from "lucide-react";
import { useEffect, useState } from "react";

import { loadCompFactorDetail } from "@/app/(app)/operacao/remuneracao/detail-actions";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { ResizableSheetContent } from "@/components/ui/resizable-sheet-content";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  DETAIL_EMPTY_NOTE,
  detailTierLabel,
  detailTierMark,
  detailTierValue,
  fmtMoneyBRL,
  fmtNumBR,
  detailRowPartsNote,
  detailSumPartsNote,
  detailTargetNote,
} from "@/lib/comp/commission-label";
import type {
  CompDetailCommission,
  CompDetailFactor,
  CompDetailOperand,
} from "@/lib/comp/detail";
import { MONTH_LABELS } from "@/lib/date/month-labels";

const PAGE_SIZE = 50;

export interface CompDetailTarget {
  planId: string;
  memberId: string;
  memberLabel: string;
  factorId: string;
}

export interface CompDetailPanelProps {
  target: CompDetailTarget | null;
  year: number;
  month: number;
  onClose: () => void;
}

interface Loaded {
  detail: CompDetailFactor;
  planName: string;
  memberLabel: string;
  apuracaoShifted: boolean;
}

function fmtValue(v: number | null, money: boolean): string {
  if (v == null) return "—";
  return money ? fmtMoneyBRL(v) : fmtNumBR(v);
}

function Summary(props: { detail: CompDetailFactor }) {
  const { detail } = props;
  const registros = detail.operands.reduce((a, o) => a + o.total, 0);
  const diverge =
    detail.listedForCompare != null &&
    detail.realized != null &&
    Math.abs(detail.realized - detail.listedForCompare) >= 0.01;
  return (
    <div className="bg-muted/40 flex flex-col gap-2 rounded-md border p-3">
      <div className="flex flex-wrap gap-x-8 gap-y-2">
        <div>
          <div className="text-muted-foreground text-xs">Realizado do fator</div>
          <div className="text-base font-semibold">
            {fmtValue(detail.realized, detail.money)}
          </div>
        </div>
        {/* Confronto NUMÉRICO — só existe com um número único a comparar. */}
        {detail.listedForCompare != null ? (
          <div>
            <div className="text-muted-foreground text-xs">
              Registros listados somam
            </div>
            <div
              className={`text-base font-semibold${diverge ? " text-destructive" : ""}`}
            >
              {fmtValue(detail.listedForCompare, detail.money)}
            </div>
          </div>
        ) : null}
        <div>
          <div className="text-muted-foreground text-xs">Registros</div>
          <div className="text-base font-semibold">{fmtNumBR(registros)}</div>
        </div>
      </div>
      {/* Memória: a conta do valor e quanto cada unidade vale. */}
      {detail.payoutFormula ? (
        <p className="text-xs tabular-nums">{detail.payoutFormula}</p>
      ) : null}
    </div>
  );
}

/** Escada de faixas de um bloco de comissão, com a aplicada destacada. */
function CommissionBlock(props: { commission: CompDetailCommission }) {
  const c = props.commission;
  // Faixa por atingimento sem a meta declarada é percentual de coisa nenhuma.
  const meta =
    c.tierBy === "attainment"
      ? detailTargetNote(
          c.triggerLabel,
          c.triggerTarget,
          c.triggerRealized,
          c.triggerMoney
        )
      : null;
  return (
    <div className="flex flex-col gap-2 rounded-md border p-3">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold">{c.label}</h3>
        <span className="font-semibold">{fmtMoneyBRL(c.value)}</span>
      </div>
      {c.formula ? (
        <p className="text-xs tabular-nums">{c.formula}</p>
      ) : null}
      <p className="text-muted-foreground text-xs">{c.tierNote}</p>
      {meta ? <p className="text-xs font-medium">{meta}</p> : null}
      <div className="overflow-x-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Faixa</TableHead>
              <TableHead className="text-right">
                {c.kind === "pct" ? "Taxa" : "Valor"}
              </TableHead>
              <TableHead>Situação</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {c.tiers.map((t, i) => (
              <TableRow
                key={`${i}-${t.fromPct}`}
                className={t.applied ? "font-semibold" : undefined}
              >
                <TableCell>
                  {detailTierLabel(
                    t.fromPct,
                    c.tierBy,
                    c.triggerMoney,
                    c.triggerTarget
                  )}
                </TableCell>
                <TableCell className="text-right whitespace-nowrap">
                  {detailTierValue(t, c.kind)}
                </TableCell>
                <TableCell
                  className={
                    t.applied ? undefined : "text-muted-foreground text-xs"
                  }
                >
                  {detailTierMark(t.applied, t.reached)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

/** Bloco de UM operando: cabeçalho, avisos, tabela paginada e subtotal. */
function OperandBlock(props: {
  operand: CompDetailOperand;
  money: boolean;
  showLabel: boolean;
}) {
  const { operand, money } = props;
  // Bloco fundido: a coluna do responsável dá lugar à composição da linha.
  const merged = operand.mergedFrom.length > 0;
  const [page, setPage] = useState(0);
  const pages = Math.max(1, Math.ceil(operand.rows.length / PAGE_SIZE));
  const slice = operand.rows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  return (
    <div className="flex flex-col gap-2">
      {props.showLabel ? (
        <h3 className="text-sm font-semibold">{operand.label}</h3>
      ) : null}
      <p className="text-muted-foreground text-xs">{operand.aggNote}</p>
      {operand.warnings.map((w, i) => (
        <p
          key={`${i}-${w}`}
          className="text-muted-foreground flex items-start gap-2 text-xs"
        >
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
          <span>{w}</span>
        </p>
      ))}
      {operand.rows.length === 0 ? (
        <p className="text-muted-foreground text-sm">{DETAIL_EMPTY_NOTE}</p>
      ) : (
        <>
          <div className="overflow-x-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Data</TableHead>
                  <TableHead>Registro</TableHead>
                  <TableHead>Base</TableHead>
                  <TableHead>{merged ? "Descrição" : "Responsável"}</TableHead>
                  <TableHead>Etapa</TableHead>
                  <TableHead className="text-right">
                    {operand.valueLabel}
                  </TableHead>
                  <TableHead className="text-right">Vale</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {slice.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="whitespace-nowrap">{r.date}</TableCell>
                    <TableCell>{r.title}</TableCell>
                    <TableCell>{r.sourceLabel}</TableCell>
                    <TableCell>
                      {merged && r.parts.length > 0
                        ? detailRowPartsNote(r.parts, money)
                        : r.responsibleLabel}
                    </TableCell>
                    <TableCell>{r.stage}</TableCell>
                    <TableCell className="text-right whitespace-nowrap">
                      {r.value != null ? fmtValue(r.value, money) : r.valueText}
                    </TableCell>
                    <TableCell className="text-right whitespace-nowrap">
                      {r.contribution != null
                        ? fmtMoneyBRL(r.contribution)
                        : "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm">
              <span className="text-muted-foreground">Subtotal: </span>
              {/* Partes de unidades diferentes não somam num número só — as
                  parcelas ficam à vista em vez de um total sem significado. */}
              <span className="font-semibold">
                {operand.sumParts.length > 0
                  ? detailSumPartsNote(operand.sumParts)
                  : fmtValue(operand.listedSum, money)}
              </span>
            </span>
            {pages > 1 ? (
              <span className="flex items-center gap-2">
                <span className="text-muted-foreground text-xs">
                  Página {page + 1} de {pages}
                </span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={page === 0}
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                >
                  Anterior
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={page >= pages - 1}
                  onClick={() => setPage((p) => Math.min(pages - 1, p + 1))}
                >
                  Próxima
                </Button>
              </span>
            ) : null}
          </div>
        </>
      )}
    </div>
  );
}

/**
 * Corpo do painel — montado com `key` do alvo, e é isso que dispensa qualquer
 * reset manual de estado: trocar de fator REMONTA o componente, então o estado
 * inicial já nasce "carregando" e o efeito só grava de forma assíncrona (nada
 * de setState síncrono dentro do efeito). O guard `alive` descarta a resposta
 * de um alvo que o usuário já trocou.
 */
function DetailBody(props: {
  target: CompDetailTarget;
  year: number;
  month: number;
}) {
  const { target, year, month } = props;
  const [state, setState] = useState<
    { kind: "pending" } | { kind: "ok"; data: Loaded } | { kind: "erro"; message: string }
  >({ kind: "pending" });

  useEffect(() => {
    let alive = true;
    void loadCompFactorDetail({
      planId: target.planId,
      factorId: target.factorId,
      memberId: target.memberId,
      memberLabel: target.memberLabel,
      year,
      month,
    })
      .then((res) => {
        if (!alive) return;
        setState(
          res.ok
            ? { kind: "ok", data: res }
            : { kind: "erro", message: res.message }
        );
      })
      .catch(() => {
        if (alive)
          setState({
            kind: "erro",
            message: "Não foi possível carregar o detalhamento.",
          });
      });
    return () => {
      alive = false;
    };
  }, [target, year, month]);

  const data = state.kind === "ok" ? state.data : null;
  const detail = data?.detail ?? null;
  const monthLabel = `${MONTH_LABELS[month - 1]} de ${year}`;

  return (
    <>
      <SheetHeader className="pb-0">
        <SheetTitle>
          {detail?.label ?? "Detalhamento"}
          {data ? ` — ${data.memberLabel}` : ""}
        </SheetTitle>
        <SheetDescription>
          {data ? `${data.planName} · ${monthLabel}` : monthLabel}
          {data?.apuracaoShifted ? " · apurado sobre o mês anterior" : ""}
        </SheetDescription>
      </SheetHeader>

      <div className="flex flex-col gap-4 px-4 pb-6">
        {state.kind === "pending" ? (
          <p className="text-muted-foreground text-sm">Carregando…</p>
        ) : null}
        {state.kind === "erro" ? (
          <p className="text-destructive text-sm">{state.message}</p>
        ) : null}

        {detail ? (
          <>
            <Summary detail={detail} />
            {detail.warnings.map((w, i) => (
              <p
                key={`${i}-${w}`}
                className="text-muted-foreground flex items-start gap-2 text-xs"
              >
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                <span>{w}</span>
              </p>
            ))}
            {detail.commissions.map((c) => (
              <CommissionBlock key={c.blockId} commission={c} />
            ))}
            {detail.operands.length === 0 ? (
              <p className="text-muted-foreground text-sm">{DETAIL_EMPTY_NOTE}</p>
            ) : (
              detail.operands.map((op, i) => (
                <OperandBlock
                  key={`${i}-${op.label}`}
                  operand={op}
                  money={detail.money}
                  showLabel={detail.operands.length > 1}
                />
              ))
            )}
          </>
        ) : null}
      </div>
    </>
  );
}

export function CompDetailPanel(props: CompDetailPanelProps) {
  const { target } = props;
  return (
    <Sheet
      open={target != null}
      onOpenChange={(o) => {
        if (!o) props.onClose();
      }}
    >
      <ResizableSheetContent
        storageKey="comp-detail-panel"
        defaultWidth={960}
        className="flex flex-col gap-4 overflow-y-auto"
      >
        {target ? (
          <DetailBody
            key={`${target.planId}:${target.factorId}:${target.memberId}:${props.year}-${props.month}`}
            target={target}
            year={props.year}
            month={props.month}
          />
        ) : null}
      </ResizableSheetContent>
    </Sheet>
  );
}
