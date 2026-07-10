// Versão: 1.0 | Data: 10/07/2026
// Fase 10: controles reutilizáveis de aparência (color picker nativo + hex).
// Usados pelo menu de fundo do dashboard e pelo editor de aparência do widget.
"use client";

import { cn } from "@/lib/utils";
import { Label } from "@/components/ui/label";

// Normaliza uma cor para o <input type="color"> (que só aceita #rrggbb).
function toHexInput(v: string | undefined): string {
  if (v && /^#[0-9a-fA-F]{6}$/.test(v)) return v;
  return "#3b82f6";
}

export function ColorField({
  label,
  value,
  onChange,
  onClear,
  className,
}: {
  label?: string;
  value: string | undefined;
  onChange: (v: string) => void;
  onClear?: () => void;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-1", className)}>
      {label ? <Label className="text-xs">{label}</Label> : null}
      <div className="flex items-center gap-2">
        <input
          type="color"
          aria-label={label ?? "Cor"}
          value={toHexInput(value)}
          onChange={(e) => onChange(e.target.value)}
          className="border-input h-8 w-10 cursor-pointer rounded-md border bg-transparent p-0.5"
        />
        <input
          type="text"
          value={value ?? ""}
          placeholder="—"
          onChange={(e) => onChange(e.target.value)}
          className="border-input h-8 w-28 rounded-md border bg-transparent px-2 text-xs tabular-nums outline-none"
        />
        {onClear && value ? (
          <button
            type="button"
            onClick={onClear}
            className="text-muted-foreground hover:text-foreground text-xs underline"
          >
            limpar
          </button>
        ) : null}
      </div>
    </div>
  );
}
