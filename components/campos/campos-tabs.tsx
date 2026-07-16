// Versão: 1.0 | Data: 16/07/2026
// Abas de página de /campos: Campos | Correspondências | Conexões (mesma
// receita visual das abas de Registros). Os três painéis chegam prontos do
// server como ReactNode (padrão de slot) e ficam TODOS montados — os inativos
// só recebem `hidden`, preservando estado local (busca digitada, Sheets
// abertos) e sem re-executar nada ao trocar de aba.
"use client";

import { useState, type ReactNode } from "react";

import { cn } from "@/lib/utils";

type TabKey = "campos" | "correspondencias" | "conexoes";

const TAB_LABELS: Record<TabKey, string> = {
  campos: "Campos",
  correspondencias: "Correspondências",
  conexoes: "Conexões",
};

const TAB_ORDER: TabKey[] = ["campos", "correspondencias", "conexoes"];

export function CamposTabs({
  campos,
  correspondencias,
  conexoes,
}: {
  campos: ReactNode;
  correspondencias: ReactNode;
  conexoes: ReactNode;
}) {
  const [tab, setTab] = useState<TabKey>("campos");
  const panels: Record<TabKey, ReactNode> = {
    campos,
    correspondencias,
    conexoes,
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap gap-1 border-b">
        {TAB_ORDER.map((key) => {
          const active = key === tab;
          return (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              className={cn(
                "-mb-px rounded-t-md border-b-2 px-4 py-2 text-sm font-medium transition-colors",
                active
                  ? "border-primary text-foreground"
                  : "text-muted-foreground border-transparent hover:text-foreground"
              )}
            >
              {TAB_LABELS[key]}
            </button>
          );
        })}
      </div>
      {TAB_ORDER.map((key) => (
        <div key={key} hidden={key !== tab}>
          {panels[key]}
        </div>
      ))}
    </div>
  );
}
