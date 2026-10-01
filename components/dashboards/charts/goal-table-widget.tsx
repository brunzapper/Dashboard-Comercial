// Versão: 1.1 | Data: 01/10/2026
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
import { Loader2 } from "lucide-react";

import { cn } from "@/lib/utils";
import { useBackgroundSave } from "@/lib/feedback/use-background-save";
import { useFontScale } from "../font-scale-context";
import { useWarmupReady } from "../presentation-warmup";
import {
  BUS_REFETCH_DELAY_MS,
  useRefetchOrigin,
} from "@/lib/feedback/use-refetch-origin";
import { useDataChanged } from "@/lib/tasks/events";
import {
  formatAttainment,
  formatIndicatorValue,
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

  return (
    <div
      className={cn("relative flex h-full flex-col gap-2 overflow-auto", refreshing && "opacity-70")}
      // v1.1: 14px × escala do dashboard; os textos menores são em `em`.
      style={{ fontSize: Math.round(14 * fontScale * 10) / 10 }}
    >
      {refreshing ? (
        <div className="text-muted-foreground absolute top-1 right-1 flex items-center gap-1 text-[0.85em]">
          <Loader2 className="size-3 animate-spin" /> Atualizando…
        </div>
      ) : null}
      {/* v1.1: flex-1 + h-full — as linhas repartem a altura do card. */}
      <table className="h-full w-full flex-1 border-separate border-spacing-0">
        <thead>
          {/* v1.1: o cabeçalho fica justo; a sobra de altura vai às linhas. */}
          <tr className="h-px">
            <th className="bg-primary/10 sticky top-0 rounded-tl-md px-3 py-2 text-left font-semibold">
              {header}
            </th>
            {data.months.map((m) => (
              <th key={m} className="bg-primary/10 sticky top-0 px-3 py-2 text-right font-semibold">
                {monthLabel(m)}
              </th>
            ))}
            {showTotal ? (
              <th className="bg-primary/10 sticky top-0 rounded-tr-md px-3 py-2 text-right font-semibold">
                Total
              </th>
            ) : null}
          </tr>
        </thead>
        <tbody>
          {data.rows.map((row) => {
            const targets = data.months.map((_, mi) =>
              targetOf(row.id, mi, row.cells[mi]?.target ?? null)
            );
            return (
              <tr key={row.id} className={cn(row.bold && "font-semibold")}>
                <td className="border-b px-3 py-2 align-middle">
                  {row.label}
                  {row.responsibleMissing ? (
                    <span className="text-destructive block text-[0.8em] font-normal">
                      Responsável não encontrado
                    </span>
                  ) : null}
                </td>
                {row.cells.map((cell, mi) => {
                  const k = `${row.id}|${data.months[mi]}`;
                  const target = targets[mi];
                  const isEditing = editing === k;
                  return (
                    <td key={k} className="border-b px-3 py-2 text-right align-middle tabular-nums">
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
                            "inline-flex items-center gap-1 rounded px-1",
                            data.canEdit && "hover:bg-muted cursor-text"
                          )}
                        >
                          {pendingKeys.has(k) ? <Loader2 className="size-3 animate-spin" /> : null}
                          {formatIndicatorValue(target, row.unit)}
                        </button>
                      )}
                      {showRealized && row.hasRealized && cell.elapsed > 0 ? (
                        <div className="text-muted-foreground mt-0.5 flex items-center justify-end gap-1 text-[0.8em] font-normal">
                          <span title={row.errors?.[cell.month] ?? "Realizado"}>
                            {row.errors?.[cell.month] ? "erro" : formatIndicatorValue(cell.realized, row.unit)}
                          </span>
                          {showAttainment && cell.attainment != null ? (
                            <span
                              className={cn("rounded px-1", STATUS_TONE[cell.status])}
                              title={INDICATOR_STATUS_LABELS[cell.status]}
                            >
                              {formatAttainment(cell.attainment)}
                            </span>
                          ) : null}
                        </div>
                      ) : null}
                    </td>
                  );
                })}
                {showTotal ? (
                  <td className="border-b px-3 py-2 text-right align-middle tabular-nums">
                    {formatIndicatorValue(rollupMonths(targets, row.rollup), row.unit)}
                    {showRealized && row.hasRealized && row.total.realized != null ? (
                      <div className="text-muted-foreground mt-0.5 text-[0.8em] font-normal">
                        {formatIndicatorValue(row.total.realized, row.unit)}
                        {showAttainment && row.total.attainment != null
                          ? ` · ${formatAttainment(row.total.attainment)}`
                          : ""}
                      </div>
                    ) : null}
                  </td>
                ) : null}
              </tr>
            );
          })}
          {data.totalRow && totalRowTargets ? (
            <tr className="font-semibold">
              <td className="px-3 py-2">{data.totalRow.label}</td>
              {totalRowTargets.map((t, mi) => (
                <td key={mi} className="px-3 py-2 text-right tabular-nums">
                  {formatIndicatorValue(t, data.rows[0]?.unit ?? "quantidade")}
                </td>
              ))}
              {showTotal ? (
                <td className="px-3 py-2 text-right tabular-nums">
                  {formatIndicatorValue(
                    rollupMonths(totalRowTargets, "soma"),
                    data.rows[0]?.unit ?? "quantidade"
                  )}
                </td>
              ) : null}
            </tr>
          ) : null}
        </tbody>
      </table>
      {settings?.note ? (
        <p className="text-muted-foreground shrink-0 px-1 text-[0.85em] whitespace-pre-line">{settings.note}</p>
      ) : null}
    </div>
  );
}
