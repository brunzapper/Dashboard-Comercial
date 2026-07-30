// Versão: 2.0 | Data: 30/07/2026
// v2.0 (30/07/2026): EDITOR UNIFICADO DE VERDADE — a dicotomia Visual (chips +
//   botões) × Texto foi eliminada. Uma única superfície de TEXTO (estilo
//   Google Sheets pt-BR, FormulaTextView) com:
//   - campos por LISTA/AUTOCOMPLETE: `[` abre a busca (sem acentos, lista
//     completa) e o Combobox "Adicionar coluna…" insere no caret;
//   - FUNÇÕES assistidas: autocomplete ao digitar letras (nomes + aliases),
//     paleta ƒ, e ASSINATURA VIVA (SignatureHelp) com o parâmetro ativo
//     destacado enquanto o caret está dentro da chamada;
//   - o resto digitado livre — operadores/números/textos são teclas, não
//     botões. 100% do que o modo texto fazia continua igual (mesmo tokenizador).
//   O contrato de form do FieldForm segue intocado: hidden `formula` (JSON),
//   `formula_text` e `formula_mode` — agora SEMPRE "text" ("builder" ficou
//   como valor legado que o servidor ainda aceita; texto vence lá desde
//   sempre). Efeito colateral aceito: fórmula legada token-only salva sem
//   edição ganha `source` — os tokens re-tokenizados são idênticos (round-trip
//   rótulo→ref pelo mesmo tokenizador; rótulo duplicado serializa a ref crua).
//
// Validação AO VIVO via validateFormulaForContext — as MESMAS regras/mensagens
// do servidor (campos/actions) — com warnings âmbar para operandos que
// degradariam para "—". Modo controlado (onChange): emite a fórmula + status a
// cada mudança REAL (assinatura em ref — nunca reemite por identidade nova de
// props).
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, CircleAlert, TriangleAlert } from "lucide-react";

import type { RefOption } from "@/lib/records/date-operands";
import {
  FormulaPreviewPanel,
  type FormulaPreviewAdapter,
} from "./formula-preview";
import {
  FormulaTextView,
  type FormulaTextViewHandle,
} from "./formula-text-view";
import { FunctionPalette } from "./function-palette";
import { SignatureHelp } from "./signature-help";
import { displayLabel } from "./operand-display";
import { SourceConceptsHint } from "./source-concepts-hint";
import { HelpHint } from "@/components/ui/help-hint";
import { Combobox, type ComboboxChip } from "@/components/ui/combobox";
import { cn } from "@/lib/utils";
import type { Formula, FormulaFuncName } from "@/lib/records/formulas";
import {
  formulaToSource,
  tokenizeFormulaText,
} from "@/lib/records/formula-text";
import { activeCall } from "@/lib/records/formula-assist";
import { FORMULA_FUNCS } from "@/lib/records/formula-funcs";
import {
  validateFormulaForContext,
  type FormulaContextValidation,
} from "@/lib/records/formula-validate";
import { refCustomKey } from "@/lib/records/formula-deps";
import type { SourceDef } from "@/lib/sources";

const CYCLE_REASON =
  "Criaria dependência circular: este campo depende (direta ou indiretamente) do campo em edição.";

export interface FormulaEditorProps {
  // Decide validação, funções disponíveis e ajuda contextual.
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
  // Modo controlado: fórmula + status a cada mudança real. Emite a fórmula
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

  // Serialização ref→texto: rótulo DUPLICADO no catálogo sai como ref crua —
  // `[Valor]` ambíguo não re-tokenizaria (o tokenizador exige a ref exata).
  const labelCount = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of displayCatalog) {
      const k = r.label.trim().toLocaleLowerCase("pt-BR");
      m.set(k, (m.get(k) ?? 0) + 1);
    }
    return m;
  }, [displayCatalog]);
  const labelFor = (ref: string) => {
    const r = displayCatalog.find((o) => o.ref === ref);
    if (!r) return ref;
    const dup =
      (labelCount.get(r.label.trim().toLocaleLowerCase("pt-BR")) ?? 0) > 1;
    return dup ? ref : r.label;
  };

  // Estado canônico ÚNICO: o texto (fórmula com `source` abre byte-idêntica;
  // token-only é serializada uma vez, na montagem).
  const [text, setText] = useState<string>(() =>
    formulaToSource(initial ?? null, labelFor)
  );
  const [caret, setCaret] = useState(0);
  const viewRef = useRef<FormulaTextViewHandle | null>(null);

  // Tokenização do texto — compartilhada por validação/emissão/prévia.
  const textTok = useMemo(
    () => (text.trim() ? tokenizeFormulaText(text, validationCatalog) : null),
    [text, validationCatalog]
  );

  const validation: LiveValidation | null = useMemo(() => {
    if (!text.trim() || !textTok) return null;
    if (!textTok.ok) return { ok: false, error: textTok.error };
    const v: FormulaContextValidation = validateFormulaForContext(
      textTok.formula,
      { kind: context, catalog: validationCatalog, sources }
    );
    return v.ok
      ? { ok: true, warnings: v.warnings }
      : { ok: false, error: v.error ?? "Fórmula inválida." };
  }, [text, textTok, context, validationCatalog, sources]);

  // Emissão por assinatura (modo controlado) — nunca reemitir o mesmo conteúdo
  // (identidade nova de `catalog` a cada render do host realimentaria o
  // setState do pai em loop; regra v1.1 do FormulaTextEditor).
  const lastEmitted = useRef<string | null>(null);
  useEffect(() => {
    if (!onChange) return;
    const formula: Formula = textTok?.ok ? textTok.formula : { tokens: [] };
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
  }, [textTok, validation]);

  // Fórmula corrente para a prévia (null = vazia ou texto não tokenizável).
  const currentFormula: Formula | null = textTok?.ok ? textTok.formula : null;

  // Assinatura viva: função que envolve o caret + argumento corrente.
  const call = useMemo(() => activeCall(text, caret), [text, caret]);
  const callSpec = call ? FORMULA_FUNCS[call.name] : null;

  const insertFunc = (name: FormulaFuncName) =>
    // `NOME()` com o caret DENTRO dos parênteses.
    viewRef.current?.insertAtCaret(`${name}()`, name.length + 1);

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      {formInputs ? (
        <>
          <input
            type="hidden"
            name="formula"
            value={JSON.stringify({ tokens: textTok?.ok ? textTok.formula.tokens : [] })}
          />
          <input type="hidden" name="formula_text" value={text} />
          {/* Sempre "text": o servidor re-tokeniza formula_text ("builder" é
              valor legado que ele ainda aceita, mas nunca mais enviamos). */}
          <input type="hidden" name="formula_mode" value="text" />
        </>
      ) : null}

      {header}

      {/* Toolbar mínima: campos por LISTA (insere no caret) + paleta ƒ. */}
      <div className="flex flex-wrap items-center gap-1.5">
        <Combobox
          options={displayCatalog.map((r) => ({
            value: r.ref,
            // Fonte curta só na EXIBIÇÃO — o texto insere o label limpo.
            label: displayLabel(r),
            cleanLabel: r.label,
            group: r.group,
            chips: r.chips,
            title: r.title,
            disabledReason: r.disabledReason,
          }))}
          chips={chips}
          value=""
          onValueChange={(ref) => {
            if (ref) viewRef.current?.insertAtCaret(`[${labelFor(ref)}]`);
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
        {context === "aggregate" ? <SourceConceptsHint /> : null}
      </div>

      <FormulaTextView
        ref={viewRef}
        text={text}
        onTextChange={setText}
        refs={displayCatalog}
        context={context}
        onCaretChange={setCaret}
      />

      {/* Assinatura viva da função sob o caret (parâmetro ativo destacado). */}
      {callSpec ? (
        <SignatureHelp spec={callSpec} argIndex={call?.argIndex ?? 0} />
      ) : null}

      {/* Linha de status (validação ao vivo). */}
      {validation ? (
        validation.ok ? (
          <>
            <p className="flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400">
              <Check className="size-3.5" /> Fórmula válida
            </p>
            {validation.warnings.map((w, i) => (
              <p
                key={i}
                className="flex items-start gap-1 text-xs text-amber-600 dark:text-amber-400"
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

      {/* Uma linha de orientação + o detalhe sob demanda (HelpHint). */}
      <p className="text-muted-foreground flex items-center gap-1.5 text-xs">
        <span>
          Digite <code>[</code> para inserir colunas; funções pelo nome ou pela
          paleta ƒ.
        </span>
        <HelpHint title="Sintaxe de fórmulas" ariaLabel="Sintaxe de fórmulas">
          <p>
            <strong>Colunas</strong> entre colchetes — digite <code>[</code> e
            busque pelo nome: <code>[Valor]</code>.
          </p>
          <p>
            <strong>Funções</strong> pelo nome (a lista aparece ao digitar) com
            argumentos separados por <code>;</code>:{" "}
            <code>SE(condição; então; senão)</code>.
          </p>
          <p>
            <strong>Comparações</strong>: <code>= &lt;&gt; &lt; &gt; &lt;=
            &gt;=</code>. Textos entre aspas (<code>&quot;Ganho&quot;</code>),
            números com vírgula ou ponto (<code>1,5</code>), datas como{" "}
            <code>&quot;2026-01-31&quot;</code>.
          </p>
          {context === "record" ? (
            <p>
              <strong>Data − data</strong> resulta em dias (ex.: ciclo de
              vendas). Colunas com ↪ vêm do registro casado de outra base
              (conexões entre bases).
            </p>
          ) : (
            <>
              <p>
                Opere entre <strong>agregações</strong> (Σ soma, média,
                contagem) e constantes. Operandos &quot;· Base&quot; contam SÓ
                aquela base — ex.: conversão = Contagem · Deals ÷ Contagem ·
                Leads.
              </p>
              <p>
                <strong>Condicionais</strong>:{" "}
                <code>SOMASE([Valor]; [Etapa] = &quot;Ganho&quot;)</code>,{" "}
                <code>CONT.SE(condição)</code>, <code>MÉDIASE</code>;{" "}
                <code>SOMASES</code>/<code>CONT.SES</code> encadeiam condições
                com <code>;</code> (E). Cada condição compara uma coluna com um
                valor fixo; texto ignora maiúsculas e espaços nas pontas.
              </p>
            </>
          )}
        </HelpHint>
      </p>

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
