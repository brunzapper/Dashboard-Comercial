// Versão: 2.0 | Data: 30/07/2026
// v2.0 (30/07/2026): superfície ÚNICA do FormulaEditor (o modo visual de
//   chips/botões foi absorvido): campos por autocomplete no `[` (busca sem
//   acentos, lista completa com scroll, Escape fecha, substituição da ref
//   INTEIRA quando o caret está no meio dela — sem `]` órfão), autocomplete de
//   FUNÇÕES ao digitar letras (nomes + aliases, insere `NOME()` com o caret
//   dentro), dropdown em portal `fixed` (não é cortado pelo overflow do
//   Sheet/Accordion) e `insertAtCaret` imperativo para a toolbar do editor.
//   Enter/Tab só são interceptados com a lista ABERTA. O caret é reportado ao
//   pai (onCaretChange) para a assinatura viva.
// Operando desabilitado (disabledReason) aparece acinzentado e não-inserível,
// com o motivo no tooltip — explicar, nunca esconder.
"use client";

import {
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

import { displaySourceHint } from "@/components/formula/operand-display";
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
    [frag, text, cursor]
  );

  const fieldSuggestions = useMemo(() => {
    if (!frag) return [];
    const q = normalizeSearch(frag.query);
    // Busca também pela fonte (sourceHint): digitar "[deals" lista os campos
    // dessa fonte. A inserção continua usando só o rótulo limpo.
    return refs.filter((r) =>
      normalizeSearch(`${r.sourceHint ?? ""} ${r.label}`).includes(q)
    );
  }, [frag, refs]);

  const funcSuggestions = useMemo(
    () => (funcWord ? matchFunctions(funcWord.word, context) : []),
    [funcWord, context]
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
    caretOffset?: number
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

  // ---- Dropdown em portal fixed (não cortado pelo overflow do Sheet) --------
  const [rect, setRect] = useState<{
    left: number;
    top: number;
    width: number;
  } | null>(null);
  useLayoutEffect(() => {
    if (!listKind) return;
    const update = () => {
      const r = taRef.current?.getBoundingClientRect();
      if (r) setRect({ left: r.left, top: r.bottom + 4, width: r.width });
    };
    // Posiciona ANTES do paint (rect antigo de uma abertura anterior não pisca).
    update();
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
    };
  }, [listKind]);

  // Mantém a opção ativa visível ao circular com as setas.
  const activeItemRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    activeItemRef.current?.scrollIntoView?.({ block: "nearest" });
  }, [suggestIndex, listKind]);

  const list =
    listKind && rect ? (
      <div
        style={{
          position: "fixed",
          left: rect.left,
          top: rect.top,
          width: rect.width,
        }}
        className="bg-popover text-popover-foreground z-50 max-h-64 overflow-auto rounded-md border p-1 shadow-md"
        role="listbox"
        aria-label={
          listKind === "field" ? "Sugestões de coluna" : "Sugestões de função"
        }
      >
        {listKind === "field"
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
                      : "hover:bg-accent/50"
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
                    : "hover:bg-accent/50"
                )}
              >
                <span className="truncate font-mono">{funcSignature(f)}</span>
                <span className="text-muted-foreground shrink-0 truncate text-xs">
                  {f.description}
                </span>
              </button>
            ))}
      </div>
    ) : null;

  return (
    <div className="flex flex-col gap-1.5">
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
          if (!["ArrowDown", "ArrowUp", "Enter", "Tab", "Escape"].includes(e.key))
            syncCursor();
        }}
        onKeyDown={onKeyDown}
        className="font-mono text-sm"
        aria-label="Fórmula (texto)"
      />
      {list && typeof document !== "undefined"
        ? createPortal(list, document.body)
        : null}
    </div>
  );
}
