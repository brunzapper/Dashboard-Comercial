// Versão: 1.0 | Data: 17/09/2026
// O gestor da BASE MANUAL (0142) — UM componente para TRÊS superfícies:
// Registros → Base manual, o ⋮ do dashboard e o widget "Base do Dashboard".
// Três editores seriam a régua paralela que a invariante 25 proíbe, e com três
// telas a divergência apareceria no primeiro ajuste.
//
// O que muda entre elas é só o que se mostra (`compact` esconde a gestão de
// dados e o assistente; `onlySeries` recorta as colunas) — o caminho de
// escrita é o mesmo, sempre pelas actions de app/(app)/registros/base-manual.
//
// Save OTIMISTA em background (lib/feedback/use-background-save.ts): o valor
// aparece na hora, a action roda com `{ revalidate: false }` e o refresh
// debounced reconcilia. É o refresh que faz os widgets do dashboard
// recalcularem — o carimbo da base entra no fingerprint deferido, então eles
// re-buscam mostrando "Atualizando…".
"use client";

import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { HelpHint } from "@/components/ui/help-hint";
import { useBackgroundSave } from "@/lib/feedback/use-background-save";
import {
  DEFAULT_MANUAL_SPREAD,
  MANUAL_SPREADS,
  MANUAL_SPREAD_HINTS,
  MANUAL_SPREAD_LABELS,
  type ManualEntry,
  type ManualSeries,
  type ManualSpread,
} from "@/lib/manual-base/types";
import {
  deleteManualEntry,
  deleteManualSeries,
  saveManualEntry,
  saveManualSeries,
} from "@/app/(app)/registros/base-manual/actions";

import {
  buildManualGrid,
  manualColumns,
  manualPeriodLabel,
  manualRowKey,
  monthEnd,
  type ManualGridRow,
} from "./rows";

export interface ManualBaseOption {
  id: string;
  name: string;
}

export interface ManualBaseManagerProps {
  series: ManualSeries[];
  entries: ManualEntry[];
  responsibles: ManualBaseOption[];
  operations: ManualBaseOption[];
  canEdit: boolean;
  /** Widget/sheet: esconde a gestão de DADOS e o assistente, deixando só a
   *  grade de lançamentos. */
  compact?: boolean;
  /** Recorta as colunas (chaves de dado). Vazio = todas. */
  onlySeries?: string[];
  /** Assistente de IA, injetado pela superfície que o hospeda (o widget não o
   *  hospeda). Fica aqui para o gestor não importar o painel e, com ele, todo
   *  o caminho de IA em telas que não o usam. */
  assistant?: React.ReactNode;
}

const todayMonth = (): string => {
  // Mês de Brasília — o read side inteiro é prefix-based (invariante 11).
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(new Date());
  const y = parts.find((p) => p.type === "year")?.value ?? "2026";
  const m = parts.find((p) => p.type === "month")?.value ?? "01";
  return `${y}-${m}`;
};

const NONE = "__none__";

export function ManualBaseManager({
  series,
  entries,
  responsibles,
  operations,
  canEdit,
  compact,
  onlySeries,
  assistant,
}: ManualBaseManagerProps) {
  const { save, pendingKeys } = useBackgroundSave();

  // Estado otimista: a lista do servidor SEMEIA, e a edição escreve aqui. O
  // router.refresh() do save reconcilia trazendo a lista nova por props — por
  // isso a semente é por identidade da lista, não por efeito.
  const [rows, setRows] = useState<ManualEntry[]>(entries);
  const [seedKey, setSeedKey] = useState(() => JSON.stringify(entries.map((e) => e.id)));
  const nextSeed = JSON.stringify(entries.map((e) => e.id));
  if (nextSeed !== seedKey && pendingKeys.size === 0) {
    // Guarda anti-eco do padrão seedKey: com save em voo, o eco do servidor é
    // stale e nunca pode clobberar o otimista.
    setSeedKey(nextSeed);
    setRows(entries);
  }

  const columns = useMemo(() => manualColumns(series, onlySeries), [series, onlySeries]);
  const grid = useMemo(() => buildManualGrid(rows), [rows]);

  const [newMonth, setNewMonth] = useState(todayMonth);
  const [newOperation, setNewOperation] = useState<string>(NONE);
  const [newResponsible, setNewResponsible] = useState<string>(NONE);
  const [newSpread, setNewSpread] = useState<ManualSpread>(DEFAULT_MANUAL_SPREAD);
  const [newSeriesLabel, setNewSeriesLabel] = useState("");
  const [pendingRows, setPendingRows] = useState<ManualGridRow[]>([]);
  const [confirmSeries, setConfirmSeries] = useState<ManualSeries | null>(null);
  const [confirmRow, setConfirmRow] = useState<ManualGridRow | null>(null);

  const allRows = useMemo(() => [...pendingRows, ...grid], [pendingRows, grid]);

  const addRow = () => {
    const start = `${newMonth}-01`;
    const end = monthEnd(newMonth);
    const responsibleId = newResponsible === NONE ? null : newResponsible;
    const operationId = newOperation === NONE ? null : newOperation;
    const key = manualRowKey(start, end, responsibleId, operationId);
    if (allRows.some((r) => r.key === key)) return; // a linha já está na tela
    setPendingRows((prev) => [
      {
        key,
        periodStart: start,
        periodEnd: end,
        responsibleId,
        operationId,
        spread: newSpread,
        bySeries: new Map(),
      },
      ...prev,
    ]);
  };

  /** Grava uma célula. Sem `id` é UPSERT pela chave natural — é o que faz
   *  reenviar o mês atualizar em vez de duplicar. */
  const setCell = (row: ManualGridRow, seriesId: string, raw: string) => {
    const existing = row.bySeries.get(seriesId);
    const trimmed = raw.trim();
    const key = `${row.key}:${seriesId}`;

    if (trimmed === "") {
      if (!existing) return;
      const before = rows;
      setRows((prev) => prev.filter((e) => e.id !== existing.id));
      save({
        key,
        context: "Não foi possível apagar o valor",
        action: () => deleteManualEntry(existing.id, { revalidate: false }),
        revert: () => setRows(before),
      });
      return;
    }

    const value = Number(trimmed.replace(",", "."));
    if (!Number.isFinite(value)) return;

    const before = rows;
    const optimisticId = existing?.id ?? `tmp:${key}`;
    setRows((prev) => {
      const rest = prev.filter((e) => e.id !== optimisticId);
      return [
        ...rest,
        {
          id: optimisticId,
          series_id: seriesId,
          period_start: row.periodStart,
          period_end: row.periodEnd,
          value,
          responsible_id: row.responsibleId,
          operation_id: row.operationId,
          spread: row.spread,
          note: existing?.note ?? null,
        },
      ];
    });
    save({
      key,
      context: "Não foi possível salvar o valor",
      action: () =>
        saveManualEntry(
          {
            id: existing?.id.startsWith("tmp:") ? undefined : existing?.id,
            seriesId,
            periodStart: row.periodStart,
            periodEnd: row.periodEnd,
            value,
            responsibleId: row.responsibleId,
            operationId: row.operationId,
            spread: row.spread,
          },
          { revalidate: false }
        ),
      revert: () => setRows(before),
    });
  };

  /** O modo é da LINHA: mudar reescreve todos os lançamentos dela. */
  const setRowSpread = (row: ManualGridRow, spread: ManualSpread) => {
    setPendingRows((prev) =>
      prev.map((r) => (r.key === row.key ? { ...r, spread } : r))
    );
    const cells = [...row.bySeries.values()];
    if (cells.length === 0) return;
    const before = rows;
    setRows((prev) =>
      prev.map((e) => (cells.some((c) => c.id === e.id) ? { ...e, spread } : e))
    );
    save({
      key: `${row.key}:spread`,
      context: "Não foi possível mudar como o período conta",
      action: async () => {
        for (const cell of cells) {
          const res = await saveManualEntry(
            {
              id: cell.id,
              seriesId: cell.series_id,
              periodStart: row.periodStart,
              periodEnd: row.periodEnd,
              value: cell.value,
              responsibleId: row.responsibleId,
              operationId: row.operationId,
              spread,
            },
            { revalidate: false }
          );
          if (!res.ok) return res;
        }
        return { ok: true };
      },
      revert: () => setRows(before),
    });
  };

  const removeRow = (row: ManualGridRow) => {
    setPendingRows((prev) => prev.filter((r) => r.key !== row.key));
    const cells = [...row.bySeries.values()];
    if (cells.length === 0) return;
    const before = rows;
    setRows((prev) => prev.filter((e) => !cells.some((c) => c.id === e.id)));
    save({
      key: `${row.key}:del`,
      context: "Não foi possível excluir a linha",
      action: async () => {
        for (const cell of cells) {
          const res = await deleteManualEntry(cell.id, { revalidate: false });
          if (!res.ok) return res;
        }
        return { ok: true };
      },
      revert: () => setRows(before),
    });
  };

  const addSeries = () => {
    const label = newSeriesLabel.trim();
    if (label.length < 2) return;
    setNewSeriesLabel("");
    save({
      key: `series:new:${label}`,
      context: "Não foi possível criar o dado",
      action: () => saveManualSeries({ label }, { revalidate: false }),
    });
  };

  const nameOf = (list: ManualBaseOption[], id: string | null) =>
    id ? (list.find((o) => o.id === id)?.name ?? "—") : "—";

  const cellValue = (row: ManualGridRow, seriesId: string): string => {
    const e = row.bySeries.get(seriesId);
    return e ? String(e.value) : "";
  };

  return (
    <div className="flex flex-col gap-4">
      {!compact && series.length > 0 ? (
        <section className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-medium">Dados</h3>
            <HelpHint ariaLabel="O que é um dado da Base manual">
              Cada dado vira um operando das fórmulas do dashboard, com o nome
              que você der aqui. O nome pode ser editado depois; a referência
              interna (<code>manual:…</code>), não — é ela que as fórmulas
              gravadas citam, e mudá-la as quebraria em silêncio.
            </HelpHint>
          </div>
          <ul className="flex flex-wrap gap-2">
            {series.map((s) => (
              <li
                key={s.id}
                className="bg-muted/50 flex items-center gap-2 rounded-md border px-2 py-1 text-xs"
              >
                <span>{s.label}</span>
                <code className="text-muted-foreground">manual:{s.key}</code>
                {canEdit ? (
                  <button
                    type="button"
                    className="text-muted-foreground hover:text-destructive"
                    aria-label={`Excluir ${s.label}`}
                    onClick={() => setConfirmSeries(s)}
                  >
                    ×
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {!compact && canEdit ? (
        <section className="flex flex-wrap items-end gap-2">
          <div className="flex flex-col gap-1">
            <Label className="text-xs" htmlFor="mb-new-series">
              Novo dado
            </Label>
            <Input
              id="mb-new-series"
              className="h-9 w-64"
              placeholder="# Emails replied"
              value={newSeriesLabel}
              onChange={(ev) => setNewSeriesLabel(ev.target.value)}
              onKeyDown={(ev) => {
                if (ev.key === "Enter") {
                  ev.preventDefault();
                  addSeries();
                }
              }}
            />
          </div>
          <Button type="button" variant="secondary" onClick={addSeries}>
            Adicionar dado
          </Button>
        </section>
      ) : null}

      {assistant}

      {series.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          Nenhum dado cadastrado ainda. Crie um dado (por exemplo “Mensagens”) e
          depois lance os números por período.
        </p>
      ) : (
        <>
          {canEdit ? (
            <section className="flex flex-wrap items-end gap-2 border-t pt-3">
              <div className="flex flex-col gap-1">
                <Label className="text-xs" htmlFor="mb-month">
                  Mês
                </Label>
                <Input
                  id="mb-month"
                  type="month"
                  className="h-9 w-40"
                  value={newMonth}
                  onChange={(ev) => setNewMonth(ev.target.value)}
                />
              </div>
              <div className="flex flex-col gap-1">
                <Label className="text-xs">Operação</Label>
                <Select value={newOperation} onValueChange={setNewOperation}>
                  <SelectTrigger className="h-9 w-44">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>Sem operação</SelectItem>
                    {operations.map((o) => (
                      <SelectItem key={o.id} value={o.id}>
                        {o.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-1">
                <Label className="text-xs">Responsável</Label>
                <Select value={newResponsible} onValueChange={setNewResponsible}>
                  <SelectTrigger className="h-9 w-44">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>Sem responsável</SelectItem>
                    {responsibles.map((o) => (
                      <SelectItem key={o.id} value={o.id}>
                        {o.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-1">
                <div className="flex items-center gap-1">
                  <Label className="text-xs">Como contar no período</Label>
                  <HelpHint ariaLabel="Como o lançamento conta no período">
                    {MANUAL_SPREAD_HINTS[newSpread]}
                  </HelpHint>
                </div>
                <Select
                  value={newSpread}
                  onValueChange={(v) => setNewSpread(v as ManualSpread)}
                >
                  <SelectTrigger className="h-9 w-64">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {MANUAL_SPREADS.map((s) => (
                      <SelectItem key={s} value={s}>
                        {MANUAL_SPREAD_LABELS[s]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button type="button" onClick={addRow}>
                Nova linha
              </Button>
            </section>
          ) : null}

          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Período</TableHead>
                  <TableHead>Operação</TableHead>
                  <TableHead>Responsável</TableHead>
                  <TableHead>Como conta</TableHead>
                  {columns.map((s) => (
                    <TableHead key={s.id} className="text-right">
                      {s.label}
                    </TableHead>
                  ))}
                  {canEdit ? <TableHead /> : null}
                </TableRow>
              </TableHeader>
              <TableBody>
                {allRows.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={4 + columns.length + (canEdit ? 1 : 0)}
                      className="text-muted-foreground"
                    >
                      Nenhum lançamento ainda.
                    </TableCell>
                  </TableRow>
                ) : null}
                {allRows.map((row) => (
                  <TableRow key={row.key}>
                    <TableCell className="whitespace-nowrap">
                      {manualPeriodLabel(row.periodStart, row.periodEnd)}
                    </TableCell>
                    <TableCell>{nameOf(operations, row.operationId)}</TableCell>
                    <TableCell>{nameOf(responsibles, row.responsibleId)}</TableCell>
                    <TableCell>
                      {canEdit ? (
                        <Select
                          value={row.spread}
                          onValueChange={(v) => setRowSpread(row, v as ManualSpread)}
                        >
                          <SelectTrigger className="h-8 w-56 text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {MANUAL_SPREADS.map((s) => (
                              <SelectItem key={s} value={s}>
                                {MANUAL_SPREAD_LABELS[s]}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : (
                        <span className="text-muted-foreground text-xs">
                          {MANUAL_SPREAD_LABELS[row.spread]}
                        </span>
                      )}
                    </TableCell>
                    {columns.map((s) => (
                      <TableCell key={s.id} className="text-right">
                        {canEdit ? (
                          <Input
                            type="number"
                            step="any"
                            inputMode="decimal"
                            className="h-8 w-28 text-right"
                            defaultValue={cellValue(row, s.id)}
                            aria-label={`${s.label} — ${manualPeriodLabel(row.periodStart, row.periodEnd)}`}
                            onBlur={(ev) => {
                              if (ev.target.value === cellValue(row, s.id)) return;
                              setCell(row, s.id, ev.target.value);
                            }}
                            onKeyDown={(ev) => {
                              if (ev.key === "Enter") ev.currentTarget.blur();
                            }}
                          />
                        ) : (
                          <span>{cellValue(row, s.id) || "—"}</span>
                        )}
                      </TableCell>
                    ))}
                    {canEdit ? (
                      <TableCell>
                        <button
                          type="button"
                          className="text-muted-foreground hover:text-destructive text-xs"
                          aria-label="Excluir linha"
                          onClick={() => setConfirmRow(row)}
                        >
                          Excluir
                        </button>
                      </TableCell>
                    ) : null}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </>
      )}

      <ConfirmDialog
        open={confirmSeries != null}
        onOpenChange={(v) => {
          if (!v) setConfirmSeries(null);
        }}
        title={`Excluir “${confirmSeries?.label ?? ""}”?`}
        description="Os lançamentos deste dado somem junto, e as fórmulas que o citam passam a exibir “—”. Excluir um dado é ação de administrador."
        actionLabel="Excluir"
        destructive
        onConfirm={() => {
          const s = confirmSeries;
          setConfirmSeries(null);
          if (!s) return;
          save({
            key: `series:del:${s.id}`,
            context: "Não foi possível excluir o dado",
            action: () => deleteManualSeries(s.id, { revalidate: false }),
          });
        }}
      />
      <ConfirmDialog
        open={confirmRow != null}
        onOpenChange={(v) => {
          if (!v) setConfirmRow(null);
        }}
        title="Excluir esta linha?"
        description="Os valores deste período saem da Base manual."
        actionLabel="Excluir"
        destructive
        onConfirm={() => {
          const r = confirmRow;
          setConfirmRow(null);
          if (r) removeRow(r);
        }}
      />
    </div>
  );
}
