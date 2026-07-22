// Versão: 1.0 | Data: 20/07/2026
// EDITOR DE FÓRMULA UNIFICADO — substitui o par FormulaBuilder/FormulaTextEditor
// e o toggle Construtor/Texto copiado em 5 sítios (FieldForm calculado e
// calculado_agg, widget "calculado", métrica ad-hoc do MetricRow e variáveis da
// calculadora). Duas VIEWS integradas sobre UM estado canônico:
//
// - Visual: chips com cursor de inserção (FormulaChips), paleta de funções
//   (FunctionPalette — SE/SOMASE/… montáveis por clique, antes só digitando),
//   operadores, comparações e literais. Trocar de view NUNCA perde conteúdo.
// - Texto: estilo Google Sheets pt-BR (FormulaTextView, autocomplete com `[`).
//   Texto inválido segura a aba (a conversão nunca é destrutiva).
//
// Validação AO VIVO nas duas views via validateFormulaForContext — as MESMAS
// regras/mensagens do servidor (campos/actions) — com warnings âmbar para
// operandos que degradariam para "—". Round-trip garantido: `Formula
// {tokens, source}` persiste igual; fórmula aberta e salva sem edição não muda.
//
// Modo formulário (formInputs): emite os três hidden do contrato do FieldForm
// (`formula` JSON, `formula_text`, `formula_mode` "builder"|"text") — o
// servidor fica intocado. Modo controlado (onChange): emite a fórmula + status
// a cada mudança REAL (assinatura em ref — nunca reemite por identidade nova
// de props, regra v1.1 do FormulaTextEditor).
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, CircleAlert, TriangleAlert } from "lucide-react";

import type { RefOption } from "@/lib/records/date-operands";
import { FormulaChips } from "./formula-chips";
import {
  FormulaPreviewPanel,
  type FormulaPreviewAdapter,
} from "./formula-preview";
import { FormulaTextView } from "./formula-text-view";
import { FunctionPalette } from "./function-palette";
import { SourceConceptsHint } from "./source-concepts-hint";
import { Button } from "@/components/ui/button";
import { Combobox, type ComboboxChip } from "@/components/ui/combobox";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type {
  Formula,
  FormulaCmpOp,
  FormulaFuncName,
  FormulaOp,
  FormulaToken,
} from "@/lib/records/formulas";
import {
  formulaToSource,
  tokenizeFormulaText,
} from "@/lib/records/formula-text";
import {
  validateFormulaForContext,
  type FormulaContextValidation,
} from "@/lib/records/formula-validate";
import { refCustomKey } from "@/lib/records/formula-deps";
import type { SourceDef } from "@/lib/sources";

const CYCLE_REASON =
  "Criaria dependência circular: este campo depende (direta ou indiretamente) do campo em edição.";

export interface FormulaEditorProps {
  // Decide validação, funções disponíveis e textos de ajuda.
  context: "record" | "aggregate";
  // Catálogo COMPLETO do contexto (perRecordCalcOperands.allRefs ou
  // buildAggOperandCatalog), já decorado (decorateRefOptions). Operandos com
  // disabledReason aparecem desabilitados COM o motivo (nunca escondidos).
  catalog: RefOption[];
  // Chips de fonte do seletor de coluna (navegação — ver Combobox.chips).
  chips?: ComboboxChip[];
  // Catálogo de fontes vivo — habilita os warnings de escopo @fonte.
  sources?: SourceDef[];
  initial?: Formula | null;
  // Modo controlado: fórmula + status a cada mudança real. Visual emite os
  // tokens como estão (o save do host acusa inválida); texto emite a fórmula
  // tokenizada (com source) ou {tokens: []} se o texto não tokeniza.
  onChange?: (formula: Formula, v: { ok: boolean; error?: string }) => void;
  // Emite os hidden formula/formula_text/formula_mode (forms nativos/FieldForm).
  formInputs?: boolean;
  // Chaves proibidas como operando (o campo em edição + dependentes
  // transitivos): entram DESABILITADAS no seletor (com motivo) e fora do
  // conjunto de validação — mesma regra do servidor (forbiddenOperandKeys).
  excludeKeys?: Set<string>;
  // Prévia ao vivo (FormulaPreviewPanel): o adapter calcula pelo MESMO caminho
  // da materialização/engine; o editor chama com a fórmula válida (debounce).
  preview?: FormulaPreviewAdapter;
  // Slots opcionais: receitas acima (Fase 2) e conteúdo extra abaixo.
  header?: React.ReactNode;
  footer?: React.ReactNode;
  className?: string;
}

type LiveValidation =
  | { ok: true; warnings: string[] }
  | { ok: false; error: string };

export function FormulaEditor({
  context,
  catalog,
  chips,
  sources,
  initial,
  onChange,
  formInputs,
  excludeKeys,
  preview,
  header,
  footer,
  className,
}: FormulaEditorProps) {
  // Catálogo de EXIBIÇÃO: refs de ciclo entram desabilitadas com motivo.
  // Catálogo de VALIDAÇÃO: sem as refs de ciclo (mesmo conjunto do servidor);
  // os demais desabilitados (ex.: "Data atual" no agregado) PERMANECEM — a
  // validação de contexto dá a mensagem dedicada, melhor que "coluna inválida".
  const displayCatalog = useMemo(() => {
    if (!excludeKeys || excludeKeys.size === 0) return catalog;
    return catalog.map((r) => {
      const key = refCustomKey(r.ref);
      return key != null && excludeKeys.has(key)
        ? { ...r, disabledReason: r.disabledReason ?? CYCLE_REASON }
        : r;
    });
  }, [catalog, excludeKeys]);
  const validationCatalog = useMemo(() => {
    if (!excludeKeys || excludeKeys.size === 0) return catalog;
    return catalog.filter((r) => {
      const key = refCustomKey(r.ref);
      return key == null || !excludeKeys.has(key);
    });
  }, [catalog, excludeKeys]);

  const labelFor = (ref: string) =>
    displayCatalog.find((r) => r.ref === ref)?.label ?? ref;

  // Estado canônico: tokens+cursor (view visual) e texto (view texto). Fórmula
  // com `source` abre no texto (preserva o texto autorado); as demais abrem no
  // visual — que agora representa funções (a paleta cobre o que o construtor
  // antigo não tinha).
  const [mode, setMode] = useState<"visual" | "text">(
    initial?.source ? "text" : "visual"
  );
  const [tokens, setTokens] = useState<FormulaToken[]>(initial?.tokens ?? []);
  const [caret, setCaret] = useState<number>((initial?.tokens ?? []).length);
  const [text, setText] = useState<string>(() =>
    formulaToSource(initial ?? null, labelFor)
  );
  // O texto só é regenerado dos tokens quando a edição visual o tornou velho —
  // preserva o texto original (source) em "abrir e salvar sem editar".
  const textStale = useRef(false);

  // Tokenização do texto (view texto) — compartilhada por validação/emissão/troca.
  const textTok = useMemo(
    () =>
      mode === "text" && text.trim()
        ? tokenizeFormulaText(text, validationCatalog)
        : null,
    [mode, text, validationCatalog]
  );

  const validation: LiveValidation | null = useMemo(() => {
    const ctx = { kind: context, catalog: validationCatalog, sources };
    if (mode === "text") {
      if (!text.trim()) return null;
      if (!textTok) return null;
      if (!textTok.ok) return { ok: false, error: textTok.error };
      const v: FormulaContextValidation = validateFormulaForContext(
        textTok.formula,
        ctx
      );
      return v.ok
        ? { ok: true, warnings: v.warnings }
        : { ok: false, error: v.error ?? "Fórmula inválida." };
    }
    if (tokens.length === 0) return null;
    const v = validateFormulaForContext({ tokens }, ctx);
    return v.ok
      ? { ok: true, warnings: v.warnings }
      : { ok: false, error: v.error ?? "Fórmula inválida." };
  }, [mode, text, textTok, tokens, context, validationCatalog, sources]);

  // Emissão por assinatura (modo controlado) — nunca reemitir o mesmo conteúdo
  // (identidade nova de `catalog` a cada render do host realimentaria o
  // setState do pai em loop; regra v1.1 do FormulaTextEditor).
  const lastEmitted = useRef<string | null>(null);
  useEffect(() => {
    if (!onChange) return;
    const formula: Formula =
      mode === "text"
        ? textTok?.ok
          ? textTok.formula
          : { tokens: [] }
        : { tokens };
    const status = validation
      ? validation.ok
        ? { ok: true as const }
        : { ok: false as const, error: validation.error }
      : { ok: false as const };
    const sig = JSON.stringify([formula, status]);
    if (sig === lastEmitted.current) return;
    lastEmitted.current = sig;
    onChange(formula, status);
    // onChange é passado inline pelo host; dependemos só do conteúdo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, textTok, tokens, validation]);

  // ---- Edição visual (sempre no cursor) --------------------------------------
  const insertAt = (ts: FormulaToken[], caretOffset?: number) => {
    setTokens((prev) => [
      ...prev.slice(0, caret),
      ...ts,
      ...prev.slice(caret),
    ]);
    setCaret((c) => c + (caretOffset ?? ts.length));
    textStale.current = true;
  };
  const removeAt = (i: number) => {
    setTokens((prev) => prev.filter((_, idx) => idx !== i));
    setCaret((c) => (i < c ? c - 1 : c));
    textStale.current = true;
  };
  const insertFunc = (name: FormulaFuncName) =>
    // FUNC ( ) com o cursor DENTRO dos parênteses.
    insertAt(
      [{ kind: "func", name }, { kind: "lparen" }, { kind: "rparen" }],
      2
    );

  const [constValue, setConstValue] = useState("");
  const addConst = () => {
    const n = Number(constValue.replace(",", "."));
    if (!Number.isFinite(n)) return;
    insertAt([{ kind: "const", value: n }]);
    setConstValue("");
  };
  const [strValue, setStrValue] = useState("");
  const addStr = () => {
    if (!strValue.trim()) return;
    insertAt([{ kind: "str", value: strValue }]);
    setStrValue("");
  };

  // ---- Troca de view (nunca destrutiva) --------------------------------------
  // Fórmula corrente para a prévia (null = vazia ou texto não tokenizável).
  const currentFormula: Formula | null = useMemo(() => {
    if (mode === "text") return textTok?.ok ? textTok.formula : null;
    return tokens.length > 0 ? { tokens } : null;
  }, [mode, textTok, tokens]);

  const textBlocked = mode === "text" && textTok != null && !textTok.ok;
  const switchTo = (next: "visual" | "text") => {
    if (next === mode) return;
    if (next === "text") {
      if (textStale.current) {
        setText(formulaToSource({ tokens }, labelFor));
        textStale.current = false;
      }
      setMode("text");
      return;
    }
    // texto → visual: só com texto vazio ou tokenizável (sem conversão
    // destrutiva; a aba Visual fica desabilitada enquanto o texto tem erro).
    if (!text.trim()) {
      setTokens([]);
      setCaret(0);
      textStale.current = false;
      setMode("visual");
      return;
    }
    if (textTok?.ok) {
      setTokens(textTok.formula.tokens);
      setCaret(textTok.formula.tokens.length);
      textStale.current = false;
      setMode("visual");
    }
  };

  const OPS: { op: FormulaOp; glyph: string }[] = [
    { op: "+", glyph: "+" },
    { op: "-", glyph: "−" },
    { op: "*", glyph: "×" },
    { op: "/", glyph: "÷" },
  ];
  const CMPS: { op: FormulaCmpOp; glyph: string }[] = [
    { op: "=", glyph: "=" },
    { op: "<>", glyph: "≠" },
    { op: "<", glyph: "<" },
    { op: ">", glyph: ">" },
    { op: "<=", glyph: "≤" },
    { op: ">=", glyph: "≥" },
  ];

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      {formInputs ? (
        <>
          <input
            type="hidden"
            name="formula"
            value={JSON.stringify({ tokens })}
          />
          <input type="hidden" name="formula_text" value={text} />
          <input
            type="hidden"
            name="formula_mode"
            value={mode === "text" ? "text" : "builder"}
          />
        </>
      ) : null}

      {header}

      <div className="flex items-center gap-2">
        <div className="bg-muted flex gap-1 self-start rounded-md p-0.5">
          {(
            [
              ["visual", "Visual"],
              ["text", "Texto"],
            ] as const
          ).map(([k, label]) => {
            const blocked = k === "visual" && textBlocked;
            return (
              <button
                key={k}
                type="button"
                onClick={() => switchTo(k)}
                disabled={blocked}
                title={
                  blocked
                    ? "Corrija o erro do texto para voltar ao modo visual (a troca nunca descarta o que você digitou)."
                    : undefined
                }
                className={cn(
                  "rounded-sm px-2 py-1 text-xs",
                  mode === k
                    ? "bg-background shadow-sm"
                    : "text-muted-foreground",
                  blocked && "cursor-not-allowed opacity-50"
                )}
              >
                {label}
              </button>
            );
          })}
        </div>
        {context === "aggregate" ? <SourceConceptsHint /> : null}
      </div>

      {mode === "visual" ? (
        <>
          <FormulaChips
            tokens={tokens}
            caret={caret}
            catalog={displayCatalog}
            onCaret={setCaret}
            onRemove={removeAt}
            onBackspace={() => {
              if (caret > 0) removeAt(caret - 1);
            }}
          />

          {/* Operadores, comparações e pontuação — inserem no cursor. */}
          <div className="flex flex-wrap items-center gap-1.5">
            {OPS.map((o) => (
              <Button
                key={o.op}
                type="button"
                variant="outline"
                size="sm"
                onClick={() => insertAt([{ kind: "op", op: o.op }])}
              >
                {o.glyph}
              </Button>
            ))}
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => insertAt([{ kind: "lparen" }])}
            >
              (
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => insertAt([{ kind: "rparen" }])}
            >
              )
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              title="Separador de argumentos de função"
              onClick={() => insertAt([{ kind: "argsep" }])}
            >
              ;
            </Button>
            <span className="bg-border mx-0.5 h-5 w-px" aria-hidden />
            {CMPS.map((c) => (
              <Button
                key={c.op}
                type="button"
                variant="outline"
                size="sm"
                title="Comparação (para condições de SE/SOMASE/…)"
                onClick={() => insertAt([{ kind: "cmp", op: c.op }])}
              >
                {c.glyph}
              </Button>
            ))}
            {tokens.length > 0 ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  setTokens([]);
                  setCaret(0);
                  textStale.current = true;
                }}
              >
                Limpar
              </Button>
            ) : null}
          </div>

          {/* Coluna + função — inserem no cursor. */}
          <div className="flex flex-wrap gap-1.5">
            <Combobox
              options={displayCatalog.map((r) => ({
                value: r.ref,
                // Fonte curta só na EXIBIÇÃO — tokens/chips seguem o label limpo.
                label: r.sourceHint ? `${r.sourceHint} · ${r.label}` : r.label,
                cleanLabel: r.label,
                group: r.group,
                chips: r.chips,
                title: r.title,
                disabledReason: r.disabledReason,
              }))}
              chips={chips}
              value=""
              onValueChange={(ref) => {
                if (ref) insertAt([{ kind: "field", ref }]);
              }}
              placeholder="Adicionar coluna…"
              emptyText="Nenhuma coluna disponível"
              className="min-w-48 flex-1"
              aria-label="Adicionar coluna"
            />
            <FunctionPalette
              context={context}
              onInsert={insertFunc}
              className="min-w-40"
            />
          </div>

          {/* Constantes: número e texto (literal de condição). */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1.5">
              <Input
                type="number"
                step="any"
                value={constValue}
                onChange={(e) => setConstValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addConst();
                  }
                }}
                placeholder="Número (ex.: 12)"
                className="w-36"
                aria-label="Número"
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={addConst}
                disabled={constValue === ""}
              >
                Inserir número
              </Button>
            </div>
            <div className="flex items-center gap-1.5">
              <Input
                value={strValue}
                onChange={(e) => setStrValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addStr();
                  }
                }}
                placeholder='Texto (ex.: Ganho)'
                className="w-36"
                aria-label="Texto"
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={addStr}
                disabled={!strValue.trim()}
              >
                Inserir texto
              </Button>
            </div>
          </div>
        </>
      ) : (
        <FormulaTextView
          text={text}
          onTextChange={(t) => setText(t)}
          refs={displayCatalog}
        />
      )}

      {/* Linha de status ÚNICA das duas views (validação ao vivo). */}
      {validation ? (
        validation.ok ? (
          <>
            <p className="flex items-center gap-1 text-xs text-emerald-600">
              <Check className="size-3.5" /> Fórmula válida
            </p>
            {validation.warnings.map((w, i) => (
              <p
                key={i}
                className="flex items-start gap-1 text-xs text-amber-600"
              >
                <TriangleAlert className="mt-0.5 size-3.5 shrink-0" /> {w}
              </p>
            ))}
          </>
        ) : (
          <p className="text-destructive flex items-start gap-1 text-xs">
            <CircleAlert className="mt-0.5 size-3.5 shrink-0" />{" "}
            {validation.error}
          </p>
        )
      ) : null}

      {/* Ajuda contextual (única — antes espalhada pelos hosts). */}
      {mode === "text" ? (
        <p className="text-muted-foreground text-xs">
          Funções: <code>SE(condição; então; senão)</code>, <code>E(…)</code>,{" "}
          <code>OU(…)</code>. Separe argumentos com <code>;</code>. Colunas
          entre colchetes — digite <code>[</code> para buscar. Comparações:{" "}
          <code>= &lt;&gt; &lt; &gt; &lt;= &gt;=</code>. Textos entre aspas:{" "}
          <code>&quot;Ganho&quot;</code>.
        </p>
      ) : context === "record" ? (
        <p className="text-muted-foreground text-xs">
          Opere entre colunas numéricas e datas: <strong>data − data</strong>{" "}
          resulta em dias (ex.: ciclo de vendas). Colunas com ↪ vêm do registro
          casado de outra base (conexões entre bases). Condições usam{" "}
          <code>ƒ SE</code> + uma comparação (ex.: SE( [Etapa] = &quot;Ganho&quot;
          ; [Valor] ; 0 )).
        </p>
      ) : (
        <p className="text-muted-foreground text-xs">
          Opere entre <strong>agregações</strong> (Σ soma, média, contagem) e
          constantes. Operandos &quot;· Base&quot; contam SÓ aquela base —
          ex.: taxa de conversão = Contagem de registros · Deals ÷ Contagem de
          registros · Leads. Condicionais: <code>ƒ SOMASE/CONT.SE</code> com
          condição <code>[Coluna] = valor</code>.
        </p>
      )}
      {mode === "text" && context === "aggregate" ? (
        <p className="text-muted-foreground text-xs">
          Condicionais de agregação:{" "}
          <code>SOMASE([Valor]; [Etapa] = &quot;Ganho&quot;)</code>,{" "}
          <code>CONT.SE([Etapa] = &quot;Ganho&quot;)</code>,{" "}
          <code>MÉDIASE([Valor]; condição)</code>; várias condições (E):{" "}
          <code>SOMASES</code>/<code>CONT.SES</code> com condições separadas
          por <code>;</code>. Cada condição compara uma coluna com um valor
          fixo. Texto compara como no <code>SE</code> (ignora
          maiúsculas/minúsculas e espaços nas pontas); números sem aspas
          comparam como número; datas no formato{" "}
          <code>&quot;2026-01-31&quot;</code>.
        </p>
      ) : null}

      {preview ? (
        <FormulaPreviewPanel
          adapter={preview}
          formula={currentFormula}
          valid={Boolean(validation?.ok)}
        />
      ) : null}

      {footer}
    </div>
  );
}
