// Versão: 2.1 | Data: 30/07/2026
// v2.1 (30/07/2026): dropdown de sugestões sobre Radix Popover ancorado no
//   textarea — registra na pilha de layers do Dialog modal (Sheet), que
//   devolve pointer-events e isenta do scroll-lock; o portal `fixed` manual
//   da v2.0 herdava o `pointer-events: none` do body e ficava inclicável e
//   sem rolagem dentro do Sheet.
// v2.0 (30/07/2026): superfície ÚNICA do FormulaEditor (o modo visual de
//   chips/botões foi absorvido): campos por autocomplete no `[` (busca sem
//   acentos, lista completa com scroll, Escape fecha, substituição da ref
//   INTEIRA quando o caret está no meio dela — sem `]` órfão), autocomplete de
//   FUNÇÕES ao digitar letras (nomes + aliases, insere `NOME()` com o caret
//   dentro), dropdown em portal (não é cortado pelo overflow do
//   Sheet/Accordion) e `insertAtCaret` imperativo para a toolbar do editor.
//   Enter/Tab só são interceptados com a lista ABERTA. O caret é reportado ao
//   pai (onCaretChange) para a assinatura viva.
// Operando desabilitado (disabledReason) aparece acinzentado e não-inserível,
// com o motivo no tooltip — explicar, nunca esconder.
"use client";

import {
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";

import { displaySourceHint } from "@/components/formula/operand-display";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { RefOption } from "@/lib/records/date-operands";
import {
  bracketRangeAt,
  funcWordAt,
  matchFunctions,
  normalizeSearch,
} from "@/lib/records/formula-assist";
import {
  funcSignature,
  type FormulaFuncSpec,
} from "@/lib/records/formula-funcs";

export interface FormulaTextViewHandle {
  /** Insere no caret atual (toolbar). Caret final = start + caretOffset. */
  insertAtCaret: (snippet: string, caretOffset?: number) => void;
}

export function FormulaTextView({
  text,
  onTextChange,
  refs,
  context,
  onCaretChange,
  ref,
}: {
  text: string;
  onTextChange: (text: string) => void;
  refs: RefOption[];
  context: "record" | "aggregate";
  onCaretChange?: (caret: number) => void;
  ref?: React.Ref<FormulaTextViewHandle>;
}) {
  const [cursor, setCursorState] = useState(0);
  const [suggestIndex, setSuggestIndex] = useState(0);
  // Escape fecha a lista até a PRÓXIMA digitação (nunca some para sempre).
  const [dismissed, setDismissed] = useState(false);
  const taRef = useRef<HTMLTextAreaElement | null>(null);

  const setCursor = (pos: number) => {
    setCursorState(pos);
    onCaretChange?.(pos);
  };

  // ---- Contextos de sugestão (helpers puros de formula-assist) --------------
  const frag = useMemo(() => bracketRangeAt(text, cursor), [text, cursor]);
  const funcWord = useMemo(
    () => (frag ? null : funcWordAt(text, cursor)),
    [frag, text, cursor],
  );

  const fieldSuggestions = useMemo(() => {
    if (!frag) return [];
    const q = normalizeSearch(frag.query);
    // Busca também pela fonte (sourceHint): digitar "[deals" lista os campos
    // dessa fonte. A inserção continua usando só o rótulo limpo.
    return refs.filter((r) =>
      normalizeSearch(`${r.sourceHint ?? ""} ${r.label}`).includes(q),
    );
  }, [frag, refs]);

  const funcSuggestions = useMemo(
    () => (funcWord ? matchFunctions(funcWord.word, context) : []),
    [funcWord, context],
  );

  const listKind: "field" | "func" | null =
    !dismissed && fieldSuggestions.length > 0
      ? "field"
      : !dismissed && funcSuggestions.length > 0
        ? "func"
        : null;
  const listLength =
    listKind === "field"
      ? fieldSuggestions.length
      : listKind === "func"
        ? funcSuggestions.length
        : 0;

  // Rótulos duplicados (dois campos com o mesmo nome) inserem a ref bruta para
  // não ficarem ambíguos no tokenizador.
  const labelCount = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of refs) {
      const k = r.label.trim().toLocaleLowerCase("pt-BR");
      m.set(k, (m.get(k) ?? 0) + 1);
    }
    return m;
  }, [refs]);

  function syncCursor() {
    setCursor(taRef.current?.selectionStart ?? 0);
  }

  // Substitui [start, end) por `snippet` e posiciona o caret.
  function applyEdit(
    start: number,
    end: number,
    snippet: string,
    caretOffset?: number,
  ) {
    const next = text.slice(0, start) + snippet + text.slice(end);
    onTextChange(next);
    setSuggestIndex(0);
    setDismissed(false);
    const pos = start + (caretOffset ?? snippet.length);
    requestAnimationFrame(() => {
      taRef.current?.focus();
      taRef.current?.setSelectionRange(pos, pos);
      setCursor(pos);
    });
  }

  function insertField(r: RefOption) {
    if (!frag || r.disabledReason) return;
    const dup =
      (labelCount.get(r.label.trim().toLocaleLowerCase("pt-BR")) ?? 0) > 1;
    applyEdit(frag.start, frag.end, `[${dup ? r.ref : r.label}]`);
  }

  function insertFunc(spec: FormulaFuncSpec) {
    if (!funcWord) return;
    // `NOME()` com o caret DENTRO dos parênteses.
    applyEdit(funcWord.start, cursor, `${spec.name}()`, spec.name.length + 1);
  }

  useImperativeHandle(ref, () => ({
    insertAtCaret: (snippet: string, caretOffset?: number) => {
      const at = taRef.current?.selectionStart ?? cursor;
      applyEdit(at, at, snippet, caretOffset);
    },
  }));

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (!listKind) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSuggestIndex((i) => (i + 1) % listLength);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSuggestIndex((i) => (i - 1 + listLength) % listLength);
    } else if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      const idx = Math.min(suggestIndex, listLength - 1);
      if (listKind === "field") insertField(fieldSuggestions[idx]);
      else insertFunc(funcSuggestions[idx]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      setDismissed(true);
    }
  }

  // Mantém a opção ativa visível ao circular com as setas.
  const activeItemRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    activeItemRef.current?.scrollIntoView?.({ block: "nearest" });
  }, [suggestIndex, listKind]);

  // Só é renderizado com a lista aberta (Radix desmonta o content fechado).
  const items =
    listKind === "field"
      ? fieldSuggestions.map((r, i) => (
          <button
            key={r.ref}
            ref={i === suggestIndex ? activeItemRef : undefined}
            type="button"
            role="option"
            aria-selected={i === suggestIndex}
            title={r.disabledReason ?? r.title}
            aria-disabled={Boolean(r.disabledReason)}
            onMouseDown={(e) => {
              e.preventDefault();
              insertField(r);
            }}
            className={cn(
              "flex w-full items-center justify-between gap-2 rounded-sm px-2 py-1 text-left text-sm",
              r.disabledReason
                ? "text-muted-foreground cursor-not-allowed opacity-60"
                : i === suggestIndex
                  ? "bg-accent text-accent-foreground"
                  : "hover:bg-accent/50",
            )}
          >
            <span className="truncate">
              {displaySourceHint(r) ? (
                <span className="text-muted-foreground">
                  {displaySourceHint(r)} ·{" "}
                </span>
              ) : null}
              {r.label}
            </span>
            {r.group ? (
              <span className="text-muted-foreground shrink-0 text-xs">
                {r.group}
              </span>
            ) : null}
          </button>
        ))
      : funcSuggestions.map((f, i) => (
          <button
            key={f.name}
            ref={i === suggestIndex ? activeItemRef : undefined}
            type="button"
            role="option"
            aria-selected={i === suggestIndex}
            title={f.description}
            onMouseDown={(e) => {
              e.preventDefault();
              insertFunc(f);
            }}
            className={cn(
              "flex w-full items-center justify-between gap-2 rounded-sm px-2 py-1 text-left text-sm",
              i === suggestIndex
                ? "bg-accent text-accent-foreground"
                : "hover:bg-accent/50",
            )}
          >
            <span className="truncate font-mono">{funcSignature(f)}</span>
            <span className="text-muted-foreground shrink-0 truncate text-xs">
              {f.description}
            </span>
          </button>
        ));

  return (
    <div className="flex flex-col gap-1.5">
      <Popover
        open={Boolean(listKind)}
        onOpenChange={(open) => {
          if (!open) setDismissed(true);
        }}
      >
        <PopoverAnchor asChild>
          <Textarea
            ref={taRef}
            value={text}
            rows={3}
            spellCheck={false}
            placeholder='SE(E([Valor] > 10; [Etapa] = "Ganho"); [Valor] * 2; 0)'
            onChange={(e) => {
              onTextChange(e.target.value);
              setCursor(e.target.selectionStart ?? 0);
              setSuggestIndex(0);
              setDismissed(false);
            }}
            onClick={syncCursor}
            onSelect={syncCursor}
            onKeyUp={(e) => {
              if (
                !["ArrowDown", "ArrowUp", "Enter", "Tab", "Escape"].includes(
                  e.key,
                )
              )
                syncCursor();
            }}
            onKeyDown={onKeyDown}
            className="font-mono text-sm"
            aria-label="Fórmula (texto)"
          />
        </PopoverAnchor>
        <PopoverContent
          role="listbox"
          aria-label={
            listKind === "field" ? "Sugestões de coluna" : "Sugestões de função"
          }
          side="bottom"
          align="start"
          sideOffset={4}
          // O foco fica no textarea — a lista é só apontada/rolada, nunca focada.
          onOpenAutoFocus={(e) => e.preventDefault()}
          onCloseAutoFocus={(e) => e.preventDefault()}
          onInteractOutside={(e) => {
            // Clicar/mover o caret no textarea (que está FORA do content) não
            // pode dispensar a lista — só interação fora do editor dispensa.
            const t = e.target;
            if (t instanceof Node && taRef.current?.contains(t))
              e.preventDefault();
          }}
          // O RemoveScroll do Sheet modal cancela wheel/touchmove fora do
          // conteúdo dele num listener bubble em document — parar a propagação
          // aqui deixa o scroll nativo da lista acontecer.
          onWheel={(e) => e.stopPropagation()}
          onTouchMove={(e) => e.stopPropagation()}
          className="max-h-64 w-[var(--radix-popover-trigger-width)] overflow-auto p-1"
        >
          {items}
        </PopoverContent>
      </Popover>
    </div>
  );
}
