// Versão: 1.0 | Data: 06/09/2026
// Barra de fórmula ("fx") da Tabela Livre — a superfície que faltava para o
// cálculo entre células ser descobrível: mostra o ENDEREÇO da célula
// selecionada (A1, B3…) e o conteúdo CRU dela (a fórmula, não o resultado),
// permite editar por ali e traz a ajuda de sintaxe num popover. O estado de
// edição é o MESMO da grade (o widget passa draft/onChange): a barra é só
// outra entrada para ele — quem tem o foco é decidido por `editing.source`.
"use client";

import { useState, type RefObject } from "react";
import { HelpCircle } from "lucide-react";

import { cn } from "@/lib/utils";
import { FloatingPanel } from "../appearance-editing";

export function QuickTableFormulaBar({
  address,
  value,
  editable,
  inputRef,
  onChange,
  onCommit,
  onCancel,
  borderColor,
}: {
  // Endereço A1 da célula âncora ("B3"); null quando não há seleção.
  address: string | null;
  // Conteúdo cru em exibição (draft, quando em edição; senão o valor gravado).
  value: string;
  editable: boolean;
  inputRef: RefObject<HTMLInputElement | null>;
  onChange: (v: string) => void;
  onCommit: () => void;
  onCancel: () => void;
  borderColor?: string;
}) {
  const [help, setHelp] = useState<{ x: number; y: number } | null>(null);
  return (
    <div
      className="flex h-7 shrink-0 items-center gap-1 px-1 text-xs"
      style={{ borderBottom: `1px solid ${borderColor ?? "var(--border)"}` }}
    >
      <span
        className={cn(
          "text-muted-foreground w-10 shrink-0 text-center font-medium tabular-nums",
          !address && "opacity-50"
        )}
        aria-label="Célula selecionada"
      >
        {address ?? "—"}
      </span>
      <span className="text-muted-foreground shrink-0 font-serif italic">fx</span>
      <input
        ref={inputRef}
        value={value}
        disabled={!address || !editable}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            onCommit();
          } else if (e.key === "Escape") {
            e.preventDefault();
            onCancel();
          }
        }}
        placeholder={
          address
            ? editable
              ? "Digite = para calcular (ex.: =A1+B2, =SOMA(A1:A10))"
              : "Célula não editável"
            : "Selecione uma célula"
        }
        className="min-w-0 flex-1 border-none bg-transparent px-1 py-0.5 outline-none disabled:opacity-60"
        aria-label="Conteúdo da célula (fórmula)"
      />
      <button
        type="button"
        className="text-muted-foreground hover:text-foreground shrink-0"
        title="Como calcular entre células"
        aria-label="Como calcular entre células"
        onClick={(e) => setHelp({ x: e.clientX - 260, y: e.clientY + 12 })}
      >
        <HelpCircle className="size-3.5" />
      </button>
      {help ? (
        <FloatingPanel
          x={help.x}
          y={help.y}
          onClose={() => setHelp(null)}
          className="max-h-[70vh] w-80 overflow-auto"
        >
          <FormulaHelp />
        </FloatingPanel>
      ) : null}
    </div>
  );
}

function FormulaHelp() {
  return (
    <div className="space-y-2 p-1 text-xs">
      <p className="font-medium">Cálculo entre células</p>
      <p className="text-muted-foreground">
        Comece a célula com <Code>=</Code>. Cada célula tem um endereço:{" "}
        <b>letra da coluna</b> + <b>número da linha</b> (A1, B3…), mostrados na
        régua ao redor da grade. Clicar numa célula durante a digitação insere o
        endereço dela; arrastar insere o intervalo.
      </p>
      <ul className="text-muted-foreground list-disc space-y-1 pl-4">
        <li>
          <Code>=A1+B2</Code>, <Code>=A1*0,1</Code>, <Code>=(A1-B1)/B1</Code>
        </li>
        <li>
          <Code>=SOMA(A1:A10)</Code> — intervalo. <Code>A2:A</Code> vai até a
          última linha; <Code>A:A</Code> é a coluna inteira.
        </li>
        <li>
          <Code>=SE(A1&gt;B1; &quot;bateu&quot;; &quot;faltou&quot;)</Code>
        </li>
      </ul>
      <p className="font-medium">Funções</p>
      <p className="text-muted-foreground">
        SOMA, MÉDIA, MÍN, MÁX, CONT.NÚM, CONT.VALORES, ARRED, ABS, CONCATENAR,
        SE, E, OU.
      </p>
      <p className="font-medium">Números do sistema</p>
      <p className="text-muted-foreground">
        <Code>{"{= … }"}</Code> traz um número dos dados do dashboard para a
        célula (mesma fórmula agregada da Nota) — e ele pode entrar nas contas
        pelo endereço da célula.
      </p>
      <p className="text-muted-foreground">
        Os endereços são <b>posicionais</b>: colunas de dados que expandem em
        várias linhas deslocam quem está abaixo. Para contas fixas, prefira
        linhas livres.
      </p>
    </div>
  );
}

function Code({ children }: { children: React.ReactNode }) {
  return (
    <code className="bg-muted rounded px-1 py-px font-mono text-[11px]">
      {children}
    </code>
  );
}
