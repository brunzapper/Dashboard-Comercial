// Versão: 1.0 | Data: 01/10/2026
// Seção do construtor para a TABELA DE METAS (visual_type 'metas', 0149).
// Arquivo próprio (precedente card-mode-section) para não inflar o
// widget-builder. Controlado: o builder guarda o rascunho e grava
// `settings.goalTable` no save, depois de passar pela MESMA régua
// (`sanitizeGoalTableSettings`) que o servidor e o import da IA usam.
"use client";

import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Combobox } from "@/components/ui/combobox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useGoalMetrics } from "@/components/goal-metrics-context";
import {
  GOAL_TABLE_MODE_LABELS,
  MAX_GOAL_TABLE_ROWS,
} from "@/lib/widgets/goal-table";
import type { GoalTableSettings } from "@/lib/widgets/types";

export function GoalTableSection({
  value,
  onChange,
}: {
  value: GoalTableSettings;
  onChange: (v: GoalTableSettings) => void;
}) {
  const metrics = useGoalMetrics();
  const metricOptions = metrics.map((m) => ({ value: m.key, label: m.label }));
  const mode = value.mode ?? "indicadores";
  const rows = value.rows ?? [];
  const patch = (p: Partial<GoalTableSettings>) => onChange({ ...value, ...p });
  const patchRow = (i: number, p: Partial<(typeof rows)[number]>) =>
    patch({ rows: rows.map((r, ri) => (ri === i ? { ...r, ...p } : r)) });
  const move = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= rows.length) return;
    const next = [...rows];
    [next[i], next[j]] = [next[j], next[i]];
    patch({ rows: next });
  };

  return (
    <div className="flex flex-col gap-3 rounded-md border p-3">
      <p className="text-muted-foreground text-xs">
        As metas vêm de Configurações → Metas e o realizado da fórmula de cada
        indicador (aba Indicadores). As colunas são os meses do período do
        dashboard — ou meses fixos, abaixo.
      </p>
      <div className="flex flex-col gap-1.5">
        <Label>Formato</Label>
        <Combobox
          options={Object.entries(GOAL_TABLE_MODE_LABELS).map(([v, l]) => ({
            value: v,
            label: l,
          }))}
          value={mode}
          onValueChange={(v) => patch({ mode: v as GoalTableSettings["mode"] })}
          searchable={false}
          aria-label="Formato da tabela de metas"
        />
      </div>

      {mode === "indicadores" ? (
        <div className="flex flex-col gap-2">
          <Label>Linhas</Label>
          {rows.map((r, i) => (
            <div key={i} className="flex flex-col gap-1.5 rounded-md border p-2">
              <div className="flex items-center gap-1">
                <Combobox
                  className="flex-1"
                  options={metricOptions}
                  value={r.indicator}
                  onValueChange={(v) => patchRow(i, { indicator: v })}
                  aria-label={`Indicador da linha ${i + 1}`}
                />
                <Button size="icon" variant="ghost" aria-label="Subir" onClick={() => move(i, -1)}>
                  <ArrowUp className="size-4" />
                </Button>
                <Button size="icon" variant="ghost" aria-label="Descer" onClick={() => move(i, 1)}>
                  <ArrowDown className="size-4" />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label="Remover linha"
                  onClick={() => patch({ rows: rows.filter((_, ri) => ri !== i) })}
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
              <div className="grid gap-1.5 sm:grid-cols-2">
                <Input
                  value={r.label ?? ""}
                  placeholder="Rótulo (opcional)"
                  onChange={(e) => patchRow(i, { label: e.target.value || undefined })}
                />
                <Input
                  value={r.responsible ?? ""}
                  placeholder="Responsável (opcional, nome)"
                  onChange={(e) => patchRow(i, { responsible: e.target.value || undefined })}
                />
              </div>
              <label className="flex items-center gap-2 text-xs">
                <Checkbox
                  checked={r.bold === true}
                  onCheckedChange={(v) => patchRow(i, { bold: v === true || undefined })}
                />
                Destacar (negrito)
              </label>
            </div>
          ))}
          <div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={rows.length >= MAX_GOAL_TABLE_ROWS || metricOptions.length === 0}
              onClick={() =>
                patch({ rows: [...rows, { indicator: metricOptions[0]?.value ?? "" }] })
              }
            >
              <Plus className="size-4" /> Adicionar indicador
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <Label>Indicador</Label>
          <Combobox
            options={metricOptions}
            value={value.indicator ?? ""}
            onValueChange={(v) => patch({ indicator: v })}
            aria-label="Indicador repartido"
          />
          <Label>Responsáveis (um por linha, pelo nome)</Label>
          <Textarea
            rows={5}
            value={(value.responsibles ?? []).join("\n")}
            onChange={(e) =>
              patch({
                responsibles: e.target.value
                  .split("\n")
                  .map((s) => s.trim())
                  .filter(Boolean),
              })
            }
          />
          <Label>Linha de total (opcional)</Label>
          <Input
            value={value.totalRowLabel ?? ""}
            placeholder="ex.: Compromissos individuais"
            onChange={(e) => patch({ totalRowLabel: e.target.value || undefined })}
          />
        </div>
      )}

      <div className="flex flex-col gap-1.5">
        <Label>Meses fixos (opcional, AAAA-MM separados por vírgula)</Label>
        <Input
          value={(value.months ?? []).join(", ")}
          placeholder="vazio = meses do período do dashboard"
          onChange={(e) =>
            patch({
              months: e.target.value
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean),
            })
          }
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label>Título da primeira coluna</Label>
        <Input
          value={value.headerLabel ?? ""}
          placeholder={mode === "por_responsavel" ? "Responsável" : "Indicador"}
          onChange={(e) => patch({ headerLabel: e.target.value || undefined })}
        />
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-2">
        {(
          [
            ["showRealized", "Mostrar realizado", true],
            ["showAttainment", "Mostrar atingimento (%)", true],
            ["totalColumn", "Coluna de total", true],
            ["editable", "Admin edita a meta na célula", false],
          ] as const
        ).map(([key, label, dflt]) => (
          <label key={key} className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={(value[key] ?? dflt) === true}
              onCheckedChange={(v) => patch({ [key]: v === true })}
            />
            {label}
          </label>
        ))}
      </div>
      <div className="flex flex-col gap-1.5">
        <Label>Rodapé (regra de cálculo, donos)</Label>
        <Textarea
          rows={2}
          value={value.note ?? ""}
          onChange={(e) => patch({ note: e.target.value || undefined })}
        />
      </div>
    </div>
  );
}
