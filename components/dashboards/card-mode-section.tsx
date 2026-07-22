"use client";
// Versão: 1.2 | Data: 20/07/2026
// v1.2 (20/07/2026): modo Fórmula usa o FormulaEditor unificado (visual +
//   texto + validação viva) no lugar do FormulaTextEditor texto-only.
// v1.1 (17/07/2026): caixa com bg-card (painel do editor ficou bg-muted).
// Seção "Modo do Card" do builder (settings.card): além do número agregado
// (comportamento original), o Card exibe o valor de um registro (maior/menor),
// um ranking Top N, uma lista de valores ou uma fórmula (motor do widget
// calculado). Arquivo próprio para não inflar o widget-builder.
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
  Combobox,
  type ComboboxChip,
  type ComboboxOption,
} from "@/components/ui/combobox";
import { FormulaEditor } from "@/components/formula/formula-editor";
import type { RefOption } from "@/lib/records/date-operands";
import {
  AGG_LABELS,
  CARD_MODE_LABELS,
  type Aggregation,
  type CardConfig,
  type CardMode,
} from "@/lib/widgets/types";
import { AGGREGATIONS } from "@/lib/widgets/fields";

export function CardModeSection({
  value,
  onChange,
  fieldOptions,
  rankOptions,
  metricFieldOptions,
  fieldChips,
  calcRefs,
}: {
  value: CardConfig;
  onChange: (v: CardConfig) => void;
  // Campos exibíveis (showField/labelField) — catálogo completo.
  fieldOptions: ComboboxOption[];
  // Campos ranqueáveis (numéricos e datas) — rankField do modo registro.
  rankOptions: ComboboxOption[];
  // Campos de métrica (numéricos + contagem) — modo ranking.
  metricFieldOptions: ComboboxOption[];
  fieldChips?: ComboboxChip[];
  calcRefs: RefOption[];
}) {
  const patch = (p: Partial<CardConfig>) => onChange({ ...value, ...p });
  const mode = value.mode ?? "value";
  const modes = Object.keys(CARD_MODE_LABELS) as CardMode[];
  return (
    <div className="bg-card flex flex-col gap-2 rounded-md border p-3">
      <div className="flex flex-col gap-1.5">
        <Label>Modo do Card</Label>
        <Select
          value={mode}
          onValueChange={(v) =>
            patch({ mode: v === "value" ? undefined : (v as CardMode) })
          }
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {modes.map((m) => (
              <SelectItem key={m} value={m}>
                {CARD_MODE_LABELS[m]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {mode !== "value" ? (
          <p className="text-muted-foreground text-xs">
            Bases, filtros e período continuam valendo; Dimensões/Métricas do
            bloco abaixo são ignoradas neste modo.
          </p>
        ) : null}
      </div>

      {mode === "record" ? (
        <>
          <div className="flex flex-col gap-1.5">
            <Label>Classificar pelo campo</Label>
            <Combobox
              options={rankOptions}
              chips={fieldChips}
              value={value.rankField ?? ""}
              onValueChange={(v) => patch({ rankField: v })}
              aria-label="Campo de classificação"
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="flex flex-col gap-1.5">
              <Label>Maior ou menor?</Label>
              <Select
                value={value.rankDir ?? "max"}
                onValueChange={(v) => patch({ rankDir: v as "max" | "min" })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="max">Maior (mais recente)</SelectItem>
                  <SelectItem value="min">Menor (mais antigo)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Exibir o campo</Label>
              <Combobox
                options={fieldOptions}
                chips={fieldChips}
                value={value.showField ?? ""}
                onValueChange={(v) => patch({ showField: v })}
                aria-label="Campo exibido"
              />
            </div>
          </div>
          <p className="text-muted-foreground text-xs">
            Ex.: classificar por Valor (maior) e exibir o Cliente → o cliente
            do maior negócio do período. Classificar por uma data (maior) →
            registro mais recente.
          </p>
        </>
      ) : null}

      {mode === "topn" || mode === "list" ? (
        <>
          <div className="flex flex-col gap-1.5">
            <Label>{mode === "topn" ? "Campo do rótulo" : "Campo da lista"}</Label>
            <Combobox
              options={fieldOptions}
              chips={fieldChips}
              value={value.labelField ?? ""}
              onValueChange={(v) => patch({ labelField: v })}
              aria-label="Campo do rótulo"
            />
          </div>
          {mode === "topn" ? (
            <div className="grid grid-cols-3 gap-2">
              <div className="col-span-2 flex flex-col gap-1.5">
                <Label>Métrica do ranking</Label>
                <Combobox
                  options={metricFieldOptions}
                  chips={fieldChips}
                  value={value.metric?.field ?? ""}
                  onValueChange={(v) =>
                    patch({
                      metric: {
                        field: v,
                        agg: v === "*" ? "count" : (value.metric?.agg ?? "sum"),
                      },
                    })
                  }
                  aria-label="Campo da métrica"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>Agregação</Label>
                <Select
                  value={value.metric?.agg ?? "sum"}
                  onValueChange={(v) =>
                    patch({
                      metric: {
                        field: value.metric?.field ?? "",
                        agg: v as Aggregation,
                      },
                    })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {AGGREGATIONS.map((a) => (
                      <SelectItem key={a} value={a}>
                        {AGG_LABELS[a]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          ) : null}
          <div className="grid grid-cols-2 gap-2">
            <div className="flex flex-col gap-1.5">
              <Label>Limite</Label>
              <Input
                type="number"
                min={1}
                max={50}
                value={String(value.limit ?? (mode === "topn" ? 5 : 10))}
                onChange={(e) => {
                  const n = Number(e.target.value);
                  patch({ limit: Number.isFinite(n) && n > 0 ? n : undefined });
                }}
              />
            </div>
            {mode === "topn" ? (
              <div className="flex flex-col gap-1.5">
                <Label>Ordem</Label>
                <Select
                  value={value.rankDir ?? "max"}
                  onValueChange={(v) => patch({ rankDir: v as "max" | "min" })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="max">Maiores primeiro</SelectItem>
                    <SelectItem value="min">Menores primeiro</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            ) : null}
          </div>
          {mode === "topn" ? (
            <p className="text-muted-foreground text-xs">
              Com a seção Comparação habilitada, cada linha do ranking mostra a
              variação vs. o período de comparação.
            </p>
          ) : null}
        </>
      ) : null}

      {mode === "formula" ? (
        <div className="flex flex-col gap-1.5">
          <Label>Fórmula</Label>
          <FormulaEditor
            context="aggregate"
            catalog={calcRefs}
            chips={fieldChips}
            initial={
              value.formula && value.formula.tokens.length > 0
                ? value.formula
                : null
            }
            onChange={(f) => patch({ formula: f })}
          />
          <p className="text-muted-foreground text-xs">
            Aceita SE/E/OU, SOMASE/CONT.SE/MÉDIASE e as funções de variação
            ANTERIOR/VARPCT/VARABS (VARPCT já sai ×100).
          </p>
        </div>
      ) : null}

      {mode !== "value" ? (
        <div className="grid grid-cols-3 gap-2">
          <div className="flex flex-col gap-1.5">
            <Label>Prefixo</Label>
            <Input
              value={value.prefix ?? ""}
              onChange={(e) => patch({ prefix: e.target.value || undefined })}
              placeholder="ex.: 🏆 "
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Sufixo</Label>
            <Input
              value={value.suffix ?? ""}
              onChange={(e) => patch({ suffix: e.target.value || undefined })}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Texto secundário</Label>
            <Input
              value={value.secondaryText ?? ""}
              onChange={(e) =>
                patch({ secondaryText: e.target.value || undefined })
              }
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}
