// Versão: 1.0 | Data: 20/07/2026
// RECEITAS guiadas do FormulaEditor: cards "Ciclo de vendas" e "Taxa de
// conversão" que abrem um wizard INLINE de 2-3 perguntas e geram uma fórmula
// normal, aberta no editor já preenchida e 100% editável — atalho POR CIMA do
// editor livre, nunca substituto (regra de produto: manter/ampliar as
// combinações, jamais limitar). As opções das perguntas saem dos MESMOS
// catálogos vivos do editor (nada de lista paralela). A receita de ciclo de
// vendas consulta getMatchCoverage e ORIENTA (nunca bloqueia) quando a conexão
// entre fontes ainda não está configurada em Campos → Conexões.
"use client";

import { useEffect, useMemo, useState } from "react";
import { CircleCheck, Clock3, Percent, TriangleAlert } from "lucide-react";

import { getMatchCoverage } from "@/app/(app)/campos/preview-actions";
import { Button } from "@/components/ui/button";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import type { RefOption } from "@/lib/records/date-operands";
import {
  buildConversionRate,
  buildSalesCycle,
  type RecipeId,
  type RecipeResult,
} from "@/lib/records/formula-recipes";
import { TODAY_REF } from "@/lib/records/date-operands";
import { parseAggRef } from "@/lib/widgets/calc-metrics";
import type { SourceDef } from "@/lib/sources";
import { cn } from "@/lib/utils";

export function RecipeStrip({
  recipes,
  recordCatalog = [],
  aggCatalog = [],
  sources = [],
  onApply,
  className,
}: {
  recipes: RecipeId[];
  // Catálogo por-registro (datas próprias + casadas) — receita de ciclo.
  recordCatalog?: RefOption[];
  // Catálogo agregado (agg:count:…@fonte) — receita de conversão.
  aggCatalog?: RefOption[];
  sources?: SourceDef[];
  onApply: (r: RecipeResult) => void;
  className?: string;
}) {
  const [open, setOpen] = useState<RecipeId | null>(null);
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-muted-foreground text-xs">
          Começar por um objetivo:
        </span>
        {recipes.includes("sales_cycle") ? (
          <Button
            type="button"
            variant={open === "sales_cycle" ? "secondary" : "outline"}
            size="sm"
            onClick={() =>
              setOpen((o) => (o === "sales_cycle" ? null : "sales_cycle"))
            }
          >
            <Clock3 className="size-3.5" /> Ciclo de vendas (dias entre datas)
          </Button>
        ) : null}
        {recipes.includes("conversion_rate") ? (
          <Button
            type="button"
            variant={open === "conversion_rate" ? "secondary" : "outline"}
            size="sm"
            onClick={() =>
              setOpen((o) =>
                o === "conversion_rate" ? null : "conversion_rate"
              )
            }
          >
            <Percent className="size-3.5" /> Taxa de conversão (fonte ÷ fonte)
          </Button>
        ) : null}
      </div>
      {open === "sales_cycle" ? (
        <SalesCycleWizard
          catalog={recordCatalog}
          sources={sources}
          onApply={(r) => {
            setOpen(null);
            onApply(r);
          }}
          onCancel={() => setOpen(null)}
        />
      ) : null}
      {open === "conversion_rate" ? (
        <ConversionWizard
          catalog={aggCatalog}
          sources={sources}
          onApply={(r) => {
            setOpen(null);
            onApply(r);
          }}
          onCancel={() => setOpen(null)}
        />
      ) : null}
    </div>
  );
}

// ---- Ciclo de vendas ----------------------------------------------------------

function SalesCycleWizard({
  catalog,
  sources,
  onApply,
  onCancel,
}: {
  catalog: RefOption[];
  sources: SourceDef[];
  onApply: (r: RecipeResult) => void;
  onCancel: () => void;
}) {
  // Datas do PRÓPRIO registro (grupo "Datas"; inclui "Data atual" — permite
  // "dias em aberto até hoje") e datas do CASADO (match:<fonte>:…).
  const endOptions: ComboboxOption[] = useMemo(
    () =>
      catalog
        .filter((r) => r.group === "Datas" && !r.disabledReason)
        .map((r) => ({ value: r.ref, label: r.label })),
    [catalog]
  );
  const [endRef, setEndRef] = useState("");
  const [startSource, setStartSource] = useState("");
  const [startRef, setStartRef] = useState("");

  const sourceOptions: ComboboxOption[] = useMemo(
    () => sources.map((s) => ({ value: s.key, label: s.label })),
    [sources]
  );
  // O grupo "Registro casado" mistura DATAS e NÚMEROS do casado; a receita
  // subtrai datas. Chaves custom de data saem do próprio catálogo (grupo
  // "Datas", refs custom:<key>) — nada de lista paralela.
  const customDateKeys = useMemo(
    () =>
      new Set(
        catalog
          .filter((r) => r.group === "Datas" && r.ref.startsWith("custom:"))
          .map((r) => r.ref.slice("custom:".length))
      ),
    [catalog]
  );
  const startOptions: ComboboxOption[] = useMemo(() => {
    const prefix = `match:${startSource}:`;
    const isDateInner = (inner: string) =>
      inner === "closed_at" ||
      inner === "opened_at" ||
      inner === "source_created_at" ||
      (inner.startsWith("custom:") &&
        customDateKeys.has(inner.slice("custom:".length)));
    return catalog
      .filter(
        (r) =>
          r.group === "Registro casado" &&
          r.ref.startsWith(prefix) &&
          !r.disabledReason &&
          isDateInner(r.ref.slice(prefix.length))
      )
      .map((r) => ({ value: r.ref, label: r.label }));
  }, [catalog, startSource, customDateKeys]);

  // Cobertura de casamento da fonte relacionada — orienta, nunca bloqueia.
  // Guardada COM a fonte consultada: resposta de fonte antiga não vaza para a
  // atual (e nada de setState síncrono no efeito).
  const [coverageBySource, setCoverageBySource] = useState<{
    source: string;
    result: { configured: boolean; label?: string; pairs: number } | null;
  } | null>(null);
  useEffect(() => {
    if (!startSource) return;
    let cancelled = false;
    getMatchCoverage(startSource)
      .then((res) => {
        if (cancelled) return;
        setCoverageBySource({
          source: startSource,
          result:
            res.ok && res.configured
              ? { configured: true, label: res.ruleLabel, pairs: res.pairCount ?? 0 }
              : { configured: false, pairs: 0 },
        });
      })
      .catch(() => {
        if (!cancelled) setCoverageBySource({ source: startSource, result: null });
      });
    return () => {
      cancelled = true;
    };
  }, [startSource]);
  const coverage =
    startSource && coverageBySource?.source === startSource
      ? coverageBySource.result
      : null;

  const labelOf = (ref: string) =>
    catalog.find((r) => r.ref === ref)?.label ?? ref;
  const ready = endRef !== "" && startRef !== "";
  return (
    <div className="bg-muted/40 flex flex-col gap-2 rounded-md border p-3">
      <p className="text-xs font-medium">
        Ciclo de vendas — dias entre uma data deste registro e uma data do
        registro relacionado (casado) de outra fonte.
      </p>
      <div className="flex flex-col gap-1.5">
        <span className="text-muted-foreground text-xs">
          1. Data FINAL (do próprio registro)
        </span>
        <Combobox
          options={endOptions}
          value={endRef}
          onValueChange={setEndRef}
          placeholder="Ex.: Data de fechamento"
          aria-label="Data final"
          className="w-full"
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <span className="text-muted-foreground text-xs">
          2. Fonte do registro relacionado
        </span>
        <Combobox
          options={sourceOptions}
          value={startSource}
          onValueChange={(v) => {
            setStartSource(v);
            setStartRef("");
          }}
          placeholder="Ex.: Leads do Bitrix"
          aria-label="Fonte relacionada"
          className="w-full"
        />
        {coverage?.configured ? (
          <p className="flex items-center gap-1 text-xs text-emerald-600">
            <CircleCheck className="size-3.5 shrink-0" /> Conexão configurada
            {coverage.label ? ` (${coverage.label})` : ""} — {coverage.pairs}{" "}
            registros casados.
          </p>
        ) : coverage && !coverage.configured ? (
          <p className="flex items-start gap-1 text-xs text-amber-600">
            <TriangleAlert className="mt-0.5 size-3.5 shrink-0" /> Nenhuma
            conexão com esta fonte ainda. O campo será criado, mas ficará vazio
            até você configurar o casamento em <strong>Campos → Conexões</strong>
            {" "}(o recálculo preenche automaticamente depois).
          </p>
        ) : null}
      </div>
      {startSource ? (
        <div className="flex flex-col gap-1.5">
          <span className="text-muted-foreground text-xs">
            3. Data INICIAL (do registro relacionado)
          </span>
          <Combobox
            options={startOptions}
            value={startRef}
            onValueChange={setStartRef}
            placeholder="Ex.: ↪ Leads: Criado em (origem)"
            emptyText="Nenhuma data disponível nesta fonte."
            aria-label="Data inicial"
            className="w-full"
          />
        </div>
      ) : null}
      <div className="flex items-center gap-2">
        <Button
          type="button"
          size="sm"
          disabled={!ready}
          onClick={() =>
            onApply(
              buildSalesCycle(endRef, startRef, {
                end: labelOf(endRef),
                start: labelOf(startRef),
              })
            )
          }
        >
          Gerar fórmula
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          Cancelar
        </Button>
        {endRef === TODAY_REF ? (
          <span className="text-muted-foreground text-xs">
            Dica: &quot;Data atual&quot; como final = dias em aberto até hoje.
          </span>
        ) : null}
      </div>
    </div>
  );
}

// ---- Taxa de conversão --------------------------------------------------------

function ConversionWizard({
  catalog,
  sources,
  onApply,
  onCancel,
}: {
  catalog: RefOption[];
  sources: SourceDef[];
  onApply: (r: RecipeResult) => void;
  onCancel: () => void;
}) {
  const [numSource, setNumSource] = useState("");
  const [numRef, setNumRef] = useState("");
  const [denSource, setDenSource] = useState("");
  const [denRef, setDenRef] = useState("");

  const sourceOptions: ComboboxOption[] = useMemo(
    () => sources.filter((s) => !s.parentKey).map((s) => ({ value: s.key, label: s.label })),
    [sources]
  );
  // Contagens da fonte: `agg:count:*@src` (registros) e `agg:count:<campo>@src`
  // (registros com o campo preenchido) — direto do catálogo agregado vivo.
  const countOptions = (src: string): ComboboxOption[] =>
    catalog
      .filter((r) => {
        if (!r.ref.startsWith("agg:count:") || r.disabledReason) return false;
        return parseAggRef(r.ref).source === src;
      })
      .map((r) => ({ value: r.ref, label: r.label }));

  const labelOf = (ref: string) =>
    catalog.find((r) => r.ref === ref)?.label ?? ref;
  const ready = numRef !== "" && denRef !== "";
  return (
    <div className="bg-muted/40 flex flex-col gap-2 rounded-md border p-3">
      <p className="text-xs font-medium">
        Taxa de conversão — contagem de uma fonte dividida pela contagem de
        outra (ex.: Deals ÷ Leads), exibida como percentual.
      </p>
      <div className="grid gap-2 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <span className="text-muted-foreground text-xs">
            1. Convertidos (numerador)
          </span>
          <Combobox
            options={sourceOptions}
            value={numSource}
            onValueChange={(v) => {
              setNumSource(v);
              setNumRef("");
            }}
            placeholder="Fonte — ex.: Deals"
            aria-label="Fonte do numerador"
            className="w-full"
          />
          {numSource ? (
            <Combobox
              options={countOptions(numSource)}
              value={numRef}
              onValueChange={setNumRef}
              placeholder="Contagem — ex.: Contagem de registros"
              emptyText="Nenhuma contagem disponível."
              aria-label="Contagem do numerador"
              className="w-full"
            />
          ) : null}
        </div>
        <div className="flex flex-col gap-1.5">
          <span className="text-muted-foreground text-xs">
            2. Base (denominador)
          </span>
          <Combobox
            options={sourceOptions}
            value={denSource}
            onValueChange={(v) => {
              setDenSource(v);
              setDenRef("");
            }}
            placeholder="Fonte — ex.: Leads"
            aria-label="Fonte do denominador"
            className="w-full"
          />
          {denSource ? (
            <Combobox
              options={countOptions(denSource)}
              value={denRef}
              onValueChange={setDenRef}
              placeholder="Contagem — ex.: Contagem de registros"
              emptyText="Nenhuma contagem disponível."
              aria-label="Contagem do denominador"
              className="w-full"
            />
          ) : null}
        </div>
      </div>
      <p className="text-muted-foreground text-xs">
        &quot;Contagem de <em>campo</em>&quot; conta só registros com o campo
        preenchido — ex.: Contagem de Data da assinatura ÷ Contagem de Data
        Reunião = conversão reunião → venda.
      </p>
      <div className="flex items-center gap-2">
        <Button
          type="button"
          size="sm"
          disabled={!ready}
          onClick={() =>
            onApply(
              buildConversionRate(numRef, denRef, {
                numerator: labelOf(numRef),
                denominator: labelOf(denRef),
              })
            )
          }
        >
          Gerar fórmula
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          Cancelar
        </Button>
      </div>
    </div>
  );
}
