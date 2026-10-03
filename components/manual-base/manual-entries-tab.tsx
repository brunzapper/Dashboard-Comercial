// Versão: 1.0 | Data: 03/10/2026
// v1.0 (03/10/2026): a aba LANÇAMENTOS da Base manual (tela v2).
//
// O que mudou em relação à grade única da v1:
//   * um NAVEGADOR DE MÊS manda na tela — a grade mostra o mês em foco (ou
//     todos), e a linha nova nasce nele. Antes o mês do formulário de "Nova
//     linha" também decidia, em silêncio, a "Conferência" do pé da página;
//   * a conferência virou AVISO contextual (`conferenceIssues`): só aparece com
//     algo a corrigir no mês em foco — nunca "Total: 0 / Canal: 0 ✔";
//   * colunas Responsável/Operação só existem quando há atribuição solta
//     (`attributionColumns`); o recorte da linha vira chips na coluna
//     "Recorte";
//   * "Como contar no período" saiu da linha (select largo em toda linha) para
//     o menu ⋯ dela, com um selo quando difere do padrão das métricas;
//   * "Adicionar linha" pergunta só o recorte (as divisões das métricas em
//     tela) — o mês é o do navegador.
"use client";

import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, MoreHorizontal, Plus, TriangleAlert } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { HelpHint } from "@/components/ui/help-hint";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
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
import { conferenceIssues, manualConference } from "@/lib/manual-base/conference";
import {
  EMPTY_MANUAL_COORDS,
  coordDeclares,
  coordMember,
  familyLabelOfKey,
  isBuiltinManualFamily,
  manualMembersOf,
  manualResidualLabel,
  type ManualCoords,
} from "@/lib/manual-base/families";
import {
  DEFAULT_MANUAL_SPREAD,
  MANUAL_SPREADS,
  MANUAL_SPREAD_HINTS,
  MANUAL_SPREAD_LABELS,
  type ManualSeries,
  type ManualSpread,
} from "@/lib/manual-base/types";
import { MANUAL_TERMS } from "@/lib/manual-base/vocabulary";

import {
  attributionColumns,
  buildManualGrid,
  isYearMonth,
  manualPeriodLabel,
  manualRowKey,
  monthEnd,
  rowsForMonth,
  shiftMonth,
  type ManualGridRow,
} from "./rows";
import { isTempId, type ManualBaseStore } from "./use-manual-base-store";

export interface ManualBaseOption {
  id: string;
  name: string;
}

const NONE = "__none__";
/** O RESIDUAL nos seletores. Distinto de NONE: "Sem Canal" é um GRUPO, e
 *  "Total (não dividir)" é não endereçar a divisão. */
const RESIDUAL = "__residual__";

/** Mês de Brasília — o read side inteiro é prefix-based (invariante 11). */
export function currentMonthBR(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(new Date());
  const y = parts.find((p) => p.type === "year")?.value ?? "2026";
  const m = parts.find((p) => p.type === "month")?.value ?? "01";
  return `${y}-${m}`;
}

const monthLabel = (ym: string) => manualPeriodLabel(`${ym}-01`, monthEnd(ym));

export function ManualEntriesTab({
  store,
  columns,
  responsibles,
  operations,
  canEdit,
  initialMonth,
  initialSpread,
  assistant,
  onManageMetrics,
}: {
  store: ManualBaseStore;
  columns: ManualSeries[];
  responsibles: ManualBaseOption[];
  operations: ManualBaseOption[];
  canEdit: boolean;
  initialMonth?: string;
  initialSpread?: ManualSpread;
  assistant?: React.ReactNode;
  /** Leva à gestão de métricas (aba, ou a página cheia no widget). */
  onManageMetrics?: () => void;
}) {
  const { state } = store;
  const [month, setMonth] = useState<string>(() =>
    isYearMonth(initialMonth) ? initialMonth : currentMonthBR()
  );
  const [allMonths, setAllMonths] = useState(false);
  const [pendingRows, setPendingRows] = useState<ManualGridRow[]>([]);
  const [focusRowKey, setFocusRowKey] = useState<string | null>(null);
  const [newCoords, setNewCoords] = useState<ManualCoords>(EMPTY_MANUAL_COORDS);
  const [addOpen, setAddOpen] = useState(false);
  const [confirmRow, setConfirmRow] = useState<ManualGridRow | null>(null);

  // As divisões das COLUNAS em tela: a linha da grade é uma coordenada só,
  // compartilhada por todas as métricas, então vale a UNIÃO das declaradas.
  const rowFamilyKeys = useMemo(() => {
    const out: string[] = [];
    for (const col of columns) {
      for (const key of state.declarations[col.id] ?? []) {
        if (!out.includes(key)) out.push(key);
      }
    }
    return out;
  }, [columns, state.declarations]);

  const grid = useMemo(() => {
    const colIds = new Set(columns.map((c) => c.id));
    return buildManualGrid(state.entries.filter((e) => colIds.has(e.series_id)));
  }, [state.entries, columns]);

  const gridKeys = new Set(grid.map((r) => r.key));
  const allRows = [...pendingRows.filter((r) => !gridKeys.has(r.key)), ...grid];
  const visibleRows = rowsForMonth(allRows, allMonths ? null : month);
  const attribution = attributionColumns(visibleRows);
  const showRecorte =
    rowFamilyKeys.length > 0 || visibleRows.some((r) => Object.keys(r.coords).length > 0);

  // O modo esperado de uma linha nova: o padrão do widget, senão o padrão
  // comum das métricas em tela, senão o do sistema.
  const sharedDefault = (() => {
    const set = new Set(columns.map((c) => c.default_spread));
    return set.size === 1 ? [...set][0] : DEFAULT_MANUAL_SPREAD;
  })();
  const newSpread = initialSpread ?? sharedDefault;

  const issues = useMemo(() => {
    if (allMonths) return [];
    const window = { from: `${month}-01`, to: monthEnd(month) };
    return columns.flatMap((col) =>
      conferenceIssues(
        manualConference(
          {
            series: state.series,
            entries: state.entries,
            families: state.families,
            members: state.members,
          },
          { seriesId: col.id, window }
        )
      ).map((issue) => ({ series: col, issue }))
    );
  }, [allMonths, month, columns, state]);

  const nameOf = (list: ManualBaseOption[], id: string | null) =>
    id ? (list.find((o) => o.id === id)?.name ?? "—") : "—";

  const memberText = (familyKey: string, member: string | null): string => {
    const famLabel = familyLabelOfKey(familyKey, state.families);
    if (member == null) return manualResidualLabel(famLabel);
    if (isBuiltinManualFamily(familyKey)) {
      return nameOf(familyKey === "responsavel" ? responsibles : operations, member);
    }
    return (
      manualMembersOf(familyKey, state.families, state.members).find((m) => m.key === member)
        ?.label ?? member
    );
  };

  const optionsOf = (familyKey: string): ManualBaseOption[] =>
    isBuiltinManualFamily(familyKey)
      ? familyKey === "responsavel"
        ? responsibles
        : operations
      : manualMembersOf(familyKey, state.families, state.members).map((m) => ({
          id: m.key,
          name: m.label,
        }));

  const addRow = (coords: ManualCoords) => {
    const ym = month;
    const start = `${ym}-01`;
    const end = monthEnd(ym);
    const key = manualRowKey(start, end, null, null, coords);
    setAllMonths(false);
    setFocusRowKey(key);
    setAddOpen(false);
    setNewCoords(EMPTY_MANUAL_COORDS);
    if (allRows.some((r) => r.key === key)) return; // a linha já está na tela
    setPendingRows((prev) => [
      {
        key,
        periodStart: start,
        periodEnd: end,
        // As divisões embutidas espelham nas colunas FK no save
        // (applyBuiltinCoords); o otimista só precisa da coordenada.
        responsibleId: coordDeclares(coords, "responsavel")
          ? coordMember(coords, "responsavel")
          : null,
        operationId: coordDeclares(coords, "operacao") ? coordMember(coords, "operacao") : null,
        coords,
        spread: newSpread,
        bySeries: new Map(),
      },
      ...prev,
    ]);
  };

  const rowSpreadBadge = (row: ManualGridRow): string | null => {
    const defaults = new Set(
      [...row.bySeries.keys()]
        .map((id) => columns.find((c) => c.id === id)?.default_spread)
        .filter(Boolean)
    );
    const expected = defaults.size === 1 ? [...defaults][0] : sharedDefault;
    return row.spread === expected ? null : MANUAL_SPREAD_LABELS[row.spread];
  };

  // A coordenada da linha vale para TODAS as colunas, mas só faz sentido numa
  // métrica que se divide por cada divisão dela: "Canal: Ligação" numa métrica
  // não dividida por Canal criaria um lançamento num nível que ela não tem.
  const cellAccepts = (row: ManualGridRow, seriesId: string): boolean => {
    const declared = state.declarations[seriesId] ?? [];
    return Object.keys(row.coords).every((k) => declared.includes(k));
  };

  const cellValue = (row: ManualGridRow, seriesId: string): string => {
    const e = row.bySeries.get(seriesId);
    return e ? String(e.value) : "";
  };

  if (columns.length === 0) {
    return (
      <div className="flex flex-col items-start gap-2 rounded-md border border-dashed p-4">
        <p className="text-sm font-medium">Nenhuma {MANUAL_TERMS.metric.toLowerCase()} ainda.</p>
        <p className="text-muted-foreground text-sm">
          Uma métrica manual é um número que você digita em vez de cadastrar
          registro por registro — ligações feitas, investimento, contas alcançadas.
          Crie a primeira e depois lance os valores mês a mês.
        </p>
        {onManageMetrics && canEdit ? (
          <Button type="button" size="sm" onClick={onManageMetrics}>
            Criar métrica
          </Button>
        ) : null}
      </div>
    );
  }

  const colCount =
    1 +
    (showRecorte ? 1 : 0) +
    (attribution.operation ? 1 : 0) +
    (attribution.responsible ? 1 : 0) +
    columns.length +
    (canEdit ? 1 : 0);

  return (
    <div className="flex flex-col gap-3">
      {assistant}

      {/* Navegador de mês: o mês em foco manda na grade, nos avisos e na
          linha nova — a relação fica à vista. */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Mês anterior"
            onClick={() => {
              setAllMonths(false);
              setMonth((m) => shiftMonth(m, -1));
            }}
          >
            <ChevronLeft className="size-4" />
          </Button>
          <Input
            type="month"
            aria-label="Mês em foco"
            className="h-9 w-40"
            value={month}
            onChange={(ev) => {
              if (!isYearMonth(ev.target.value)) return;
              setAllMonths(false);
              setMonth(ev.target.value);
            }}
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Próximo mês"
            onClick={() => {
              setAllMonths(false);
              setMonth((m) => shiftMonth(m, 1));
            }}
          >
            <ChevronRight className="size-4" />
          </Button>
        </div>
        <Button
          type="button"
          variant={allMonths ? "secondary" : "outline"}
          size="sm"
          aria-pressed={allMonths}
          onClick={() => setAllMonths((v) => !v)}
        >
          Todos os meses
        </Button>

        {canEdit ? (
          rowFamilyKeys.length === 0 ? (
            <Button
              type="button"
              size="sm"
              className="ml-auto"
              onClick={() => addRow(EMPTY_MANUAL_COORDS)}
            >
              <Plus className="size-4" /> Lançar {monthLabel(month)}
            </Button>
          ) : (
            <Popover open={addOpen} onOpenChange={setAddOpen}>
              <PopoverTrigger asChild>
                <Button type="button" size="sm" className="ml-auto">
                  <Plus className="size-4" /> Lançar {monthLabel(month)}
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="flex w-80 flex-col gap-3">
                <div className="flex items-center gap-1">
                  <p className="text-sm font-medium">Qual recorte você vai lançar?</p>
                  <HelpHint ariaLabel="O que é o recorte de uma linha">
                    Deixe “Total” para lançar o número inteiro do mês. Escolha uma
                    opção para lançar só a parte dela (ex.: só as Ligações). O total
                    e as partes são leituras do MESMO número: eles nunca se somam.
                  </HelpHint>
                </div>
                {rowFamilyKeys.map((key) => {
                  const famLabel = familyLabelOfKey(key, state.families);
                  const current = coordDeclares(newCoords, key)
                    ? (coordMember(newCoords, key) ?? RESIDUAL)
                    : NONE;
                  return (
                    <div key={key} className="flex flex-col gap-1">
                      <Label className="text-xs">{famLabel}</Label>
                      <Select
                        value={current}
                        onValueChange={(v) =>
                          setNewCoords((prev) => {
                            const next = { ...prev };
                            if (v === NONE) delete next[key];
                            else next[key] = v === RESIDUAL ? null : v;
                            return next;
                          })
                        }
                      >
                        <SelectTrigger className="h-9" aria-label={famLabel}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={NONE}>Total (não dividir)</SelectItem>
                          {optionsOf(key).map((o) => (
                            <SelectItem key={o.id} value={o.id}>
                              {o.name}
                            </SelectItem>
                          ))}
                          <SelectItem value={RESIDUAL}>{manualResidualLabel(famLabel)}</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  );
                })}
                <Button type="button" size="sm" onClick={() => addRow(newCoords)}>
                  Adicionar linha
                </Button>
              </PopoverContent>
            </Popover>
          )
        ) : null}
      </div>

      {issues.length > 0 ? (
        <div
          role="status"
          className="flex flex-col gap-1 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm"
        >
          <div className="flex items-center gap-2 font-medium">
            <TriangleAlert className="size-4 text-amber-600" />
            Confira {monthLabel(month)}
            <HelpHint ariaLabel="Por que este aviso aparece">
              O total e as divisões são leituras do MESMO número — eles nunca se
              somam. Quando uma divisão não fecha com o total, os gráficos
              mostram exatamente o que foi lançado (o sistema não inventa o
              resto). Este aviso some quando os números batem.
            </HelpHint>
          </div>
          <ul className="flex flex-col gap-0.5">
            {issues.map(({ series, issue }, i) => (
              <li key={`${series.id}:${i}`}>
                <strong>{series.label}:</strong> {issue.text}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="overflow-x-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Período</TableHead>
              {showRecorte ? <TableHead>Recorte</TableHead> : null}
              {attribution.operation ? <TableHead>Operação</TableHead> : null}
              {attribution.responsible ? <TableHead>Responsável</TableHead> : null}
              {columns.map((s) => (
                <TableHead key={s.id} className="text-right">
                  {s.label}
                </TableHead>
              ))}
              {canEdit ? <TableHead className="w-10" /> : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {visibleRows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={colCount} className="text-muted-foreground py-6 text-center">
                  {allMonths
                    ? "Nenhum lançamento ainda."
                    : `Nada lançado em ${monthLabel(month)}.`}
                  {canEdit ? " Use “Lançar” acima para começar." : ""}
                </TableCell>
              </TableRow>
            ) : null}
            {visibleRows.map((row) => {
              const badge = rowSpreadBadge(row);
              const declared = Object.keys(row.coords);
              return (
                <TableRow key={row.key}>
                  <TableCell className="whitespace-nowrap">
                    <div className="flex flex-col gap-0.5">
                      <span>{manualPeriodLabel(row.periodStart, row.periodEnd)}</span>
                      {badge ? (
                        <span className="text-muted-foreground text-xs">{badge}</span>
                      ) : null}
                    </div>
                  </TableCell>
                  {showRecorte ? (
                    <TableCell>
                      {declared.length === 0 ? (
                        <Badge variant="secondary">{MANUAL_TERMS.total}</Badge>
                      ) : (
                        <span className="flex flex-wrap gap-1">
                          {declared.map((k) => (
                            <Badge key={k} variant="outline">
                              {familyLabelOfKey(k, state.families)}:{" "}
                              {memberText(k, coordMember(row.coords, k))}
                            </Badge>
                          ))}
                        </span>
                      )}
                    </TableCell>
                  ) : null}
                  {attribution.operation ? (
                    <TableCell>{nameOf(operations, row.operationId)}</TableCell>
                  ) : null}
                  {attribution.responsible ? (
                    <TableCell>{nameOf(responsibles, row.responsibleId)}</TableCell>
                  ) : null}
                  {columns.map((s, colIdx) => (
                    <TableCell key={s.id} className="text-right">
                      {!cellAccepts(row, s.id) && !row.bySeries.has(s.id) ? (
                        <span
                          className="text-muted-foreground/60"
                          title={`${s.label} não é dividida por este recorte`}
                        >
                          —
                        </span>
                      ) : canEdit && !isTempId(s.id) ? (
                        <Input
                          // A chave carrega o valor: um eco do servidor (outra
                          // aba, a IA) re-semeia o input não-controlado.
                          key={`${row.key}:${s.id}:${cellValue(row, s.id)}`}
                          type="number"
                          step="any"
                          inputMode="decimal"
                          className="ml-auto h-8 w-28 text-right"
                          defaultValue={cellValue(row, s.id)}
                          autoFocus={focusRowKey === row.key && colIdx === 0}
                          aria-label={`${s.label} — ${manualPeriodLabel(row.periodStart, row.periodEnd)}`}
                          onBlur={(ev) => {
                            if (ev.target.value === cellValue(row, s.id)) return;
                            store.setCell(row, s.id, ev.target.value);
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
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            aria-label="Ações da linha"
                          >
                            <MoreHorizontal className="size-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-72">
                          <DropdownMenuLabel>Como contar no período</DropdownMenuLabel>
                          {MANUAL_SPREADS.map((sp) => (
                            <DropdownMenuCheckboxItem
                              key={sp}
                              checked={row.spread === sp}
                              disabled={row.bySeries.size === 0}
                              onCheckedChange={() => {
                                if (row.spread === sp) return;
                                setPendingRows((prev) =>
                                  prev.map((r) => (r.key === row.key ? { ...r, spread: sp } : r))
                                );
                                store.setRowSpread(row, sp);
                              }}
                            >
                              <div className="flex flex-col">
                                <span>{MANUAL_SPREAD_LABELS[sp]}</span>
                                <span className="text-muted-foreground text-xs">
                                  {MANUAL_SPREAD_HINTS[sp]}
                                </span>
                              </div>
                            </DropdownMenuCheckboxItem>
                          ))}
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            variant="destructive"
                            onSelect={() => setConfirmRow(row)}
                          >
                            Excluir linha
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  ) : null}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      <ConfirmDialog
        open={confirmRow != null}
        onOpenChange={(v) => {
          if (!v) setConfirmRow(null);
        }}
        title="Excluir esta linha?"
        description="Os valores desta linha saem da Base manual, e os gráficos que os usam recalculam."
        actionLabel="Excluir"
        destructive
        onConfirm={() => {
          const r = confirmRow;
          setConfirmRow(null);
          if (!r) return;
          setPendingRows((prev) => prev.filter((p) => p.key !== r.key));
          store.removeRow(r);
        }}
      />
    </div>
  );
}
