// Versão: 1.0 | Data: 28/07/2026
// Popover "Métricas" da página dedicada/cheia de kanban (modo registros):
// métrica do cabeçalho da coluna com agregação escolhível + até 3 indicadores
// (badges) do card — MESMAS opções do builder do widget (kanbanMetricOptions;
// catálogo via useSources, com fallback builtin). Persistência via
// `onSave(nextKanban)` com spread completo no chamador (padrão
// ColumnConfigPopover — updateBoardSettings/saveWidgetSettings preservam o
// resto do settings). Quadro legado sem badges configurados segue legado se o
// usuário não tocar nos slots (não converte à toa).
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Gauge } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import { useSources } from "@/components/sources-context";
import type { FieldDefinition } from "@/lib/records/types";
import { AGG_LABELS, type Aggregation } from "@/lib/widgets/types";
import {
  defaultAggFor,
  encodeMetricSpec,
  kanbanMetricOptions,
  normalizeKanbanMetrics,
  parseMetricSpec,
} from "@/lib/kanban/metrics";
import {
  KANBAN_MAX_BADGES,
  type KanbanAgg,
  type KanbanMetricSpec,
  type KanbanSettings,
} from "@/lib/kanban/types";

const AGG_OPTIONS: ComboboxOption[] = (
  Object.keys(AGG_LABELS) as Aggregation[]
).map((a) => ({ value: a, label: AGG_LABELS[a] }));

export function MetricsPopover({
  kanban,
  fields,
  onSave,
}: {
  kanban: KanbanSettings;
  fields: FieldDefinition[];
  // Persiste settings.kanban inteiro (o chamador faz o spread do resto).
  onSave: (next: KanbanSettings) => Promise<{ ok?: boolean; message?: string }>;
}) {
  const router = useRouter();
  const catalog = useSources();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [headerValue, setHeaderValue] = useState("");
  const [agg, setAgg] = useState<KanbanAgg>("sum");
  const [badges, setBadges] = useState<string[]>([]);

  const opts = kanbanMetricOptions(fields, kanban.source, catalog);
  const headerOptions: ComboboxOption[] = [
    { value: "", label: "— nenhuma —" },
    ...opts.fields,
    ...opts.indicators,
  ];
  const badgeOptions: ComboboxOption[] = [
    { value: "", label: "—" },
    ...opts.indicators,
    ...opts.fields,
  ];

  function init() {
    const n = normalizeKanbanMetrics(kanban);
    setHeaderValue(n.columnMetric ? encodeMetricSpec(n.columnMetric.spec) : "");
    setAgg(n.columnMetric?.agg ?? "sum");
    setBadges(
      Array.from({ length: KANBAN_MAX_BADGES }, (_, i) => {
        const s = n.badges[i];
        return s ? encodeMetricSpec(s) : "";
      })
    );
    setMessage(null);
  }

  async function save() {
    setSaving(true);
    setMessage(null);
    const spec = headerValue ? parseMetricSpec(headerValue) : null;
    const badgeSpecs = badges
      .map((v) => (v ? parseMetricSpec(v) : null))
      .filter((s): s is KanbanMetricSpec => s != null)
      .slice(0, KANBAN_MAX_BADGES);
    // Legado intocado segue legado: sem badges configurados E slots iguais ao
    // default (só tarefas abertas), a chave não é gravada.
    const defaultBadges: KanbanMetricSpec[] = [
      { kind: "tasks", metric: "open" },
    ];
    const keepLegacyBadges =
      kanban.card?.badges === undefined &&
      JSON.stringify(badgeSpecs) === JSON.stringify(defaultBadges);
    const res = await onSave({
      ...kanban,
      columnMetric: spec ? { spec, agg } : undefined,
      metric: undefined,
      card: {
        ...kanban.card,
        ...(keepLegacyBadges ? {} : { badges: badgeSpecs }),
      },
    });
    setSaving(false);
    if (!res.ok) {
      setMessage(res.message ?? "Falha ao salvar.");
      return;
    }
    setOpen(false);
    router.refresh();
  }

  const headerSpec = headerValue ? parseMetricSpec(headerValue) : null;

  return (
    <Popover
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (v) init();
      }}
    >
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm">
          <Gauge className="size-4" />
          Métricas
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80">
        <div className="flex flex-col gap-3">
          <p className="text-sm font-medium">Métricas do quadro</p>
          <div className="flex flex-col gap-1.5">
            <Label>Métrica no cabeçalho da coluna</Label>
            <Combobox
              options={headerOptions}
              value={headerValue}
              onValueChange={(v) => {
                setHeaderValue(v);
                const s = v ? parseMetricSpec(v) : null;
                if (s) setAgg(defaultAggFor(s));
              }}
              className="w-full"
              aria-label="Métrica no cabeçalho"
            />
            {headerSpec ? (
              <Combobox
                searchable={false}
                options={AGG_OPTIONS}
                value={agg}
                onValueChange={(v) => setAgg(v as KanbanAgg)}
                className="w-full"
                aria-label="Agregação da métrica"
              />
            ) : null}
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Indicadores do card (até {KANBAN_MAX_BADGES})</Label>
            {badges.map((v, i) => (
              <Combobox
                key={i}
                options={badgeOptions}
                value={v}
                onValueChange={(next) =>
                  setBadges((bs) => bs.map((b, j) => (j === i ? next : b)))
                }
                className="w-full"
                aria-label={`Indicador do card ${i + 1}`}
              />
            ))}
            <p className="text-muted-foreground text-xs">
              Badges no rodapé do card — ex.: “Leads vinculados” (registros
              conectados), tarefas abertas/atrasadas ou idade em dias.
            </p>
          </div>
          {message ? (
            <p className="text-destructive text-sm">{message}</p>
          ) : null}
          <Button size="sm" onClick={save} disabled={saving}>
            {saving ? "Salvando..." : "Salvar métricas"}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
