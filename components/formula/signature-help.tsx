// Versão: 1.0 | Data: 30/07/2026
// Assinatura VIVA do editor de fórmulas: quando o caret está dentro de uma
// chamada de função (activeCall, lib/records/formula-assist.ts), este painel
// fixo mostra a assinatura com o PARÂMETRO ATIVO destacado + descrição +
// exemplo — metadados do catálogo único (lib/records/formula-funcs.ts).
// Substitui os parágrafos estáticos que explicavam as funções sem saber qual
// estava em uso.
"use client";

import type { FormulaFuncSpec } from "@/lib/records/formula-funcs";
import { cn } from "@/lib/utils";

export function SignatureHelp({
  spec,
  argIndex,
}: {
  spec: FormulaFuncSpec;
  argIndex: number;
}) {
  // Variádico: argumentos além da lista destacam o último parâmetro.
  const active = Math.min(argIndex, spec.params.length - 1);
  return (
    <div className="bg-muted/50 rounded-md border px-2.5 py-1.5 text-xs">
      <p className="font-mono">
        <span className="font-semibold">{spec.name}</span>(
        {spec.params.map((p, i) => (
          <span key={i}>
            {i > 0 ? "; " : ""}
            <span
              className={cn(
                i === active
                  ? "bg-primary/15 text-foreground rounded-sm px-0.5 font-semibold"
                  : "text-muted-foreground"
              )}
              title={p.optional ? "Argumento opcional" : undefined}
            >
              {p.name}
              {p.variadic ? "; …" : ""}
            </span>
          </span>
        ))}
        )
      </p>
      <p className="text-muted-foreground mt-0.5">{spec.description}</p>
      <p className="text-muted-foreground/80 mt-0.5 truncate font-mono">
        Ex.: {spec.example}
      </p>
    </div>
  );
}
