// Versão: 1.0 | Data: 02/10/2026
// v1.0 (02/10/2026): PEÇAS das células de META da Tabela Livre — MOVIDAS (não
//   reescritas) do widget da antiga Tabela de metas (goal-table-widget v1.2),
//   que a Tabela Livre absorveu. A marcação, as classes e os tamanhos em `em`
//   são os MESMOS: é o que garante a paridade visual das tabelas convertidas
//   (o preset Metas 4T26 inclusive). Consumidas pela tabela de apresentação
//   (presentation-table.tsx) e pela grade de planilha (quick-table-widget).
//
// Mudanças em relação ao widget antigo (todas pedidas e nenhuma visual por
// padrão): a etiqueta da linha é DADO (`row.tag`, antes regex "N1 " no
// rótulo), a unidade no rótulo tem modo por linha (automático/sempre/nunca) e
// a célula pode mostrar só uma FACETA (meta, realizado ou atingimento).
"use client";

import { Loader2, TriangleAlert } from "lucide-react";

import { cn } from "@/lib/utils";
import {
  formatAttainment,
  formatIndicatorValue,
  indicatorUnitSymbol,
  INDICATOR_STATUS_LABELS,
  type IndicatorStatus,
  type IndicatorUnit,
} from "@/lib/indicators/model";
import {
  labelHasUnit,
  resolveGoalTableDisplay,
  type GoalTableDisplay,
} from "@/lib/widgets/goal-table";
import { STATUS_TONE } from "@/components/indicators/status-tone";
import type { QTGoalView, QTRowGoalView } from "@/lib/widgets/quick-table/model";
import type { QuickTableGoalDisplay } from "@/lib/widgets/types";
import { isClassicStyle } from "@/lib/dashboards/style";
import { useDashboardStyle } from "../dashboard-style-context";

const TONE_TEXT: Record<IndicatorStatus, string> = {
  ok: "text-ds-good",
  atencao: "text-ds-warn",
  fora: "text-ds-bad",
  sem_dado: "text-muted-foreground",
};
const TONE_BAR: Record<IndicatorStatus, string> = {
  ok: "bg-ds-good",
  atencao: "bg-ds-warn",
  fora: "bg-ds-bad",
  sem_dado: "bg-muted-foreground",
};

export interface GoalDisplayKit {
  disp: GoalTableDisplay;
  styled: boolean;
  /** Fonte base da tabela (14px × escala; × escala de tabela do estilo). */
  fontSizeFor: (fontScale: number) => number;
  fill: boolean;
  cellPad: string;
  thClass: (align: "left" | "right", edge?: "l" | "r") => string;
  valueOpts: { unit: boolean };
  showRealized: boolean;
  showAttainment: boolean;
}

/** Exibição resolvida contra o estilo do board (Clássico = o de sempre). */
export function useGoalDisplay(
  display: QuickTableGoalDisplay | undefined,
  goals: { showRealized?: boolean; showAttainment?: boolean } | undefined
): GoalDisplayKit {
  const dstyle = useDashboardStyle();
  const styled = !isClassicStyle(dstyle);
  const disp = resolveGoalTableDisplay(display, {
    styled,
    header: dstyle.table.header,
    zebra: dstyle.table.zebra,
  });
  const lineHeader = disp.header === "linha";
  const thBg = dstyle.card === "superficie" ? "bg-card" : "bg-background";
  return {
    disp,
    styled,
    fontSizeFor: (fontScale) =>
      Math.round(14 * fontScale * (styled ? dstyle.fontScale.table : 1) * 10) / 10,
    fill: disp.density === "preencher",
    cellPad:
      disp.density === "compacta"
        ? "px-3 py-[0.35em]"
        : disp.density === "confortavel"
          ? "px-3 py-[0.65em]"
          : "px-3 py-2",
    thClass: (align, edge) =>
      lineHeader
        ? cn(
            thBg,
            "text-muted-foreground sticky top-0 border-b px-3 pt-1 pb-[0.55em] text-[0.72em] font-semibold tracking-[0.1em] uppercase",
            align === "left" ? "text-left" : "text-right"
          )
        : cn(
            "bg-primary/10 sticky top-0 px-3 py-2 font-semibold",
            align === "left" ? "text-left" : "text-right",
            edge === "l" && "rounded-tl-md",
            edge === "r" && "rounded-tr-md"
          ),
    valueOpts: { unit: disp.unitPlacement !== "rotulo" },
    showRealized: goals?.showRealized !== false,
    showAttainment: goals?.showAttainment !== false,
  };
}

/**
 * Linha secundária da célula (realizado · atingimento). `reserve` mantém a
 * altura mesmo vazia: é o que alinha o valor principal entre os meses.
 */
export function GoalSubLine({
  kit,
  show,
  realized,
  attainment,
  status,
  unit,
  error,
  reserve = false,
}: {
  kit: GoalDisplayKit;
  show: boolean;
  realized: number | null | undefined;
  attainment: number | null | undefined;
  status: IndicatorStatus;
  unit: IndicatorUnit;
  error?: string;
  reserve?: boolean;
}) {
  const { disp } = kit;
  if (!show) {
    return reserve ? <div className="mt-0.5 text-[0.8em]" aria-hidden>&nbsp;</div> : null;
  }
  // Realizado "vazio": sem número ou zero num mês decorrido. Com "traco", é
  // falta de dado — não desvio de meta, então nada de vermelho.
  const empty = disp.emptyRealized === "traco" && (realized == null || realized === 0);
  if (empty && !error) {
    return (
      <div className="text-muted-foreground mt-0.5 text-[0.8em] font-normal" title="Ainda sem realizado">
        —
      </div>
    );
  }
  const pct =
    kit.showAttainment && attainment != null ? (
      disp.attainmentStyle === "pilula" ? (
        <span className={cn("rounded px-1", STATUS_TONE[status])} title={INDICATOR_STATUS_LABELS[status]}>
          {formatAttainment(attainment)}
        </span>
      ) : (
        <span className={TONE_TEXT[status]} title={INDICATOR_STATUS_LABELS[status]}>
          {formatAttainment(attainment)}
        </span>
      )
    ) : null;
  return (
    <>
      {disp.attainmentStyle === "barra" && kit.showAttainment && attainment != null ? (
        <div className="bg-border mt-[0.3em] ml-auto h-[2px] w-[5.5em] overflow-hidden rounded-full" aria-hidden>
          <div
            className={cn("h-full", TONE_BAR[status])}
            style={{ width: `${Math.max(0, Math.min(100, attainment))}%` }}
          />
        </div>
      ) : null}
      <div className="text-muted-foreground mt-0.5 flex items-center justify-end gap-1 text-[0.8em] font-normal">
        <span title={error ?? "Realizado"}>
          {error ? "erro" : formatIndicatorValue(realized, unit, kit.valueOpts)}
        </span>
        {pct ? (disp.attainmentStyle === "pilula" ? pct : <>· {pct}</>) : null}
      </div>
    </>
  );
}

/** Rótulo da linha: etiqueta, texto, unidade e aviso de responsável. */
export function GoalRowLabel({
  kit,
  row,
  presenting,
}: {
  kit: GoalDisplayKit;
  row: QTRowGoalView;
  presenting: boolean;
}) {
  const { disp, styled } = kit;
  // Etiqueta: discreta (levelTags) ou como texto, antes do rótulo (o visual
  // do rótulo "N1 MRR novo" de sempre no Clássico).
  const tag = row.tag && disp.levelTags ? row.tag : null;
  const text = row.tag && !disp.levelTags ? `${row.tag} ${row.label}` : row.label;
  const showUnit =
    row.unitMode === "show" ||
    (row.unitMode === "auto" && disp.unitPlacement === "rotulo" && !labelHasUnit(text));
  const unitSym = showUnit && row.unitMode !== "hide" ? indicatorUnitSymbol(row.unit) : "";
  return (
    <>
      {tag ? (
        <span className="text-muted-foreground mr-[0.6em] font-mono text-[0.7em] font-normal tracking-wide">
          {tag}
        </span>
      ) : null}
      {text}
      {unitSym ? (
        <span className="text-muted-foreground ml-[0.35em] text-[0.8em] font-normal">({unitSym})</span>
      ) : null}
      {row.responsibleMissing && !presenting ? (
        styled ? (
          <span
            className="text-ds-warn ml-[0.4em] inline-flex align-middle"
            title="Responsável não encontrado — confira o nome na configuração da linha (não aparece ao apresentar)"
          >
            <TriangleAlert className="size-[0.85em]" />
          </span>
        ) : (
          <span className="text-destructive block text-[0.8em] font-normal">Responsável não encontrado</span>
        )
      ) : null}
      {row.chips.length > 0 ? (
        <span className="mt-0.5 flex flex-wrap gap-1">
          {row.chips.map((c) => (
            <span key={c} className="bg-muted text-muted-foreground rounded px-1 text-[0.7em] font-normal">
              {c}
            </span>
          ))}
        </span>
      ) : null}
    </>
  );
}

/** A meta (botão que abre o input quando editável). */
export function GoalTarget({
  kit,
  view,
  editing,
  pending,
  onStartEdit,
  onCommit,
  onCancel,
}: {
  kit: GoalDisplayKit;
  view: QTGoalView;
  editing: boolean;
  pending: boolean;
  onStartEdit: () => void;
  onCommit: (raw: string) => void;
  onCancel: () => void;
}) {
  if (editing) {
    return (
      <input
        autoFocus
        defaultValue={view.target == null ? "" : String(view.target).replace(".", ",")}
        className="bg-background w-[6em] rounded border px-1 text-right"
        onBlur={(e) => onCommit(e.currentTarget.value)}
        onPointerDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") onCancel();
        }}
      />
    );
  }
  return (
    <button
      type="button"
      disabled={!view.editable}
      title={view.editable ? "Clique para editar a meta" : "Meta"}
      onClick={(e) => {
        e.stopPropagation();
        onStartEdit();
      }}
      className={cn(
        // -mx-1: o respiro do botão não desloca o número da borda direita da
        // coluna (alinha com o cabeçalho).
        "-mx-1 inline-flex items-center gap-1 rounded px-1",
        view.editable && "hover:bg-muted cursor-text"
      )}
    >
      {pending ? <Loader2 className="size-3 animate-spin" /> : null}
      {formatIndicatorValue(view.target, view.unit, kit.valueOpts)}
    </button>
  );
}

/**
 * Corpo de uma célula de meta pela FACETA. "composto" = meta + linha
 * secundária (o visual da Tabela de metas); as outras mostram um número só.
 */
export function GoalCellBody({
  kit,
  view,
  rowHasRealized,
  editing,
  pending,
  onStartEdit,
  onCommit,
  onCancel,
}: {
  kit: GoalDisplayKit;
  view: QTGoalView;
  /** A linha tem realizado (reserva a altura da linha secundária). */
  rowHasRealized: boolean;
  editing: boolean;
  pending: boolean;
  onStartEdit: () => void;
  onCommit: (raw: string) => void;
  onCancel: () => void;
}) {
  if (view.facet === "realizado") {
    return <>{view.error ? "erro" : formatIndicatorValue(view.realized, view.unit, kit.valueOpts)}</>;
  }
  if (view.facet === "atingimento") {
    return (
      <span className={kit.styled ? TONE_TEXT[view.status] : undefined}>
        {formatAttainment(view.attainment)}
      </span>
    );
  }
  const target =
    view.kind === "month" ? (
      <GoalTarget
        kit={kit}
        view={view}
        editing={editing}
        pending={pending}
        onStartEdit={onStartEdit}
        onCommit={onCommit}
        onCancel={onCancel}
      />
    ) : (
      formatIndicatorValue(view.target, view.unit, kit.valueOpts)
    );
  if (view.facet === "meta" || view.kind === "sum") return <>{target}</>;
  const reserve = kit.showRealized && rowHasRealized;
  if (view.kind === "total") {
    // Total: o ramo Clássico (pílula + zero) é o de sempre da Tabela de metas.
    const { disp } = kit;
    return (
      <>
        {target}
        {disp.attainmentStyle === "pilula" && disp.emptyRealized === "zero" ? (
          kit.showRealized && view.hasRealized && view.realized != null ? (
            <div className="text-muted-foreground mt-0.5 text-[0.8em] font-normal">
              {formatIndicatorValue(view.realized, view.unit)}
              {kit.showAttainment && view.attainment != null ? ` · ${formatAttainment(view.attainment)}` : ""}
            </div>
          ) : reserve ? (
            <div className="mt-0.5 text-[0.8em]" aria-hidden>&nbsp;</div>
          ) : null
        ) : (
          <GoalSubLine
            kit={kit}
            show={kit.showRealized && view.hasRealized && view.realized != null}
            realized={view.realized}
            attainment={view.attainment}
            // O total não tem status (a régua de tolerância é por mês) — neutro.
            status="sem_dado"
            unit={view.unit}
            reserve={reserve}
          />
        )}
      </>
    );
  }
  return (
    <>
      {target}
      <GoalSubLine
        kit={kit}
        show={kit.showRealized && view.hasRealized && view.elapsed > 0}
        realized={view.realized}
        attainment={view.attainment}
        status={view.status}
        unit={view.unit}
        error={view.error}
        reserve={reserve}
      />
    </>
  );
}
