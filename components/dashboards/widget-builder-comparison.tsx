"use client";
// Versão: 1.0 | Data: 17/07/2026
// Seção "Comparação" do builder (settings.comparison): compara o resultado do
// widget com um período de comparação — período anterior, mesmo período do ano
// passado, ou média/mediana por bucket de uma janela maior. Config de DADOS
// (dispara a segunda consulta no engine); a exibição (formato/cores/setinha)
// vive no mesmo objeto p/ a edição ficar num lugar só. Arquivo próprio para
// não inflar o widget-builder.
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  COMPARISON_BASE_LABELS,
  COMPARISON_WINDOW_LABELS,
  type ComparisonBase,
  type ComparisonSettings,
  type ComparisonWindow,
  type VisualType,
} from "@/lib/widgets/types";
import { BuilderSection } from "./widget-builder-rows";

const BASES = Object.keys(COMPARISON_BASE_LABELS) as ComparisonBase[];
const WINDOWS = Object.keys(COMPARISON_WINDOW_LABELS) as ComparisonWindow[];

export function ComparisonSection({
  value,
  onChange,
  visualType,
}: {
  value: ComparisonSettings;
  onChange: (v: ComparisonSettings) => void;
  visualType: VisualType;
}) {
  const patch = (p: Partial<ComparisonSettings>) => onChange({ ...value, ...p });
  const base = value.base ?? "previous_period";
  const isWindow = base === "window_avg" || base === "window_median";
  const isTable = visualType === "tabela";
  const isChart =
    visualType === "barra" ||
    visualType === "barra_horizontal" ||
    visualType === "linha" ||
    visualType === "pizza" ||
    visualType === "funil";
  const isBarLine =
    visualType === "barra" ||
    visualType === "barra_horizontal" ||
    visualType === "linha";
  return (
    <BuilderSection
      value="comparacao"
      title="Comparação"
      badge={value.enabled ? COMPARISON_BASE_LABELS[base] : null}
    >
      <label className="flex items-center gap-2 text-sm">
        <Checkbox
          checked={value.enabled ?? false}
          onCheckedChange={(v) => patch({ enabled: v === true })}
        />
        Comparar com um período de comparação
      </label>
      {value.enabled ? (
        <>
          <p className="text-muted-foreground text-xs">
            A variação usa o período ativo do dashboard. Em &quot;todo o
            período&quot; não há base de comparação e ela fica indisponível.
          </p>
          <div className="flex flex-col gap-1.5">
            <Label>Comparar com</Label>
            <Select
              value={base}
              onValueChange={(v) => patch({ base: v as ComparisonBase })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {BASES.map((b) => (
                  <SelectItem key={b} value={b}>
                    {COMPARISON_BASE_LABELS[b]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {isWindow ? (
            <div className="flex flex-col gap-1.5">
              <Label>Janela</Label>
              <Select
                value={value.window ?? "last_12m"}
                onValueChange={(v) => patch({ window: v as ComparisonWindow })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {WINDOWS.map((w) => (
                    <SelectItem key={w} value={w}>
                      {COMPARISON_WINDOW_LABELS[w]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-muted-foreground text-xs">
                A janela é bucketizada na granularidade equivalente ao período
                atual (ex.: vendo um mês, compara com a média/mediana MENSAL da
                janela).
              </p>
            </div>
          ) : null}
          <div className="grid grid-cols-2 gap-2">
            <div className="flex flex-col gap-1.5">
              <Label>Formato</Label>
              <Select
                value={value.format ?? "pct"}
                onValueChange={(v) =>
                  patch({ format: v as ComparisonSettings["format"] })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="pct">Percentual</SelectItem>
                  <SelectItem value="abs">Absoluto</SelectItem>
                  <SelectItem value="both">Percentual + absoluto</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Estilo</Label>
              <Select
                value={value.style ?? "both"}
                onValueChange={(v) =>
                  patch({ style: v as ComparisonSettings["style"] })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="color">Número colorido</SelectItem>
                  <SelectItem value="arrow">Setinha</SelectItem>
                  <SelectItem value="both">Cor + setinha</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={value.showBaseValue ?? false}
              onCheckedChange={(v) => patch({ showBaseValue: v === true })}
            />
            Exibir o valor do período de comparação
          </label>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={value.invertColors ?? false}
              onCheckedChange={(v) => patch({ invertColors: v === true })}
            />
            Inverter cores (queda é bom — ex.: churn)
          </label>
          {visualType === "kpi" ? (
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={value.onlyVariation ?? false}
                onCheckedChange={(v) => patch({ onlyVariation: v === true })}
              />
              Mostrar só a variação (no lugar do valor)
            </label>
          ) : null}
          {isTable ? (
            <div className="flex flex-col gap-1.5">
              <Label>Posição na tabela</Label>
              <Select
                value={value.tablePlacement ?? "inline"}
                onValueChange={(v) =>
                  patch({
                    tablePlacement: v as ComparisonSettings["tablePlacement"],
                  })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="inline">
                    Na mesma célula do valor
                  </SelectItem>
                  <SelectItem value="column">
                    Coluna exclusiva de variação
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
          ) : null}
          {isChart ? (
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={value.ghostSeries ?? value.showBaseValue ?? false}
                onCheckedChange={(v) => patch({ ghostSeries: v === true })}
              />
              Série do período de comparação no gráfico (fantasma)
            </label>
          ) : null}
          {isBarLine && visualType !== "linha" ? (
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={value.chartLabels ?? false}
                onCheckedChange={(v) => patch({ chartLabels: v === true })}
              />
              Rótulo de variação nas barras
            </label>
          ) : null}
        </>
      ) : null}
    </BuilderSection>
  );
}
