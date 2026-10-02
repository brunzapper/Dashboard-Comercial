// Versão: 1.1 | Data: 02/10/2026
// v1.1 (02/10/2026): METAS (a Tabela Livre absorveu a Tabela de metas).
//  - ColumnPanel: tipos "Rótulo da linha", "Metas por mês" (meses pelo
//    seletor — fixos ou os do período, nunca "2026-10, 2026-11" digitado — e
//    o que a célula mostra) e "Total dos meses";
//  - RowPanel: rótulo, etiqueta, negrito, unidade no rótulo e o VÍNCULO da
//    linha — indicador + responsável (lista dos cadastrados, grava o NOME) +
//    fonte do realizado (o MESMO editor da Tree e dos indicadores) — ou linha
//    de total; atalho "Repetir para responsáveis".
// Versão: 1.0 | Data: 15/07/2026
// Tabela Livre — painéis flutuantes de estrutura (modo Editar layout):
//  - useQuickTableConfig: estado otimista de settings.quickTable + gravação
//    debounced via saveWidgetSettings (espelho do useWidgetAppearance).
//  - ColumnPanel: rótulo, tipo (livre/dimensão/métrica), campo/agregação,
//    formato de data, pivot e "quem pode editar" (papéis) + excluir coluna.
//  - RowPanel: excluir linha.
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { notifyOnError } from "@/lib/feedback/notify";
import { ROLE_LABELS, type RoleKey } from "@/lib/auth/roles";
import { DATE_TRANSFORMS, type AvailableField } from "@/lib/widgets/fields";
import {
  AGG_LABELS,
  TRANSFORM_LABELS,
  type Aggregation,
  type QuickTableColumn,
  type Transform,
  type Widget,
} from "@/lib/widgets/types";
import type { QuickTable } from "@/lib/widgets/quick-table/model";
import { sourceChips, toFieldOptions } from "@/lib/widgets/filter-ops";
import { useSourceLabels } from "@/components/source-labels-context";
import { saveWidgetSettings } from "@/app/(app)/dashboards/actions";
import { FloatingPanel } from "../appearance-editing";
import { MonthRangePicker } from "@/components/ui/month-range-picker";
import { useGoalMetrics } from "@/components/goal-metrics-context";
import {
  RealizedSourceEditor,
  type RealizedCatalog,
} from "@/components/indicators/realized-source-editor";
import { parseRealizedSource } from "@/lib/indicators/realized-source";
import { QT_GOAL_FACET_LABELS, type QTGoalRowData } from "@/lib/widgets/quick-table/goals";
import { listActiveResponsibleNames } from "@/app/(app)/dashboards/quick-table-actions";
import type { QuickTableGoalFacet, QuickTableRow } from "@/lib/widgets/types";

const ROLE_KEYS = Object.keys(ROLE_LABELS) as RoleKey[];

// -------- estado otimista + persistência da estrutura --------
// Igual ao useWidgetAppearance: aplica na hora, grava com debounce de 500ms o
// settings COMPLETO mesclado e recarrega as props do servidor em seguida.
export function useQuickTableConfig(widget: Widget, dashboardId: string) {
  const router = useRouter();
  const empty: QuickTable = { columns: [], rows: [] };
  const [qt, setQt] = useState<QuickTable>(
    widget.settings?.quickTable ?? empty
  );
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setQt(widget.settings?.quickTable ?? { columns: [], rows: [] });
  }, [widget.settings?.quickTable]);

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef<QuickTable>(qt);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    []
  );

  const save = useCallback(
    (next: QuickTable) => {
      setQt(next); // otimista imediato
      latest.current = next;
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        void notifyOnError(
          saveWidgetSettings(widget.id, dashboardId, {
            ...widget.settings,
            quickTable: latest.current,
          }),
          "Não foi possível salvar as colunas"
        ).then((res) => {
          if (res?.ok) router.refresh();
        });
      }, 500);
    },
    [widget.id, widget.settings, dashboardId, router]
  );

  return { qt, save };
}

// -------- painel de coluna --------

const KIND_OPTIONS: ComboboxOption[] = [
  { value: "free", label: "Livre (digitação)" },
  { value: "dimension", label: "Dimensão (dados do sistema)" },
  { value: "metric", label: "Métrica (agregação)" },
  // v1.1: metas.
  { value: "rowLabel", label: "Rótulo da linha" },
  { value: "goal", label: "Metas por mês (um mês por coluna)" },
  { value: "goalTotal", label: "Total dos meses" },
];

const FACET_OPTIONS: ComboboxOption[] = (
  Object.keys(QT_GOAL_FACET_LABELS) as QuickTableGoalFacet[]
).map((f) => ({ value: f, label: QT_GOAL_FACET_LABELS[f] }));

/** Patch que limpa a config que não se aplica ao tipo novo. */
function clearForKind(kind: QuickTableColumn["kind"]): Partial<QuickTableColumn> {
  const none = {
    field: undefined,
    metric: undefined,
    pivot: undefined,
    transform: undefined,
    weekMode: undefined,
    months: undefined,
    facet: undefined,
    of: undefined,
    editableRoles: undefined,
  };
  if (kind === "free") return { ...none, editableRoles: undefined };
  if (kind === "dimension") return { ...none, field: undefined };
  return none;
}

export function ColumnPanel({
  x,
  y,
  column,
  available,
  goalColumns = [],
  onChange,
  onDelete,
  onClose,
}: {
  x: number;
  y: number;
  column: QuickTableColumn;
  available: AvailableField[];
  /** v1.1: colunas "Metas por mês" da tabela (o total escolhe qual soma). */
  goalColumns?: QuickTableColumn[];
  // Patch mesclado na coluna (a troca de pivot é resolvida pelo chamador).
  onChange: (patch: Partial<QuickTableColumn>) => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  // Campos elegíveis: dimensão = qualquer coluna real do RPC; métrica =
  // numéricos + contagem de registros (mesmos recortes do builder), com o mesmo
  // formato de opção dos dropdowns do builder (fonte, chips, ƒ, tooltip).
  const sourceLabels = useSourceLabels();
  const fieldSourceChips = sourceChips(sourceLabels);
  const dimOptions: ComboboxOption[] = toFieldOptions(
    available.filter((f) => !f.displayOnly && !f.aggCalc),
    sourceLabels
  );
  const metricFieldOptions: ComboboxOption[] = [
    { value: "*", label: "Contagem de registros" },
    ...toFieldOptions(
      available.filter((f) => f.isNumeric && !f.aggCalc),
      sourceLabels
    ),
  ];
  const aggOptions: ComboboxOption[] = (
    Object.keys(AGG_LABELS) as Aggregation[]
  ).map((a) => ({ value: a, label: AGG_LABELS[a] }));
  const transformOptions: ComboboxOption[] = DATE_TRANSFORMS.map((t) => ({
    value: t,
    label: TRANSFORM_LABELS[t],
  }));
  const isDateDim =
    column.kind === "dimension" &&
    (available.find((a) => a.field === column.field)?.isDate ?? false);

  // Papéis: ausente = todos podem editar. O toggle "Restringir" materializa a
  // lista; sem papéis marcados = ninguém edita (só admin).
  const restricted = column.editableRoles != null;

  return (
    <FloatingPanel x={x} y={y} onClose={onClose} className="w-72">
      <div className="flex flex-col gap-3 p-1">
        <div className="flex flex-col gap-1.5">
          <Label className="text-xs">Rótulo do cabeçalho</Label>
          <Input
            className="h-8 text-sm"
            value={column.header ?? ""}
            onChange={(e) => onChange({ header: e.target.value })}
            placeholder={column.kind === "free" ? "Ex.: Observações" : "Padrão"}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label className="text-xs">Tipo da coluna</Label>
          <Combobox
            searchable={false}
            options={KIND_OPTIONS}
            value={column.kind}
            onValueChange={(v) => {
              const kind = v as QuickTableColumn["kind"];
              // Troca de tipo limpa a config que não se aplica (a dimensão
              // conserva o campo — o comportamento de sempre).
              const patch = clearForKind(kind);
              if (kind === "dimension") delete patch.field;
              if (kind === "free") delete patch.editableRoles;
              onChange({ kind, ...patch });
            }}
            aria-label="Tipo da coluna"
          />
        </div>

        {column.kind === "dimension" ? (
          <>
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs">Campo (dimensão)</Label>
              <Combobox
                options={dimOptions}
                chips={fieldSourceChips}
                value={column.field ?? ""}
                placeholder="— campo —"
                onValueChange={(field) =>
                  onChange({ field, transform: undefined, weekMode: undefined })
                }
                aria-label="Campo da dimensão"
              />
            </div>
            {isDateDim ? (
              <div className="flex flex-col gap-1.5">
                <Label className="text-xs">Formato da data</Label>
                <Combobox
                  searchable={false}
                  options={transformOptions}
                  value={column.transform ?? "none"}
                  onValueChange={(t) =>
                    onChange({
                      transform: t === "none" ? undefined : (t as Transform),
                      weekMode:
                        t === "week_month"
                          ? (column.weekMode ?? "restricted")
                          : undefined,
                    })
                  }
                  aria-label="Formato da data"
                />
              </div>
            ) : null}
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={column.pivot === true}
                onCheckedChange={(v) => onChange({ pivot: v === true })}
              />
              Expandir valores em colunas (pivot)
            </label>
            <p className="text-muted-foreground text-xs">
              Sem pivot, cada valor da dimensão vira uma LINHA; com pivot, os
              valores viram COLUNAS (uma por métrica).
            </p>
          </>
        ) : null}

        {column.kind === "metric" ? (
          <div className="flex items-end gap-1.5">
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              <Label className="text-xs">Métrica</Label>
              <Combobox
                options={metricFieldOptions}
                chips={fieldSourceChips}
                value={column.metric?.field ?? ""}
                placeholder="— campo —"
                onValueChange={(field) =>
                  onChange({
                    metric: {
                      field,
                      agg:
                        field === "*" ? "count" : (column.metric?.agg ?? "sum"),
                    },
                  })
                }
                aria-label="Campo da métrica"
              />
            </div>
            {column.metric?.field && column.metric.field !== "*" ? (
              <Combobox
                className="w-28 shrink-0"
                searchable={false}
                options={aggOptions}
                value={column.metric.agg}
                onValueChange={(agg) =>
                  onChange({
                    metric: { ...column.metric!, agg: agg as Aggregation },
                  })
                }
                aria-label="Agregação"
              />
            ) : null}
          </div>
        ) : null}

        {/* v1.1: metas. */}
        {column.kind === "rowLabel" ? (
          <p className="text-muted-foreground text-xs">
            Mostra o rótulo de cada linha (configurado no ⚙ da linha). Linha
            ligada a indicador sem rótulo usa o nome do indicador.
          </p>
        ) : null}
        {column.kind === "goal" ? (
          <>
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs">Meses</Label>
              <MonthRangePicker
                value={column.months ?? []}
                onChange={(months) => onChange({ months: months.length > 0 ? months : undefined })}
                ariaLabel="Meses da coluna de metas"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs">A célula mostra</Label>
              <Combobox
                searchable={false}
                options={FACET_OPTIONS}
                value={column.facet ?? "composto"}
                onValueChange={(f) =>
                  onChange({ facet: f === "composto" ? undefined : (f as QuickTableGoalFacet) })
                }
                aria-label="O que a célula de meta mostra"
              />
            </div>
            <p className="text-muted-foreground text-xs">
              Meta: as metas mensais do indicador da linha (Configurações →
              Metas). Realizado: a fórmula do indicador ou a métrica própria da
              linha. Uma coluna por mês.
            </p>
          </>
        ) : null}
        {column.kind === "goalTotal" ? (
          <>
            {goalColumns.length > 1 ? (
              <div className="flex flex-col gap-1.5">
                <Label className="text-xs">Soma os meses de</Label>
                <Combobox
                  searchable={false}
                  options={goalColumns.map((g, i) => ({
                    value: g.id,
                    label: g.header?.trim() || `Metas por mês ${i + 1}`,
                  }))}
                  value={column.of ?? goalColumns[0]?.id ?? ""}
                  onValueChange={(of) => onChange({ of })}
                  aria-label="Coluna de metas somada"
                />
              </div>
            ) : null}
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs">A célula mostra</Label>
              <Combobox
                searchable={false}
                options={FACET_OPTIONS}
                value={column.facet ?? "composto"}
                onValueChange={(f) =>
                  onChange({ facet: f === "composto" ? undefined : (f as QuickTableGoalFacet) })
                }
                aria-label="O que a célula de total mostra"
              />
            </div>
            <p className="text-muted-foreground text-xs">
              Total pela regra do indicador (soma, último mês ou média).
            </p>
          </>
        ) : null}

        {column.kind === "free" ? (
          <div className="flex flex-col gap-1.5 border-t pt-2">
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={restricted}
                onCheckedChange={(v) =>
                  onChange({ editableRoles: v === true ? [] : undefined })
                }
              />
              Restringir quem pode editar
            </label>
            {restricted ? (
              <div className="flex flex-wrap gap-3 pl-6">
                {ROLE_KEYS.map((role) => (
                  <label
                    key={role}
                    className="flex items-center gap-2 text-sm"
                  >
                    <Checkbox
                      checked={column.editableRoles?.includes(role) ?? false}
                      onCheckedChange={(v) => {
                        const cur = column.editableRoles ?? [];
                        onChange({
                          editableRoles:
                            v === true
                              ? [...cur, role]
                              : cur.filter((r) => r !== role),
                        });
                      }}
                    />
                    {ROLE_LABELS[role]}
                  </label>
                ))}
              </div>
            ) : null}
            {restricted ? (
              <p className="text-muted-foreground text-xs">
                Sem papéis marcados, ninguém edita (admins sempre podem).
              </p>
            ) : null}
          </div>
        ) : null}

        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="text-destructive hover:text-destructive justify-start"
          onClick={onDelete}
        >
          <Trash2 className="size-4" /> Excluir coluna
        </Button>
      </div>
    </FloatingPanel>
  );
}

// -------- painel de linha --------

const NONE = "__nenhum__";

/** v1.1: responsáveis cadastrados (carregados ao abrir o painel). */
function useResponsibleNames(): string[] | null {
  const [names, setNames] = useState<string[] | null>(null);
  useEffect(() => {
    let alive = true;
    listActiveResponsibleNames()
      .then((n) => {
        if (alive) setNames(n);
      })
      .catch(() => {
        if (alive) setNames([]);
      });
    return () => {
      alive = false;
    };
  }, []);
  return names;
}

export function RowPanel({
  x,
  y,
  row,
  goalData,
  realizedCatalog,
  onChange,
  onAddRows,
  onDelete,
  onClose,
}: {
  x: number;
  y: number;
  /** v1.1: a linha (ausente = linha de dados BI — só excluir não se aplica). */
  row?: QuickTableRow;
  /** v1.1: o que o servidor resolveu para a linha (rótulo/fórmula do indicador). */
  goalData?: QTGoalRowData;
  realizedCatalog?: RealizedCatalog | null;
  onChange?: (patch: Partial<QuickTableRow>) => void;
  /** v1.1: "Repetir para responsáveis" — linhas novas logo abaixo. */
  onAddRows?: (rows: QuickTableRow[]) => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const metrics = useGoalMetrics();
  const names = useResponsibleNames();
  const [repeatOpen, setRepeatOpen] = useState(false);
  const [repeatPick, setRepeatPick] = useState<Set<string>>(() => new Set());
  const indicatorOptions: ComboboxOption[] = useMemo(
    () => metrics.map((m) => ({ value: m.key, label: m.label })),
    [metrics]
  );
  const respOptions: ComboboxOption[] = useMemo(
    () => [
      { value: NONE, label: "Global (sem responsável)" },
      ...(names ?? []).map((n) => ({ value: n, label: n })),
      // Nome gravado que não está mais na lista segue visível.
      ...(row?.bind?.kind === "indicator" &&
      row.bind.responsible &&
      names &&
      !names.includes(row.bind.responsible)
        ? [{ value: row.bind.responsible, label: `${row.bind.responsible} (não cadastrado)` }]
        : []),
    ],
    [names, row]
  );
  if (!row || !onChange) {
    return (
      <FloatingPanel x={x} y={y} onClose={onClose} className="w-44">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="text-destructive hover:text-destructive w-full justify-start"
          onClick={onDelete}
        >
          <Trash2 className="size-4" /> Excluir linha
        </Button>
      </FloatingPanel>
    );
  }
  const bindKind = row.bind?.kind ?? "none";
  const ind = row.bind?.kind === "indicator" ? row.bind : null;
  const indicatorLabel =
    (ind && metrics.find((m) => m.key === ind.indicator)?.label) ?? goalData?.defaultLabel ?? null;
  return (
    <FloatingPanel x={x} y={y} onClose={onClose} className="max-h-[75vh] w-80 overflow-y-auto">
      <div className="flex flex-col gap-3 p-1">
        <div className="flex flex-col gap-1.5">
          <Label className="text-xs">Rótulo</Label>
          <Input
            className="h-8 text-sm"
            value={row.label ?? ""}
            onChange={(e) => onChange({ label: e.target.value || undefined })}
            placeholder={indicatorLabel ?? "Texto da coluna “Rótulo da linha”"}
          />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs">Etiqueta</Label>
            <Input
              className="h-8 text-sm"
              value={row.tag ?? ""}
              maxLength={24}
              onChange={(e) => onChange({ tag: e.target.value.trim() ? e.target.value : undefined })}
              placeholder="ex.: N1"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs">Unidade no rótulo</Label>
            <Combobox
              searchable={false}
              options={[
                { value: "auto", label: "Automática" },
                { value: "show", label: "Mostrar" },
                { value: "hide", label: "Ocultar" },
              ]}
              value={row.unit ?? "auto"}
              onValueChange={(v) => onChange({ unit: v === "auto" ? undefined : (v as "show" | "hide") })}
              aria-label="Unidade no rótulo"
            />
          </div>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <Checkbox
            checked={row.bold === true}
            onCheckedChange={(v) => onChange({ bold: v === true ? true : undefined })}
          />
          Negrito (num board com estilo, vira a linha de conclusão)
        </label>

        <div className="flex flex-col gap-1.5 border-t pt-2">
          <Label className="text-xs">Esta linha</Label>
          <Combobox
            searchable={false}
            options={[
              { value: "none", label: "Livre (sem metas)" },
              { value: "indicator", label: "Ligada a um indicador (metas por mês)" },
              { value: "total", label: "Total das linhas ligadas acima" },
            ]}
            value={bindKind}
            onValueChange={(v) =>
              onChange({
                bind:
                  v === "indicator"
                    ? { kind: "indicator", indicator: ind?.indicator ?? metrics[0]?.key ?? "" }
                    : v === "total"
                      ? { kind: "total" }
                      : undefined,
              })
            }
            aria-label="Vínculo da linha"
          />
        </div>
        {ind ? (
          <>
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs">Indicador</Label>
              <Combobox
                options={indicatorOptions}
                value={ind.indicator}
                onValueChange={(k) => onChange({ bind: { ...ind, indicator: k } })}
                placeholder="— indicador —"
                aria-label="Indicador da linha"
              />
              <a
                href="/configuracoes/metas"
                target="_blank"
                rel="noreferrer"
                className="text-primary self-start text-xs underline-offset-2 hover:underline"
              >
                Criar/editar indicadores e metas
              </a>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs">Responsável</Label>
              <Combobox
                options={respOptions}
                value={ind.responsible ?? NONE}
                onValueChange={(v) =>
                  onChange({ bind: { ...ind, responsible: v === NONE ? undefined : v } })
                }
                placeholder={names ? "Global" : "Carregando…"}
                aria-label="Responsável da linha"
              />
              <p className="text-muted-foreground text-xs">
                Com responsável, a meta é a dele e o realizado é recortado por
                ele. Sem responsável, as metas globais.
              </p>
            </div>
            {realizedCatalog ? (
              <div className="flex flex-col gap-1.5 border-t pt-2">
                <Label className="text-xs">Realizado — de onde vem</Label>
                <RealizedSourceEditor
                  catalog={realizedCatalog}
                  value={parseRealizedSource(ind.realized)}
                  onChange={(rs) => onChange({ bind: { ...ind, realized: rs ?? undefined } })}
                  indicatorLabel={indicatorLabel}
                  indicatorFormula={goalData?.formulaText ?? null}
                />
              </div>
            ) : null}
            {onAddRows ? (
              <div className="flex flex-col gap-1.5 border-t pt-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setRepeatOpen((o) => !o)}
                >
                  Repetir para responsáveis…
                </Button>
                {repeatOpen ? (
                  <>
                    <div className="flex max-h-48 flex-col gap-1 overflow-y-auto">
                      {(names ?? []).map((n) => (
                        <label key={n} className="flex items-center gap-2 text-sm">
                          <Checkbox
                            checked={repeatPick.has(n)}
                            onCheckedChange={(v) =>
                              setRepeatPick((prev) => {
                                const next = new Set(prev);
                                if (v === true) next.add(n);
                                else next.delete(n);
                                return next;
                              })
                            }
                          />
                          {n}
                        </label>
                      ))}
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      disabled={repeatPick.size === 0}
                      onClick={() => {
                        onAddRows(
                          [...repeatPick].map((n) => ({
                            id: `qr_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
                            label: n,
                            bind: { kind: "indicator", indicator: ind.indicator, responsible: n },
                          }))
                        );
                        setRepeatPick(new Set());
                        setRepeatOpen(false);
                      }}
                    >
                      Adicionar {repeatPick.size} linha(s) abaixo
                    </Button>
                  </>
                ) : null}
              </div>
            ) : null}
          </>
        ) : null}
        {bindKind === "total" ? (
          <p className="text-muted-foreground text-xs">
            Soma as METAS das linhas ligadas acima desta, mês a mês.
          </p>
        ) : null}

      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="text-destructive hover:text-destructive w-full justify-start"
        onClick={onDelete}
      >
        <Trash2 className="size-4" /> Excluir linha
      </Button>
      </div>
    </FloatingPanel>
  );
}
