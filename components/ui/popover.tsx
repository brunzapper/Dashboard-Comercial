// Versão: 1.1 | Data: 01/10/2026
// Componente Popover (shadcn/ui, new-york) sobre radix-ui.
// v1.1 (01/10/2026): teto de altura = espaço livre na viewport (variável do
//   Radix) + rolagem interna. Sem isso, popover longo (ex.: "Campo de data por
//   base" com muitas bases) saía da tela e só se alcançava com zoom out.
"use client";

import * as React from "react";
import { Popover as PopoverPrimitive } from "radix-ui";

import { cn } from "@/lib/utils";

const Popover = PopoverPrimitive.Root;
const PopoverTrigger = PopoverPrimitive.Trigger;
const PopoverAnchor = PopoverPrimitive.Anchor;

function PopoverContent({
  className,
  align = "center",
  sideOffset = 4,
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Content>) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        data-slot="popover-content"
        align={align}
        sideOffset={sideOffset}
        className={cn(
          "bg-popover text-popover-foreground data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 z-50 max-h-[var(--radix-popover-content-available-height)] w-72 origin-[var(--radix-popover-content-transform-origin)] overflow-y-auto overscroll-contain rounded-md border p-4 shadow-md outline-hidden",
          className
        )}
        {...props}
      />
    </PopoverPrimitive.Portal>
  );
}

export { Popover, PopoverTrigger, PopoverContent, PopoverAnchor };
