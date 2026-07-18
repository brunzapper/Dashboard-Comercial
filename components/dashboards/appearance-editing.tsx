// Versão: 1.0 | Data: 10/07/2026
// Fase 10.1: peças de UI compartilhadas para a edição de aparência IN-LOCO
// (direto na tabela e no gráfico), mais o hook de persistência. Reutilizado por
// widget-chart (tabela agregada + gráficos) e record-list-table.
//  - useWidgetAppearance: estado otimista + salva via saveWidgetSettings.
//  - FloatingPanel: janela flutuante posicionada no ponto do clique.
//  - ContextMenu: menu de duplo-clique (Ordem / Cor).
//  - ColorPopover: janela com abas Texto/Preenchimento.
//  - ColorOrderDialog: ordena as cores por arraste (para "Por cor").
"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  ArrowDownAZ,
  ArrowUpAZ,
  CalendarDays,
  Check,
  GripVertical,
  Palette,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ColorField } from "./appearance-controls";
import type {
  AppearanceSettings,
  ColorPair,
  TableAlign,
  Widget,
} from "@/lib/widgets/types";
import {
  DATE_FORMATS,
  DATE_FORMAT_LABELS,
  type DateFormat,
} from "@/lib/widgets/format";
import { saveWidgetSettings } from "@/app/(app)/dashboards/actions";

// -------- hook de estado + persistência --------
// Estado otimista local + escrita DEBOUNCED (500ms) — cores mexem o input
// continuamente; sem debounce cada frame gravaria no banco + router.refresh().
export function useWidgetAppearance(widget: Widget, dashboardId: string) {
  const router = useRouter();
  const [ap, setAp] = useState<AppearanceSettings>(
    widget.settings?.appearance ?? {}
  );
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setAp(widget.settings?.appearance ?? {});
  }, [widget.settings?.appearance]);

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef<AppearanceSettings>(ap);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const save = useCallback(
    (next: AppearanceSettings) => {
      setAp(next); // otimista imediato
      latest.current = next;
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        void saveWidgetSettings(widget.id, dashboardId, {
          ...widget.settings,
          appearance: latest.current,
        }).then(() => router.refresh());
      }, 500);
    },
    [widget.id, widget.settings, dashboardId, router]
  );

  return { ap, save };
}

// -------- portal para o body --------
// Elementos `position: fixed` renderizados dentro de um item do react-grid-layout
// ficam presos ao item (o CSS transform do RGL vira o containing block do fixed)
// e abrem deslocados/fora da tela. Todo flutuante de widget DEVE passar por aqui.
export function BodyPortal({ children }: { children: ReactNode }) {
  if (typeof document === "undefined") return null;
  return createPortal(children, document.body);
}

// -------- janela flutuante no ponto do clique --------
export function FloatingPanel({
  x,
  y,
  onClose,
  children,
  className,
}: {
  x: number;
  y: number;
  onClose: () => void;
  children: ReactNode;
  className?: string;
}) {
  // Clampa para não estourar a viewport.
  const left = Math.min(x, (typeof window !== "undefined" ? window.innerWidth : 9999) - 240);
  const top = Math.min(y, (typeof window !== "undefined" ? window.innerHeight : 9999) - 220);
  return (
    <BodyPortal>
      <div className="fixed inset-0 z-40" onMouseDown={onClose} />
      <div
        className={cn(
          "bg-popover text-popover-foreground fixed z-50 rounded-md border p-2 shadow-md",
          className
        )}
        style={{ left: Math.max(4, left), top: Math.max(4, top) }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </BodyPortal>
  );
}

export function MenuBtn({
  onClick,
  children,
}: {
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="hover:bg-accent hover:text-accent-foreground flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm [&_svg]:size-4"
    >
      {children}
    </button>
  );
}

// -------- menu de duplo-clique (Ordem / Cor) --------
export type ColorScope = "row" | "col" | "cell";

export function ContextMenu({
  x,
  y,
  onClose,
  ordering,
  coloring,
  dateFormat,
}: {
  x: number;
  y: number;
  onClose: () => void;
  ordering?: {
    onAsc: () => void;
    onDesc: () => void;
    onByColor?: () => void;
  };
  coloring?: {
    scopes: ColorScope[];
    onScope: (scope: ColorScope) => void;
  };
  // Só aparece quando a coluna clicada é de data: escolhe o formato da coluna
  // (override do padrão global do dashboard).
  dateFormat?: {
    value?: DateFormat;
    onSelect: (f: DateFormat) => void;
  };
}) {
  const scopeLabel: Record<ColorScope, string> = {
    row: "Linha",
    col: "Coluna",
    cell: "Célula",
  };
  return (
    <FloatingPanel x={x} y={y} onClose={onClose} className="w-44">
      {ordering ? (
        <>
          <p className="text-muted-foreground px-2 pb-1 text-xs">Ordem</p>
          <MenuBtn onClick={ordering.onAsc}>
            <ArrowUpAZ /> Crescente
          </MenuBtn>
          <MenuBtn onClick={ordering.onDesc}>
            <ArrowDownAZ /> Decrescente
          </MenuBtn>
          {ordering.onByColor ? (
            <MenuBtn onClick={ordering.onByColor}>
              <Palette /> Por cor
            </MenuBtn>
          ) : null}
        </>
      ) : null}
      {coloring ? (
        <>
          {ordering ? <div className="bg-border my-1 h-px" /> : null}
          <p className="text-muted-foreground px-2 pb-1 text-xs">Aparência</p>
          {coloring.scopes.map((s) => (
            <MenuBtn key={s} onClick={() => coloring.onScope(s)}>
              <Palette /> {scopeLabel[s]}
            </MenuBtn>
          ))}
        </>
      ) : null}
      {dateFormat ? (
        <>
          {ordering || coloring ? <div className="bg-border my-1 h-px" /> : null}
          <p className="text-muted-foreground px-2 pb-1 text-xs">
            Formato de data
          </p>
          {DATE_FORMATS.map((f) => (
            <MenuBtn key={f} onClick={() => dateFormat.onSelect(f)}>
              <CalendarDays />
              <span className="flex-1">{DATE_FORMAT_LABELS[f]}</span>
              {dateFormat.value === f ? <Check className="size-3.5" /> : null}
            </MenuBtn>
          ))}
        </>
      ) : null}
    </FloatingPanel>
  );
}

// -------- janela de aparência: cor (abas Texto/Preenchimento) + alinhamento --------
export function ColorPopover({
  x,
  y,
  title,
  value,
  onChange,
  onClose,
  only,
  align,
  border,
  decimals,
  footer,
}: {
  x: number;
  y: number;
  title: string;
  value: ColorPair;
  onChange: (v: ColorPair) => void;
  onClose: () => void;
  only?: "fill" | "text"; // esconde as abas e mostra só uma cor
  // Alinhamento do escopo (linha/coluna/célula). onSelect(undefined) limpa o
  // override (clicar de novo no alinhamento ativo).
  align?: {
    value?: TableAlign;
    onSelect: (a: TableAlign | undefined) => void;
  };
  // Borda do escopo (célula/seleção): terceira aba com cor; limpar remove.
  border?: {
    value?: string;
    onChange: (v: string | undefined) => void;
  };
  // Casas decimais do escopo (18/07/2026): "Auto" = herda (limpa o override);
  // clicar no valor ativo também limpa (mesmo padrão do alinhamento).
  decimals?: {
    value?: number;
    onSelect: (d: number | undefined) => void;
  };
  footer?: ReactNode; // extras abaixo do alinhamento (ex.: atalhos linha/coluna)
}) {
  const [tab, setTab] = useState<"fill" | "text" | "border">(only ?? "fill");
  const active = only ?? tab;
  const ALIGN_OPTIONS: {
    key: TableAlign;
    label: string;
    Icon: typeof AlignLeft;
  }[] = [
    { key: "left", label: "Esquerda", Icon: AlignLeft },
    { key: "center", label: "Centro", Icon: AlignCenter },
    { key: "right", label: "Direita", Icon: AlignRight },
  ];
  return (
    <FloatingPanel x={x} y={y} onClose={onClose} className="w-60">
      <div className="flex flex-col gap-2">
        <p className="text-xs font-medium">{title}</p>
        {only ? null : (
          <div className="bg-muted flex gap-1 rounded-md p-0.5">
            {(
              [
                ["fill", "Preenchimento"],
                ["text", "Texto"],
                ...(border ? ([["border", "Borda"]] as const) : []),
              ] as const
            ).map(([k, label]) => (
              <button
                key={k}
                type="button"
                onClick={() => setTab(k)}
                className={cn(
                  "flex-1 rounded-sm px-2 py-1 text-xs",
                  tab === k ? "bg-background shadow-sm" : "text-muted-foreground"
                )}
              >
                {label}
              </button>
            ))}
          </div>
        )}
        {active === "fill" ? (
          <ColorField
            value={value.fill}
            onChange={(v) => onChange({ ...value, fill: v })}
            onClear={() => onChange({ ...value, fill: undefined })}
          />
        ) : active === "border" && border ? (
          <ColorField
            value={border.value}
            onChange={(v) => border.onChange(v)}
            onClear={() => border.onChange(undefined)}
          />
        ) : (
          <ColorField
            value={value.text}
            onChange={(v) => onChange({ ...value, text: v })}
            onClear={() => onChange({ ...value, text: undefined })}
          />
        )}
        {align ? (
          <div className="flex flex-col gap-1 border-t pt-2">
            <p className="text-muted-foreground text-xs">Alinhamento</p>
            <div className="flex gap-1">
              {ALIGN_OPTIONS.map(({ key, label, Icon }) => (
                <button
                  key={key}
                  type="button"
                  title={label}
                  aria-label={label}
                  aria-pressed={align.value === key}
                  onClick={() =>
                    align.onSelect(align.value === key ? undefined : key)
                  }
                  className={cn(
                    "flex flex-1 items-center justify-center rounded-sm border px-2 py-1",
                    align.value === key
                      ? "bg-accent text-accent-foreground"
                      : "text-muted-foreground hover:bg-accent/50"
                  )}
                >
                  <Icon className="size-4" />
                </button>
              ))}
            </div>
          </div>
        ) : null}
        {decimals ? (
          <div className="flex flex-col gap-1 border-t pt-2">
            <p className="text-muted-foreground text-xs">Casas decimais</p>
            <div className="flex gap-1">
              {[undefined, 0, 1, 2, 3, 4].map((d) => (
                <button
                  key={d ?? "auto"}
                  type="button"
                  aria-pressed={decimals.value === d}
                  onClick={() =>
                    decimals.onSelect(
                      d != null && decimals.value === d ? undefined : d
                    )
                  }
                  className={cn(
                    "flex flex-1 items-center justify-center rounded-sm border px-1 py-1 text-xs tabular-nums",
                    decimals.value === d
                      ? "bg-accent text-accent-foreground"
                      : "text-muted-foreground hover:bg-accent/50"
                  )}
                >
                  {d ?? "Auto"}
                </button>
              ))}
            </div>
          </div>
        ) : null}
        {footer ? (
          <div className="flex flex-col border-t pt-1">{footer}</div>
        ) : null}
      </div>
    </FloatingPanel>
  );
}

// -------- editor de categorias de um gráfico (barra/linha) --------
// Faixa de "chips" arrastáveis (uma por categoria, na ordem atual). Arrastar
// reordena; duplo-clique abre Ordem (cresc/decr/por cor) e Cor (preenchimento
// da barra). É a superfície de manipulação in-loco das colunas do gráfico.
export function CategoryEditor({
  names,
  appearance,
  onChange,
}: {
  names: string[];
  appearance: import("@/lib/widgets/types").AppearanceSettings;
  onChange: (a: import("@/lib/widgets/types").AppearanceSettings) => void;
}) {
  const [drag, setDrag] = useState<string | null>(null);
  const [menu, setMenu] = useState<
    | { kind: "ctx"; x: number; y: number; name: string }
    | { kind: "color"; x: number; y: number; name: string }
    | { kind: "colorOrder"; x: number; y: number }
    | null
  >(null);

  const catColors = appearance.categoryColors ?? {};
  const fills = distinctFillsLocal(names.map((n) => catColors[n]?.fill));
  const canByColor = fills.length >= 2;

  function reorder(target: string) {
    if (!drag) return;
    const next = moveKey(names, drag, target);
    onChange({ ...appearance, categoryOrder: next, categorySort: undefined });
  }
  function setCatColor(name: string, cp: ColorPair) {
    const next = { ...catColors };
    if (!cp.fill && !cp.text) delete next[name];
    else next[name] = cp;
    onChange({ ...appearance, categoryColors: next });
  }

  return (
    <div className="flex flex-wrap gap-1 px-1 pb-1">
      {names.map((n) => (
        <span
          key={n}
          draggable
          onDragStart={() => setDrag(n)}
          onDragOver={(e) => e.preventDefault()}
          onDrop={() => {
            reorder(n);
            setDrag(null);
          }}
          onDoubleClick={(e) =>
            setMenu({ kind: "ctx", x: e.clientX, y: e.clientY, name: n })
          }
          title="Arraste para reordenar • duplo-clique p/ ordenar/colorir"
          className="bg-muted hover:bg-accent flex cursor-move items-center gap-1 rounded-full px-2 py-0.5 text-xs"
        >
          <span
            className="size-2.5 rounded-full border"
            style={{ background: catColors[n]?.fill ?? "transparent" }}
          />
          {n}
        </span>
      ))}

      {menu?.kind === "ctx" ? (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          ordering={{
            onAsc: () => {
              onChange({ ...appearance, categorySort: { dir: "asc" }, categoryOrder: undefined });
              setMenu(null);
            },
            onDesc: () => {
              onChange({ ...appearance, categorySort: { dir: "desc" }, categoryOrder: undefined });
              setMenu(null);
            },
            onByColor: canByColor
              ? () => setMenu({ kind: "colorOrder", x: menu.x, y: menu.y })
              : undefined,
          }}
          coloring={{
            scopes: ["col"],
            onScope: () =>
              setMenu({ kind: "color", x: menu.x, y: menu.y, name: menu.name }),
          }}
        />
      ) : null}

      {menu?.kind === "color" ? (
        <ColorPopover
          x={menu.x}
          y={menu.y}
          only="fill"
          title={`Cor da barra — ${menu.name}`}
          value={catColors[menu.name] ?? {}}
          onChange={(cp) => setCatColor(menu.name, cp)}
          onClose={() => setMenu(null)}
        />
      ) : null}

      {menu?.kind === "colorOrder" ? (
        <ColorOrderDialog
          x={menu.x}
          y={menu.y}
          colors={fills}
          value={appearance.categorySort?.colorOrder}
          onApply={(order) => {
            onChange({
              ...appearance,
              categorySort: { dir: "color", colorOrder: order },
              categoryOrder: undefined,
            });
            setMenu(null);
          }}
          onClose={() => setMenu(null)}
        />
      ) : null}
    </div>
  );
}

// helpers locais (evita import circular com appearance.ts nos usos de UI)
function moveKey(order: string[], drag: string, target: string): string[] {
  if (drag === target) return order;
  const next = [...order];
  const from = next.indexOf(drag);
  const to = next.indexOf(target);
  if (from < 0 || to < 0) return order;
  next.splice(to, 0, next.splice(from, 1)[0]);
  return next;
}
function distinctFillsLocal(fills: (string | undefined)[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const f of fills)
    if (f && !seen.has(f)) {
      seen.add(f);
      out.push(f);
    }
  return out;
}

// -------- janela "Por cor": ordena as cores por arraste --------
export function ColorOrderDialog({
  x,
  y,
  colors,
  value,
  onApply,
  onClose,
}: {
  x: number;
  y: number;
  colors: string[];
  value: string[] | undefined;
  onApply: (order: string[]) => void;
  onClose: () => void;
}) {
  const initial = value && value.length ? value : colors;
  const [order, setOrder] = useState<string[]>(initial);
  const [drag, setDrag] = useState<string | null>(null);

  function drop(target: string) {
    if (!drag || drag === target) return;
    const next = [...order];
    const from = next.indexOf(drag);
    const to = next.indexOf(target);
    if (from < 0 || to < 0) return;
    next.splice(to, 0, next.splice(from, 1)[0]);
    setOrder(next);
  }

  return (
    <FloatingPanel x={x} y={y} onClose={onClose} className="w-56">
      <div className="flex flex-col gap-2">
        <p className="text-xs font-medium">Ordenar por cor (arraste)</p>
        <div className="flex flex-col gap-1">
          {order.map((c) => (
            <div
              key={c}
              draggable
              onDragStart={() => setDrag(c)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => {
                drop(c);
                setDrag(null);
              }}
              className="flex items-center gap-2 rounded-md border px-2 py-1"
            >
              <GripVertical className="text-muted-foreground size-4 cursor-move" />
              <span
                className="size-4 rounded-sm border"
                style={{ background: c }}
              />
              <span className="text-muted-foreground truncate text-xs">
                {c}
              </span>
            </div>
          ))}
        </div>
        <Button size="sm" onClick={() => onApply(order)}>
          Aplicar
        </Button>
      </div>
    </FloatingPanel>
  );
}

// -------- alça de redimensionamento (largura de coluna / altura de linha) --------
// Faixa fina posicionada na borda da célula. Aparece ao passar o mouse (mesmo com
// as linhas de grade ocultas) durante a edição de layout. Arrastar altera o
// tamanho: `getStart` lê o tamanho atual no início; `onResize` recebe o novo (px).
export function ResizeHandle({
  axis,
  onResize,
  minSize = 40,
}: {
  axis: "col" | "row";
  onResize: (size: number) => void;
  minSize?: number;
}) {
  const ref = useRef<HTMLSpanElement | null>(null);
  const dragRef = useRef<{ pos: number; size: number } | null>(null);

  function onPointerDown(e: React.PointerEvent) {
    e.preventDefault();
    e.stopPropagation();
    // Mede a célula/linha que contém a alça como tamanho inicial.
    const cell = ref.current?.parentElement as HTMLElement | null;
    const size = cell
      ? axis === "col"
        ? cell.offsetWidth
        : cell.offsetHeight
      : minSize;
    dragRef.current = { pos: axis === "col" ? e.clientX : e.clientY, size };
    e.currentTarget.setPointerCapture(e.pointerId);
  }
  function onPointerMove(e: React.PointerEvent) {
    const d = dragRef.current;
    if (!d) return;
    const delta = (axis === "col" ? e.clientX : e.clientY) - d.pos;
    onResize(Math.max(minSize, Math.round(d.size + delta)));
  }
  function endDrag(e: React.PointerEvent) {
    if (!dragRef.current) return;
    dragRef.current = null;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // capture pode já ter sido liberada
    }
  }

  return (
    <span
      ref={ref}
      role="separator"
      aria-orientation={axis === "col" ? "vertical" : "horizontal"}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onDoubleClick={(e) => e.stopPropagation()}
      title={axis === "col" ? "Arraste para largura" : "Arraste para altura"}
      className={cn(
        "absolute z-10 opacity-0 transition-opacity hover:opacity-100",
        "before:absolute before:bg-primary/60 before:content-['']",
        axis === "col"
          ? "top-0 right-0 h-full w-2 cursor-col-resize before:top-0 before:right-0 before:h-full before:w-0.5"
          : "bottom-0 left-0 h-2 w-full cursor-row-resize before:bottom-0 before:left-0 before:h-0.5 before:w-full"
      )}
    />
  );
}

// -------- alça de arraste (cabeçalho de coluna / gutter de linha) --------
export function DragHandle({
  onDragStart,
  onDragOver,
  onDrop,
  className,
  title,
}: {
  onDragStart: () => void;
  onDragOver: (e: React.DragEvent) => void;
  onDrop: () => void;
  className?: string;
  title?: string;
}) {
  return (
    <span
      draggable
      title={title}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      className={cn(
        "text-muted-foreground hover:text-foreground cursor-move opacity-0 transition-opacity group-hover:opacity-100",
        className
      )}
    >
      <GripVertical className="size-3.5" />
    </span>
  );
}
