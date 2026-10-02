// Versão: 1.2 | Data: 02/10/2026
// v1.2 (02/10/2026): nada fixo pelo preset Metas 4T26.
//   * INDICADOR: linhas do cartão configuráveis (meta, realizado, projetado,
//     atingimento, composição dos filhos — rótulo, ordem, ocultar; o "Real"
//     virou "Realizado" editável), etiqueta livre no lugar do N0–N3, projetado
//     a partir das metas OU dos realizados dos filhos, recortes expostos como
//     etiquetas e quebra do realizado (aberta ou recolhida). O EDITOR explica
//     de onde vem cada número: meta (as metas mensais do indicador — editáveis
//     ali mesmo), realizado (fórmula do catálogo ou métrica própria — o MESMO
//     editor do catálogo de Indicadores) e projetado (os filhos).
//   * PLANO → MULTI-FATORES: fatores livres (título opcional + descrição),
//     adicionar/remover/reordenar; o 5W2H é só um atalho.
//   * RITUAL: vários dias da semana, dia do mês 1–31 e "manter N abertas".
//   * MODO APRESENTAR: "Agendar próxima" e avisos de configuração somem por
//     padrão (lib/tree/display.ts — o widget e o cartão decidem).
//   * `full` (o cartão em destaque, duplo-clique) mostra tudo, sem recorte.
// Versão: 1.1 | Data: 02/10/2026
// v1.1 (02/10/2026): tamanhos de fonte fixos (10px/11px em classe) trocados
//   pela escala nomeada text-2xs/text-micro (globals.css); guarda em
//   tests/no-arbitrary-font-size.test.ts.
// Versão: 1.0 | Data: 01/10/2026
// Nós OPERACIONAIS da Tree (0149): o corpo do cartão (Lista e Root) e o editor
// de cada um. Os dados chegam por CONTEXTO (`TreeOpsProvider`, do widget): o
// corpo é o mesmo nas duas visualizações e nenhuma delas precisa saber de
// indicador.
"use client";

import { createContext, useContext, useMemo, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  CalendarPlus,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Loader2,
  Plus,
  Trash2,
  TriangleAlert,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { todayBrasiliaIso } from "@/lib/date/today";
import {
  CHILDREN_OP_LABELS,
  combineChildren,
  formatAttainment,
  formatIndicatorValue,
  INDICATOR_STATUS_LABELS,
  monthLabel,
  type ChildrenOp,
} from "@/lib/indicators/model";
import { exposedFilters } from "@/lib/indicators/realized-source";
import { progressOf } from "@/lib/tree/path";
import {
  indicatorRows,
  INDICATOR_ROW_DEFAULT_TEXT,
  INDICATOR_ROW_LABELS,
  MAX_PLAN_FACTORS,
  nodeSeriesKey,
  PLAN_FIELDS,
  parseIndicatorPayload,
  parsePlanPayload,
  parseRitualPayload,
  seriesKey,
  type IndicatorNodePayload,
  type IndicatorRow,
  type OperationalKind,
  type PlanFactor,
  type PlanNodePayload,
  type RitualNodePayload,
} from "@/lib/tree/payload";
import {
  describeSchedule,
  nextOpenOccurrence,
  RITUAL_CADENCE_LABELS,
  WEEKDAY_LABELS,
  weekdaysOf,
  type RitualCadence,
} from "@/lib/rituals/cadence";
import { TREE_NODE_KIND_LABELS, type TreeNode } from "@/lib/tree/model";
import {
  TREE_TONE_LABELS,
  TREE_TONES,
  treeChrome,
  type TreeNodeDisplay,
  type TreePresentationSettings,
  type TreeTone,
} from "@/lib/tree/display";
import type { TreeIndicatorSeries } from "@/app/(app)/dashboards/goal-table-actions";
import {
  RealizedSourceEditor,
  type RealizedCatalog,
} from "@/components/indicators/realized-source-editor";
import { statusToneClass, STATUS_TONE } from "@/components/indicators/status-tone";

export interface TreeOpsValue {
  months: string[];
  series: Map<string, TreeIndicatorSeries>;
  loading: boolean;
  ritualOccurrences: Record<string, { n: number; taskId: string; done: boolean }[]>;
  scheduling: ReadonlySet<string>;
  onScheduleRitual: (node: TreeNode) => void;
  /** v1.2: apresentando? (o cartão esconde a mesa de trabalho). */
  presenting?: boolean;
  /** v1.2: o que o widget deixa aparecer ao apresentar. */
  presentation?: TreePresentationSettings;
  /** v1.2: escolhas de exibição do cartão (tree_nodes.display). */
  displayOf?: (node: TreeNode) => TreeNodeDisplay | null;
  /** v1.2: rótulo de um campo (recortes e quebra). */
  fieldLabelOf?: (ref: string) => string;
  /** v1.2: board com estilo (tons de status pelos tokens). */
  styled?: boolean;
}

const TreeOpsContext = createContext<TreeOpsValue | null>(null);

export const TreeOpsProvider = TreeOpsContext.Provider;

export function useTreeOps(): TreeOpsValue | null {
  return useContext(TreeOpsContext);
}

export function isOperationalNode(node: TreeNode): boolean {
  return node.kind === "indicator" || node.kind === "plan" || node.kind === "ritual";
}

/**
 * Tamanho AUTOMÁTICO do cartão na Root (o redimensionado vence — 0150).
 * v1.2: o indicador cresce com o número de meses e de linhas visíveis.
 */
export function operationalSize(
  node: TreeNode,
  monthsCount = 3
): { w: number; h: number } | null {
  switch (node.kind) {
    case "indicator": {
      const p = parseIndicatorPayload(node.payload);
      const rows = p ? indicatorRows(p).filter((r) => !r.hidden).length : 3;
      return { w: Math.max(300, 96 + monthsCount * 68), h: Math.max(156, 80 + rows * 20) };
    }
    case "plan":
      return { w: 320, h: 200 };
    case "ritual":
      return { w: 264, h: 136 };
    default:
      return null;
  }
}

function useChrome(node: TreeNode) {
  const ops = useTreeOps();
  return treeChrome(ops?.presentation, ops?.displayOf?.(node) ?? null, ops?.presenting ?? false);
}

// --------------------------------------------------------------- corpo

export function OperationalBody({ node, full = false }: { node: TreeNode; full?: boolean }) {
  switch (node.kind) {
    case "indicator":
      return <IndicatorBody node={node} full={full} />;
    case "plan":
      return <PlanBody node={node} full={full} />;
    case "ritual":
      return <RitualBody node={node} full={full} />;
    default:
      return null;
  }
}

function MissingConfig({ text }: { text: string }) {
  return (
    <p className="text-muted-foreground flex items-center gap-1 text-micro">
      <TriangleAlert className="size-3" /> {text}
    </p>
  );
}

/** A série de um nó de indicador (pedida POR NÓ — v1.2). */
function nodeSeries(ops: TreeOpsValue | null, node: TreeNode) {
  return ops?.series.get(nodeSeriesKey(node.id));
}

function filterChipText(
  f: { field: string; op: string; value?: unknown },
  labelOf: (ref: string) => string
): string {
  const v = Array.isArray(f.value) ? f.value.join(", ") : String(f.value ?? "");
  const op = f.op === "eq" || f.op === "in" ? ":" : f.op === "neq" ? " ≠" : ` ${f.op}`;
  return `${labelOf(f.field)}${op} ${v}`.trim();
}

function IndicatorBody({ node, full }: { node: TreeNode; full: boolean }) {
  const ops = useTreeOps();
  const chrome = useChrome(node);
  const p = parseIndicatorPayload(node.payload);
  const rd = p?.realized?.breakdown;
  const [openBreakdown, setOpenBreakdown] = useState<boolean | null>(null);
  if (!p) return chrome.warnings ? <MissingConfig text="Escolha o indicador (Editar)." /> : null;
  const s = nodeSeries(ops, node);
  const months = ops?.months ?? [];
  const labelOf = ops?.fieldLabelOf ?? ((r: string) => r);
  const rows = indicatorRows(p).filter((r) => !r.hidden);
  const rowText = (r: IndicatorRow) => r.label ?? INDICATOR_ROW_DEFAULT_TEXT[r.kind];
  const fmt = (v: number | null | undefined) =>
    s ? formatIndicatorValue(v, s.unit, { unit: p.unitInCell !== false }) : "—";
  const chips = exposedFilters(p.realized);

  // Projetado: os filhos INDICADORES combinados pelo operador, mês a mês —
  // a partir das METAS (padrão) ou dos REALIZADOS (v1.2).
  const childSeries = p.childrenOp
    ? node.children.filter((c) => c.kind === "indicator").map((c) => nodeSeries(ops, c))
    : [];
  const projected =
    p.childrenOp && childSeries.length >= 2 && childSeries.every(Boolean)
      ? months.map((_, mi) =>
          combineChildren(
            p.childrenOp!,
            childSeries.map((cs) => ({
              value:
                p.projectFrom === "realizado"
                  ? (cs!.cells[mi]?.realized ?? null)
                  : (cs!.cells[mi]?.target ?? null),
              unit: cs!.unit,
            }))
          )
        )
      : null;
  const breakdownOpen = openBreakdown ?? (full || rd?.display !== "recolhido");
  const tone = (st: Parameters<typeof statusToneClass>[0]) =>
    statusToneClass(st, ops?.styled ?? false);

  const tableRow = (r: IndicatorRow) => {
    if (!s) return null;
    switch (r.kind) {
      case "meta":
        return (
          <tr key="meta" className="font-semibold">
            <td className="text-muted-foreground font-normal">{rowText(r)}</td>
            {s.cells.map((c) => (
              <td key={c.month} className="truncate text-right">
                {fmt(c.target)}
              </td>
            ))}
          </tr>
        );
      case "realizado": {
        if (!s.hasRealized) return null;
        const bd = s.breakdown ?? [];
        return (
          <FragmentRows key="realizado">
            <tr>
              <td className="text-muted-foreground">
                {bd.length > 0 && rd ? (
                  <button
                    type="button"
                    data-no-drag
                    className="hover:text-foreground inline-flex items-center gap-0.5"
                    onClick={() => setOpenBreakdown(!breakdownOpen)}
                    title={`Quebra por ${labelOf(rd.field)}`}
                  >
                    {breakdownOpen ? (
                      <ChevronDown className="size-3" />
                    ) : (
                      <ChevronRight className="size-3" />
                    )}
                    {rowText(r)}
                  </button>
                ) : (
                  rowText(r)
                )}
              </td>
              {s.cells.map((c) => (
                <td key={c.month} className="truncate text-right">
                  {c.elapsed > 0 ? (
                    <span
                      className={cn("rounded px-0.5", tone(c.status))}
                      title={`${INDICATOR_STATUS_LABELS[c.status]} · ${formatAttainment(c.attainment)}`}
                    >
                      {fmt(c.realized)}
                    </span>
                  ) : (
                    "—"
                  )}
                </td>
              ))}
            </tr>
            {breakdownOpen
              ? bd.map((b) => (
                  <tr key={`bd:${b.label}`} className="text-muted-foreground">
                    <td className="truncate pl-2" title={b.label}>
                      {b.label}
                    </td>
                    {b.realized.map((v, mi) => (
                      <td key={mi} className="truncate text-right">
                        {v == null ? "—" : fmt(v)}
                      </td>
                    ))}
                  </tr>
                ))
              : null}
          </FragmentRows>
        );
      }
      case "projetado":
        return projected ? (
          <tr key="projetado" className="text-muted-foreground">
            <td
              title={
                p.projectFrom === "realizado"
                  ? "Combinação dos realizados dos filhos"
                  : "Combinação das metas dos filhos"
              }
            >
              {rowText(r)}
            </td>
            {projected.map((v, mi) => (
              <td key={mi} className="truncate text-right" title={CHILDREN_OP_LABELS[p.childrenOp!]}>
                {fmt(v)}
              </td>
            ))}
          </tr>
        ) : null;
      case "atingimento":
        return s.hasRealized ? (
          <tr key="atingimento">
            <td className="text-muted-foreground">{rowText(r)}</td>
            {s.cells.map((c) => (
              <td key={c.month} className="truncate text-right">
                {c.elapsed > 0 && c.attainment != null ? (
                  <span className={cn("rounded px-0.5", tone(c.status))}>
                    {formatAttainment(c.attainment)}
                  </span>
                ) : (
                  "—"
                )}
              </td>
            ))}
          </tr>
        ) : null;
      default:
        return null;
    }
  };

  const compRow = rows.find((r) => r.kind === "composicao");
  return (
    <div className={cn("flex flex-col gap-1 text-micro", !full && "h-full")}>
      {p.tag || p.responsible || (compRow && p.childrenOp) ? (
        <div className="flex items-center gap-1">
          {p.tag ? (
            <Badge variant="secondary" className="h-4 px-1 text-2xs">
              {p.tag}
            </Badge>
          ) : null}
          {p.responsible ? <span className="text-muted-foreground truncate">{p.responsible}</span> : null}
          {compRow && p.childrenOp ? (
            <span className="text-muted-foreground ml-auto" title={CHILDREN_OP_LABELS[p.childrenOp]}>
              {rowText(compRow)}: {p.childrenOp}
            </span>
          ) : null}
        </div>
      ) : null}
      {chips.length > 0 ? (
        <div className="flex flex-wrap gap-1">
          {chips.map((f, i) => (
            <span key={i} className="bg-muted rounded px-1 text-2xs">
              {filterChipText(f, labelOf)}
            </span>
          ))}
        </div>
      ) : null}
      {p.hint ? <p className={cn("text-muted-foreground", !full && "line-clamp-1")}>{p.hint}</p> : null}
      {!s ? (
        ops?.loading ? (
          <span className="text-muted-foreground flex items-center gap-1">
            <Loader2 className="size-3 animate-spin" /> carregando…
          </span>
        ) : chrome.warnings ? (
          <MissingConfig text="Sem metas para o período." />
        ) : null
      ) : s.responsibleMissing ? (
        chrome.warnings ? <MissingConfig text={`Responsável "${p.responsible}" não encontrado.`} /> : null
      ) : (
        <table className={cn("w-full tabular-nums", !full && "table-fixed")}>
          <thead>
            <tr className="text-muted-foreground">
              <th className="w-12 text-left font-normal" />
              {months.map((m) => (
                <th key={m} className="text-right font-normal">
                  {full ? monthLabel(m, true) : monthLabel(m).slice(0, 3)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>{rows.map((r) => tableRow(r))}</tbody>
        </table>
      )}
    </div>
  );
}

/** Agrupa linhas de tabela sem elemento extra (tr dentro de tbody). */
function FragmentRows({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

function PlanBody({ node, full }: { node: TreeNode; full: boolean }) {
  const ops = useTreeOps();
  const chrome = useChrome(node);
  const p = parsePlanPayload(node.payload) ?? { factors: [] };
  const progress = progressOf(node);
  const lastElapsed = (key: string) => {
    const s = ops?.series.get(seriesKey(key, null));
    if (!s) return null;
    const cells = s.cells.filter((c) => c.elapsed > 0);
    return { s, cell: cells[cells.length - 1] ?? null };
  };
  return (
    <div className={cn("flex flex-col gap-1 text-micro", !full && "h-full overflow-hidden")}>
      {p.responsible ? (
        <span className="text-muted-foreground">Responsável: {p.responsible}</span>
      ) : null}
      {p.factors.length === 0 ? (
        chrome.warnings ? <MissingConfig text="Adicione os fatores (Editar)." /> : null
      ) : (
        <div className={cn("flex flex-col gap-1", !full && "min-h-0 flex-1 overflow-hidden")}>
          {p.factors.map((f) => (
            <p key={f.id} className={cn("leading-snug", full ? "text-sm" : "")}>
              {f.title ? <span className="font-semibold">{f.title}: </span> : null}
              <span className="whitespace-pre-line">{f.text}</span>
            </p>
          ))}
        </div>
      )}
      {(p.indicators ?? []).length > 0 ? (
        <div className="flex flex-wrap gap-1">
          {(p.indicators ?? []).map((k) => {
            const hit = lastElapsed(k);
            return (
              <span
                key={k}
                className={cn(
                  "rounded px-1",
                  hit?.cell ? STATUS_TONE[hit.cell.status] : "bg-muted text-muted-foreground"
                )}
                title={hit?.cell ? INDICATOR_STATUS_LABELS[hit.cell.status] : "Sem dado"}
              >
                {hit?.s.label ?? k}
                {hit?.cell?.attainment != null ? ` ${formatAttainment(hit.cell.attainment)}` : ""}
              </span>
            );
          })}
        </div>
      ) : null}
      {progress.total > 0 && !p.hideSteps ? (
        <span className="text-muted-foreground mt-auto">
          Etapas: {progress.done}/{progress.total}
        </span>
      ) : null}
    </div>
  );
}

function RitualBody({ node, full }: { node: TreeNode; full: boolean }) {
  const ops = useTreeOps();
  const chrome = useChrome(node);
  const p = parseRitualPayload(node.payload);
  const existing = useMemo(
    () => new Set((ops?.ritualOccurrences[node.id] ?? []).map((o) => o.n)),
    [ops?.ritualOccurrences, node.id]
  );
  if (!p) return chrome.warnings ? <MissingConfig text="Configure a cadência (Editar)." /> : null;
  const next = nextOpenOccurrence(p.schedule, todayBrasiliaIso(), existing);
  const open = (ops?.ritualOccurrences[node.id] ?? []).filter((o) => !o.done).length;
  const busy = ops?.scheduling.has(node.id) ?? false;
  return (
    <div className="flex h-full flex-col gap-1 text-micro">
      <div className="flex items-center gap-1">
        <span className="font-medium">{describeSchedule(p.schedule)}</span>
        {p.auto ? (
          <Badge variant="secondary" className="h-4 px-1 text-2xs">
            automático
          </Badge>
        ) : null}
      </div>
      {p.responsible ? <span className="text-muted-foreground">{p.responsible}</span> : null}
      {p.reading ? (
        <p className={cn("text-muted-foreground whitespace-pre-line", !full && "line-clamp-2")}>
          {p.reading}
        </p>
      ) : null}
      <div className="mt-auto flex items-center gap-1">
        <span className="text-muted-foreground">
          {next ? `Próxima: ${next.date.slice(8, 10)}/${next.date.slice(5, 7)}` : "Sem próximas"}
          {open > 0 ? ` · ${open} aberta(s)` : ""}
        </span>
        {/* v1.2: some ao apresentar (o widget pode ligar de volta). */}
        {next && ops && chrome.ritualSchedule ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="ml-auto h-6 gap-1 px-1.5 text-micro"
            data-no-drag
            disabled={busy}
            onClick={() => ops.onScheduleRitual(node)}
            title="Cria a tarefa da próxima ocorrência, pendurada neste ritual"
          >
            {busy ? <Loader2 className="size-3 animate-spin" /> : <CalendarPlus className="size-3" />}
            Agendar próxima
          </Button>
        ) : null}
      </div>
    </div>
  );
}

// --------------------------------------------------------------- editor

export interface OperationalDraft {
  kind: OperationalKind;
  /** null = criar. */
  node: TreeNode | null;
  parentRef: string | null;
  title: string;
  /** v1.2: a anotação que vira este nó (Converter em…). */
  fromNoteId?: string;
}

export interface OperationalSaveInput {
  label: string;
  payload: unknown;
  body?: string | null;
  /** v1.2: escolhas de exibição do cartão (null = limpar). */
  display?: TreeNodeDisplay | null;
}

const NONE = "__none__";

export function OperationalNodeSheet({
  draft,
  onClose,
  onSave,
  indicatorOptions,
  responsibleOptions,
  saving,
  catalog,
  display,
  tagSuggestions,
  months,
  series,
  canEditGoals,
  onSaveGoal,
}: {
  draft: OperationalDraft | null;
  onClose: () => void;
  onSave: (input: OperationalSaveInput) => void;
  indicatorOptions: ComboboxOption[];
  responsibleOptions: ComboboxOption[];
  saving: boolean;
  /** v1.2: catálogo do editor de fórmula (null = editor indisponível). */
  catalog: RealizedCatalog | null;
  /** v1.2: exibição atual do cartão. */
  display: TreeNodeDisplay | null;
  /** v1.2: etiquetas já usadas no mapa (sugestões). */
  tagSuggestions: string[];
  /** v1.2: meses e série do nó (meta editável no próprio nó). */
  months: string[];
  series: TreeIndicatorSeries | undefined;
  canEditGoals: boolean;
  onSaveGoal?: (month: string, value: number | null) => Promise<boolean>;
}) {
  return (
    <Sheet open={draft != null} onOpenChange={(o) => (o ? null : onClose())}>
      <SheetContent className="flex flex-col gap-3 overflow-y-auto sm:max-w-2xl">
        {draft ? (
          <OperationalForm
            key={draft.node?.id ?? `new:${draft.kind}:${draft.parentRef ?? ""}:${draft.fromNoteId ?? ""}`}
            draft={draft}
            onClose={onClose}
            onSave={onSave}
            indicatorOptions={indicatorOptions}
            responsibleOptions={responsibleOptions}
            saving={saving}
            catalog={catalog}
            display={display}
            tagSuggestions={tagSuggestions}
            months={months}
            series={series}
            canEditGoals={canEditGoals}
            onSaveGoal={onSaveGoal}
          />
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

const newFactorId = () => `f${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2 rounded-md border p-3">
      <div>
        <p className="text-sm font-medium">{title}</p>
        {hint ? <p className="text-muted-foreground text-xs">{hint}</p> : null}
      </div>
      {children}
    </div>
  );
}

function OperationalForm({
  draft,
  onClose,
  onSave,
  indicatorOptions,
  responsibleOptions,
  saving,
  catalog,
  display: initialDisplay,
  tagSuggestions,
  months,
  series,
  canEditGoals,
  onSaveGoal,
}: {
  draft: OperationalDraft;
  onClose: () => void;
  onSave: (input: OperationalSaveInput) => void;
  indicatorOptions: ComboboxOption[];
  responsibleOptions: ComboboxOption[];
  saving: boolean;
  catalog: RealizedCatalog | null;
  display: TreeNodeDisplay | null;
  tagSuggestions: string[];
  months: string[];
  series: TreeIndicatorSeries | undefined;
  canEditGoals: boolean;
  onSaveGoal?: (month: string, value: number | null) => Promise<boolean>;
}) {
  const kind = draft.kind;
  const [label, setLabel] = useState(draft.node?.label ?? draft.title);
  const [ind, setInd] = useState<IndicatorNodePayload>(
    () => parseIndicatorPayload(draft.node?.payload) ?? {}
  );
  const [plan, setPlan] = useState<PlanNodePayload>(
    () => parsePlanPayload(draft.node?.payload) ?? { factors: [] }
  );
  const [ritual, setRitual] = useState<RitualNodePayload>(
    () =>
      parseRitualPayload(draft.node?.payload) ?? {
        schedule: { cadence: "semanal", weekday: 5, anchor: todayBrasiliaIso() },
      }
  );
  const [display, setDisplay] = useState<TreeNodeDisplay>(initialDisplay ?? {});
  const [error, setError] = useState<string | null>(null);
  const respOpts = [{ value: NONE, label: "—" }, ...responsibleOptions];

  const submit = () => {
    setError(null);
    if (!label.trim()) return setError("Dê um nome ao nó.");
    const disp = Object.keys(display).length > 0 ? display : null;
    if (kind === "indicator") {
      if (!ind.indicator && !ind.realized?.override)
        return setError("Escolha o indicador ou defina uma métrica própria para o realizado.");
      if (ind.realized?.override && ind.realized.override.formula.tokens.length === 0)
        return setError("Informe a fórmula da métrica própria.");
      return onSave({ label, payload: ind, display: disp });
    }
    if (kind === "plan") {
      const factors = plan.factors.filter((f) => f.text.trim() || f.title?.trim());
      return onSave({ label, payload: { ...plan, factors }, display: disp });
    }
    return onSave({ label, payload: ritual, display: disp });
  };

  const description =
    kind === "indicator"
      ? "Um indicador mostra, mês a mês, a META, o REALIZADO e o PROJETADO. Cada seção abaixo diz de onde vem o número — e deixa trocar."
      : kind === "plan"
        ? "Multi-fatores: uma lista livre de fatores (título opcional + descrição). As etapas podem ser branches filhas (anotação-etapa ou tarefa)."
        : "Rotina de acompanhamento: a próxima ocorrência vira tarefa pelo botão “Agendar próxima” — ou sozinha, no modo automático.";

  return (
    <>
      <SheetHeader>
        <SheetTitle>
          {draft.node ? "Editar" : "Novo"} {TREE_NODE_KIND_LABELS[kind].toLowerCase()}
        </SheetTitle>
        <SheetDescription>{description}</SheetDescription>
      </SheetHeader>
      <div className="flex flex-col gap-3 px-4 pb-4">
        <div className="flex flex-col gap-1.5">
          <Label>Nome</Label>
          <Input value={label} onChange={(e) => setLabel(e.target.value)} />
        </div>

        {kind === "indicator" ? (
          <IndicatorFormSections
            ind={ind}
            setInd={setInd}
            indicatorOptions={indicatorOptions}
            respOpts={respOpts}
            catalog={catalog}
            tagSuggestions={tagSuggestions}
            months={months}
            series={draft.node ? series : undefined}
            canEditGoals={canEditGoals && draft.node != null}
            onSaveGoal={onSaveGoal}
          />
        ) : null}

        {kind === "plan" ? (
          <PlanFormSections
            plan={plan}
            setPlan={setPlan}
            respOpts={respOpts}
            indicatorOptions={indicatorOptions}
          />
        ) : null}

        {kind === "ritual" ? (
          <RitualFormSections ritual={ritual} setRitual={setRitual} respOpts={respOpts} />
        ) : null}

        <DisplaySection display={display} setDisplay={setDisplay} />

        {error ? <p className="text-destructive text-sm">{error}</p> : null}
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button onClick={submit} disabled={saving}>
            {saving ? "Salvando…" : "Salvar"}
          </Button>
        </div>
      </div>
    </>
  );
}

/** v1.2: rótulo de tipo ao apresentar e cor do cartão (os dois do CARTÃO). */
export function DisplaySection({
  display,
  setDisplay,
}: {
  display: TreeNodeDisplay;
  setDisplay: (d: TreeNodeDisplay) => void;
}) {
  return (
    <Section title="Exibição do cartão">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label className="text-xs">Tipo do cartão no modo Apresentar</Label>
          <select
            className="border-input h-9 rounded-md border bg-transparent px-2 text-sm"
            value={display.kindBadge ?? ""}
            onChange={(e) => {
              const v = e.target.value;
              const next = { ...display };
              if (v === "show" || v === "hide") next.kindBadge = v;
              else delete next.kindBadge;
              setDisplay(next);
            }}
          >
            <option value="">Padrão do widget</option>
            <option value="show">Mostrar</option>
            <option value="hide">Ocultar</option>
          </select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label className="text-xs">Cor do cartão</Label>
          <select
            className="border-input h-9 rounded-md border bg-transparent px-2 text-sm"
            value={display.tone ?? "padrao"}
            onChange={(e) => {
              const v = e.target.value as TreeTone;
              const next = { ...display };
              if (v === "padrao") delete next.tone;
              else next.tone = v;
              setDisplay(next);
            }}
          >
            {TREE_TONES.map((t) => (
              <option key={t} value={t}>
                {TREE_TONE_LABELS[t]}
              </option>
            ))}
          </select>
        </div>
      </div>
    </Section>
  );
}

function parseNumberBR(raw: string): number | null | undefined {
  const t = raw.trim();
  if (!t) return null;
  const n = Number(t.replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? n : undefined;
}

function IndicatorFormSections({
  ind,
  setInd,
  indicatorOptions,
  respOpts,
  catalog,
  tagSuggestions,
  months,
  series,
  canEditGoals,
  onSaveGoal,
}: {
  ind: IndicatorNodePayload;
  setInd: (p: IndicatorNodePayload) => void;
  indicatorOptions: ComboboxOption[];
  respOpts: ComboboxOption[];
  catalog: RealizedCatalog | null;
  tagSuggestions: string[];
  months: string[];
  series: TreeIndicatorSeries | undefined;
  canEditGoals: boolean;
  onSaveGoal?: (month: string, value: number | null) => Promise<boolean>;
}) {
  const rows = indicatorRows(ind);
  const [goalSaving, setGoalSaving] = useState<string | null>(null);
  const [goalError, setGoalError] = useState<string | null>(null);
  const indicatorLabel = indicatorOptions.find((o) => o.value === ind.indicator)?.label ?? null;
  const setRows = (next: IndicatorRow[]) => setInd({ ...ind, rows: next });
  const moveRow = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= rows.length) return;
    const next = [...rows];
    [next[i], next[j]] = [next[j], next[i]];
    setRows(next);
  };
  return (
    <>
      <Section
        title="Indicador"
        hint="A chave do indicador é a chave da meta. O catálogo (unidade, total entre meses, direção, tolerância e a fórmula padrão do realizado) fica em Configurações → Metas → Indicadores."
      >
        <Combobox
          options={[{ value: NONE, label: "— nenhum (só métrica própria, sem meta)" }, ...indicatorOptions]}
          value={ind.indicator ?? NONE}
          onValueChange={(v) => setInd({ ...ind, indicator: v === NONE ? undefined : v })}
          aria-label="Indicador"
        />
        <a
          href="/configuracoes/metas"
          target="_blank"
          rel="noreferrer"
          className="text-primary inline-flex items-center gap-1 self-start text-xs underline"
        >
          <ExternalLink className="size-3" /> Abrir o catálogo de indicadores
        </a>
      </Section>

      <Section
        title="Meta — de onde vem"
        hint={
          ind.indicator
            ? `As metas mensais de “${indicatorLabel ?? ind.indicator}”${ind.responsible ? ` do responsável ${ind.responsible}` : " (globais)"}. São as mesmas de Configurações → Metas: editar aqui edita lá.`
            : "Sem indicador, o nó não tem meta (só realizado)."
        }
      >
        <div className="flex flex-col gap-1.5">
          <Label className="text-xs">Meta de um responsável (opcional)</Label>
          <Combobox
            options={respOpts}
            value={ind.responsible ?? NONE}
            onValueChange={(v) => setInd({ ...ind, responsible: v === NONE ? undefined : v })}
            aria-label="Responsável"
          />
        </div>
        {ind.indicator && series && months.length > 0 ? (
          <div className="grid grid-cols-3 gap-2">
            {months.map((m, mi) => (
              <label key={m} className="flex flex-col gap-1 text-xs">
                <span className="text-muted-foreground">{monthLabel(m, true)}</span>
                <Input
                  inputMode="decimal"
                  disabled={!canEditGoals || goalSaving === m}
                  defaultValue={
                    series.cells[mi]?.target == null
                      ? ""
                      : String(series.cells[mi].target).replace(".", ",")
                  }
                  onBlur={async (e) => {
                    if (!onSaveGoal) return;
                    const v = parseNumberBR(e.currentTarget.value);
                    if (v === undefined) return setGoalError("Valor inválido.");
                    if (v === (series.cells[mi]?.target ?? null)) return;
                    setGoalError(null);
                    setGoalSaving(m);
                    const ok = await onSaveGoal(m, v);
                    setGoalSaving(null);
                    if (!ok) setGoalError("Não foi possível salvar a meta.");
                  }}
                />
              </label>
            ))}
          </div>
        ) : ind.indicator ? (
          <p className="text-muted-foreground text-xs">
            Salve o nó para editar as metas dos meses aqui.
          </p>
        ) : null}
        {!canEditGoals && ind.indicator && series ? (
          <p className="text-muted-foreground text-xs">Só administradores editam metas.</p>
        ) : null}
        {goalError ? <p className="text-destructive text-xs">{goalError}</p> : null}
      </Section>

      <Section
        title="Realizado — de onde vem"
        hint="Atualiza sozinho com os registros. Use a fórmula do indicador ou qualquer métrica calculada; recorte por dimensão (exibido ou não no cartão) e abra em sub-linhas."
      >
        {catalog ? (
          <RealizedSourceEditor
            catalog={catalog}
            value={ind.realized ?? null}
            onChange={(v) => setInd({ ...ind, realized: v ?? undefined })}
            indicatorLabel={indicatorLabel}
            indicatorFormula={series?.formulaText ?? (series?.hasRealized ? "fórmula do catálogo" : null)}
          />
        ) : (
          <p className="text-muted-foreground text-xs">
            O editor de fórmula precisa do catálogo de campos do painel — abra pelo painel.
          </p>
        )}
      </Section>

      <Section
        title="Projetado — de onde vem"
        hint="Combina os FILHOS indicadores deste nó, mês a mês (ex.: vendas × ticket = MRR). Precisa de pelo menos dois filhos indicadores."
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs">Filhos se combinam por</Label>
            <Combobox
              options={[
                { value: NONE, label: "— (não projeta)" },
                ...Object.entries(CHILDREN_OP_LABELS).map(([v, l]) => ({ value: v, label: `${v} ${l}` })),
              ]}
              value={ind.childrenOp ?? NONE}
              onValueChange={(v) =>
                setInd({ ...ind, childrenOp: v === NONE ? undefined : (v as ChildrenOp) })
              }
              searchable={false}
              aria-label="Operador dos filhos"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs">A partir de</Label>
            <select
              className="border-input h-9 rounded-md border bg-transparent px-2 text-sm"
              value={ind.projectFrom ?? "meta"}
              onChange={(e) =>
                setInd({
                  ...ind,
                  projectFrom: e.target.value === "realizado" ? "realizado" : undefined,
                })
              }
            >
              <option value="meta">Metas dos filhos</option>
              <option value="realizado">Realizados dos filhos</option>
            </select>
          </div>
        </div>
      </Section>

      <Section title="Linhas do cartão" hint="Rótulo, ordem e o que aparece.">
        <div className="flex flex-col gap-1">
          {rows.map((r, i) => (
            <div key={r.kind} className="flex items-center gap-2">
              <Checkbox
                checked={!r.hidden}
                onCheckedChange={(v) =>
                  setRows(rows.map((x, xi) => (xi === i ? { ...x, hidden: v === true ? undefined : true } : x)))
                }
                aria-label={`Mostrar ${INDICATOR_ROW_LABELS[r.kind]}`}
              />
              <span className="text-muted-foreground w-36 shrink-0 text-xs">
                {INDICATOR_ROW_LABELS[r.kind]}
              </span>
              <Input
                className="h-8"
                maxLength={24}
                value={r.label ?? ""}
                placeholder={INDICATOR_ROW_DEFAULT_TEXT[r.kind]}
                onChange={(e) =>
                  setRows(
                    rows.map((x, xi) =>
                      xi === i ? { ...x, label: e.target.value || undefined } : x
                    )
                  )
                }
                aria-label={`Rótulo de ${INDICATOR_ROW_LABELS[r.kind]}`}
              />
              <Button type="button" variant="ghost" size="icon" className="size-7" aria-label="Subir" onClick={() => moveRow(i, -1)} disabled={i === 0}>
                <ArrowUp className="size-3.5" />
              </Button>
              <Button type="button" variant="ghost" size="icon" className="size-7" aria-label="Descer" onClick={() => moveRow(i, 1)} disabled={i === rows.length - 1}>
                <ArrowDown className="size-3.5" />
              </Button>
            </div>
          ))}
        </div>
        <label className="flex items-center gap-2 text-sm">
          <Checkbox
            checked={ind.unitInCell !== false}
            onCheckedChange={(v) => setInd({ ...ind, unitInCell: v === true ? undefined : false })}
          />
          Unidade (R$, %) em cada valor
        </label>
      </Section>

      <Section title="Identificação">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs">Etiqueta (opcional)</Label>
            <Input
              list="tree-tag-suggestions"
              maxLength={24}
              value={ind.tag ?? ""}
              placeholder="ex.: N1, Estratégico"
              onChange={(e) => setInd({ ...ind, tag: e.target.value || undefined })}
            />
            <datalist id="tree-tag-suggestions">
              {tagSuggestions.map((t) => (
                <option key={t} value={t} />
              ))}
            </datalist>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs">Frase de apoio (opcional)</Label>
            <Input
              value={ind.hint ?? ""}
              placeholder="ex.: SQL realizados × conversão"
              onChange={(e) => setInd({ ...ind, hint: e.target.value || undefined })}
            />
          </div>
        </div>
      </Section>
    </>
  );
}

function PlanFormSections({
  plan,
  setPlan,
  respOpts,
  indicatorOptions,
}: {
  plan: PlanNodePayload;
  setPlan: (p: PlanNodePayload) => void;
  respOpts: ComboboxOption[];
  indicatorOptions: ComboboxOption[];
}) {
  const setFactors = (factors: PlanFactor[]) => setPlan({ ...plan, factors });
  const move = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= plan.factors.length) return;
    const next = [...plan.factors];
    [next[i], next[j]] = [next[j], next[i]];
    setFactors(next);
  };
  return (
    <>
      <Section
        title="Fatores"
        hint="Cada fator tem um título (opcional) e a descrição. A ordem é a do cartão."
      >
        {plan.factors.map((f, i) => (
          <div key={f.id} className="flex flex-col gap-1 rounded-md border p-2">
            <div className="flex items-center gap-1">
              <Input
                className="h-8"
                placeholder="Título (opcional)"
                value={f.title ?? ""}
                onChange={(e) =>
                  setFactors(
                    plan.factors.map((x, xi) =>
                      xi === i ? { ...x, title: e.target.value || undefined } : x
                    )
                  )
                }
                aria-label={`Título do fator ${i + 1}`}
              />
              <Button type="button" variant="ghost" size="icon" className="size-7" aria-label="Subir fator" onClick={() => move(i, -1)} disabled={i === 0}>
                <ArrowUp className="size-3.5" />
              </Button>
              <Button type="button" variant="ghost" size="icon" className="size-7" aria-label="Descer fator" onClick={() => move(i, 1)} disabled={i === plan.factors.length - 1}>
                <ArrowDown className="size-3.5" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-7"
                aria-label="Remover fator"
                onClick={() => setFactors(plan.factors.filter((_, xi) => xi !== i))}
              >
                <Trash2 className="size-3.5" />
              </Button>
            </div>
            <Textarea
              rows={2}
              placeholder="Descrição"
              value={f.text}
              onChange={(e) =>
                setFactors(plan.factors.map((x, xi) => (xi === i ? { ...x, text: e.target.value } : x)))
              }
              aria-label={`Descrição do fator ${i + 1}`}
            />
          </div>
        ))}
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={plan.factors.length >= MAX_PLAN_FACTORS}
            onClick={() => setFactors([...plan.factors, { id: newFactorId(), text: "" }])}
          >
            <Plus className="size-4" /> Adicionar fator
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            title="Atalho: acrescenta os seis campos clássicos (o quê, por quê…) como fatores editáveis"
            disabled={plan.factors.length + PLAN_FIELDS.length > MAX_PLAN_FACTORS}
            onClick={() =>
              setFactors([
                ...plan.factors,
                ...PLAN_FIELDS.map(([, title]) => ({ id: newFactorId(), title, text: "" })),
              ])
            }
          >
            Adicionar molde 5W2H
          </Button>
        </div>
      </Section>
      <Section title="Responsável e indicadores (opcionais)">
        <Combobox
          options={respOpts}
          value={plan.responsible ?? NONE}
          onValueChange={(v) => setPlan({ ...plan, responsible: v === NONE ? undefined : v })}
          aria-label="Responsável"
        />
        <div className="flex max-h-40 flex-col gap-1 overflow-auto rounded-md border p-2">
          {indicatorOptions.map((o) => (
            <label key={o.value} className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={(plan.indicators ?? []).includes(o.value)}
                onCheckedChange={(v) =>
                  setPlan({
                    ...plan,
                    indicators:
                      v === true
                        ? [...(plan.indicators ?? []), o.value]
                        : (plan.indicators ?? []).filter((k) => k !== o.value),
                  })
                }
              />
              {o.label}
            </label>
          ))}
        </div>
        <label className="flex items-center gap-2 text-sm">
          <Checkbox
            checked={!plan.hideSteps}
            onCheckedChange={(v) => setPlan({ ...plan, hideSteps: v === true ? undefined : true })}
          />
          Mostrar “Etapas: x/y” (branches filhas a concluir)
        </label>
      </Section>
    </>
  );
}

function RitualFormSections({
  ritual,
  setRitual,
  respOpts,
}: {
  ritual: RitualNodePayload;
  setRitual: (r: RitualNodePayload) => void;
  respOpts: ComboboxOption[];
}) {
  const days = weekdaysOf(ritual.schedule);
  const setDays = (next: number[]) => {
    const sorted = [...new Set(next)].sort((a, b) => a - b);
    if (sorted.length === 0) return;
    const { weekday: _w, weekdays: _ws, ...rest } = ritual.schedule;
    void _w;
    void _ws;
    setRitual({
      ...ritual,
      schedule: sorted.length === 1 ? { ...rest, weekday: sorted[0] } : { ...rest, weekdays: sorted },
    });
  };
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label>Cadência</Label>
          <Combobox
            options={Object.entries(RITUAL_CADENCE_LABELS).map(([v, l]) => ({ value: v, label: l }))}
            value={ritual.schedule.cadence}
            onValueChange={(v) =>
              setRitual({ ...ritual, schedule: { ...ritual.schedule, cadence: v as RitualCadence } })
            }
            searchable={false}
            aria-label="Cadência"
          />
        </div>
        {ritual.schedule.cadence === "semanal" ? (
          <div className="flex flex-col gap-1.5 sm:col-span-2">
            <Label>Dias da semana</Label>
            <div className="flex flex-wrap gap-1">
              {WEEKDAY_LABELS.map((l, i) => (
                <button
                  key={l}
                  type="button"
                  aria-pressed={days.includes(i)}
                  onClick={() =>
                    setDays(days.includes(i) ? days.filter((d) => d !== i) : [...days, i])
                  }
                  className={cn(
                    "rounded border px-2 py-1 text-xs capitalize",
                    days.includes(i) ? "bg-primary text-primary-foreground" : "hover:bg-accent"
                  )}
                >
                  {l}
                </button>
              ))}
            </div>
          </div>
        ) : null}
        {ritual.schedule.cadence === "mensal" ? (
          <div className="flex flex-col gap-1.5">
            <Label>Dia do mês</Label>
            <Combobox
              options={[
                { value: "ultimo_util", label: "Último dia útil" },
                ...Array.from({ length: 31 }, (_, i) => ({
                  value: String(i + 1),
                  label: i + 1 > 28 ? `${i + 1} (ou o último dia do mês)` : String(i + 1),
                })),
              ]}
              value={String(ritual.schedule.monthDay ?? 1)}
              onValueChange={(v) =>
                setRitual({
                  ...ritual,
                  schedule: {
                    ...ritual.schedule,
                    monthDay: v === "ultimo_util" ? "ultimo_util" : Number(v),
                  },
                })
              }
              aria-label="Dia do mês"
            />
          </div>
        ) : null}
        {ritual.schedule.cadence === "dias" ? (
          <div className="flex flex-col gap-1.5">
            <Label>A cada (dias)</Label>
            <Input
              inputMode="numeric"
              value={String(ritual.schedule.everyDays ?? 7)}
              onChange={(e) =>
                setRitual({
                  ...ritual,
                  schedule: { ...ritual.schedule, everyDays: Number(e.target.value) || 1 },
                })
              }
            />
          </div>
        ) : null}
        <div className="flex flex-col gap-1.5">
          <Label>A partir de</Label>
          <Input
            type="date"
            value={ritual.schedule.anchor}
            onChange={(e) =>
              setRitual({ ...ritual, schedule: { ...ritual.schedule, anchor: e.target.value } })
            }
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>Até (opcional)</Label>
          <Input
            type="date"
            value={ritual.schedule.until ?? ""}
            onChange={(e) =>
              setRitual({
                ...ritual,
                schedule: { ...ritual.schedule, until: e.target.value || undefined },
              })
            }
          />
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label>Responsável das tarefas</Label>
        <Combobox
          options={respOpts}
          value={ritual.responsible ?? NONE}
          onValueChange={(v) => setRitual({ ...ritual, responsible: v === NONE ? undefined : v })}
          aria-label="Responsável do ritual"
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label>Leitura e decisão (vira a descrição da tarefa)</Label>
        <Textarea
          rows={3}
          value={ritual.reading ?? ""}
          onChange={(e) => setRitual({ ...ritual, reading: e.target.value || undefined })}
        />
      </div>
      <label className="flex items-center gap-2 text-sm">
        <Checkbox
          checked={ritual.auto === true}
          onCheckedChange={(v) => setRitual({ ...ritual, auto: v === true || undefined })}
        />
        Gerar as tarefas sozinho (automático)
      </label>
      {ritual.auto ? (
        <label className="flex items-center gap-2 text-sm">
          Manter
          <select
            className="border-input h-8 rounded-md border bg-transparent px-2 text-sm"
            value={String(ritual.lookahead ?? 1)}
            onChange={(e) => {
              const n = Number(e.target.value);
              setRitual({ ...ritual, lookahead: n > 1 ? n : undefined });
            }}
            aria-label="Ocorrências futuras abertas"
          >
            {[1, 2, 3, 4, 5].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
          ocorrência(s) futura(s) aberta(s)
        </label>
      ) : null}
    </>
  );
}

/** Rótulo do intervalo de meses (para legendas). */
export function monthsCaption(months: string[]): string {
  if (months.length === 0) return "";
  return months.length === 1
    ? monthLabel(months[0], true)
    : `${monthLabel(months[0], true)} – ${monthLabel(months[months.length - 1], true)}`;
}
