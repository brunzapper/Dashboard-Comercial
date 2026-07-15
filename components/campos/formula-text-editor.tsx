// Versão: 1.0 | Data: 13/07/2026
// Editor de fórmula por TEXTO estilo Google Sheets (pt-BR) para campos
// calculados: SE(E([Valor] > 10; [Etapa] = "Ganho"); [Valor] * 2; 0).
// Digite `[` para abrir o autocomplete de colunas (setas + Enter inserem).
// Valida ao vivo no cliente (tokenizeFormulaText); a validação forte (refs
// permitidos) roda no servidor no submit. Emite <input hidden name="formula_text">.
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, CircleAlert } from "lucide-react";

import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { OperandRef } from "@/lib/records/date-operands";
import type { Formula } from "@/lib/records/formulas";
import { formulaToSource, tokenizeFormulaText } from "@/lib/records/formula-text";

export function FormulaTextEditor({
  refs,
  initial,
  onChange,
}: {
  refs: OperandRef[];
  initial?: Formula | null;
  // Modo controlado (editor de widget): emite os tokens a cada texto VÁLIDO;
  // texto inválido/vazio emite tokens vazios (o submit acusa "defina a
  // fórmula"; o erro fino aparece na validação ao vivo abaixo do campo). O
  // <input hidden> continua para os forms nativos (campos calculados).
  onChange?: (formula: Formula) => void;
}) {
  const [text, setText] = useState(() =>
    formulaToSource(initial, (ref) => refs.find((r) => r.ref === ref)?.label ?? ref)
  );
  const [cursor, setCursor] = useState(0);
  const [suggestIndex, setSuggestIndex] = useState(0);
  const taRef = useRef<HTMLTextAreaElement | null>(null);

  // Colchete aberto (sem fechar) imediatamente antes do cursor → autocomplete.
  const frag = useMemo(() => {
    const upto = text.slice(0, cursor);
    const open = upto.lastIndexOf("[");
    if (open < 0) return null;
    if (upto.lastIndexOf("]") > open) return null;
    return { start: open, query: upto.slice(open + 1) };
  }, [text, cursor]);

  const suggestions = useMemo(() => {
    if (!frag) return [];
    const q = frag.query.trim().toLocaleLowerCase("pt-BR");
    return refs
      .filter((r) => r.label.toLocaleLowerCase("pt-BR").includes(q))
      .slice(0, 8);
  }, [frag, refs]);

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

  const validation = useMemo(
    () => (text.trim() ? tokenizeFormulaText(text, refs) : null),
    [text, refs]
  );

  useEffect(() => {
    if (!onChange) return;
    onChange(validation?.ok ? validation.formula : { tokens: [] });
    // onChange é passado inline pelo pai; dependemos só da validação.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [validation]);

  // Catálogo com operandos agregados (agg:*) = fórmula de totais → mostra a
  // ajuda de SOMASE/CONT.SE/MÉDIASE (que só existem nesse contexto).
  const isAggContext = useMemo(
    () => refs.some((r) => r.ref.startsWith("agg:")),
    [refs]
  );

  function syncCursor() {
    setCursor(taRef.current?.selectionStart ?? 0);
  }

  function insert(r: OperandRef) {
    if (!frag) return;
    const dup = (labelCount.get(r.label.trim().toLocaleLowerCase("pt-BR")) ?? 0) > 1;
    const inserted = `[${dup ? r.ref : r.label}]`;
    const before = text.slice(0, frag.start);
    const after = text.slice(cursor);
    const next = before + inserted + after;
    setText(next);
    setSuggestIndex(0);
    requestAnimationFrame(() => {
      const pos = (before + inserted).length;
      taRef.current?.focus();
      taRef.current?.setSelectionRange(pos, pos);
      setCursor(pos);
    });
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (suggestions.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSuggestIndex((i) => (i + 1) % suggestions.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSuggestIndex((i) => (i - 1 + suggestions.length) % suggestions.length);
    } else if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      insert(suggestions[Math.min(suggestIndex, suggestions.length - 1)]);
    }
  }

  return (
    <div className="relative flex flex-col gap-1.5">
      <input type="hidden" name="formula_text" value={text} />
      <Textarea
        ref={taRef}
        value={text}
        rows={3}
        spellCheck={false}
        placeholder='SE(E([Valor] > 10; [Etapa] = "Ganho"); [Valor] * 2; 0)'
        onChange={(e) => {
          setText(e.target.value);
          setCursor(e.target.selectionStart ?? 0);
          setSuggestIndex(0);
        }}
        onClick={syncCursor}
        onKeyUp={(e) => {
          if (!["ArrowDown", "ArrowUp", "Enter", "Tab"].includes(e.key)) syncCursor();
        }}
        onKeyDown={onKeyDown}
        className="font-mono text-sm"
        aria-label="Fórmula (texto)"
      />

      {suggestions.length > 0 ? (
        <div className="bg-popover text-popover-foreground absolute top-full z-30 mt-1 w-full rounded-md border p-1 shadow-md">
          {suggestions.map((r, i) => (
            <button
              key={r.ref}
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                insert(r);
              }}
              className={cn(
                "flex w-full items-center justify-between gap-2 rounded-sm px-2 py-1 text-left text-sm",
                i === suggestIndex
                  ? "bg-accent text-accent-foreground"
                  : "hover:bg-accent/50"
              )}
            >
              <span className="truncate">{r.label}</span>
              {r.group ? (
                <span className="text-muted-foreground shrink-0 text-xs">{r.group}</span>
              ) : null}
            </button>
          ))}
        </div>
      ) : null}

      {validation ? (
        validation.ok ? (
          <p className="flex items-center gap-1 text-xs text-emerald-600">
            <Check className="size-3.5" /> Fórmula válida
          </p>
        ) : (
          <p className="text-destructive flex items-center gap-1 text-xs">
            <CircleAlert className="size-3.5 shrink-0" /> {validation.error}
          </p>
        )
      ) : null}

      <p className="text-muted-foreground text-xs">
        Funções: <code>SE(condição; então; senão)</code>, <code>E(…)</code>,{" "}
        <code>OU(…)</code>. Separe argumentos com <code>;</code>. Colunas entre
        colchetes — digite <code>[</code> para buscar. Comparações:{" "}
        <code>= &lt;&gt; &lt; &gt; &lt;= &gt;=</code>. Textos entre aspas:{" "}
        <code>&quot;Ganho&quot;</code>.
      </p>
      {isAggContext ? (
        <p className="text-muted-foreground text-xs">
          Condicionais de agregação:{" "}
          <code>SOMASE([Valor]; [Etapa] = &quot;Ganho&quot;)</code>,{" "}
          <code>CONT.SE([Etapa] = &quot;Ganho&quot;)</code>,{" "}
          <code>MÉDIASE([Valor]; condição)</code>; várias condições (E):{" "}
          <code>SOMASES</code>/<code>CONT.SES</code> com condições separadas por{" "}
          <code>;</code>. Cada condição compara uma coluna com um valor fixo.
          Texto compara como no <code>SE</code> (ignora maiúsculas/minúsculas e
          espaços nas pontas); números sem aspas comparam como número; datas no
          formato <code>&quot;2026-01-31&quot;</code>.
        </p>
      ) : null}
    </div>
  );
}
