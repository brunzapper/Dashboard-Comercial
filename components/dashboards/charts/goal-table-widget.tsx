// Versão: 1.2 | Data: 02/10/2026
// v1.2 (02/10/2026): TABELA DE SLIDE (lib/widgets/goal-table.ts
//   resolveGoalTableDisplay). Num board com estilo: linhas de altura fixa (não
//   repartem mais o card — números sem presença em linhas de 100px), colunas de
//   mês iguais, cabeçalho em rótulo pequeno com filete, unidade só no rótulo,
//   nível "N0/N1" como etiqueta, linha em negrito vira a CONCLUSÃO (filete em
//   cima), atingimento como barrinha + texto e mês sem realizado como "—"
//   neutro (falta de dado não é desvio). Em qualquer estilo, a linha secundária
//   fica RESERVADA nas linhas que a têm (o valor de Outubro não sobe mais) e o
//   aviso "Responsável não encontrado" some ao apresentar. Cada escolha pode
//   ser fixada no widget (density/attainmentStyle/emptyRealized/
//   unitPlacement/levelTags).
// v1.1 (01/10/2026): (a) a tabela OCUPA o card — as linhas dividem a altura
//   (antes ficavam no topo, com o resto do card vazio, que é o que fazia o
//   slide parecer usar só parte da tela); (b) a fonte segue a escala do
//   dashboard (`useFontScale` — e, apresentando, o ajuste à tela); (c) avisa
//   prontidão ao pré-render do modo Apresentar (`useWarmupReady`).
// Widget "Tabela de metas" (visual_type 'metas', 0149): indicador × mês com
// META, REALIZADO e atingimento.
//
// Deferido como a Tabela Livre: a page não computa nada; o card busca por
// `runGoalTable` (escopo do widget-scope) depois do mount e re-busca quando o
// fingerprint de escopo (`scopeKey`) muda. O tick do event bus re-busca em
// SILÊNCIO (useRefetchOrigin — §4.10): o sync roda a cada minuto e piscar a
// tabela de quem está apresentando leria como defeito.
//
// Edição (admin + `editable`): clicar na meta abre o input; Enter/blur grava
// por `saveGoalCell` em background (useBackgroundSave, otimista + revert);
// apagar o valor EXCLUI a meta. Sem reconcile por refresh da página: o próprio
// card re-busca depois do save.
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2, TriangleAlert } from "lucide-react";

import { cn } from "@/lib/utils";
import { useBackgroundSave } from "@/lib/feedback/use-background-save";
import { useFontScale } from "../font-scale-context";
import { useWarmupReady } from "../presentation-warmup";
import { useDashboardStyle } from "../dashboard-style-context";
import { usePresenting } from "../presenting-context";
import { isClassicStyle } from "@/lib/dashboards/style";
import {
  labelHasUnit,
  resolveGoalTableDisplay,
  splitLevelTag,
} from "@/lib/widgets/goal-table";
import {
  BUS_REFETCH_DELAY_MS,
  useRefetchOrigin,
} from "@/lib/feedback/use-refetch-origin";
import { useDataChanged } from "@/lib/tasks/events";
import {
  formatAttainment,
  formatIndicatorValue,
  indicatorUnitSymbol,
  INDICATOR_STATUS_LABELS,
  monthLabel,
  rollupMonths,
  type IndicatorStatus,
} from "@/lib/indicators/model";
import type { GoalTableSettings } from "@/lib/widgets/types";
import {
  runGoalTable,
  saveGoalCell,
  type GoalTableResult,
} from "@/app/(app)/dashboards/goal-table-actions";

/** Cor do status — a MESMA régua nos nós da Tree (exportada). */
export const STATUS_TONE: Record<IndicatorStatus, string> = {
  ok: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  atencao: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  fora: "bg-red-500/15 text-red-700 dark:text-red-300",
  sem_dado: "bg-muted text-muted-foreground",
};

function parseTyped(raw: string): number | null | "invalid" {
  const t = raw.trim();
  if (t === "") return null;
  // pt-BR: "30.220" = trinta mil; "23,5" = vinte e três e meio.
  const norm = t.replace(/\s|R\$|%/g, "").replace(/\./g, "").replace(",", ".");
  const n = Number(norm);
  return Number.isFinite(n) ? n : "invalid";
}

export function GoalTableWidget({
  dashboardId,
  widgetId,
  settings,
  scopeKey,
}: {
  dashboardId: string;
  widgetId: string;
  settings: GoalTableSettings | undefined;
  scopeKey?: string;
}) {
  const [data, setData] = useState<GoalTableResult | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [tick, setTick] = useState(0);
  // Meta digitada que o servidor ainda não devolveu: "row|month" → valor.
  const [optimistic, setOptimistic] = useState<Record<string, number | null>>({});
  const [editing, setEditing] = useState<string | null>(null);
  const { save, pendingKeys } = useBackgroundSave();
  const fontScale = useFontScale();
  const dstyle = useDashboardStyle();
  const styled = !isClassicStyle(dstyle);
  const presenting = usePresenting();

  useDataChanged((d) => {
    if (d.kind === "record") setTick((t) => t + 1);
  });
  const configKey = JSON.stringify(settings ?? {});
  const originOf = useRefetchOrigin(`${scopeKey ?? ""}|${configKey}`);
  const payloadRef = useRef<string | null>(null);
  const visibleRef = useRef(false);
  // Re-busca forçada pós-save (conta como do usuário? não — é silenciosa: o
  // valor já está na tela pelo otimista).
  const [saveTick, setSaveTick] = useState(0);

  useEffect(() => {
    if (originOf()) visibleRef.current = true;
    const userCaused = visibleRef.current;
    let cancelled = false;
    const timer = setTimeout(
      () => {
        if (userCaused) setRefreshing(true);
        void runGoalTable(dashboardId, widgetId, window.location.search).then((res) => {
          if (cancelled) return;
          const json = JSON.stringify(res);
          if (json !== payloadRef.current) {
            payloadRef.current = json;
            setData(res);
            setOptimistic({});
          }
          visibleRef.current = false;
          setRefreshing(false);
        });
      },
      userCaused ? 60 : BUS_REFETCH_DELAY_MS
    );
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [dashboardId, widgetId, scopeKey, configKey, tick, saveTick, originOf]);

  const showRealized = settings?.showRealized !== false;
  const showAttainment = settings?.showAttainment !== false;
  const showTotal = settings?.totalColumn !== false;
  const header =
    settings?.headerLabel ??
    (settings?.mode === "por_responsavel" ? "Responsável" : "Indicador");

  const targetOf = (rowId: string, mi: number, server: number | null) => {
    const k = `${rowId}|${data?.months[mi] ?? ""}`;
    return k in optimistic ? optimistic[k] : server;
  };

  const commit = (rowId: string, mi: number, raw: string) => {
    setEditing(null);
    if (!data) return;
    const row = data.rows.find((r) => r.id === rowId);
    const month = data.months[mi];
    if (!row || !month) return;
    const parsed = parseTyped(raw);
    if (parsed === "invalid") return;
    const k = `${rowId}|${month}`;
    const before = targetOf(rowId, mi, row.cells[mi]?.target ?? null);
    if (parsed === before) return;
    setOptimistic((o) => ({ ...o, [k]: parsed }));
    save({
      key: k,
      context: "Não foi possível salvar a meta",
      reconcile: false,
      action: async () => {
        const res = await saveGoalCell({
          dashboardId,
          widgetId,
          indicator: row.indicator,
          responsibleName: row.responsibleName,
          month,
          target: parsed,
        });
        if (res.ok) setSaveTick((t) => t + 1);
        return res;
      },
      revert: () =>
        setOptimistic((o) => {
          const next = { ...o };
          delete next[k];
          return next;
        }),
    });
  };

  // v1.1: pronto para o pré-render quando a 1ª resposta chegou.
  useWarmupReady(widgetId, data !== null);

  const totalRowTargets = useMemo(() => {
    if (!data?.totalRow) return null;
    return data.months.map((_, mi) => {
      const nums = data.rows.map((r) => targetOf(r.id, mi, r.cells[mi]?.target ?? null));
      const valid = nums.filter((n): n is number => n != null);
      return valid.length ? valid.reduce((a, b) => a + b, 0) : null;
    });
    // targetOf lê `optimistic`/`data` — as deps reais.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, optimistic]);

  if (!data) {
    return <div className="bg-muted h-full min-h-24 w-full animate-pulse rounded-md" />;
  }
  if (!data.ok) {
    return (
      <div className="text-muted-foreground flex h-full items-center justify-center p-3 text-sm">
        {data.message ?? "Não foi possível carregar a tabela de metas."}
      </div>
    );
  }
  if (data.rows.length === 0) {
    return (
      <div className="text-muted-foreground flex h-full items-center justify-center p-3 text-center text-sm">
        Escolha os indicadores na configuração do widget (⋮ → Editar).
      </div>
    );
  }

  // v1.2: exibição resolvida contra o estilo (Clássico = o de sempre).
  const disp = resolveGoalTableDisplay(settings, {
    styled,
    header: dstyle.table.header,
    zebra: dstyle.table.zebra,
  });
  const fill = disp.density === "preencher";
  const cellPad =
    disp.density === "compacta"
      ? "px-3 py-[0.35em]"
      : disp.density === "confortavel"
        ? "px-3 py-[0.65em]"
        : "px-3 py-2";
  const lineHeader = disp.header === "linha";
  const thBg = dstyle.card === "superficie" ? "bg-card" : "bg-background";
  const thClass = (align: "left" | "right", edge?: "l" | "r") =>
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
        );
  const valueOpts = { unit: disp.unitPlacement !== "rotulo" };
  const toneText: Record<IndicatorStatus, string> = {
    ok: "text-ds-good",
    atencao: "text-ds-warn",
    fora: "text-ds-bad",
    sem_dado: "text-muted-foreground",
  };
  const barTone: Record<IndicatorStatus, string> = {
    ok: "bg-ds-good",
    atencao: "bg-ds-warn",
    fora: "bg-ds-bad",
    sem_dado: "bg-muted-foreground",
  };
  // Realizado "vazio": sem número ou zero num mês decorrido. Com "traco", é
  // falta de dado — não desvio de meta, então nada de vermelho.
  const realizedEmpty = (v: number | null | undefined) =>
    disp.emptyRealized === "traco" && (v == null || v === 0);

  // Linha secundária da célula (realizado · atingimento). `reserve` mantém a
  // altura mesmo vazia: é o que alinha o valor principal entre os meses.
  const subLine = (
    show: boolean,
    realized: number | null | undefined,
    attainment: number | null | undefined,
    status: IndicatorStatus,
    unit: GoalTableResult["rows"][number]["unit"],
    error?: string,
    reserve = false
  ) => {
    if (!show) {
      return reserve ? <div className="mt-0.5 text-[0.8em]" aria-hidden>&nbsp;</div> : null;
    }
    if (realizedEmpty(realized) && !error) {
      return (
        <div className="text-muted-foreground mt-0.5 text-[0.8em] font-normal" title="Ainda sem realizado">
          —
        </div>
      );
    }
    const pct =
      showAttainment && attainment != null ? (
        disp.attainmentStyle === "pilula" ? (
          <span
            className={cn("rounded px-1", STATUS_TONE[status])}
            title={INDICATOR_STATUS_LABELS[status]}
          >
            {formatAttainment(attainment)}
          </span>
        ) : (
          <span className={toneText[status]} title={INDICATOR_STATUS_LABELS[status]}>
            {formatAttainment(attainment)}
          </span>
        )
      ) : null;
    return (
      <>
        {disp.attainmentStyle === "barra" && showAttainment && attainment != null ? (
          <div className="bg-border mt-[0.3em] ml-auto h-[2px] w-[5.5em] overflow-hidden rounded-full" aria-hidden>
            <div
              className={cn("h-full", barTone[status])}
              style={{ width: `${Math.max(0, Math.min(100, attainment))}%` }}
            />
          </div>
        ) : null}
        <div className="text-muted-foreground mt-0.5 flex items-center justify-end gap-1 text-[0.8em] font-normal">
          <span title={error ?? "Realizado"}>
            {error ? "erro" : formatIndicatorValue(realized, unit, valueOpts)}
          </span>
          {pct ? (disp.attainmentStyle === "pilula" ? pct : <>· {pct}</>) : null}
        </div>
      </>
    );
  };

  const labelCell = (row: GoalTableResult["rows"][number]) => {
    const raw = row.label;
    const { tag, text } = disp.levelTags ? splitLevelTag(raw) : { tag: null, text: raw };
    const unitSym =
      disp.unitPlacement === "rotulo" && !labelHasUnit(raw)
        ? indicatorUnitSymbol(row.unit)
        : "";
    return (
      <>
        {tag ? (
          <span className="text-muted-foreground mr-[0.6em] font-mono text-[0.7em] font-normal tracking-wide">
            {tag}
          </span>
        ) : null}
        {text}
        {unitSym ? (
          <span className="text-muted-foreground ml-[0.35em] text-[0.8em] font-normal">
            ({unitSym})
          </span>
        ) : null}
        {row.responsibleMissing && !presenting ? (
          styled ? (
            <span
              className="text-ds-warn ml-[0.4em] inline-flex align-middle"
              title="Responsável não encontrado — confira o nome na configuração (não aparece ao apresentar)"
            >
              <TriangleAlert className="size-[0.85em]" />
            </span>
          ) : (
            <span className="text-destructive block text-[0.8em] font-normal">
              Responsável não encontrado
            </span>
          )
        ) : null}
      </>
    );
  };

  return (
    <div
      className={cn("relative flex h-full flex-col gap-2 overflow-auto", refreshing && "opacity-70")}
      // v1.1: 14px × escala do dashboard; os textos menores são em `em`.
      // v1.2: × o multiplicador de tabela do estilo.
      style={{
        fontSize:
          Math.round(14 * fontScale * (styled ? dstyle.fontScale.table : 1) * 10) / 10,
      }}
    >
      {refreshing ? (
        <div className="text-muted-foreground absolute top-1 right-1 flex items-center gap-1 text-[0.85em]">
          <Loader2 className="size-3 animate-spin" /> Atualizando…
        </div>
      ) : null}
      {/* v1.1: flex-1 + h-full — as linhas repartem a altura do card.
          v1.2: só na densidade "preencher"; as outras têm linha de altura fixa
          e colunas de mês iguais. */}
      <table
        className={cn(
          "w-full border-separate border-spacing-0",
          fill ? "h-full flex-1" : "table-fixed"
        )}
      >
        {!fill ? (
          <colgroup>
            <col style={{ width: "34%" }} />
          </colgroup>
        ) : null}
        <thead>
          {/* v1.1: o cabeçalho fica justo; a sobra de altura vai às linhas. */}
          <tr className="h-px">
            <th className={thClass("left", "l")}>{header}</th>
            {data.months.map((m) => (
              <th key={m} className={thClass("right")}>
                {monthLabel(m)}
              </th>
            ))}
            {showTotal ? <th className={thClass("right", "r")}>Total</th> : null}
          </tr>
        </thead>
        <tbody>
          {data.rows.map((row) => {
            const targets = data.months.map((_, mi) =>
              targetOf(row.id, mi, row.cells[mi]?.target ?? null)
            );
            // v1.2: linha em destaque (a conclusão) num board com estilo —
            // filete em cima e corpo um pouco maior, além do peso.
            const emphasis = styled && row.bold;
            const emphasisStyle = emphasis
              ? { borderTop: "1px solid var(--foreground)", fontSize: "1.08em" }
              : undefined;
            const reserve = showRealized && row.hasRealized;
            return (
              <tr
                key={row.id}
                className={cn(row.bold && "font-semibold", disp.zebra && "even:bg-muted/70")}
              >
                <td className={cn("border-b align-middle", cellPad)} style={emphasisStyle}>
                  {labelCell(row)}
                </td>
                {row.cells.map((cell, mi) => {
                  const k = `${row.id}|${data.months[mi]}`;
                  const target = targets[mi];
                  const isEditing = editing === k;
                  return (
                    <td
                      key={k}
                      className={cn("border-b text-right align-middle tabular-nums", cellPad)}
                      style={emphasisStyle}
                    >
                      {isEditing ? (
                        <input
                          autoFocus
                          defaultValue={target == null ? "" : String(target).replace(".", ",")}
                          className="bg-background w-[6em] rounded border px-1 text-right"
                          onBlur={(e) => commit(row.id, mi, e.currentTarget.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") e.currentTarget.blur();
                            if (e.key === "Escape") setEditing(null);
                          }}
                        />
                      ) : (
                        <button
                          type="button"
                          disabled={!data.canEdit}
                          title={data.canEdit ? "Clique para editar a meta" : "Meta"}
                          onClick={() => setEditing(k)}
                          className={cn(
                            // -mx-1: o respiro do botão não desloca o número
                            // da borda direita da coluna (alinha com o cabeçalho).
                            "-mx-1 inline-flex items-center gap-1 rounded px-1",
                            data.canEdit && "hover:bg-muted cursor-text"
                          )}
                        >
                          {pendingKeys.has(k) ? <Loader2 className="size-3 animate-spin" /> : null}
                          {formatIndicatorValue(target, row.unit, valueOpts)}
                        </button>
                      )}
                      {subLine(
                        showRealized && row.hasRealized && cell.elapsed > 0,
                        cell.realized,
                        cell.attainment,
                        cell.status,
                        row.unit,
                        row.errors?.[cell.month],
                        reserve
                      )}
                    </td>
                  );
                })}
                {showTotal ? (
                  <td
                    className={cn("border-b text-right align-middle tabular-nums", cellPad)}
                    style={emphasisStyle}
                  >
                    {formatIndicatorValue(rollupMonths(targets, row.rollup), row.unit, valueOpts)}
                    {disp.attainmentStyle === "pilula" && disp.emptyRealized === "zero" ? (
                      showRealized && row.hasRealized && row.total.realized != null ? (
                        <div className="text-muted-foreground mt-0.5 text-[0.8em] font-normal">
                          {formatIndicatorValue(row.total.realized, row.unit)}
                          {showAttainment && row.total.attainment != null
                            ? ` · ${formatAttainment(row.total.attainment)}`
                            : ""}
                        </div>
                      ) : reserve ? (
                        <div className="mt-0.5 text-[0.8em]" aria-hidden>&nbsp;</div>
                      ) : null
                    ) : (
                      subLine(
                        showRealized && row.hasRealized && row.total.realized != null,
                        row.total.realized,
                        row.total.attainment,
                        // O servidor não manda o status do total (a régua
                        // de tolerância é por mês) — total em tom neutro.
                        "sem_dado",
                        row.unit,
                        undefined,
                        reserve
                      )
                    )}
                  </td>
                ) : null}
              </tr>
            );
          })}
          {data.totalRow && totalRowTargets ? (
            <tr className="font-semibold">
              <td
                className={cellPad}
                style={styled ? { borderTop: "1px solid var(--foreground)" } : undefined}
              >
                {data.totalRow.label}
              </td>
              {totalRowTargets.map((t, mi) => (
                <td
                  key={mi}
                  className={cn("text-right tabular-nums", cellPad)}
                  style={styled ? { borderTop: "1px solid var(--foreground)" } : undefined}
                >
                  {formatIndicatorValue(t, data.rows[0]?.unit ?? "quantidade", valueOpts)}
                </td>
              ))}
              {showTotal ? (
                <td
                  className={cn("text-right tabular-nums", cellPad)}
                  style={styled ? { borderTop: "1px solid var(--foreground)" } : undefined}
                >
                  {formatIndicatorValue(
                    rollupMonths(totalRowTargets, "soma"),
                    data.rows[0]?.unit ?? "quantidade",
                    valueOpts
                  )}
                </td>
              ) : null}
            </tr>
          ) : null}
        </tbody>
      </table>
      {settings?.note ? (
        <p
          className={cn(
            "text-muted-foreground shrink-0 px-1 text-[0.85em] whitespace-pre-line",
            styled && "border-t pt-2"
          )}
        >
          {settings.note}
        </p>
      ) : null}
    </div>
  );
}

