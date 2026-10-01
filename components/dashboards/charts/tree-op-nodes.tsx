// Versão: 1.0 | Data: 01/10/2026
// Nós OPERACIONAIS da Tree (0149): o corpo do cartão (Lista e Root) e o editor
// de cada um.
//
//  - INDICADOR: meta × realizado × atingimento por mês do período do painel
//    (os números vêm de `loadTreeIndicatorValues`, que roda o MESMO dono da
//    Tabela de metas — lib/indicators/values.ts) e, com operador e filhos
//    indicadores, o PROJETADO dos filhos contra a meta oficial do nó: é a
//    leitura "vendas × ticket = MRR" do desdobramento.
//  - PLANO: o 5W2H, o responsável, os indicadores que ele move (status vivo)
//    e o progresso das etapas.
//  - RITUAL: a cadência por extenso, a próxima data e "Agendar próxima".
//
// Os dados chegam por CONTEXTO (`TreeOpsProvider`, do widget): o corpo é o
// mesmo nas duas visualizações e nenhuma delas precisa saber de indicador.
"use client";

import { createContext, useContext, useMemo, useState } from "react";
import { CalendarPlus, Loader2, TriangleAlert } from "lucide-react";

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
import { progressOf } from "@/lib/tree/path";
import {
  INDICATOR_LEVELS,
  PLAN_FIELDS,
  parseIndicatorPayload,
  parsePlanPayload,
  parseRitualPayload,
  seriesKey,
  type IndicatorNodePayload,
  type OperationalKind,
  type PlanNodePayload,
  type RitualNodePayload,
} from "@/lib/tree/payload";
import {
  describeSchedule,
  nextOpenOccurrence,
  RITUAL_CADENCE_LABELS,
  WEEKDAY_LABELS,
  type RitualCadence,
} from "@/lib/rituals/cadence";
import { TREE_NODE_KIND_LABELS, type TreeNode } from "@/lib/tree/model";
import type { TreeIndicatorSeries } from "@/app/(app)/dashboards/goal-table-actions";
import { STATUS_TONE } from "./goal-table-widget";

export interface TreeOpsValue {
  months: string[];
  series: Map<string, TreeIndicatorSeries>;
  loading: boolean;
  ritualOccurrences: Record<string, { n: number; taskId: string; done: boolean }[]>;
  scheduling: ReadonlySet<string>;
  onScheduleRitual: (node: TreeNode) => void;
}

const TreeOpsContext = createContext<TreeOpsValue | null>(null);

export const TreeOpsProvider = TreeOpsContext.Provider;

function useTreeOps(): TreeOpsValue | null {
  return useContext(TreeOpsContext);
}

export function isOperationalNode(node: TreeNode): boolean {
  return node.kind === "indicator" || node.kind === "plan" || node.kind === "ritual";
}

/** Tamanho do cartão na Root (os demais nós usam o padrão). */
export function operationalSize(node: TreeNode): { w: number; h: number } | null {
  switch (node.kind) {
    case "indicator":
      return { w: 300, h: 156 };
    case "plan":
      return { w: 320, h: 176 };
    case "ritual":
      return { w: 264, h: 136 };
    default:
      return null;
  }
}

// --------------------------------------------------------------- corpo

export function OperationalBody({ node }: { node: TreeNode }) {
  switch (node.kind) {
    case "indicator":
      return <IndicatorBody node={node} />;
    case "plan":
      return <PlanBody node={node} />;
    case "ritual":
      return <RitualBody node={node} />;
    default:
      return null;
  }
}

function MissingConfig({ text }: { text: string }) {
  return (
    <p className="text-muted-foreground flex items-center gap-1 text-[11px]">
      <TriangleAlert className="size-3" /> {text}
    </p>
  );
}

function IndicatorBody({ node }: { node: TreeNode }) {
  const ops = useTreeOps();
  const p = parseIndicatorPayload(node.payload);
  if (!p) return <MissingConfig text="Escolha o indicador (Editar)." />;
  const s = ops?.series.get(seriesKey(p.indicator, p.responsible));
  const months = ops?.months ?? [];

  // Projetado: os filhos INDICADORES combinados pelo operador, mês a mês.
  const childSeries = p.childrenOp
    ? node.children
        .filter((c) => c.kind === "indicator")
        .map((c) => {
          const cp = parseIndicatorPayload(c.payload);
          return cp ? ops?.series.get(seriesKey(cp.indicator, cp.responsible)) : undefined;
        })
    : [];
  const projected =
    p.childrenOp && childSeries.length >= 2 && childSeries.every(Boolean)
      ? months.map((_, mi) =>
          combineChildren(
            p.childrenOp!,
            childSeries.map((cs) => ({ value: cs!.cells[mi]?.target ?? null, unit: cs!.unit }))
          )
        )
      : null;

  return (
    <div className="flex h-full flex-col gap-1 text-[11px]">
      <div className="flex items-center gap-1">
        {p.level ? (
          <Badge variant="secondary" className="h-4 px-1 text-[10px]">
            {p.level}
          </Badge>
        ) : null}
        {p.responsible ? <span className="text-muted-foreground truncate">{p.responsible}</span> : null}
        {p.childrenOp ? (
          <span className="text-muted-foreground ml-auto" title={CHILDREN_OP_LABELS[p.childrenOp]}>
            filhos: {p.childrenOp}
          </span>
        ) : null}
      </div>
      {p.hint ? <p className="text-muted-foreground line-clamp-1">{p.hint}</p> : null}
      {!s ? (
        ops?.loading ? (
          <span className="text-muted-foreground flex items-center gap-1">
            <Loader2 className="size-3 animate-spin" /> carregando…
          </span>
        ) : (
          <MissingConfig text="Sem metas para o período." />
        )
      ) : s.responsibleMissing ? (
        <MissingConfig text={`Responsável "${p.responsible}" não encontrado.`} />
      ) : (
        <table className="w-full table-fixed tabular-nums">
          <thead>
            <tr className="text-muted-foreground">
              <th className="w-10 text-left font-normal" />
              {months.map((m) => (
                <th key={m} className="text-right font-normal">
                  {monthLabel(m).slice(0, 3)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr className="font-semibold">
              <td className="text-muted-foreground font-normal">Meta</td>
              {s.cells.map((c) => (
                <td key={c.month} className="truncate text-right">
                  {formatIndicatorValue(c.target, s.unit)}
                </td>
              ))}
            </tr>
            {s.hasRealized ? (
              <tr>
                <td className="text-muted-foreground">Real</td>
                {s.cells.map((c) => (
                  <td key={c.month} className="truncate text-right">
                    {c.elapsed > 0 ? (
                      <span
                        className={cn("rounded px-0.5", STATUS_TONE[c.status])}
                        title={`${INDICATOR_STATUS_LABELS[c.status]} · ${formatAttainment(c.attainment)}`}
                      >
                        {formatIndicatorValue(c.realized, s.unit)}
                      </span>
                    ) : (
                      "—"
                    )}
                  </td>
                ))}
              </tr>
            ) : null}
            {projected ? (
              <tr className="text-muted-foreground">
                <td title="Combinação das metas dos filhos">Proj.</td>
                {projected.map((v, mi) => (
                  <td key={mi} className="truncate text-right" title={CHILDREN_OP_LABELS[p.childrenOp!]}>
                    {formatIndicatorValue(v, s.unit)}
                  </td>
                ))}
              </tr>
            ) : null}
          </tbody>
        </table>
      )}
    </div>
  );
}

function PlanBody({ node }: { node: TreeNode }) {
  const ops = useTreeOps();
  const p = parsePlanPayload(node.payload) ?? {};
  const progress = progressOf(node);
  const lastElapsed = (key: string) => {
    const s = ops?.series.get(seriesKey(key, null));
    if (!s) return null;
    const cells = s.cells.filter((c) => c.elapsed > 0);
    return { s, cell: cells[cells.length - 1] ?? null };
  };
  return (
    <div className="flex h-full flex-col gap-1 text-[11px]">
      {p.responsible ? (
        <span className="text-muted-foreground">Responsável: {p.responsible}</span>
      ) : null}
      {p.oQue ? <p className="line-clamp-2">{p.oQue}</p> : <MissingConfig text="Descreva o plano (Editar)." />}
      {p.prazo ? <p className="text-muted-foreground line-clamp-1">Prazo: {p.prazo}</p> : null}
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
      {progress.total > 0 ? (
        <span className="text-muted-foreground mt-auto">
          Etapas: {progress.done}/{progress.total}
        </span>
      ) : null}
    </div>
  );
}

function RitualBody({ node }: { node: TreeNode }) {
  const ops = useTreeOps();
  const p = parseRitualPayload(node.payload);
  const existing = useMemo(
    () => new Set((ops?.ritualOccurrences[node.id] ?? []).map((o) => o.n)),
    [ops?.ritualOccurrences, node.id]
  );
  if (!p) return <MissingConfig text="Configure a cadência (Editar)." />;
  const next = nextOpenOccurrence(p.schedule, todayBrasiliaIso(), existing);
  const open = (ops?.ritualOccurrences[node.id] ?? []).filter((o) => !o.done).length;
  const busy = ops?.scheduling.has(node.id) ?? false;
  return (
    <div className="flex h-full flex-col gap-1 text-[11px]">
      <div className="flex items-center gap-1">
        <span className="font-medium">{describeSchedule(p.schedule)}</span>
        {p.auto ? (
          <Badge variant="secondary" className="h-4 px-1 text-[10px]">
            automático
          </Badge>
        ) : null}
      </div>
      {p.responsible ? <span className="text-muted-foreground">{p.responsible}</span> : null}
      {p.reading ? <p className="text-muted-foreground line-clamp-2">{p.reading}</p> : null}
      <div className="mt-auto flex items-center gap-1">
        <span className="text-muted-foreground">
          {next ? `Próxima: ${next.date.slice(8, 10)}/${next.date.slice(5, 7)}` : "Sem próximas"}
          {open > 0 ? ` · ${open} aberta(s)` : ""}
        </span>
        {next && ops ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="ml-auto h-6 gap-1 px-1.5 text-[11px]"
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
}

const NONE = "__none__";

export function OperationalNodeSheet({
  draft,
  onClose,
  onSave,
  indicatorOptions,
  responsibleOptions,
  saving,
}: {
  draft: OperationalDraft | null;
  onClose: () => void;
  onSave: (input: { label: string; payload: unknown; body?: string | null }) => void;
  indicatorOptions: ComboboxOption[];
  responsibleOptions: ComboboxOption[];
  saving: boolean;
}) {
  return (
    <Sheet open={draft != null} onOpenChange={(o) => (o ? null : onClose())}>
      <SheetContent className="flex flex-col gap-3 overflow-y-auto sm:max-w-xl">
        {draft ? (
          <OperationalForm
            key={draft.node?.id ?? `new:${draft.kind}:${draft.parentRef ?? ""}`}
            draft={draft}
            onClose={onClose}
            onSave={onSave}
            indicatorOptions={indicatorOptions}
            responsibleOptions={responsibleOptions}
            saving={saving}
          />
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

function OperationalForm({
  draft,
  onClose,
  onSave,
  indicatorOptions,
  responsibleOptions,
  saving,
}: {
  draft: OperationalDraft;
  onClose: () => void;
  onSave: (input: { label: string; payload: unknown; body?: string | null }) => void;
  indicatorOptions: ComboboxOption[];
  responsibleOptions: ComboboxOption[];
  saving: boolean;
}) {
  const kind = draft.kind;
  const [label, setLabel] = useState(draft.node?.label ?? draft.title);
  const [ind, setInd] = useState<IndicatorNodePayload>(
    () => parseIndicatorPayload(draft.node?.payload) ?? { indicator: "" }
  );
  const [plan, setPlan] = useState<PlanNodePayload>(
    () => parsePlanPayload(draft.node?.payload) ?? {}
  );
  const [ritual, setRitual] = useState<RitualNodePayload>(
    () =>
      parseRitualPayload(draft.node?.payload) ?? {
        schedule: { cadence: "semanal", weekday: 5, anchor: todayBrasiliaIso() },
      }
  );
  const [error, setError] = useState<string | null>(null);
  const respOpts = [{ value: NONE, label: "—" }, ...responsibleOptions];

  const submit = () => {
    setError(null);
    if (!label.trim()) return setError("Dê um nome ao nó.");
    if (kind === "indicator") {
      if (!ind.indicator) return setError("Escolha o indicador.");
      return onSave({ label, payload: ind });
    }
    if (kind === "plan") return onSave({ label, payload: plan });
    return onSave({ label, payload: ritual });
  };

  return (
    <>
      <SheetHeader>
        <SheetTitle>
          {draft.node ? "Editar" : "Novo"} {TREE_NODE_KIND_LABELS[kind].toLowerCase()}
        </SheetTitle>
        <SheetDescription>
          {kind === "indicator"
            ? "O nó mostra meta, realizado e atingimento do indicador nos meses do período do painel."
            : kind === "plan"
              ? "O plano de ação: o que, por que, resultado esperado, como medir, prazo e como acontecer. As etapas são branches filhas (anotação-etapa ou tarefa)."
              : "Rotina de acompanhamento: a próxima ocorrência vira tarefa pelo botão “Agendar próxima” — ou sozinha, no modo automático."}
        </SheetDescription>
      </SheetHeader>
      <div className="flex flex-col gap-3 px-4 pb-4">
        <div className="flex flex-col gap-1.5">
          <Label>Nome</Label>
          <Input value={label} onChange={(e) => setLabel(e.target.value)} />
        </div>

        {kind === "indicator" ? (
          <>
            <div className="flex flex-col gap-1.5">
              <Label>Indicador</Label>
              <Combobox
                options={indicatorOptions}
                value={ind.indicator}
                onValueChange={(v) => setInd({ ...ind, indicator: v })}
                aria-label="Indicador"
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <Label>Nível</Label>
                <Combobox
                  options={[{ value: NONE, label: "—" }, ...INDICATOR_LEVELS.map((l) => ({ value: l, label: l }))]}
                  value={ind.level ?? NONE}
                  onValueChange={(v) =>
                    setInd({ ...ind, level: v === NONE ? undefined : (v as IndicatorNodePayload["level"]) })
                  }
                  searchable={false}
                  aria-label="Nível"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>Filhos se combinam por</Label>
                <Combobox
                  options={[
                    { value: NONE, label: "— (não projeta)" },
                    ...Object.entries(CHILDREN_OP_LABELS).map(([v, l]) => ({ value: v, label: l })),
                  ]}
                  value={ind.childrenOp ?? NONE}
                  onValueChange={(v) =>
                    setInd({ ...ind, childrenOp: v === NONE ? undefined : (v as ChildrenOp) })
                  }
                  searchable={false}
                  aria-label="Operador dos filhos"
                />
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Meta de um responsável (opcional)</Label>
              <Combobox
                options={respOpts}
                value={ind.responsible ?? NONE}
                onValueChange={(v) => setInd({ ...ind, responsible: v === NONE ? undefined : v })}
                aria-label="Responsável"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Frase de apoio (opcional)</Label>
              <Input
                value={ind.hint ?? ""}
                placeholder="ex.: SQL realizados × conversão"
                onChange={(e) => setInd({ ...ind, hint: e.target.value || undefined })}
              />
            </div>
          </>
        ) : null}

        {kind === "plan" ? (
          <>
            {PLAN_FIELDS.map(([key, title]) => (
              <div key={key} className="flex flex-col gap-1.5">
                <Label>{title}</Label>
                <Textarea
                  rows={2}
                  value={plan[key] ?? ""}
                  onChange={(e) => setPlan({ ...plan, [key]: e.target.value || undefined })}
                />
              </div>
            ))}
            <div className="flex flex-col gap-1.5">
              <Label>Responsável</Label>
              <Combobox
                options={respOpts}
                value={plan.responsible ?? NONE}
                onValueChange={(v) => setPlan({ ...plan, responsible: v === NONE ? undefined : v })}
                aria-label="Responsável do plano"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Indicadores que o plano move</Label>
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
            </div>
          </>
        ) : null}

        {kind === "ritual" ? (
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
                <div className="flex flex-col gap-1.5">
                  <Label>Dia da semana</Label>
                  <Combobox
                    options={WEEKDAY_LABELS.map((l, i) => ({ value: String(i), label: l }))}
                    value={String(ritual.schedule.weekday ?? 1)}
                    onValueChange={(v) =>
                      setRitual({ ...ritual, schedule: { ...ritual.schedule, weekday: Number(v) } })
                    }
                    searchable={false}
                    aria-label="Dia da semana"
                  />
                </div>
              ) : null}
              {ritual.schedule.cadence === "mensal" ? (
                <div className="flex flex-col gap-1.5">
                  <Label>Dia do mês</Label>
                  <Combobox
                    options={[
                      { value: "ultimo_util", label: "Último dia útil" },
                      ...Array.from({ length: 28 }, (_, i) => ({ value: String(i + 1), label: String(i + 1) })),
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
              Gerar as tarefas sozinho (automático — mantém a próxima ocorrência aberta)
            </label>
          </>
        ) : null}

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

/** Rótulo do mês corrente/fechado mais recente (para legendas). */
export function monthsCaption(months: string[]): string {
  if (months.length === 0) return "";
  return months.length === 1
    ? monthLabel(months[0], true)
    : `${monthLabel(months[0], true)} – ${monthLabel(months[months.length - 1], true)}`;
}
