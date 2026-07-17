// Versão: 1.0 | Data: 17/07/2026
// Popover "Aparência" da PÁGINA dedicada de kanban: edita
// settings.kanban.appearance (mesmos campos do widget — seção compartilhada
// KanbanAppearanceSection) e persiste via updateBoardSettings — ATENÇÃO: a
// action sobrescreve `settings` INTEIRO, então enviamos
// { ...settings, kanban: { ...kanban, appearance } } (regra documentada em
// app/(app)/dashboards/actions.ts).
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Palette } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { updateBoardSettings } from "@/app/(app)/dashboards/actions";
import type { DashboardSettings } from "@/lib/widgets/types";
import type { KanbanAppearance } from "@/lib/kanban/types";
import { KanbanAppearanceSection } from "./kanban-appearance-section";

export function BoardAppearancePopover({
  boardId,
  settings,
}: {
  boardId: string;
  settings: DashboardSettings;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState<KanbanAppearance>({});
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setMessage(null);
    const res = await updateBoardSettings(boardId, {
      ...settings,
      kanban: {
        mode: "registros",
        ...settings.kanban,
        appearance: value,
      },
    });
    setSaving(false);
    if (!res.ok) {
      setMessage(res.message ?? "Falha ao salvar.");
      return;
    }
    setOpen(false);
    router.refresh();
  }

  return (
    <Popover
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (v) {
          setValue(settings.kanban?.appearance ?? {});
          setMessage(null);
        }
      }}
    >
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="h-8 gap-1.5">
          <Palette className="size-4" />
          Aparência
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="max-h-[70vh] w-80 overflow-y-auto">
        <div className="flex flex-col gap-3">
          <p className="text-sm font-medium">Aparência do kanban</p>
          <KanbanAppearanceSection value={value} onChange={setValue} />
          {message ? (
            <p className="text-destructive text-xs" role="status">
              {message}
            </p>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setOpen(false)}
              disabled={saving}
            >
              Cancelar
            </Button>
            <Button size="sm" onClick={save} disabled={saving}>
              {saving ? "Salvando…" : "Salvar"}
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
