// Versão: 1.0 | Data: 20/07/2026
// View VISUAL do FormulaEditor: a fórmula como sequência de chips com CURSOR de
// inserção (gaps clicáveis entre chips). Setas movem o cursor, Backspace/Delete
// removem, clique no chip posiciona o cursor depois dele e o "×" o remove.
// Substitui a caixa append-only do FormulaBuilder antigo. Ref não resolvida
// (campo excluído/fora do catálogo) vira chip "⚠ Campo indisponível" com a ref
// bruta SÓ no tooltip — nunca string crua no meio da fórmula.
"use client";

import { X } from "lucide-react";

import type { RefOption } from "@/lib/records/date-operands";
import type { FormulaToken } from "@/lib/records/formulas";
import { cn } from "@/lib/utils";

interface ChipInfo {
  label: string;
  unresolved?: boolean;
  title?: string;
}

function chipInfo(t: FormulaToken, catalog: RefOption[]): ChipInfo {
  switch (t.kind) {
    case "field": {
      const r = catalog.find((o) => o.ref === t.ref);
      if (!r) {
        return {
          label: "⚠ Campo indisponível",
          unresolved: true,
          title: `Referência não encontrada no catálogo: ${t.ref}. Em execução, este operando fica vazio ("—").`,
        };
      }
      return {
        label: r.sourceHint ? `${r.sourceHint} · ${r.label}` : r.label,
        title: r.title,
      };
    }
    case "const":
      return { label: String(t.value).replace(".", ",") };
    case "str":
      return { label: `"${t.value}"` };
    case "bool":
      return { label: t.value ? "VERDADEIRO" : "FALSO" };
    case "op":
      return { label: t.op === "*" ? "×" : t.op === "/" ? "÷" : t.op };
    case "cmp":
      return { label: t.op === "<>" ? "≠" : t.op };
    case "func":
      return { label: t.name };
    case "argsep":
      return { label: ";" };
    case "lparen":
      return { label: "(" };
    case "rparen":
      return { label: ")" };
  }
}

// Tokens "de pontuação" ganham chip compacto sem borda (a fórmula fica legível
// como expressão, não como fileira de caixas iguais).
function isPunct(t: FormulaToken): boolean {
  return (
    t.kind === "op" ||
    t.kind === "cmp" ||
    t.kind === "argsep" ||
    t.kind === "lparen" ||
    t.kind === "rparen"
  );
}

export function FormulaChips({
  tokens,
  caret,
  catalog,
  onCaret,
  onRemove,
  onBackspace,
}: {
  tokens: FormulaToken[];
  // Posição de inserção: 0..tokens.length (entre chips). Toda inserção do
  // FormulaEditor entra aqui, não no fim.
  caret: number;
  catalog: RefOption[];
  onCaret: (i: number) => void;
  onRemove: (i: number) => void;
  onBackspace: () => void;
}) {
  const caretEl = (
    <span
      aria-hidden
      className="bg-primary inline-block h-5 w-0.5 shrink-0 animate-pulse rounded"
    />
  );
  return (
    <div
      role="listbox"
      aria-label="Fórmula montada (setas movem o cursor; Backspace remove)"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "ArrowLeft") {
          e.preventDefault();
          onCaret(Math.max(0, caret - 1));
        } else if (e.key === "ArrowRight") {
          e.preventDefault();
          onCaret(Math.min(tokens.length, caret + 1));
        } else if (e.key === "Backspace") {
          e.preventDefault();
          onBackspace();
        } else if (e.key === "Delete" && caret < tokens.length) {
          e.preventDefault();
          onRemove(caret);
        } else if (e.key === "Home") {
          e.preventDefault();
          onCaret(0);
        } else if (e.key === "End") {
          e.preventDefault();
          onCaret(tokens.length);
        }
      }}
      className="bg-muted/40 focus-visible:ring-ring flex min-h-10 flex-wrap items-center gap-y-1.5 rounded-md p-2 focus-visible:ring-2 focus-visible:outline-none"
    >
      {tokens.length === 0 ? (
        <span className="text-muted-foreground text-sm">
          Monte a fórmula com os controles abaixo (ex.: Valor ÷ Licenças). Você
          pode clicar entre os itens para inserir no meio.
        </span>
      ) : (
        <>
          {tokens.map((t, i) => {
            const info = chipInfo(t, catalog);
            return (
              <span key={i} className="inline-flex items-center">
                {/* Gap clicável ANTES do chip i (posição de inserção i). */}
                {caret === i ? (
                  caretEl
                ) : (
                  <button
                    type="button"
                    tabIndex={-1}
                    aria-label={`Inserir na posição ${i + 1}`}
                    onClick={() => onCaret(i)}
                    className="hover:bg-primary/20 h-6 w-1.5 shrink-0 rounded"
                  />
                )}
                <span
                  title={info.title}
                  onClick={() => onCaret(i + 1)}
                  className={cn(
                    "inline-flex cursor-pointer items-center gap-1 text-sm",
                    isPunct(t)
                      ? "text-foreground px-1 font-medium"
                      : "bg-background rounded border px-2 py-0.5",
                    info.unresolved &&
                      "border-destructive/50 text-destructive bg-destructive/5"
                  )}
                >
                  {info.label}
                  <button
                    type="button"
                    tabIndex={-1}
                    onClick={(e) => {
                      e.stopPropagation();
                      onRemove(i);
                    }}
                    aria-label={`Remover ${info.label}`}
                    className="text-muted-foreground hover:text-destructive"
                  >
                    <X className="size-3" />
                  </button>
                </span>
              </span>
            );
          })}
          {/* Gap final (posição tokens.length). */}
          {caret === tokens.length ? (
            caretEl
          ) : (
            <button
              type="button"
              tabIndex={-1}
              aria-label="Inserir no fim"
              onClick={() => onCaret(tokens.length)}
              className="hover:bg-primary/20 h-6 w-2 shrink-0 rounded"
            />
          )}
        </>
      )}
    </div>
  );
}
