// Versão: 1.4 | Data: 15/07/2026
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
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ROLE_LABELS, type RoleKey } from "@/lib/auth/roles";
import {
  DATA_TYPE_LABELS,
  type DataType,
  type FieldDefinition,
} from "@/lib/records/types";
import { CURRENCY_OPTIONS } from "@/lib/widgets/currency";
import { formulaUsesFunctions } from "@/lib/records/formulas";
import { cn } from "@/lib/utils";
import {
  createField,
  updateField,
  type FieldActionState,
} from "@/app/(app)/campos/actions";
import { FormulaBuilder, type RefOption } from "./formula-builder";
import { FormulaTextEditor } from "./formula-text-editor";

const ROLE_KEYS = Object.keys(ROLE_LABELS) as RoleKey[];
const DATA_TYPE_OPTIONS: ComboboxOption[] = (
  Object.keys(DATA_TYPE_LABELS) as DataType[]
).map((t) => ({ value: t, label: DATA_TYPE_LABELS[t] }));
// Fallback quando o caller não passa as moedas habilitadas (Real/Dólar).
const DEFAULT_CURRENCY_OPTIONS: ComboboxOption[] = CURRENCY_OPTIONS.filter(
  (o) => o.value === "BRL" || o.value === "USD"
);
const initial: FieldActionState = {};

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
  currencyOptions,
  onDone,
}: {
  field?: FieldDefinition;
  numericRefs: RefOption[];
  // Catálogo completo p/ o editor de TEXTO (números + datas + texto/seleção/
  // booleano p/ condicionais). Ausente → cai no numericRefs.
  allRefs?: RefOption[];
  // Operandos de AGREGAÇÃO (agg:*) p/ o tipo "Calculado (totais)". Ausente →
  // o tipo ainda aparece, mas sem operandos (caller deve passar).
  aggRefs?: RefOption[];
  // Moedas habilitadas para os seletores de moeda (default: Real/Dólar).
  currencyOptions?: ComboboxOption[];
  // Recebe o campo recém-criado (só no create) para quem quiser usá-lo na hora.
  onDone?: (created?: FieldActionState["field"]) => void;
}) {
  const isEdit = Boolean(field);
  const action = isEdit ? updateField : createField;
  const [state, formAction, pending] = useActionState(action, initial);
  const [dataType, setDataType] = useState<DataType>(
    field?.data_type ?? "texto"
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

  // Ao editar um campo calculado, ele não pode ser operando de si mesmo.
  const operandRefs = numericRefs.filter(
    (r) => r.ref !== `custom:${field?.field_key}`
  );
  const textRefs = (allRefs ?? numericRefs).filter(
    (r) => r.ref !== `custom:${field?.field_key}`
  );
  // Operandos de agregação (calculado_agg): Σ/Média do próprio campo fora.
  const aggOperands = (aggRefs ?? []).filter(
    (r) => !r.ref.endsWith(`:custom:${field?.field_key}`)
  );
  // O construtor de botões só expressa + − × ÷ — recebe apenas os operandos
  // agregados (agg:*). Os operandos de SOMASE/CONT.SE/MÉDIASE (campos crus e
  // colunas de condição) ficam só no editor de texto, que sabe usá-los.
  const aggBuilderOperands = aggOperands.filter((r) => r.ref.startsWith("agg:"));
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
  // Editor da fórmula: construtor por botões (fórmulas simples) ou texto estilo
  // Sheets (obrigatório p/ SE/E/OU — o construtor não representa funções).
  const [formulaMode, setFormulaMode] = useState<"builder" | "text">(
    field?.formula && (field.formula.source || formulaUsesFunctions(field.formula))
      ? "text"
      : "builder"
  );

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
        <Combobox
          name="data_type"
          options={DATA_TYPE_OPTIONS}
          value={dataType}
          onValueChange={(v) => setDataType(v as DataType)}
          searchable={false}
          className="w-full"
          aria-label="Tipo"
        />
      </div>

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
        </div>
      ) : null}

      {dataType === "numero" ? (
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

      {dataType === "moeda" ? (
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
          <input type="hidden" name="formula_mode" value={formulaMode} />
          <div className="bg-muted flex gap-1 self-start rounded-md p-0.5">
            {(
              [
                ["builder", "Construtor"],
                ["text", "Texto (funções)"],
              ] as const
            ).map(([k, label]) => (
              <button
                key={k}
                type="button"
                onClick={() => setFormulaMode(k)}
                className={cn(
                  "rounded-sm px-2 py-1 text-xs",
                  formulaMode === k
                    ? "bg-background shadow-sm"
                    : "text-muted-foreground"
                )}
              >
                {label}
              </button>
            ))}
          </div>
          {formulaMode === "builder" ? (
            <FormulaBuilder refs={aggBuilderOperands} initial={field?.formula ?? null} />
          ) : (
            <FormulaTextEditor refs={aggOperands} initial={field?.formula ?? null} />
          )}
          <p className="text-muted-foreground text-xs">
            Opere entre <strong>agregações</strong> (Σ soma, média e contagem
            dos campos) e constantes — ex.: ticket médio ={" "}
            <code>Σ MRR ÷ Contagem de registros</code>. O resultado é calculado
            sobre os <strong>totais do recorte</strong> (filtros/período do
            widget) e recalculado em cada grupo, subtotal e Total geral — não
            por registro.
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
          <input type="hidden" name="formula_mode" value={formulaMode} />
          <div className="bg-muted flex gap-1 self-start rounded-md p-0.5">
            {(
              [
                ["builder", "Construtor"],
                ["text", "Texto (funções)"],
              ] as const
            ).map(([k, label]) => (
              <button
                key={k}
                type="button"
                onClick={() => setFormulaMode(k)}
                className={cn(
                  "rounded-sm px-2 py-1 text-xs",
                  formulaMode === k
                    ? "bg-background shadow-sm"
                    : "text-muted-foreground"
                )}
              >
                {label}
              </button>
            ))}
          </div>
          {formulaMode === "builder" ? (
            <>
              <FormulaBuilder refs={operandRefs} initial={field?.formula ?? null} />
              <p className="text-muted-foreground text-xs">
                Opere entre colunas numéricas e datas (+ − × ÷) e constantes.{" "}
                <strong>data − data</strong> resulta em dias (ex.: lead time).
                Você pode usar datas do registro casado (↪) via conexões entre
                fontes. Para condicionais (SE/E/OU), use a aba{" "}
                <strong>Texto (funções)</strong>. O resultado é calculado por
                registro a cada sincronização/edição (os que usam ↪ são
                atualizados no auto-match/recálculo).
              </p>
            </>
          ) : (
            <FormulaTextEditor refs={textRefs} initial={field?.formula ?? null} />
          )}
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

      <div className="flex flex-col gap-1.5">
        <Label>Visível para os papéis</Label>
        <RoleChecks name="visible_to_roles" selected={field?.visible_to_roles ?? []} />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label>Editável pelos papéis</Label>
        <RoleChecks name="editable_by_roles" selected={field?.editable_by_roles ?? []} />
      </div>

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

      <div className="flex items-center gap-4">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            name="is_local"
            defaultChecked={field?.is_local ?? false}
            className="size-4 accent-primary"
          />
          Campo só do app (nunca vem de sync)
        </label>
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
