// Versão: 2.0 | Data: 20/07/2026
// v2.0 (20/07/2026): métrica ad-hoc usa o FormulaEditor unificado (visual com
//   cursor + paleta de funções + validação viva no card) no lugar do toggle
//   Construtor/Texto; MetricRow ganha sourceDefs (warnings de escopo @fonte).
// v1.9 (20/07/2026): UX de fórmulas — ajuda da moeda do calc ad-hoc corrigida
//   (moeda CONVERTE via resolveCalcMetric, não é só exibição) e hint "?" dos
//   três escopos de fonte (SourceConceptsHint) no bloco "Fontes da métrica".
// v1.8 (18/07/2026): DimensionRow ganha a lista "Fonte do dado" (colunas
//   unificadas no modo registros, 2+ fontes candidatas): hierarquia ordenada
//   de fontes com fallback (RecordListColumn.unifiedSources).
// v1.7 (18/07/2026): MetricRow ganha o bloco recolhível "Fontes da métrica"
//   (Metric.sources): a métrica é calculada sobre as fontes marcadas — pode
//   AMPLIAR ou restringir em relação às fontes do widget (as linhas/registros
//   continuam seguindo widgets.sources). Nenhuma marcada = fontes do widget.
// v1.6 (17/07/2026): cards de dimensão/métrica/filtro com bg-card — o painel
//   do editor ficou bg-muted e os cards se destacam em branco.
// v1.5 (17/07/2026): título da BuilderSection vira faixa destacada (fundo
//   preto/texto branco) para separar visualmente as seções do editor.
// v1.4 (15/07/2026): "Nome exibido" também para a métrica "Contagem de
//   registros" (field "*") — o pipeline (save/engine/chart) já honrava o
//   apelido; só o input era ocultado.
// v1.3 (15/07/2026): FilterRow ganha seletor de fontes-alvo (pass-through):
//   nenhum marcado = todas as fontes; o filtro só restringe as fontes marcadas
//   e as demais fontes do widget passam sem restrição.
// v1.2 (15/07/2026): toggle "%" por métrica (sufixo, oculto p/ monetárias) e
//   opção Percentual no Formato do resultado do calc ad-hoc (resultPercent).
// v1.1 (14/07/2026): MetricRow suporta métricas calculadas de agregados
//   (chip "Fórmula" no lugar da agregação, editor de fórmula + formato do
//   resultado para o sentinela 'calc:formula') — lógica de troca de campo
//   fica no pai via onFieldChange.
// Peças APRESENTACIONAIS do construtor de widget (widget-builder.tsx):
// - BuilderSection: seção recolhível (Accordion) com badge de resumo no título.
// - DimensionRow / MetricRow / FilterRow: cards de linha, extraídos 1:1 do
//   builder (mesmas opções/handlers/aria-labels), só com layout mais respirado.
// Todo o estado continua no WidgetBuilder; aqui só props + callbacks.
"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight, Plus, Trash2 } from "lucide-react";

import {
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Combobox,
  type ComboboxChip,
  type ComboboxOption,
} from "@/components/ui/combobox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { RefOption } from "@/lib/records/date-operands";
import { FormulaEditor } from "@/components/formula/formula-editor";
import { RecipeStrip } from "@/components/formula/recipe-strip";
import { SourceConceptsHint } from "@/components/formula/source-concepts-hint";
import type { SourceDef, SourceKey } from "@/lib/sources";
import { cn } from "@/lib/utils";
import type {
  Aggregation,
  DateAgg,
  Dimension,
  FilterOp,
  Metric,
  Transform,
  WidgetFilter,
} from "@/lib/widgets/types";
import type {
  ConversionBasis,
  CurrencyDisplay,
  CurrencyMultiMode,
  GrandTotalMode,
} from "@/lib/widgets/currency";

// --- Opções de moeda das métricas monetárias (Parte C) ---
export const CONVERSION_BASIS_OPTIONS: ComboboxOption[] = [
  { value: "record_year", label: "Ano do registro" },
  { value: "record_quarter", label: "Trimestre do registro" },
  { value: "period_year", label: "Ano do período" },
  { value: "period_quarter", label: "Trimestre do período" },
];
export const CURRENCY_DISPLAY_OPTIONS: ComboboxOption[] = [
  { value: "original", label: "Só a moeda original" },
  { value: "converted", label: "Só convertido (R$)" },
  { value: "reference", label: "US$ original → R$ convertido" },
];
export const CURRENCY_MULTI_OPTIONS: ComboboxOption[] = [
  { value: "convert", label: "Converter tudo (R$)" },
  { value: "separate", label: "Totais por moeda (separados)" },
  { value: "reference", label: "US$ total → R$ convertido" },
];
export const GRAND_TOTAL_OPTIONS: ComboboxOption[] = [
  { value: "converted", label: "Total convertido (R$)" },
  { value: "dollar", label: "Total em US$" },
];

export function basisValue(b?: ConversionBasis): string {
  return b ? `${b.source}_${b.granularity}` : "record_year";
}
export function parseBasis(v: string): ConversionBasis {
  const [source, granularity] = v.split("_");
  return {
    source: source === "period" ? "period" : "record",
    granularity: granularity === "quarter" ? "quarter" : "year",
  };
}

// Seção recolhível do construtor: título + badge de resumo (visível mesmo
// fechada, para nada "sumir em silêncio") e corpo com espaçamento padrão.
export function BuilderSection({
  value,
  title,
  badge,
  children,
}: {
  value: string;
  title: string;
  badge?: string | null;
  children: React.ReactNode;
}) {
  return (
    <AccordionItem value={value} className="border-b-0">
      <AccordionTrigger className="bg-foreground text-background hover:bg-foreground/90 my-1 rounded-md px-3 py-2.5 hover:no-underline [&>svg]:text-background/70">
        <span className="flex items-center gap-2">
          <span className="text-sm font-medium">{title}</span>
          {badge ? (
            <Badge variant="secondary" className="font-normal">
              {badge}
            </Badge>
          ) : null}
        </span>
      </AccordionTrigger>
      <AccordionContent className="flex flex-col gap-3 pt-1">
        {children}
      </AccordionContent>
    </AccordionItem>
  );
}

// Card de uma dimensão. No modo lista de registros, a dimensão é também a
// coluna exibida (flags Editável / Gravar no Bitrix + agregação por período).
export function DimensionRow({
  dim,
  fieldOptions,
  fieldChips,
  transformOptions,
  dateAggOptions,
  isDateField,
  defaultLabel,
  isRecordList,
  columnAggValue,
  unifiedSourceOptions,
  unifiedSourcesValue,
  onUnifiedSourcesChange,
  editable,
  writeBack,
  editableCapable,
  writable,
  fieldMenu,
  onChange,
  onRemove,
  onColumnAggChange,
  onFlagChange,
}: {
  dim: Dimension;
  fieldOptions: ComboboxOption[];
  fieldChips?: ComboboxChip[];
  transformOptions: ComboboxOption[];
  dateAggOptions: ComboboxOption[];
  isDateField: boolean;
  defaultLabel: string;
  isRecordList: boolean;
  columnAggValue?: DateAgg;
  // "Fonte do dado" da coluna unificada (modo registros): fontes candidatas
  // (membro do campo ∩ fontes do widget; só renderiza com 2+) e a hierarquia
  // escolhida, em ordem de prioridade com fallback.
  unifiedSourceOptions?: ComboboxOption[];
  unifiedSourcesValue?: string[];
  onUnifiedSourcesChange?: (list: string[]) => void;
  editable: boolean;
  writeBack: boolean;
  editableCapable: boolean;
  writable: boolean;
  fieldMenu: React.ReactNode;
  onChange: (patch: Partial<Dimension>) => void;
  onRemove: () => void;
  onColumnAggChange: (a: DateAgg) => void;
  onFlagChange: (patch: { editable?: boolean; writeBack?: boolean }) => void;
}) {
  return (
    <div className="bg-card flex flex-col gap-2 rounded-md border p-2.5">
      <div className="flex items-center gap-2">
        <Combobox
          className="flex-1"
          options={fieldOptions}
          chips={fieldChips}
          value={dim.field}
          placeholder="— campo —"
          onValueChange={(field) => onChange({ field })}
          aria-label="Campo da dimensão"
        />
        {dim.field ? fieldMenu : null}
        <Button type="button" variant="ghost" size="icon" onClick={onRemove}>
          <Trash2 className="size-4" />
        </Button>
      </div>
      {isDateField ? (
        <div className="grid grid-cols-2 gap-2">
          <div className="flex flex-col gap-1">
            <Label className="text-muted-foreground text-xs">Formato</Label>
            <Combobox
              className="h-8 text-sm"
              searchable={false}
              options={transformOptions}
              value={dim.transform ?? "none"}
              onValueChange={(t) => onChange({ transform: t as Transform })}
              aria-label="Transformação de data"
            />
          </div>
          {dim.transform === "week_month" ? (
            <div className="flex flex-col gap-1">
              <Label className="text-muted-foreground text-xs">Semana</Label>
              <Combobox
                className="h-8 text-sm"
                searchable={false}
                options={[
                  { value: "restricted", label: "Restrita" },
                  { value: "full", label: "Cheia" },
                ]}
                value={dim.weekMode ?? "restricted"}
                onValueChange={(wm) =>
                  onChange({ weekMode: wm as "full" | "restricted" })
                }
                aria-label="Modo da semana do mês"
              />
            </div>
          ) : null}
        </div>
      ) : null}
      {dim.field ? (
        <Input
          className="h-8 text-sm"
          placeholder={`Nome exibido (padrão: ${defaultLabel})`}
          value={dim.label ?? ""}
          onChange={(e) => onChange({ label: e.target.value })}
          aria-label="Nome exibido da dimensão"
        />
      ) : null}
      {isDateField && dim.transform && dim.transform !== "none" ? (
        <div className="flex items-center gap-2">
          <Label className="text-muted-foreground w-28 shrink-0 text-xs">
            Agrupar período
          </Label>
          <Combobox
            className="h-8 flex-1 text-sm"
            searchable={false}
            options={
              isRecordList
                ? dateAggOptions
                : [{ value: "", label: "Padrão (agregado)" }, ...dateAggOptions]
            }
            value={
              isRecordList ? columnAggValue ?? "individual" : dim.dateAgg ?? ""
            }
            onValueChange={(a) => {
              if (isRecordList) onColumnAggChange(a as DateAgg);
              else onChange({ dateAgg: a ? (a as DateAgg) : undefined });
            }}
            aria-label="Agregação por período"
          />
        </div>
      ) : null}
      {isRecordList &&
      dim.field.startsWith("unified:") &&
      unifiedSourceOptions &&
      unifiedSourceOptions.length > 1 ? (
        <div className="flex flex-col gap-1">
          <Label className="text-muted-foreground text-xs">Fonte do dado</Label>
          {(unifiedSourcesValue ?? []).map((src, idx) => {
            const list = unifiedSourcesValue ?? [];
            const used = new Set(list.filter((_, i) => i !== idx));
            const opts = unifiedSourceOptions.filter(
              (o) => o.value === src || !used.has(o.value)
            );
            return (
              <div key={idx} className="flex items-center gap-1.5">
                <span className="text-muted-foreground w-5 shrink-0 text-right text-xs tabular-nums">
                  {idx + 1}.
                </span>
                <Combobox
                  className="h-8 flex-1 text-sm"
                  searchable={false}
                  options={opts}
                  value={src}
                  onValueChange={(v) =>
                    onUnifiedSourcesChange?.(
                      list.map((s, i) => (i === idx ? v : s))
                    )
                  }
                  aria-label={`Fonte do dado — prioridade ${idx + 1}`}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="text-muted-foreground hover:text-destructive size-8 shrink-0"
                  onClick={() =>
                    onUnifiedSourcesChange?.(list.filter((_, i) => i !== idx))
                  }
                  title="Remover fonte"
                  aria-label={`Remover fonte ${idx + 1}`}
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
            );
          })}
          {(() => {
            const list = unifiedSourcesValue ?? [];
            const used = new Set(list);
            const free = unifiedSourceOptions.find((o) => !used.has(o.value));
            return (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="self-start"
                disabled={!free}
                onClick={() =>
                  free && onUnifiedSourcesChange?.([...list, free.value])
                }
              >
                <Plus className="size-4" />
                {list.length === 0 ? "Escolher fonte…" : "Adicionar fallback"}
              </Button>
            );
          })()}
          <p className="text-muted-foreground text-xs">
            {(unifiedSourcesValue ?? []).length === 0
              ? "Padrão: cada registro mostra o dado da própria fonte."
              : "Busca o dado na 1ª fonte (do próprio registro ou do registro casado dela); vazio cai para a próxima."}
          </p>
        </div>
      ) : null}
      {isRecordList && dim.field && editableCapable ? (
        <div className="text-muted-foreground flex items-center gap-4 text-xs">
          <label className="flex items-center gap-1.5">
            <Checkbox
              checked={editable}
              onCheckedChange={(c) => onFlagChange({ editable: c === true })}
            />
            Editável
          </label>
          {editable && writable ? (
            <label className="flex items-center gap-1.5">
              <Checkbox
                checked={writeBack}
                onCheckedChange={(c) => onFlagChange({ writeBack: c === true })}
              />
              Gravar no Bitrix
            </label>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

// Card de uma métrica. Nas métricas monetárias, as 4 opções de moeda ficam num
// bloco recolhível por linha (abre por padrão quando já há algo configurado).
// Métrica calculada de agregados: chip "Fórmula" no lugar da agregação; o
// sentinela 'calc:formula' ganha editor de fórmula + formato do resultado.
export function MetricRow({
  metric,
  metricOptions,
  fieldChips,
  aggOptions,
  isMoney,
  isAggCalc,
  isCalcSentinel,
  calcRefs,
  sourceDefs,
  resultFormatOptions,
  defaultLabel,
  fieldMenu,
  sourceOptions,
  onFieldChange,
  onChange,
  onRemove,
}: {
  metric: Metric;
  metricOptions: ComboboxOption[];
  fieldChips?: ComboboxChip[];
  aggOptions: ComboboxOption[];
  isMoney: boolean;
  isAggCalc: boolean;
  isCalcSentinel: boolean;
  calcRefs: RefOption[];
  // Catálogo de fontes vivo — warnings de escopo @fonte do FormulaEditor.
  sourceDefs?: SourceDef[];
  resultFormatOptions: ComboboxOption[];
  defaultLabel: string;
  fieldMenu: React.ReactNode;
  // Fontes da MÉTRICA (Metric.sources): catálogo inteiro — diferente do
  // filtro, que só oferece as fontes do widget, aqui AMPLIAR é o ponto (ex.:
  // linhas só de Deals + conversão contando Leads e Deals). Ausente/1 fonte no
  // catálogo = bloco oculto.
  sourceOptions?: FilterSourceOption[];
  // Troca de campo tem regras próprias (limpeza/marcação de `calc`), decididas
  // pelo pai; os demais ajustes usam onChange(patch).
  onFieldChange: (field: string) => void;
  onChange: (patch: Partial<Metric>) => void;
  onRemove: () => void;
}) {
  // Aberto por padrão só quando alguma opção de moeda já foi configurada:
  // config existente nunca fica escondida; métrica nova nasce limpa.
  const [moneyOpen, setMoneyOpen] = useState<boolean>(
    Boolean(
      metric.conversionBasis ||
        metric.currencyDisplay ||
        metric.currencyMultiMode ||
        metric.grandTotalMode
    )
  );
  // Remonta o FormulaEditor quando uma receita aplica fórmula nova (o editor
  // lê `initial` só na montagem).
  const [recipeNonce, setRecipeNonce] = useState(0);
  // Fontes da métrica: aberto por padrão só quando já há fontes marcadas
  // (config existente nunca fica escondida; métrica nova nasce limpa).
  const srcTargets = metric.sources ?? [];
  const [sourcesOpen, setSourcesOpen] = useState<boolean>(srcTargets.length > 0);
  const toggleMetricSource = (key: SourceKey, checked: boolean) => {
    const next = checked
      ? [...new Set([...srcTargets, key])]
      : srcTargets.filter((s) => s !== key);
    onChange({ sources: next.length > 0 ? next : undefined });
  };
  return (
    <div className="bg-card flex flex-col gap-2 rounded-md border p-2.5">
      <div className="flex items-center gap-2">
        <Combobox
          className="flex-1"
          options={metricOptions}
          chips={fieldChips}
          value={metric.field}
          onValueChange={onFieldChange}
          aria-label="Campo da métrica"
        />
        {isAggCalc ? (
          <span className="text-muted-foreground bg-muted w-28 shrink-0 rounded-md px-2 py-1.5 text-center text-xs">
            Fórmula
          </span>
        ) : (
          <Combobox
            className="w-28 shrink-0"
            searchable={false}
            options={aggOptions}
            value={metric.agg}
            disabled={metric.field === "*"}
            onValueChange={(a) => onChange({ agg: a as Aggregation })}
            aria-label="Agregação"
          />
        )}
        {metric.field && metric.field !== "*" && !isCalcSentinel
          ? fieldMenu
          : null}
        <Button type="button" variant="ghost" size="icon" onClick={onRemove}>
          <Trash2 className="size-4" />
        </Button>
      </div>
      {isCalcSentinel ? (
        <div className="flex flex-col gap-1.5 rounded-md border p-2">
          <FormulaEditor
            key={`calc-${recipeNonce}`}
            context="aggregate"
            catalog={calcRefs}
            chips={fieldChips}
            sources={sourceDefs}
            initial={
              metric.formula && metric.formula.tokens.length > 0
                ? metric.formula
                : null
            }
            onChange={(f) => onChange({ formula: f })}
            header={
              <RecipeStrip
                recipes={["conversion_rate"]}
                aggCatalog={calcRefs}
                sources={sourceDefs ?? []}
                onApply={(r) => {
                  // Receita aplica fórmula + formato % + nome sugerido (se
                  // vazio); o editor remonta (nonce) já preenchido e editável.
                  onChange({
                    formula: r.formula,
                    resultPercent: r.format === "percent",
                    resultCurrency: null,
                    label: metric.label?.trim()
                      ? metric.label
                      : r.suggestedLabel,
                  });
                  setRecipeNonce((n) => n + 1);
                }}
              />
            }
          />
          <div className="flex items-center gap-2">
            <Label className="text-muted-foreground shrink-0 text-xs">
              Formato do resultado
            </Label>
            <Combobox
              className="h-8 flex-1 text-sm"
              searchable={false}
              options={resultFormatOptions}
              value={
                metric.resultPercent ? "percent" : (metric.resultCurrency ?? "")
              }
              onValueChange={(v) =>
                v === "percent"
                  ? onChange({ resultPercent: true, resultCurrency: null })
                  : onChange({ resultPercent: false, resultCurrency: v || null })
              }
              aria-label="Formato do resultado"
            />
          </div>
          <p className="text-muted-foreground text-xs">
            Fórmula sobre os totais do recorte, recalculada por grupo,
            subtotal e Total geral. Percentual exibe ×100 (0,35 → 35%); moeda
            CONVERTE o resultado para a moeda escolhida (taxa do período do
            dashboard).
          </p>
        </div>
      ) : null}
      {metric.field ? (
        <Input
          className="h-8 text-sm"
          placeholder={`Nome exibido (padrão: ${defaultLabel})`}
          value={metric.label ?? ""}
          onChange={(e) => onChange({ label: e.target.value })}
          aria-label="Nome exibido da métrica"
        />
      ) : null}
      {/* Toggle "%": só anexa o símbolo ao número exibido (sem ×100) — p/ números
          que já vêm em magnitude percentual. Sem sentido em métrica monetária ou
          fórmula com formato moeda (aí o combobox de formato manda). Contagem de
          registros ("*") é caso de uso legítimo. */}
      {metric.field &&
      !isMoney &&
      !(isCalcSentinel && (metric.resultCurrency || metric.resultPercent)) ? (
        <label className="text-muted-foreground flex items-center gap-2 text-xs">
          <input
            type="checkbox"
            className="size-4 accent-primary"
            checked={metric.percent ?? false}
            onChange={(e) => onChange({ percent: e.target.checked })}
          />
          Exibir com &quot;%&quot; (só o símbolo — não multiplica por 100)
        </label>
      ) : null}
      {isMoney ? (
        <div className="flex flex-col gap-2 rounded-md border p-2">
          <button
            type="button"
            className="text-muted-foreground hover:text-foreground flex items-center gap-1 self-start text-xs font-medium"
            onClick={() => setMoneyOpen((o) => !o)}
            aria-expanded={moneyOpen}
          >
            {moneyOpen ? (
              <ChevronDown className="size-3.5" />
            ) : (
              <ChevronRight className="size-3.5" />
            )}
            Opções de moeda
          </button>
          {moneyOpen ? (
            <div className="flex flex-col gap-2">
              <div className="flex flex-col gap-1">
                <Label className="text-muted-foreground text-xs">
                  Base da taxa
                </Label>
                <Combobox
                  className="h-8 text-sm"
                  searchable={false}
                  options={CONVERSION_BASIS_OPTIONS}
                  value={basisValue(metric.conversionBasis)}
                  onValueChange={(v) =>
                    onChange({ conversionBasis: parseBasis(v) })
                  }
                  aria-label="Base da taxa de conversão"
                />
              </div>
              <div className="flex flex-col gap-1">
                <Label className="text-muted-foreground text-xs">
                  Exibição (1 moeda)
                </Label>
                <Combobox
                  className="h-8 text-sm"
                  searchable={false}
                  options={CURRENCY_DISPLAY_OPTIONS}
                  value={metric.currencyDisplay ?? "original"}
                  onValueChange={(v) =>
                    onChange({ currencyDisplay: v as CurrencyDisplay })
                  }
                  aria-label="Exibição para moeda única"
                />
              </div>
              <div className="flex flex-col gap-1">
                <Label className="text-muted-foreground text-xs">
                  Exibição (várias)
                </Label>
                <Combobox
                  className="h-8 text-sm"
                  searchable={false}
                  options={CURRENCY_MULTI_OPTIONS}
                  value={metric.currencyMultiMode ?? "convert"}
                  onValueChange={(v) =>
                    onChange({ currencyMultiMode: v as CurrencyMultiMode })
                  }
                  aria-label="Exibição para várias moedas"
                />
              </div>
              <div className="flex flex-col gap-1">
                <Label className="text-muted-foreground text-xs">
                  Total geral
                </Label>
                <Combobox
                  className="h-8 text-sm"
                  searchable={false}
                  options={GRAND_TOTAL_OPTIONS}
                  value={metric.grandTotalMode ?? "converted"}
                  onValueChange={(v) =>
                    onChange({ grandTotalMode: v as GrandTotalMode })
                  }
                  aria-label="Total geral"
                />
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
      {metric.field && sourceOptions && sourceOptions.length > 1 ? (
        <div className="flex flex-col gap-2 rounded-md border p-2">
          <div className="flex items-center gap-1.5 self-start">
            <button
              type="button"
              className="text-muted-foreground hover:text-foreground flex items-center gap-1 text-xs font-medium"
              onClick={() => setSourcesOpen((o) => !o)}
              aria-expanded={sourcesOpen}
            >
              {sourcesOpen ? (
                <ChevronDown className="size-3.5" />
              ) : (
                <ChevronRight className="size-3.5" />
              )}
              Fontes da métrica
              {srcTargets.length > 0 ? ` (${srcTargets.length})` : ""}
            </button>
            <SourceConceptsHint />
          </div>
          {sourcesOpen ? (
            <div className="flex flex-col gap-1">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                {sourceOptions.map((opt) => (
                  <label
                    key={opt.key}
                    className={cn(
                      "flex items-center gap-1.5 text-xs",
                      opt.stale && "text-destructive"
                    )}
                  >
                    <Checkbox
                      checked={srcTargets.includes(opt.key)}
                      onCheckedChange={(c) =>
                        toggleMetricSource(opt.key, c === true)
                      }
                      aria-label={`Calcular a métrica sobre a fonte ${opt.label}`}
                    />
                    {opt.label}
                    {opt.stale ? " (fora do catálogo)" : null}
                  </label>
                ))}
              </div>
              <span className="text-muted-foreground text-xs">
                {srcTargets.length === 0
                  ? "Nenhuma marcada = as fontes do widget."
                  : "A métrica é calculada sobre as fontes marcadas; as linhas e os registros do widget continuam seguindo as fontes do widget."}
              </span>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

// Opção do seletor de fontes-alvo de um filtro. `stale` = fonte que saiu das
// fontes do widget depois de virar alvo (exibida com aviso, nunca escondida).
export interface FilterSourceOption {
  key: SourceKey;
  label: string;
  stale?: boolean;
}

// Card de um filtro: campo em cima, operador + valor embaixo (o valor não
// colapsa mais quando o painel está na largura mínima). Com sourceOptions
// (2+ fontes no widget), uma terceira linha escolhe as fontes-alvo do filtro:
// nenhuma marcada = todas; marcadas = o filtro só restringe essas fontes e as
// demais passam sem restrição (pass-through).
export function FilterRow({
  filter,
  fieldOptions,
  fieldChips,
  opOptions,
  sourceOptions,
  onChange,
  onRemove,
}: {
  filter: WidgetFilter;
  fieldOptions: ComboboxOption[];
  fieldChips?: ComboboxChip[];
  opOptions: ComboboxOption[];
  sourceOptions?: FilterSourceOption[];
  onChange: (patch: Partial<WidgetFilter>) => void;
  onRemove: () => void;
}) {
  const targets = filter.sources ?? [];
  const toggleSource = (key: SourceKey, checked: boolean) => {
    const next = checked ? [...new Set([...targets, key])] : targets.filter((s) => s !== key);
    onChange({ sources: next.length > 0 ? next : undefined });
  };
  return (
    <div className="bg-card flex flex-col gap-2 rounded-md border p-2.5">
      <div className="flex items-center gap-2">
        <Combobox
          className="flex-1"
          options={fieldOptions}
          chips={fieldChips}
          value={filter.field}
          placeholder="— campo —"
          onValueChange={(field) => onChange({ field })}
          aria-label="Campo do filtro"
        />
        <Button type="button" variant="ghost" size="icon" onClick={onRemove}>
          <Trash2 className="size-4" />
        </Button>
      </div>
      <div className="flex items-center gap-2">
        <Combobox
          className="w-32 shrink-0"
          searchable={false}
          options={opOptions}
          value={filter.op}
          onValueChange={(op) => onChange({ op: op as FilterOp })}
          aria-label="Operador do filtro"
        />
        {filter.op !== "is_null" && filter.op !== "not_null" ? (
          <Input
            value={String(filter.value ?? "")}
            onChange={(e) => onChange({ value: e.target.value })}
            placeholder="valor"
          />
        ) : null}
      </div>
      {sourceOptions && sourceOptions.length > 1 ? (
        <div className="flex flex-col gap-1">
          <Label className="text-muted-foreground text-xs">Fontes</Label>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            {sourceOptions.map((opt) => (
              <label
                key={opt.key}
                className={cn(
                  "flex items-center gap-1.5 text-xs",
                  opt.stale && "text-destructive"
                )}
              >
                <Checkbox
                  checked={targets.includes(opt.key)}
                  onCheckedChange={(c) => toggleSource(opt.key, c === true)}
                  aria-label={`Aplicar filtro à fonte ${opt.label}`}
                />
                {opt.label}
                {opt.stale ? " (fora das fontes do widget)" : null}
              </label>
            ))}
          </div>
          <span className="text-muted-foreground text-xs">
            {targets.length === 0
              ? "Nenhuma marcada = todas as fontes."
              : "Só as fontes marcadas são restringidas; as demais entregam seus dados normalmente."}
          </span>
        </div>
      ) : null}
    </div>
  );
}
