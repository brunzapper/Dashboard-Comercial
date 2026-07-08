// Versão: 1.0 | Data: 05/07/2026
// Botão (admin) para gerar os dashboards preset. Idempotente.
"use client";

import { useState, useTransition } from "react";
import { Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";
import { generatePresets } from "@/app/(app)/dashboards/actions";

export function GeneratePresetsButton() {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  return (
    <div className="flex items-center gap-3">
      <Button
        variant="outline"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const res = await generatePresets();
            setMessage(res.message ?? null);
          })
        }
      >
        <Sparkles className="size-4" />
        {pending ? "Gerando..." : "Gerar presets"}
      </Button>
      {message ? (
        <span className="text-muted-foreground text-sm">{message}</span>
      ) : null}
    </div>
  );
}
