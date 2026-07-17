// Versão: 1.0 | Data: 17/07/2026
// Flyout do "Inserir ▸" do menu de contexto do grid: TODOS os tipos de widget
// (VISUAL_TYPE_LABELS) numa lista com busca (sem acento) e navegação por
// teclado. Renderizado dentro do FloatingPanel do dashboard-grid — cliques não
// vazam (o painel já segura o mousedown); Esc fecha só o flyout.
"use client";

import { useRef, useState } from "react";
import {
  BarChart3,
  BarChartHorizontal,
  CalendarClock,
  CalendarDays,
  Calculator,
  Gauge,
  LineChart,
  ListFilter,
  PieChart,
  Funnel,
  Shapes,
  Sigma,
  SquareKanban,
  StickyNote,
  Table,
  Table2,
  type LucideIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { VISUAL_TYPE_LABELS, type VisualType } from "@/lib/widgets/types";

const TYPE_ICONS: Record<VisualType, LucideIcon> = {
  kpi: Gauge,
  calculado: Sigma,
  calculadora: Calculator,
  nota: StickyNote,
  forma: Shapes,
  tabela: Table,
  tabela_editavel: Table2,
  barra: BarChart3,
  barra_horizontal: BarChartHorizontal,
  linha: LineChart,
  pizza: PieChart,
  funil: Funnel,
  filtro: CalendarClock,
  filtro_campo: ListFilter,
  kanban: SquareKanban,
  agenda: CalendarDays,
};

// Busca sem acento/caixa ("metrica" acha "Métrica calculada").
const norm = (s: string) =>
  s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();

export function InsertTypeMenu({
  alignLeft,
  onPick,
  onClose,
}: {
  // Flip: abre para a esquerda quando o menu está colado na borda direita.
  alignLeft: boolean;
  onPick: (t: VisualType) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [hi, setHi] = useState(0);
  const listRef = useRef<HTMLDivElement | null>(null);

  const q = norm(query.trim());
  const items = (
    Object.entries(VISUAL_TYPE_LABELS) as [VisualType, string][]
  ).filter(([kind, label]) => !q || norm(label).includes(q) || norm(kind).includes(q));
  const active = Math.min(hi, Math.max(0, items.length - 1));

  const move = (delta: number) => {
    if (items.length === 0) return;
    const next = (active + delta + items.length) % items.length;
    setHi(next);
    // Mantém o item destacado à vista dentro da lista rolável.
    listRef.current
      ?.querySelector(`[data-idx="${next}"]`)
      ?.scrollIntoView({ block: "nearest" });
  };

  return (
    <div
      className={cn(
        "bg-popover text-popover-foreground absolute top-0 z-50 w-56 rounded-md border p-2 shadow-md",
        alignLeft ? "right-full mr-1" : "left-full ml-1"
      )}
    >
      <Input
        autoFocus
        value={query}
        placeholder="Buscar tipo…"
        className="mb-1 h-8"
        onChange={(e) => {
          setQuery(e.target.value);
          setHi(0);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            move(1);
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            move(-1);
          } else if (e.key === "Enter") {
            e.preventDefault();
            const it = items[active];
            if (it) onPick(it[0]);
          } else if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            onClose();
          }
        }}
      />
      <div ref={listRef} className="max-h-64 overflow-y-auto">
        {items.map(([kind, label], i) => {
          const Icon = TYPE_ICONS[kind];
          return (
            <button
              key={kind}
              type="button"
              data-idx={i}
              onClick={() => onPick(kind)}
              onMouseEnter={() => setHi(i)}
              className={cn(
                "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm [&_svg]:size-4",
                i === active
                  ? "bg-accent text-accent-foreground"
                  : "hover:bg-accent hover:text-accent-foreground"
              )}
            >
              <Icon />
              <span className="flex-1">{label}</span>
            </button>
          );
        })}
        {items.length === 0 ? (
          <p className="text-muted-foreground px-2 py-1.5 text-xs">
            Nenhum tipo encontrado
          </p>
        ) : null}
      </div>
    </div>
  );
}
