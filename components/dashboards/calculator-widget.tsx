// Versão: 1.0 | Data: 15/07/2026
// Widget Calculadora: expressão avaliada AO VIVO no cliente (tokenizeFormulaText
// + evaluateFormula — ágil p/ contas básicas: + - * / e parênteses) com
// variáveis de campos ([Nome] → var:<id>, valores computados no servidor com
// filtros+período do widget; ver page.tsx calcVarsById). A expressão corrente é
// compartilhada entre usuários (dashboard_table_cells __calc__, debounce) — um
// cache client em memória preserva o texto ao trocar de aba (remontagem),
// já que saveCalcExpression não revalida a página.
"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Delete, SquareSigma } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import type { OperandRef } from "@/lib/records/date-operands";
import {
  evaluateFormula,
  validateFormula,
  type FormulaResult,
} from "@/lib/records/formulas";
import { tokenizeFormulaText } from "@/lib/records/formula-text";
import {
  calcVarRef,
  calculatorCatalog,
} from "@/lib/widgets/calculator";
import type {
  AppearanceSettings,
  CalcWidgetResult,
  Widget,
} from "@/lib/widgets/types";
import { saveCalcExpression } from "@/app/(app)/dashboards/actions";

// Texto da expressão por widget, vivo enquanto a página está aberta: sobrevive
// à remontagem do card (troca de aba) mesmo antes de um refresh trazer o valor
// salvo (saveCalcExpression não revalida de propósito).
const exprCache = new Map<string, string>();

const SAVE_DEBOUNCE_MS = 800;

// Teclado: rótulo → texto inserido (null = ação especial C/⌫/=).
const KEYS: { label: string; insert: string | null; op?: boolean }[] = [
  { label: "7", insert: "7" },
  { label: "8", insert: "8" },
  { label: "9", insert: "9" },
  { label: "÷", insert: "/", op: true },
  { label: "4", insert: "4" },
  { label: "5", insert: "5" },
  { label: "6", insert: "6" },
  { label: "×", insert: "*", op: true },
  { label: "1", insert: "1" },
  { label: "2", insert: "2" },
  { label: "3", insert: "3" },
  { label: "−", insert: "-", op: true },
  { label: "0", insert: "0" },
  { label: ",", insert: "," },
  { label: "(", insert: "(", op: true },
  { label: ")", insert: ")", op: true },
  { label: "C", insert: null, op: true },
  { label: "⌫", insert: null, op: true },
  { label: "+", insert: "+", op: true },
  { label: "=", insert: null, op: true },
];

export function CalculatorWidget({
  widget,
  dashboardId,
  vars,
  initialExpr,
  appearance,
}: {
  widget: Widget;
  dashboardId: string;
  // Valores das variáveis (por id), computados no servidor.
  vars?: Record<string, CalcWidgetResult>;
  // Expressão compartilhada persistida (semente do carregamento).
  initialExpr?: string;
  appearance?: AppearanceSettings["calculator"];
}) {
  const variables = widget.settings?.calculator?.variables ?? [];
  const catalog: OperandRef[] = useMemo(
    () => calculatorCatalog(variables),
    // A identidade de settings muda junto com o widget; suficiente.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [widget.settings]
  );
  const ctx = useMemo(() => {
    const out: Record<string, unknown> = {};
    for (const v of variables) out[calcVarRef(v.id)] = vars?.[v.id]?.value ?? null;
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [widget.settings, vars]);

  const [expr, setExpr] = useState(
    () => exprCache.get(widget.id) ?? initialExpr ?? ""
  );
  const [cursor, setCursor] = useState(expr.length);
  const [suggestIndex, setSuggestIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Persistência compartilhada com debounce (fire-and-forget) + flush no
  // desmonte. O cache em memória cobre a remontagem por troca de aba.
  const saveTimer = useRef<number | null>(null);
  const lastSaved = useRef(initialExpr ?? "");
  // Espelho do texto p/ o flush no desmonte (sincronizado no setter — todo
  // caminho de escrita passa por setExpression).
  const exprRef = useRef(expr);
  const setExpression = (next: string, nextCursor?: number) => {
    setExpr(next);
    exprRef.current = next;
    exprCache.set(widget.id, next);
    if (nextCursor != null) setCursor(nextCursor);
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      if (next === lastSaved.current) return;
      lastSaved.current = next;
      void saveCalcExpression(dashboardId, widget.id, next);
    }, SAVE_DEBOUNCE_MS);
  };
  useEffect(
    () => () => {
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
      if (exprRef.current !== lastSaved.current) {
        lastSaved.current = exprRef.current;
        void saveCalcExpression(dashboardId, widget.id, exprRef.current);
      }
    },
    // Flush só no desmonte.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  // Avaliação ao vivo: tokens do texto (catálogo = variáveis) + contexto de
  // valores. Vazio → sem resultado; erro de sintaxe → mensagem.
  const evalState = useMemo((): {
    value: FormulaResult | null;
    error: string | null;
  } => {
    if (!expr.trim()) return { value: null, error: null };
    const t = tokenizeFormulaText(expr, catalog);
    if (!t.ok) return { value: null, error: t.error };
    // Erro de SINTAXE (parser, ex.: "2++"): evaluateFormula devolve null em
    // silêncio — validateFormula dá a mensagem pt-BR do FormulaParseError.
    const v = validateFormula(t.formula, new Set(catalog.map((r) => r.ref)));
    if (!v.ok) return { value: null, error: v.error ?? "Expressão inválida." };
    return { value: evaluateFormula(t.formula, ctx), error: null };
  }, [expr, catalog, ctx]);

  const display =
    evalState.value == null
      ? "—"
      : typeof evalState.value === "number"
        ? evalState.value.toLocaleString("pt-BR", { maximumFractionDigits: 4 })
        : typeof evalState.value === "boolean"
          ? evalState.value
            ? "Verdadeiro"
            : "Falso"
          : String(evalState.value);

  // Autocomplete de [variável] (mesma mecânica do FormulaTextEditor).
  const frag = useMemo(() => {
    const upto = expr.slice(0, cursor);
    const open = upto.lastIndexOf("[");
    if (open < 0) return null;
    if (upto.lastIndexOf("]") > open) return null;
    return { start: open, query: upto.slice(open + 1) };
  }, [expr, cursor]);
  const suggestions = useMemo(() => {
    if (!frag) return [];
    const q = frag.query.trim().toLocaleLowerCase("pt-BR");
    return catalog
      .filter((r) => r.label.toLocaleLowerCase("pt-BR").includes(q))
      .slice(0, 8);
  }, [frag, catalog]);

  const focusAt = (pos: number) => {
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.setSelectionRange(pos, pos);
      setCursor(pos);
    });
  };

  const insertText = (text: string) => {
    const pos = inputRef.current?.selectionStart ?? cursor;
    const next = expr.slice(0, pos) + text + expr.slice(pos);
    setExpression(next, pos + text.length);
    focusAt(pos + text.length);
  };

  const insertRef = (r: OperandRef) => {
    if (!frag) return;
    const inserted = `[${r.label}]`;
    const next = expr.slice(0, frag.start) + inserted + expr.slice(cursor);
    setExpression(next, frag.start + inserted.length);
    setSuggestIndex(0);
    focusAt(frag.start + inserted.length);
  };

  const backspace = () => {
    const pos = inputRef.current?.selectionStart ?? cursor;
    if (pos <= 0) return;
    const next = expr.slice(0, pos - 1) + expr.slice(pos);
    setExpression(next, pos - 1);
    focusAt(pos - 1);
  };

  const onKey = (k: (typeof KEYS)[number]) => {
    if (k.insert != null) {
      insertText(k.insert);
      return;
    }
    if (k.label === "C") {
      setExpression("", 0);
      focusAt(0);
    } else if (k.label === "⌫") {
      backspace();
    } else if (k.label === "=") {
      // "=": substitui a expressão pelo resultado (vírgula decimal).
      if (typeof evalState.value === "number") {
        const asText = String(evalState.value).replace(".", ",");
        setExpression(asText, asText.length);
        focusAt(asText.length);
      }
    }
  };

  function onInputKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (suggestions.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSuggestIndex((i) => (i + 1) % suggestions.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSuggestIndex((i) => (i - 1 + suggestions.length) % suggestions.length);
    } else if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      insertRef(suggestions[Math.min(suggestIndex, suggestions.length - 1)]);
    }
  }

  return (
    <div
      className="flex h-full flex-col gap-2 p-1"
      style={{ background: appearance?.bg }}
    >
      {/* Visor: expressão editável + resultado ao vivo. */}
      <div
        className="relative flex flex-col gap-1 rounded-md border p-2"
        style={{
          background: appearance?.displayBg,
          color: appearance?.displayText,
        }}
      >
        <input
          ref={inputRef}
          value={expr}
          spellCheck={false}
          placeholder="Digite: (2+3)*4 ou [Variável]…"
          aria-label="Expressão da calculadora"
          onChange={(e) => {
            setExpression(e.target.value);
            setCursor(e.target.selectionStart ?? 0);
            setSuggestIndex(0);
          }}
          onClick={(e) => setCursor(e.currentTarget.selectionStart ?? 0)}
          onKeyUp={(e) => {
            if (!["ArrowDown", "ArrowUp", "Enter", "Tab"].includes(e.key))
              setCursor(e.currentTarget.selectionStart ?? 0);
          }}
          onKeyDown={onInputKeyDown}
          className="w-full bg-transparent font-mono text-sm outline-none placeholder:opacity-50"
        />
        <span
          className="truncate text-right text-2xl font-semibold tabular-nums"
          title={display}
        >
          {display}
        </span>
        {evalState.error && expr.trim() ? (
          <span className="text-destructive truncate text-xs" title={evalState.error}>
            {evalState.error}
          </span>
        ) : null}
        {suggestions.length > 0 ? (
          <div className="bg-popover text-popover-foreground absolute top-full left-0 z-30 mt-1 w-full rounded-md border p-1 shadow-md">
            {suggestions.map((r, i) => (
              <button
                key={r.ref}
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  insertRef(r);
                }}
                className={cn(
                  "flex w-full items-center rounded-sm px-2 py-1 text-left text-sm",
                  i === suggestIndex
                    ? "bg-accent text-accent-foreground"
                    : "hover:bg-accent/50"
                )}
              >
                <span className="truncate">{r.label}</span>
              </button>
            ))}
          </div>
        ) : null}
      </div>

      {/* Variáveis de campos (inserem [Nome] na expressão). */}
      {catalog.length > 0 ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 self-start px-2 text-xs"
            >
              <SquareSigma className="size-3.5" /> Variáveis
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            {catalog.map((r) => {
              const v = variables.find((x) => calcVarRef(x.id) === r.ref);
              const val = v ? vars?.[v.id]?.value : null;
              return (
                <DropdownMenuItem key={r.ref} onSelect={() => insertText(`[${r.label}]`)}>
                  <span className="flex-1 truncate">{r.label}</span>
                  <span className="text-muted-foreground text-xs tabular-nums">
                    {val == null
                      ? "—"
                      : val.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}
                  </span>
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}

      {/* Teclado. */}
      <div className="grid min-h-0 flex-1 grid-cols-4 gap-1">
        {KEYS.map((k) => (
          <button
            key={k.label}
            type="button"
            aria-label={`Tecla ${k.label}`}
            onClick={() => onKey(k)}
            className={cn(
              "min-h-7 rounded-md border text-sm font-medium transition-colors",
              k.op
                ? "bg-muted hover:bg-accent hover:text-accent-foreground"
                : "bg-background hover:bg-accent hover:text-accent-foreground"
            )}
            style={
              k.op
                ? {
                    background: appearance?.opKeyBg,
                    color: appearance?.opKeyText,
                  }
                : {
                    background: appearance?.keyBg,
                    color: appearance?.keyText,
                  }
            }
          >
            {k.label === "⌫" ? <Delete className="mx-auto size-4" /> : k.label}
          </button>
        ))}
      </div>
    </div>
  );
}
