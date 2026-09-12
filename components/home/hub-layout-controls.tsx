// Versão: 2.0 | Data: 12/09/2026
// Controles de disposição do hub / painel de Operação.
//
// v2.0 (12/09/2026): dois níveis, por papel.
//  - TODO MUNDO vê só o alternador CARTÃO ↔ LISTA. É a escolha de conforto de
//    quem está olhando, e era a única que o vendedor e o gestor pediram.
//  - ADMIN vê, além dele, uma ENGRENAGEM com o resto: colunas, altura do card,
//    exibir descrição e exibir nível de acesso. Quatro controles soltos no
//    cabeçalho competiam com o conteúdo da tela.
// O estado agora é do contexto (hub-display-context): a tela responde no mesmo
// frame e a gravação vai em segundo plano SEM refresh — antes o valor só
// aparecia depois de recarregar, e o refresh ainda desmarcava a caixa.
"use client";

import { LayoutGrid, List, Minus, Plus, Settings2 } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  CARD_HEIGHT_STEP,
  MAX_CARD_HEIGHT,
  MAX_HUB_COLUMNS,
  MIN_CARD_HEIGHT,
  MIN_HUB_COLUMNS,
  type HubLayout,
} from "@/lib/config/ui-prefs";
import { useHubDisplay } from "./hub-display-context";

const LOCKED_HINT = "Definido pela organização";

export function HubLayoutControls({
  isAdmin,
  /** Rótulo do interruptor de acesso — muda de sentido entre as famílias. */
  accessLabel = "Nível de acesso",
}: {
  isAdmin: boolean;
  accessLabel?: string;
}) {
  const { display, isLocked, set, saving } = useHubDisplay();

  const layoutOptions = [
    { value: "grid", Icon: LayoutGrid, label: "Cartão" },
    { value: "list", Icon: List, label: "Lista" },
  ] as const;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div
        className="flex items-center rounded-md border p-0.5"
        role="group"
        aria-label="Formato dos cards"
      >
        {layoutOptions.map(({ value, Icon, label }) => (
          <button
            key={value}
            type="button"
            onClick={() => set({ layout: value as HubLayout })}
            disabled={isLocked("layout")}
            aria-pressed={display.layout === value}
            title={isLocked("layout") ? LOCKED_HINT : label}
            className={cn(
              "rounded-sm p-1.5 transition-colors disabled:opacity-50",
              display.layout === value
                ? "bg-brand/10 text-brand"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            <Icon className="size-4" />
            <span className="sr-only">{label}</span>
          </button>
        ))}
      </div>

      {isAdmin ? (
        <Popover>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              size="icon"
              className="size-8"
              aria-label="Configurar exibição dos cards"
              title="Configurar exibição dos cards"
            >
              <Settings2 className="size-4" />
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="flex w-72 flex-col gap-4">
            <div className="flex flex-col gap-0.5">
              <p className="text-sm font-medium">Exibição dos cards</p>
              <p className="text-muted-foreground text-xs">
                Vale para você. O padrão de toda a organização fica em
                Configurações → Tema e interface.
              </p>
            </div>

            {display.layout === "grid" ? (
              <Stepper
                label="Colunas"
                value={display.columns}
                min={MIN_HUB_COLUMNS}
                max={MAX_HUB_COLUMNS}
                step={1}
                locked={isLocked("columns")}
                onChange={(columns) => set({ columns })}
                format={(n) => String(n)}
              />
            ) : null}

            <Stepper
              label="Altura do card"
              value={display.cardHeight}
              min={MIN_CARD_HEIGHT}
              max={MAX_CARD_HEIGHT}
              step={CARD_HEIGHT_STEP}
              locked={isLocked("cardHeight")}
              onChange={(cardHeight) => set({ cardHeight })}
              format={(n) => (n === 0 ? "Auto" : `${n}px`)}
            />

            <label
              className="flex items-center gap-2"
              title={isLocked("showDescription") ? LOCKED_HINT : undefined}
            >
              <Checkbox
                checked={display.showDescription}
                disabled={isLocked("showDescription")}
                onCheckedChange={(v) => set({ showDescription: v === true })}
              />
              <Label className="cursor-pointer text-sm font-normal">
                Exibir descrição
              </Label>
            </label>

            <label
              className="flex items-center gap-2"
              title={isLocked("showAccess") ? LOCKED_HINT : undefined}
            >
              <Checkbox
                checked={display.showAccess}
                disabled={isLocked("showAccess")}
                onCheckedChange={(v) => set({ showAccess: v === true })}
              />
              <Label className="cursor-pointer text-sm font-normal">
                Exibir {accessLabel.toLowerCase()}
              </Label>
            </label>
          </PopoverContent>
        </Popover>
      ) : null}

      <span
        aria-live="polite"
        className={cn(
          "text-muted-foreground text-xs transition-opacity",
          saving ? "opacity-100" : "opacity-0"
        )}
      >
        Salvando…
      </span>
    </div>
  );
}

function Stepper({
  label,
  value,
  min,
  max,
  step,
  locked,
  onChange,
  format,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  locked: boolean;
  onChange: (next: number) => void;
  format: (n: number) => string;
}) {
  const bump = (delta: number) => {
    const next = Math.min(max, Math.max(min, value + delta * step));
    if (next !== value) onChange(next);
  };
  return (
    <div
      className="flex items-center justify-between gap-2"
      title={locked ? LOCKED_HINT : undefined}
    >
      <Label className="text-sm font-normal">{label}</Label>
      <div className="flex items-center gap-1">
        <Button
          variant="outline"
          size="icon"
          className="size-7"
          onClick={() => bump(-1)}
          disabled={locked || value <= min}
          aria-label={`Diminuir ${label.toLowerCase()}`}
        >
          <Minus className="size-3.5" />
        </Button>
        <span
          className="w-12 text-center text-sm tabular-nums"
          aria-live="polite"
        >
          {format(value)}
        </span>
        <Button
          variant="outline"
          size="icon"
          className="size-7"
          onClick={() => bump(1)}
          disabled={locked || value >= max}
          aria-label={`Aumentar ${label.toLowerCase()}`}
        >
          <Plus className="size-3.5" />
        </Button>
      </div>
    </div>
  );
}
