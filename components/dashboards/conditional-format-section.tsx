"use client";
// Versão: 1.0 | Data: 17/07/2026
// Seção "Formatação condicional" do sheet de Aparência
// (appearance.conditional): regras valor→estilo e escalas de cor contínuas
// (heatmap), avaliadas por lib/widgets/conditional.ts. Arquivo próprio para
// não inflar o widget-appearance-sheet.
import { Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { ComboboxOption } from "@/components/ui/combobox";
import { BuilderSection } from "@/components/dashboards/widget-builder-rows";
import { ColorField } from "@/components/dashboards/appearance-controls";
import {
  COND_OP_LABELS,
  type ColorScale,
  type CondOp,
  type ConditionalFormatting,
  type ConditionalRule,
} from "@/lib/widgets/types";

const newId = (prefix: string) =>
  `${prefix}_${Math.random().toString(36).slice(2, 9)}`;

const OPS = Object.keys(COND_OP_LABELS) as CondOp[];
const NEEDS_VALUE = new Set<CondOp>([
  "gt",
  "gte",
  "lt",
  "lte",
  "eq",
  "neq",
  "between",
  "contains",
]);

const ICON_OPTIONS: { value: string; label: string }[] = [
  { value: "none", label: "— sem ícone —" },
  { value: "up", label: "▲ seta p/ cima" },
  { value: "down", label: "▼ seta p/ baixo" },
  { value: "dot", label: "● ponto" },
  { value: "warn", label: "⚠ alerta" },
];

export function ConditionalFormatSection({
  value,
  onChange,
  targets,
  numericTargets,
  hasComparison,
}: {
  value: ConditionalFormatting | undefined;
  onChange: (v: ConditionalFormatting | undefined) => void;
  /** Alvos possíveis de regra (colunas/métricas/"value"). */
  targets: ComboboxOption[];
  /** Alvos numéricos (escala de cor). */
  numericTargets: ComboboxOption[];
  /** Comparação habilitada no widget (mostra var_up/var_down). */
  hasComparison?: boolean;
}) {
  const rules = value?.rules ?? [];
  const scales = value?.scales ?? [];
  const commit = (next: ConditionalFormatting) => {
    const clean: ConditionalFormatting = {};
    if (next.rules && next.rules.length > 0) clean.rules = next.rules;
    if (next.scales && next.scales.length > 0) clean.scales = next.scales;
    onChange(clean.rules || clean.scales ? clean : undefined);
  };
  const patchRule = (id: string, p: Partial<ConditionalRule>) =>
    commit({
      ...value,
      rules: rules.map((r) => (r.id === id ? { ...r, ...p } : r)),
    });
  const patchScale = (id: string, p: Partial<ColorScale>) =>
    commit({
      ...value,
      scales: scales.map((s) => (s.id === id ? { ...s, ...p } : s)),
    });
  const ops = OPS.filter(
    (o) => hasComparison || (o !== "var_up" && o !== "var_down")
  );
  const count = rules.length + scales.length;

  return (
    <BuilderSection
      value="condicional"
      title="Formatação condicional"
      badge={count > 0 ? String(count) : null}
    >
      <p className="text-muted-foreground text-xs">
        Regras pintam o valor quando a condição casa (a primeira que casar
        vence; cor manual de célula tem precedência). A escala de cor pinta o
        fundo do menor ao maior valor da coluna.
      </p>

      <div className="flex items-center justify-between">
        <Label>Regras</Label>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() =>
            commit({
              ...value,
              rules: [
                ...rules,
                {
                  id: newId("cr"),
                  target: String(targets[0]?.value ?? ""),
                  op: "gt",
                  style: { text: "#16a34a" },
                },
              ],
            })
          }
        >
          + Adicionar regra
        </Button>
      </div>
      {rules.map((r) => (
        <div key={r.id} className="flex flex-col gap-2 rounded-md border p-2.5">
          <div className="grid grid-cols-2 gap-2">
            <Select
              value={r.target}
              onValueChange={(v) => patchRule(r.id, { target: v })}
            >
              <SelectTrigger aria-label="Alvo da regra">
                <SelectValue placeholder="Coluna/valor" />
              </SelectTrigger>
              <SelectContent>
                {targets.map((t) => (
                  <SelectItem key={String(t.value)} value={String(t.value)}>
                    {t.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={r.op}
              onValueChange={(v) => patchRule(r.id, { op: v as CondOp })}
            >
              <SelectTrigger aria-label="Operador">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ops.map((o) => (
                  <SelectItem key={o} value={o}>
                    {COND_OP_LABELS[o]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {NEEDS_VALUE.has(r.op) ? (
            <div className="grid grid-cols-2 gap-2">
              <Input
                value={String(r.value ?? "")}
                onChange={(e) =>
                  patchRule(r.id, { value: e.target.value || undefined })
                }
                placeholder="Valor"
              />
              {r.op === "between" ? (
                <Input
                  value={String(r.value2 ?? "")}
                  onChange={(e) =>
                    patchRule(r.id, { value2: e.target.value || undefined })
                  }
                  placeholder="até"
                />
              ) : null}
            </div>
          ) : null}
          <div className="grid grid-cols-2 gap-2">
            <ColorField
              label="Texto"
              value={r.style.text}
              onChange={(v) => patchRule(r.id, { style: { ...r.style, text: v } })}
              onClear={() =>
                patchRule(r.id, { style: { ...r.style, text: undefined } })
              }
            />
            <ColorField
              label="Fundo"
              value={r.style.fill}
              onChange={(v) => patchRule(r.id, { style: { ...r.style, fill: v } })}
              onClear={() =>
                patchRule(r.id, { style: { ...r.style, fill: undefined } })
              }
            />
          </div>
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={r.style.bold ?? false}
                onCheckedChange={(v) =>
                  patchRule(r.id, {
                    style: { ...r.style, bold: v === true || undefined },
                  })
                }
              />
              Negrito
            </label>
            <Select
              value={r.style.icon ?? "none"}
              onValueChange={(v) =>
                patchRule(r.id, {
                  style: {
                    ...r.style,
                    icon:
                      v === "none"
                        ? undefined
                        : (v as ConditionalRule["style"]["icon"]),
                  },
                })
              }
            >
              <SelectTrigger className="h-8 flex-1" aria-label="Ícone">
                <SelectValue placeholder="Ícone" />
              </SelectTrigger>
              <SelectContent>
                {ICON_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Remover regra"
              onClick={() =>
                commit({ ...value, rules: rules.filter((x) => x.id !== r.id) })
              }
            >
              <Trash2 className="size-4" />
            </Button>
          </div>
        </div>
      ))}

      <div className="flex items-center justify-between">
        <Label>Escalas de cor (heatmap)</Label>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={numericTargets.length === 0}
          onClick={() =>
            commit({
              ...value,
              scales: [
                ...scales,
                {
                  id: newId("cs"),
                  target: String(numericTargets[0]?.value ?? ""),
                  min: "#fee2e2",
                  max: "#dcfce7",
                },
              ],
            })
          }
        >
          + Adicionar escala
        </Button>
      </div>
      {scales.map((s) => (
        <div key={s.id} className="flex flex-col gap-2 rounded-md border p-2.5">
          <div className="flex items-center gap-2">
            <Select
              value={s.target}
              onValueChange={(v) => patchScale(s.id, { target: v })}
            >
              <SelectTrigger className="flex-1" aria-label="Coluna da escala">
                <SelectValue placeholder="Coluna" />
              </SelectTrigger>
              <SelectContent>
                {numericTargets.map((t) => (
                  <SelectItem key={String(t.value)} value={String(t.value)}>
                    {t.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Remover escala"
              onClick={() =>
                commit({
                  ...value,
                  scales: scales.filter((x) => x.id !== s.id),
                })
              }
            >
              <Trash2 className="size-4" />
            </Button>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <ColorField
              label="Menor"
              value={s.min}
              onChange={(v) => patchScale(s.id, { min: v })}
            />
            <ColorField
              label="Meio (opcional)"
              value={s.mid}
              onChange={(v) => patchScale(s.id, { mid: v })}
              onClear={() => patchScale(s.id, { mid: undefined })}
            />
            <ColorField
              label="Maior"
              value={s.max}
              onChange={(v) => patchScale(s.id, { max: v })}
            />
          </div>
        </div>
      ))}
    </BuilderSection>
  );
}
