// Versão: 1.1 | Data: 14/07/2026
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
import { ChevronDown, ChevronRight, Trash2 } from "lucide-react";

import {
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  FormulaBuilder,
  type RefOption,
} from "@/components/campos/formula-builder";
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
    <AccordionItem value={value}>
      <AccordionTrigger className="py-2.5 hover:no-underline">
        <span className="flex items-center gap-2">
          <span className="text-sm font-medium hover:underline">{title}</span>
          {badge ? (
            <Badge variant="secondary" className="font-normal">
              {badge}
            </Badge>
          ) : null}
        </span>
      </AccordionTrigger>
      <AccordionContent className="flex flex-col gap-3">
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
  transformOptions,
  dateAggOptions,
  isDateField,
  defaultLabel,
  isRecordList,
  columnAggValue,
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
  transformOptions: ComboboxOption[];
  dateAggOptions: ComboboxOption[];
  isDateField: boolean;
  defaultLabel: string;
  isRecordList: boolean;
  columnAggValue?: DateAgg;
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
    <div className="flex flex-col gap-2 rounded-md border p-2.5">
      <div className="flex items-center gap-2">
        <Combobox
          className="flex-1"
          options={fieldOptions}
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
  aggOptions,
  isMoney,
  isAggCalc,
  isCalcSentinel,
  calcRefs,
  resultFormatOptions,
  defaultLabel,
  fieldMenu,
  onFieldChange,
  onChange,
  onRemove,
}: {
  metric: Metric;
  metricOptions: ComboboxOption[];
  aggOptions: ComboboxOption[];
  isMoney: boolean;
  isAggCalc: boolean;
  isCalcSentinel: boolean;
  calcRefs: RefOption[];
  resultFormatOptions: ComboboxOption[];
  defaultLabel: string;
  fieldMenu: React.ReactNode;
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
  return (
    <div className="flex flex-col gap-2 rounded-md border p-2.5">
      <div className="flex items-center gap-2">
        <Combobox
          className="flex-1"
          options={metricOptions}
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
          <FormulaBuilder
            refs={calcRefs}
            initial={metric.formula ?? null}
            onChange={(f) => onChange({ formula: f })}
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
            é só exibição (sem conversão).
          </p>
        </div>
      ) : null}
      {metric.field && metric.field !== "*" ? (
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
    </div>
  );
}

// Card de um filtro: campo em cima, operador + valor embaixo (o valor não
// colapsa mais quando o painel está na largura mínima).
export function FilterRow({
  filter,
  fieldOptions,
  opOptions,
  onChange,
  onRemove,
}: {
  filter: WidgetFilter;
  fieldOptions: ComboboxOption[];
  opOptions: ComboboxOption[];
  onChange: (patch: Partial<WidgetFilter>) => void;
  onRemove: () => void;
}) {
  return (
    <div className="flex flex-col gap-2 rounded-md border p-2.5">
      <div className="flex items-center gap-2">
        <Combobox
          className="flex-1"
          options={fieldOptions}
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
    </div>
  );
}
