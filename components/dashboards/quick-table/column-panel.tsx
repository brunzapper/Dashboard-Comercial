// Versão: 1.0 | Data: 15/07/2026
// Tabela rápida — painéis flutuantes de estrutura (modo Editar layout):
//  - useQuickTableConfig: estado otimista de settings.quickTable + gravação
//    debounced via saveWidgetSettings (espelho do useWidgetAppearance).
//  - ColumnPanel: rótulo, tipo (livre/dimensão/métrica), campo/agregação,
//    formato de data, pivot e "quem pode editar" (papéis) + excluir coluna.
//  - RowPanel: excluir linha.
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { saveWidgetSettings } from "@/app/(app)/dashboards/actions";
import { FloatingPanel } from "../appearance-editing";

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
        void saveWidgetSettings(widget.id, dashboardId, {
          ...widget.settings,
          quickTable: latest.current,
        }).then(() => router.refresh());
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
];

export function ColumnPanel({
  x,
  y,
  column,
  available,
  onChange,
  onDelete,
  onClose,
}: {
  x: number;
  y: number;
  column: QuickTableColumn;
  available: AvailableField[];
  // Patch mesclado na coluna (a troca de pivot é resolvida pelo chamador).
  onChange: (patch: Partial<QuickTableColumn>) => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  // Campos elegíveis: dimensão = qualquer coluna real do RPC; métrica =
  // numéricos + contagem de registros (mesmos recortes do builder).
  const dimOptions: ComboboxOption[] = available
    .filter((f) => !f.displayOnly && !f.aggCalc)
    .map((f) => ({ value: f.field, label: f.label }));
  const metricFieldOptions: ComboboxOption[] = [
    { value: "*", label: "Contagem de registros" },
    ...available
      .filter((f) => f.isNumeric && !f.aggCalc)
      .map((f) => ({ value: f.field, label: f.label })),
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
            onValueChange={(v) =>
              onChange({
                kind: v as QuickTableColumn["kind"],
                // Troca de tipo limpa a config que não se aplica.
                ...(v === "free"
                  ? { field: undefined, metric: undefined, pivot: undefined, transform: undefined, weekMode: undefined }
                  : v === "dimension"
                    ? { metric: undefined }
                    : { field: undefined, pivot: undefined, transform: undefined, weekMode: undefined }),
              })
            }
            aria-label="Tipo da coluna"
          />
        </div>

        {column.kind === "dimension" ? (
          <>
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs">Campo (dimensão)</Label>
              <Combobox
                options={dimOptions}
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

export function RowPanel({
  x,
  y,
  onDelete,
  onClose,
}: {
  x: number;
  y: number;
  onDelete: () => void;
  onClose: () => void;
}) {
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
