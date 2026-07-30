// Versão: 1.0 | Data: 30/07/2026
// SheetContent (lado direito) redimensionável arrastando a borda esquerda.
// Envolve o primitivo sem tocá-lo: `sm:max-w-none` neutraliza o teto do base e
// a largura real vai por style inline. Largura por-painel via storageKey.
"use client";

import * as React from "react";

import { SheetContent } from "@/components/ui/sheet";
import { usePanelWidth } from "@/components/ui/use-panel-width";
import { cn } from "@/lib/utils";

export function ResizableSheetContent({
  storageKey,
  defaultWidth,
  minWidth = 320,
  className,
  style,
  children,
  ...props
}: React.ComponentProps<typeof SheetContent> & {
  storageKey: string;
  defaultWidth: number;
  minWidth?: number;
}) {
  const { width, handleProps } = usePanelWidth(storageKey, defaultWidth, {
    min: minWidth,
  });
  return (
    <SheetContent
      className={cn("sm:max-w-none", className)}
      style={{ width, maxWidth: "95vw", ...style }}
      {...props}
    >
      {/* Alça de redimensionamento (borda esquerda do painel). */}
      <span
        role="separator"
        aria-orientation="vertical"
        aria-label="Redimensionar painel"
        title="Arraste para redimensionar o painel"
        {...handleProps}
        className="hover:bg-primary/40 absolute top-0 left-0 z-20 h-full w-1.5 cursor-col-resize"
      />
      {children}
    </SheetContent>
  );
}
