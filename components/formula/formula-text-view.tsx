// Versão: 1.0 | Data: 20/07/2026
// View de TEXTO do FormulaEditor — o FormulaTextEditor clássico (estilo Google
// Sheets pt-BR, autocomplete com `[`), adaptado para ser CONTROLADO pelo
// FormulaEditor: o texto e a validação vivem no pai (um único estado/linha de
// status para as duas views); aqui ficam só a textarea e o autocomplete.
// Operando desabilitado (disabledReason) aparece acinzentado e não-inserível,
// com o motivo no tooltip — explicar, nunca esconder.
"use client";

import { useMemo, useRef, useState } from "react";

import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { RefOption } from "@/lib/records/date-operands";

export function FormulaTextView({
  text,
  onTextChange,
  refs,
}: {
  text: string;
  onTextChange: (text: string) => void;
  refs: RefOption[];
}) {
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
    // Busca também pela fonte (sourceHint): digitar "[deals" lista os campos
    // dessa fonte. A inserção continua usando só o rótulo limpo.
    return refs
      .filter((r) =>
        `${r.sourceHint ?? ""} ${r.label}`.toLocaleLowerCase("pt-BR").includes(q)
      )
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

  function syncCursor() {
    setCursor(taRef.current?.selectionStart ?? 0);
  }

  function insert(r: RefOption) {
    if (!frag || r.disabledReason) return;
    const dup =
      (labelCount.get(r.label.trim().toLocaleLowerCase("pt-BR")) ?? 0) > 1;
    const inserted = `[${dup ? r.ref : r.label}]`;
    const before = text.slice(0, frag.start);
    const after = text.slice(cursor);
    onTextChange(before + inserted + after);
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
        }}
        onClick={syncCursor}
        onKeyUp={(e) => {
          if (!["ArrowDown", "ArrowUp", "Enter", "Tab"].includes(e.key))
            syncCursor();
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
              title={r.disabledReason ?? r.title}
              aria-disabled={Boolean(r.disabledReason)}
              onMouseDown={(e) => {
                e.preventDefault();
                insert(r);
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
                {r.sourceHint ? (
                  <span className="text-muted-foreground">
                    {r.sourceHint} ·{" "}
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
          ))}
        </div>
      ) : null}
    </div>
  );
}
