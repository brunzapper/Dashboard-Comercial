// Versão: 1.0 | Data: 11/07/2026
// Barra de abas inline do dashboard. Cada aba tem nome e cor de fundo do "chip"
// do nome (configuráveis). No modo edição: adicionar (+), renomear (duplo-clique),
// escolher cor (swatch) e excluir (×). Fora do modo edição, só troca a aba ativa.
// A lista de abas é persistida pelo pai (onChange → updateDashboardSettings).
"use client";

import { useState } from "react";
import { Plus, X } from "lucide-react";

import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";

export interface DashboardTab {
  id: string;
  name: string;
  color?: string;
}

// Cor de texto legível (preto/branco) sobre um fundo hex — contraste simples.
function readableText(bg?: string): string | undefined {
  if (!bg || !/^#([0-9a-f]{6})$/i.test(bg)) return undefined;
  const r = parseInt(bg.slice(1, 3), 16);
  const g = parseInt(bg.slice(3, 5), 16);
  const b = parseInt(bg.slice(5, 7), 16);
  const luma = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luma > 0.6 ? "#111827" : "#ffffff";
}

export function DashboardTabs({
  tabs,
  activeId,
  onSelect,
  editMode,
  onChange,
}: {
  tabs: DashboardTab[];
  activeId: string;
  onSelect: (id: string) => void;
  editMode: boolean;
  onChange: (tabs: DashboardTab[]) => void;
}) {
  const [renaming, setRenaming] = useState<string | null>(null);

  function addTab() {
    const id =
      typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : `tab_${Date.now()}`;
    const next = [...tabs, { id, name: `Aba ${tabs.length + 1}` }];
    onChange(next);
    onSelect(id);
    setRenaming(id);
  }
  function rename(id: string, name: string) {
    onChange(tabs.map((t) => (t.id === id ? { ...t, name } : t)));
  }
  function setColor(id: string, color: string) {
    onChange(tabs.map((t) => (t.id === id ? { ...t, color } : t)));
  }
  function remove(id: string) {
    const next = tabs.filter((t) => t.id !== id);
    onChange(next);
    if (activeId === id) onSelect(next[0]?.id ?? "");
  }

  // Sem abas e fora do modo edição: não renderiza nada (tela única).
  if (tabs.length === 0 && !editMode) return null;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {tabs.map((tab) => {
        const active = tab.id === activeId;
        const textColor = readableText(tab.color);
        if (renaming === tab.id) {
          return (
            <Input
              key={tab.id}
              autoFocus
              defaultValue={tab.name}
              className="h-8 w-32 text-sm"
              onBlur={(e) => {
                rename(tab.id, e.target.value.trim() || tab.name);
                setRenaming(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") e.currentTarget.blur();
                if (e.key === "Escape") setRenaming(null);
              }}
              aria-label="Nome da aba"
            />
          );
        }
        return (
          <span
            key={tab.id}
            className={cn(
              "inline-flex items-center gap-1 rounded-full border px-3 py-1 text-sm transition",
              active ? "ring-primary ring-2" : "opacity-80 hover:opacity-100"
            )}
            style={{ background: tab.color, color: textColor }}
          >
            <button
              type="button"
              onClick={() => onSelect(tab.id)}
              onDoubleClick={() => editMode && setRenaming(tab.id)}
              className="cursor-pointer"
            >
              {tab.name}
            </button>
            {editMode ? (
              <>
                <label
                  className="relative inline-flex size-4 cursor-pointer items-center justify-center rounded-full border"
                  title="Cor de fundo do nome"
                  style={{ background: tab.color ?? "transparent" }}
                >
                  <input
                    type="color"
                    value={tab.color ?? "#334155"}
                    onChange={(e) => setColor(tab.id, e.target.value)}
                    className="absolute inset-0 cursor-pointer opacity-0"
                    aria-label="Cor da aba"
                  />
                </label>
                <button
                  type="button"
                  onClick={() => remove(tab.id)}
                  title="Excluir aba"
                  className="hover:text-destructive"
                >
                  <X className="size-3.5" />
                </button>
              </>
            ) : null}
          </span>
        );
      })}
      {editMode ? (
        <button
          type="button"
          onClick={addTab}
          title="Adicionar aba"
          className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 rounded-full border border-dashed px-2.5 py-1 text-sm"
        >
          <Plus className="size-3.5" /> Aba
        </button>
      ) : null}
    </div>
  );
}
