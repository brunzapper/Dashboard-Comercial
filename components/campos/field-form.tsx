// Versão: 2.1 | Data: 20/07/2026
// v2.1 (20/07/2026): receitas guiadas na criação (RecipeStrip — a receita
//   escolhe tipo/fórmula/formato), prévias ao vivo (registros reais no
//   'calculado'; runCalculatedWidget no 'calculado_agg') e preset
//   initialDataType/initialFormula ("Salvar como campo reutilizável" do
//   builder de widgets).
// v2.0 (20/07/2026): editor de fórmula UNIFICADO (FormulaEditor) nos dois tipos
//   calculados — substitui o toggle Construtor/Texto + FormulaBuilder/
//   FormulaTextEditor; validação ao vivo com as regras do servidor, funções
//   montáveis por clique e operandos de ciclo desabilitados COM motivo (antes
//   escondidos). Contrato de hidden inputs (formula/formula_text/formula_mode)
//   preservado — o servidor fica intocado. Nova prop `sources` (warnings).
// v1.5 (19/07/2026): aninhamento de campos calculados — excludeKeys (o campo
//   em edição + dependentes transitivos, calculado pelo FieldsManager) filtra
//   dos catálogos os operandos que criariam ciclo; o construtor de botões do
//   "Calculado (totais)" aceita também o grupo de agregados aninhados
//   (AGG_NESTED_GROUP, ref plano custom:<key>).
// v1.4 (15/07/2026): exibição percentual — checkbox no tipo 'numero' e opção
//   "Percentual (%)" no Formato do resultado dos calculados.
// Formulário de criação/edição de um campo personalizado (field_definition).
// v1.1 (09/07/2026): Fase 7 — tipo "Calculado" abre o construtor de fórmula e o
//   toggle "Exibir nos seletores" (show_in_builder).
// v1.2 (14/07/2026): tipo "Calculado (totais)" (calculado_agg) — fórmula sobre
//   AGREGAÇÕES (Σ/Média/Contagem, catálogo aggRefs) avaliada por grupo nos
//   widgets; formato número | moeda FIXA (sem "herdar" — não há registro).
// v1.3 (14/07/2026): campo 'moeda' ganha seletor de modo — "Moeda do registro"
//   (inherit, padrão) ou moeda fixa (fixed:<code>).
"use client";

import { useActionState, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Combobox,
  type ComboboxChip,
  type ComboboxOption,
} from "@/components/ui/combobox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ROLE_LABELS, type RoleKey } from "@/lib/auth/roles";
import {
  DATA_TYPE_LABELS,
  type DataType,
  type FieldDefinition,
} from "@/lib/records/types";
import { CORE_SELECT_CAPABLE, isCoreDef } from "@/lib/records/core-defs";
import { CURRENCY_OPTIONS } from "@/lib/widgets/currency";
import type { SourceDef } from "@/lib/sources";
import {
  createField,
  updateField,
  type FieldActionState,
} from "@/app/(app)/campos/actions";
import { previewRecordFormula } from "@/app/(app)/campos/preview-actions";
import { previewAggregateFormula } from "@/app/(app)/dashboards/formula-preview-actions";
import type { RefOption } from "@/lib/records/date-operands";
import type { Formula } from "@/lib/records/formulas";
import { FormulaEditor } from "@/components/formula/formula-editor";
import { RecipeStrip } from "@/components/formula/recipe-strip";

const ROLE_KEYS = Object.keys(ROLE_LABELS) as RoleKey[];
const DATA_TYPE_OPTIONS: ComboboxOption[] = (
  Object.keys(DATA_TYPE_LABELS) as DataType[]
).map((t) => ({ value: t, label: DATA_TYPE_LABELS[t] }));
// Fallback quando o caller não passa as moedas habilitadas (Real/Dólar).
const DEFAULT_CURRENCY_OPTIONS: ComboboxOption[] = CURRENCY_OPTIONS.filter(
  (o) => o.value === "BRL" || o.value === "USD"
);
const initial: FieldActionState = {};
// Colunas núcleo de texto da whitelist (pipeline/etapa/...): texto ↔ seleção.
const CORE_TYPE_OPTIONS: ComboboxOption[] = (["texto", "selecao"] as DataType[]).map(
  (t) => ({ value: t, label: DATA_TYPE_LABELS[t] })
);

function RoleChecks({
  name,
  selected,
}: {
  name: string;
  selected: string[];
}) {
  return (
    <div className="flex flex-wrap gap-3">
      {ROLE_KEYS.map((role) => (
        <label key={role} className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            name={name}
            value={role}
            defaultChecked={selected.includes(role)}
            className="size-4 accent-primary"
          />
          {ROLE_LABELS[role]}
        </label>
      ))}
    </div>
  );
}

export function FieldForm({
  field,
  numericRefs,
  allRefs,
  aggRefs,
  excludeKeys,
  fieldChips,
  sources,
  currencyOptions,
  initialDataType,
  initialFormula,
  onDone,
}: {
  field?: FieldDefinition;
  numericRefs: RefOption[];
  // Catálogo completo do contexto POR-REGISTRO (números + datas + texto/
  // seleção/booleano p/ condicionais). Ausente → cai no numericRefs.
  allRefs?: RefOption[];
  // Catálogo de AGREGAÇÃO (agg:* + SOMASE/…) p/ o tipo "Calculado (totais do
  // recorte)". Ausente → o tipo ainda aparece, mas sem operandos.
  aggRefs?: RefOption[];
  // Chaves PROIBIDAS como operando da fórmula: o campo em edição + seus
  // dependentes transitivos (referenciá-los criaria ciclo — aninhamento,
  // 19/07/2026). Ausente → só o próprio campo fica de fora. O FormulaEditor as
  // exibe DESABILITADAS com o motivo (nunca escondidas) e as exclui da
  // validação — mesma regra do servidor.
  excludeKeys?: Set<string>;
  // Chips de fonte dos seletores de coluna das fórmulas (ver Combobox.chips).
  fieldChips?: ComboboxChip[];
  // Catálogo de fontes vivo — habilita os warnings de escopo do FormulaEditor.
  sources?: SourceDef[];
  // Moedas habilitadas para os seletores de moeda (default: Real/Dólar).
  currencyOptions?: ComboboxOption[];
  // Preset de CRIAÇÃO (ex.: "Salvar como campo reutilizável" de uma métrica
  // ad-hoc do widget): tipo e fórmula já preenchidos, tudo editável.
  initialDataType?: DataType;
  initialFormula?: Formula | null;
  // Recebe o campo recém-criado (só no create) para quem quiser usá-lo na hora.
  onDone?: (created?: FieldActionState["field"]) => void;
}) {
  const isEdit = Boolean(field);
  // Linha core (0086): coluna do núcleo de `records` — form em modo reduzido
  // (rótulo/olho/ordem; tipo travado, exceto texto↔seleção na whitelist).
  const isCore = Boolean(field && isCoreDef(field));
  const coreSelectable = isCore && CORE_SELECT_CAPABLE.has(field!.field_key);
  const action = isEdit ? updateField : createField;
  const [state, formAction, pending] = useActionState(action, initial);
  const [dataType, setDataType] = useState<DataType>(
    field?.data_type ?? initialDataType ?? "texto"
  );
  const currencyChoices =
    currencyOptions && currencyOptions.length > 0
      ? currencyOptions
      : DEFAULT_CURRENCY_OPTIONS;
  // Moeda de um campo 'moeda': herdada do registro (padrão) ou fixed:<code>.
  // Campo legado sem migração (mode null + code) continua exibindo o fixo.
  const [moedaCurrency, setMoedaCurrency] = useState(
    !field || field.currency_mode === "inherit"
      ? "inherit"
      : `fixed:${field.currency_code ?? "BRL"}`
  );
  const moedaMode = moedaCurrency === "inherit" ? "inherit" : "fixed";
  const moedaCode = moedaCurrency.startsWith("fixed:")
    ? moedaCurrency.slice("fixed:".length)
    : "";
  const moedaOptions: ComboboxOption[] = [
    { value: "inherit", label: "Moeda do registro (automática)" },
    ...currencyChoices.map((o) => ({
      value: `fixed:${o.value}`,
      label: `Moeda fixa — ${o.label}`,
    })),
  ];
  // "Formato do resultado" de um campo 'calculado': número | percentual |
  // herdar | fixed:<code>. Percentual (15/07/2026) exibe o valor ×100 + "%" e é
  // mutuamente exclusivo com moeda (mesmo combobox garante isso).
  const [calcCurrency, setCalcCurrency] = useState(
    field?.currency_mode === "inherit"
      ? "inherit"
      : field?.currency_mode === "fixed"
        ? `fixed:${field?.currency_code ?? "BRL"}`
        : field?.show_as_percent
          ? "percent"
          : "number"
  );
  const calcMode = calcCurrency.startsWith("fixed:")
    ? "fixed"
    : calcCurrency === "inherit"
      ? "inherit"
      : "";
  const calcCode = calcCurrency.startsWith("fixed:")
    ? calcCurrency.slice("fixed:".length)
    : "";
  const calcResultOptions: ComboboxOption[] = [
    { value: "number", label: "Número (sem moeda)" },
    { value: "percent", label: "Percentual (%) — exibe o valor ×100" },
    { value: "inherit", label: "Moeda — automática (dos operandos)" },
    ...currencyChoices.map((o) => ({
      value: `fixed:${o.value}`,
      label: `Moeda — ${o.label}`,
    })),
  ];

  // Ao editar um campo calculado, nem ele nem quem depende dele (transitivos)
  // podem ser operandos — criariam ciclo. Mesmo conjunto do servidor
  // (forbiddenOperandKeys em campos/actions.ts). O FormulaEditor os exibe
  // desabilitados com o motivo e os exclui da validação.
  const forbidden = excludeKeys ?? new Set(field ? [field.field_key] : []);
  // Formato do resultado do calculado_agg: número, moeda automática (preserva a
  // dos operandos; misturou → Real) ou moeda fixa (converte).
  const aggResultOptions: ComboboxOption[] = [
    { value: "number", label: "Número (sem moeda)" },
    { value: "percent", label: "Percentual (%) — exibe o valor ×100" },
    { value: "inherit", label: "Moeda — automática (dos operandos)" },
    ...currencyChoices.map((o) => ({
      value: `fixed:${o.value}`,
      label: `Moeda — ${o.label}`,
    })),
  ];
  // Fórmula vinda de uma RECEITA (Ciclo de vendas / Taxa de conversão): decide
  // o tipo do campo, pré-preenche o editor (remontado via nonce) e sugere o
  // formato — o usuário segue editando livremente a partir daí.
  const [recipeFormula, setRecipeFormula] = useState<Formula | null>(null);
  const [recipeNonce, setRecipeNonce] = useState(0);

  useEffect(() => {
    if (state.ok && onDone) onDone(state.field);
  }, [state.ok, state.field, onDone]);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      {isEdit ? <input type="hidden" name="id" value={field!.id} /> : null}

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="label">Rótulo</Label>
        <Input
          id="label"
          name="label"
          defaultValue={field?.label ?? ""}
          placeholder="Ex.: Forecast, Temperatura, Observações"
          required
        />
        {isEdit ? (
          <p className="text-muted-foreground text-xs">
            Chave: <code>{field!.field_key}</code> (não muda após criado)
          </p>
        ) : null}
      </div>

      <div className="flex flex-col gap-1.5">
        <Label>Tipo</Label>
        {isCore && !coreSelectable ? (
          <>
            <p className="text-sm">{DATA_TYPE_LABELS[dataType]}</p>
            <input type="hidden" name="data_type" value={dataType} />
            <p className="text-muted-foreground text-xs">
              Coluna do núcleo — o tipo é fixo.
            </p>
          </>
        ) : (
          <Combobox
            name="data_type"
            options={isCore ? CORE_TYPE_OPTIONS : DATA_TYPE_OPTIONS}
            value={dataType}
            onValueChange={(v) => setDataType(v as DataType)}
            searchable={false}
            className="w-full"
            aria-label="Tipo"
          />
        )}
        {isCore && coreSelectable ? (
          <p className="text-muted-foreground text-xs">
            Coluna do núcleo — pode alternar entre Texto e Seleção (as opções
            viram dropdown nos filtros e na edição inline).
          </p>
        ) : null}
      </div>

      {/* Receitas: geram a fórmula E escolhem o tipo certo (por-registro ou
          totais) — o usuário não precisa conhecer a distinção de antemão. */}
      {!isEdit ? (
        <RecipeStrip
          recipes={["sales_cycle", "conversion_rate"]}
          recordCatalog={allRefs ?? numericRefs}
          aggCatalog={aggRefs ?? []}
          sources={sources ?? []}
          onApply={(r) => {
            setDataType(r.target);
            setRecipeFormula(r.formula);
            setCalcCurrency(r.format === "percent" ? "percent" : "number");
            setRecipeNonce((n) => n + 1);
          }}
        />
      ) : null}

      {dataType === "selecao" ? (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="options">Opções (uma por linha)</Label>
          <Textarea
            id="options"
            name="options"
            defaultValue={(field?.options ?? []).join("\n")}
            placeholder={"Quente\nMorno\nFrio"}
            rows={4}
          />
          {isCore && field?.field_key === "pipeline" ? (
            <p className="text-muted-foreground text-xs">
              As opções são atualizadas automaticamente a cada sincronização
              (funis do Bitrix) — edições manuais serão sobrescritas.
            </p>
          ) : null}
        </div>
      ) : null}

      {!isCore && dataType === "numero" ? (
        <div className="flex flex-col gap-1.5">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              name="show_as_percent"
              defaultChecked={field?.show_as_percent ?? false}
              className="size-4 accent-primary"
            />
            Exibir como percentual (0,35 → 35%)
          </label>
          <p className="text-muted-foreground text-xs">
            Só a exibição muda: o valor armazenado continua cru e a edição usa o
            valor cru. Agregações (soma/média) em widgets também exibem em %.
          </p>
        </div>
      ) : null}

      {!isCore && dataType === "moeda" ? (
        <div className="flex flex-col gap-1.5">
          <Label>Moeda</Label>
          <Combobox
            options={moedaOptions}
            value={moedaCurrency}
            onValueChange={setMoedaCurrency}
            searchable={false}
            className="w-full"
            aria-label="Moeda"
          />
          <input type="hidden" name="currency_mode" value={moedaMode} />
          <input type="hidden" name="currency_code" value={moedaCode} />
          <p className="text-muted-foreground text-xs">
            Moeda do registro: o valor segue a coluna Moeda de cada registro
            (registros sem moeda contam como Real). Moeda fixa: todos os valores
            deste campo são exibidos nessa moeda. Habilite outras moedas em
            Configurações → Moedas.
          </p>
        </div>
      ) : null}

      {dataType === "calculado_agg" ? (
        <div className="flex flex-col gap-1.5">
          <Label>Fórmula (sobre os totais)</Label>
          <FormulaEditor
            key={`agg-${recipeNonce}`}
            context="aggregate"
            catalog={aggRefs ?? []}
            chips={fieldChips}
            sources={sources}
            initial={recipeFormula ?? field?.formula ?? initialFormula ?? null}
            formInputs
            excludeKeys={forbidden}
            preview={{
              title: "Prévia do resultado (todas as fontes)",
              manualStart: true,
              // Mesmo choke point dos widgets (runCalculatedWidget) — sem
              // período/filtros: o campo salvo respeita o recorte de cada
              // widget onde for usado.
              run: (f) =>
                previewAggregateFormula({
                  formulaJson: JSON.stringify(f),
                  sources: [],
                  filters: [],
                  resultPercent: calcCurrency === "percent",
                  resultCurrency: calcCurrency.startsWith("fixed:")
                    ? calcCurrency.slice("fixed:".length)
                    : null,
                }),
            }}
          />
          <p className="text-muted-foreground text-xs">
            O resultado é calculado sobre os <strong>totais do recorte</strong>{" "}
            (filtros/período do widget) e recalculado em cada grupo, subtotal e
            Total geral — não por registro. Ex.: ticket médio ={" "}
            <code>Σ MRR ÷ Contagem de registros</code>.
          </p>
          <Label className="mt-1">Formato do resultado</Label>
          <Combobox
            options={aggResultOptions}
            value={calcCurrency}
            onValueChange={setCalcCurrency}
            searchable={false}
            className="w-full"
            aria-label="Formato do resultado"
          />
          <input type="hidden" name="currency_mode" value={calcMode} />
          <input type="hidden" name="currency_code" value={calcCode} />
          <input
            type="hidden"
            name="show_as_percent"
            value={calcCurrency === "percent" ? "on" : ""}
          />
          <p className="text-muted-foreground text-xs">
            Percentual: o resultado exibe multiplicado por 100 (0,35 → 35%) em
            widgets e registros. Automática: os totais mantêm a moeda dos
            operandos quando é uma só; ao misturar moedas, os operandos são
            somados convertidos para Real (taxa do período). Moeda fixa converte
            o resultado para a moeda escolhida.
          </p>
          <label className="mt-1 flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              name="allow_negative"
              defaultChecked={field?.allow_negative ?? true}
              className="size-4 accent-primary"
            />
            Aceitar número negativo (desmarcado: resultado negativo vira 0)
          </label>
        </div>
      ) : null}

      {dataType === "calculado" ? (
        <div className="flex flex-col gap-1.5">
          <Label>Fórmula</Label>
          <FormulaEditor
            key={`rec-${recipeNonce}`}
            context="record"
            catalog={allRefs ?? numericRefs}
            chips={fieldChips}
            sources={sources}
            initial={recipeFormula ?? field?.formula ?? initialFormula ?? null}
            formInputs
            excludeKeys={forbidden}
            preview={{
              title: "Prévia (registros reais)",
              // Mesma montagem da materialização (record-eval-context +
              // computeFormulaFields) — o que a prévia mostra é o que o save
              // gravará em cada registro.
              run: (f) =>
                previewRecordFormula({
                  formulaJson: JSON.stringify(f),
                  formulaMode: "builder",
                  editingKey: field?.field_key,
                }),
            }}
          />
          <p className="text-muted-foreground text-xs">
            O resultado é calculado por registro a cada sincronização/edição
            (fórmulas com ↪ registro casado são atualizadas no
            auto-match/recálculo).
          </p>
          <Label className="mt-1">Formato do resultado</Label>
          <Combobox
            options={calcResultOptions}
            value={calcCurrency}
            onValueChange={setCalcCurrency}
            searchable={false}
            className="w-full"
            aria-label="Formato do resultado"
          />
          <input type="hidden" name="currency_mode" value={calcMode} />
          <input type="hidden" name="currency_code" value={calcCode} />
          <input
            type="hidden"
            name="show_as_percent"
            value={calcCurrency === "percent" ? "on" : ""}
          />
          <p className="text-muted-foreground text-xs">
            Percentual: o valor calculado exibe multiplicado por 100 (0,35 →
            35%) — o valor armazenado continua cru. Automática: o resultado
            mantém a moeda dos operandos (ex.: campo em US$ × 2 continua US$);
            ao misturar moedas diferentes, os valores são convertidos para Real
            pela taxa do período do registro. Moeda fixa converte tudo para a
            moeda escolhida.
          </p>
          <label className="mt-1 flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              name="allow_negative"
              defaultChecked={field?.allow_negative ?? true}
              className="size-4 accent-primary"
            />
            Aceitar número negativo (desmarcado: resultado negativo vira 0)
          </label>
        </div>
      ) : null}

      {isCore ? (
        <p className="text-muted-foreground text-xs">
          Colunas do núcleo são visíveis a todos os papéis.
        </p>
      ) : (
        <>
          <div className="flex flex-col gap-1.5">
            <Label>Visível para os papéis</Label>
            <RoleChecks name="visible_to_roles" selected={field?.visible_to_roles ?? []} />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>Editável pelos papéis</Label>
            <RoleChecks name="editable_by_roles" selected={field?.editable_by_roles ?? []} />
          </div>
        </>
      )}

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          name="show_in_builder"
          defaultChecked={field?.show_in_builder ?? true}
          className="size-4 accent-primary"
        />
        Exibir nos seletores (dropdowns do construtor e colunas de Registros)
      </label>

      {isEdit && field?.source_system === "bitrix" && field?.source_field_id ? (
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            name="write_back"
            defaultChecked={field?.write_back ?? false}
            className="size-4 accent-primary"
          />
          Sincronizar de volta para o Bitrix ao editar este campo
        </label>
      ) : null}

      {isCore && (field?.field_key === "pipeline" || field?.field_key === "stage") ? (
        <p className="text-muted-foreground text-xs">
          Edição inline com &quot;Gravar no Bitrix&quot; nesta coluna ainda não
          converte nome→id — o item fica com erro na fila e a edição local é
          preservada.
        </p>
      ) : null}

      <div className="flex items-center gap-4">
        {!isCore ? (
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              name="is_local"
              defaultChecked={field?.is_local ?? false}
              className="size-4 accent-primary"
            />
            Campo só do app (nunca vem de sync)
          </label>
        ) : null}
        <div className="flex items-center gap-2">
          <Label htmlFor="sort_order" className="text-sm">
            Ordem
          </Label>
          <Input
            id="sort_order"
            name="sort_order"
            type="number"
            defaultValue={field?.sort_order ?? 0}
            className="w-20"
          />
        </div>
      </div>

      {state.message ? (
        <p
          className={state.ok ? "text-muted-foreground text-sm" : "text-destructive text-sm"}
          role="status"
        >
          {state.message}
        </p>
      ) : null}

      <Button type="submit" disabled={pending} className="w-full">
        {pending ? "Salvando..." : isEdit ? "Salvar alterações" : "Criar campo"}
      </Button>
    </form>
  );
}
