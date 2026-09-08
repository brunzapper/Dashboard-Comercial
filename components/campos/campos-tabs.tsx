// Versão: 1.2 | Data: 07/08/2026
// Abas de página de /campos: Campos | Correspondências | Conexões | Moedas |
// Reclassificações (mesma receita visual das abas de Registros). Os painéis
// chegam prontos do server como ReactNode (padrão de slot) e ficam TODOS
// montados — os inativos só recebem `hidden`, preservando estado local (busca
// digitada, Sheets abertos) e sem re-executar nada ao trocar de aba.
// v1.1 (27/07/2026): aba Moedas (movida de /configuracoes/moedas) — slot
//   OPCIONAL: null/ausente (deny do override de área) esconde a aba.
// v1.2 (07/08/2026): aba Reclassificações (domínios dinâmicos de mapeamento,
//   0119) — slot opcional, mesmo padrão (some com a área/feature negada).
"use client";

import { useState, type ReactNode } from "react";

import { cn } from "@/lib/utils";

type TabKey =
  | "campos"
  | "correspondencias"
  | "conexoes"
  | "moedas"
  | "reclassificacoes";

const TAB_LABELS: Record<TabKey, string> = {
  campos: "Campos",
  correspondencias: "Correspondências",
  conexoes: "Conexões",
  moedas: "Moedas",
  reclassificacoes: "Reclassificações",
};

const TAB_ORDER: TabKey[] = [
  "campos",
  "correspondencias",
  "conexoes",
  "moedas",
  "reclassificacoes",
];

/** Abas de slot OPCIONAL: null/ausente esconde a aba. */
const OPTIONAL_TABS: TabKey[] = ["moedas", "reclassificacoes"];

export function CamposTabs({
  campos,
  correspondencias,
  conexoes,
  moedas,
  reclassificacoes,
}: {
  campos: ReactNode;
  correspondencias: ReactNode;
  conexoes: ReactNode;
  moedas?: ReactNode;
  reclassificacoes?: ReactNode;
}) {
  const [tab, setTab] = useState<TabKey>("campos");
  const panels: Record<TabKey, ReactNode> = {
    campos,
    correspondencias,
    conexoes,
    moedas,
    reclassificacoes,
  };
  const tabs = TAB_ORDER.filter(
    (key) => !OPTIONAL_TABS.includes(key) || panels[key] != null
  );

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap gap-1 border-b">
        {tabs.map((key) => {
          const active = key === tab;
          return (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              className={cn(
                "-mb-px rounded-t-md border-b-2 px-4 py-2 text-sm font-medium transition-colors",
                active
                  ? "border-brand text-foreground"
                  : "text-muted-foreground border-transparent hover:text-foreground"
              )}
            >
              {TAB_LABELS[key]}
            </button>
          );
        })}
      </div>
      {tabs.map((key) => (
        <div key={key} hidden={key !== tab}>
          {panels[key]}
        </div>
      ))}
    </div>
  );
}
