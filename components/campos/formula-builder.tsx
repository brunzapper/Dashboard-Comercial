// Versão: 1.0 | Data: 09/07/2026
// Construtor estruturado de fórmula (Fase 7) para campos calculados. Monta uma
// sequência de tokens (coluna/constante + operadores + − × ÷ e parênteses) e
// emite um <input hidden name="formula"> com o JSON. A validação forte roda no
// servidor (lib/records/formulas.validateFormula) no submit.
"use client";

import { useState } from "react";
import { X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { Input } from "@/components/ui/input";
import type { Formula, FormulaToken } from "@/lib/records/formulas";

export interface RefOption {
  ref: string;
  label: string;
}

const OPS: { op: "+" | "-" | "*" | "/"; glyph: string }[] = [
  { op: "+", glyph: "+" },
  { op: "-", glyph: "−" },
  { op: "*", glyph: "×" },
  { op: "/", glyph: "÷" },
];

function tokenLabel(t: FormulaToken, refs: RefOption[]): string {
  switch (t.kind) {
    case "field":
      return refs.find((r) => r.ref === t.ref)?.label ?? t.ref;
    case "const":
      return String(t.value);
    case "op":
      return t.op === "*" ? "×" : t.op === "/" ? "÷" : t.op;
    case "lparen":
      return "(";
    case "rparen":
      return ")";
  }
}

export function FormulaBuilder({
  refs,
  initial,
}: {
  refs: RefOption[];
  initial?: Formula | null;
}) {
  const [tokens, setTokens] = useState<FormulaToken[]>(initial?.tokens ?? []);
  const [constValue, setConstValue] = useState("");

  const push = (t: FormulaToken) => setTokens((prev) => [...prev, t]);
  const removeAt = (i: number) =>
    setTokens((prev) => prev.filter((_, idx) => idx !== i));

  const addConst = () => {
    const n = Number(constValue.replace(",", "."));
    if (!Number.isFinite(n)) return;
    push({ kind: "const", value: n });
    setConstValue("");
  };

  return (
    <div className="flex flex-col gap-3">
      <input type="hidden" name="formula" value={JSON.stringify({ tokens })} />

      {/* Fórmula montada */}
      <div className="bg-muted/40 flex min-h-10 flex-wrap items-center gap-1.5 rounded-md p-2">
        {tokens.length === 0 ? (
          <span className="text-muted-foreground text-sm">
            Monte a fórmula abaixo (ex.: Valor ÷ Licenças).
          </span>
        ) : (
          tokens.map((t, i) => (
            <span
              key={i}
              className="bg-background inline-flex items-center gap-1 rounded border px-2 py-0.5 text-sm"
            >
              {tokenLabel(t, refs)}
              <button
                type="button"
                onClick={() => removeAt(i)}
                aria-label="Remover"
                className="text-muted-foreground hover:text-destructive"
              >
                <X className="size-3" />
              </button>
            </span>
          ))
        )}
      </div>

      {/* Operadores e parênteses */}
      <div className="flex flex-wrap gap-1.5">
        {OPS.map((o) => (
          <Button
            key={o.op}
            type="button"
            variant="outline"
            size="sm"
            onClick={() => push({ kind: "op", op: o.op })}
          >
            {o.glyph}
          </Button>
        ))}
        <Button type="button" variant="outline" size="sm" onClick={() => push({ kind: "lparen" })}>
          (
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={() => push({ kind: "rparen" })}>
          )
        </Button>
        {tokens.length > 0 ? (
          <Button type="button" variant="ghost" size="sm" onClick={() => setTokens([])}>
            Limpar
          </Button>
        ) : null}
      </div>

      {/* Adicionar coluna */}
      <div className="flex flex-col gap-1.5">
        <Combobox
          options={refs.map((r) => ({ value: r.ref, label: r.label }))}
          value=""
          onValueChange={(ref) => push({ kind: "field", ref })}
          placeholder="Adicionar coluna…"
          emptyText="Nenhuma coluna numérica disponível"
          className="w-full"
          aria-label="Adicionar coluna"
        />
      </div>

      {/* Adicionar constante */}
      <div className="flex items-end gap-2">
        <div className="flex flex-1 flex-col gap-1.5">
          <Input
            type="number"
            step="any"
            value={constValue}
            onChange={(e) => setConstValue(e.target.value)}
            placeholder="Número (ex.: 12)"
          />
        </div>
        <Button type="button" variant="outline" onClick={addConst} disabled={constValue === ""}>
          Adicionar número
        </Button>
      </div>
    </div>
  );
}
