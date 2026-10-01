// Versão: 1.1 | Data: 01/10/2026
// Componente Textarea (shadcn/ui, new-york).
// v1.1 (01/10/2026): `field-sizing-content` crescia SEM teto (texto/JSON longo
//   empurrava o painel para fora da tela). Cresce até metade da tela e rola.
import * as React from "react";

import { cn } from "@/lib/utils";

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "border-input placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:ring-destructive/20 aria-invalid:border-destructive flex field-sizing-content min-h-16 max-h-[50vh] w-full overflow-y-auto rounded-md border bg-transparent px-3 py-2 text-base shadow-xs transition-[color,box-shadow] outline-none focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
        className
      )}
      {...props}
    />
  );
}

export { Textarea };
