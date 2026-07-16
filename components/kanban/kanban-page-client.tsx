// Versão: 1.0 | Data: 16/07/2026
// Shell client da página dedicada de kanban (/kanbans/[id]): cabeçalho (nome,
// visões kanban|lista, barra de período simples, config de colunas, novo
// registro) + o quadro/lista. Os dados chegam computados do RSC; navegação de
// período muda a URL (?periodo/?de/?ate) e o servidor recomputa.
"use client";

import { useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { List, SquareKanban } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import { Input } from "@/components/ui/input";
import { PERIOD_PRESETS } from "@/lib/widgets/period";
import type { DashboardSettings } from "@/lib/widgets/types";
import type { KanbanBoardData } from "@/lib/kanban/data";
import type { KanbanSettings } from "@/lib/kanban/types";
import { cn } from "@/lib/utils";
import { RecordCreateSheet } from "@/components/registros/record-create-sheet";
import {
  KanbanBoard,
  type KanbanRecordContext,
} from "./kanban-board";
import { KanbanList } from "./kanban-list";
import { ColumnConfigPopover } from "./column-config-popover";

const PERIOD_OPTIONS: ComboboxOption[] = [
  { value: "", label: "Todo o período" },
  ...Object.entries(PERIOD_PRESETS).map(([value, label]) => ({ value, label })),
];

type View = "kanban" | "lista";

export function KanbanPageClient({
  boardId,
  boardName,
  settings,
  kanban,
  data,
  quickCreateSource,
  recordCtx,
  canConfig,
}: {
  boardId: string;
  boardName: string;
  settings: DashboardSettings;
  kanban: KanbanSettings;
  data: KanbanBoardData;
  quickCreateSource: { key: string; label: string } | null;
  recordCtx: KanbanRecordContext;
  canConfig: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [view, setView] = useState<View>("kanban");

  const periodo = searchParams.get("periodo") ?? "";
  const de = searchParams.get("de") ?? "";
  const ate = searchParams.get("ate") ?? "";

  function setPeriod(next: { periodo?: string; de?: string; ate?: string }) {
    const params = new URLSearchParams(searchParams.toString());
    const apply = (key: string, v: string | undefined) => {
      if (v) params.set(key, v);
      else params.delete(key);
    };
    apply("periodo", next.periodo);
    apply("de", next.de);
    apply("ate", next.ate);
    router.replace(`${pathname}?${params.toString()}`);
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">{boardName}</h1>
        <div className="flex flex-wrap items-center gap-2">
          {/* Visões */}
          <div className="flex rounded-md border p-0.5">
            <Button
              variant="ghost"
              size="sm"
              className={cn("h-7 gap-1 px-2", view === "kanban" && "bg-muted")}
              onClick={() => setView("kanban")}
              aria-pressed={view === "kanban"}
            >
              <SquareKanban className="size-4" />
              Kanban
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className={cn("h-7 gap-1 px-2", view === "lista" && "bg-muted")}
              onClick={() => setView("lista")}
              aria-pressed={view === "lista"}
            >
              <List className="size-4" />
              Lista
            </Button>
          </div>

          {/* Período (aplicado no campo de data da fonte / do bucket) */}
          <Combobox
            options={PERIOD_OPTIONS}
            value={periodo}
            onValueChange={(v) => setPeriod({ periodo: v, de: "", ate: "" })}
            searchable={false}
            className="w-40"
            aria-label="Período"
          />
          <Input
            type="date"
            value={de}
            onChange={(e) =>
              setPeriod({ periodo: "", de: e.target.value, ate })
            }
            className="h-8 w-36"
            aria-label="De"
          />
          <Input
            type="date"
            value={ate}
            onChange={(e) =>
              setPeriod({ periodo: "", de, ate: e.target.value })
            }
            className="h-8 w-36"
            aria-label="Até"
          />

          {canConfig ? (
            <ColumnConfigPopover
              boardId={boardId}
              settings={settings}
              data={data}
            />
          ) : null}

          {quickCreateSource ? (
            <RecordCreateSheet
              source={quickCreateSource}
              fields={recordCtx.fields}
              responsibles={recordCtx.responsibles}
              operations={recordCtx.operations}
              userRoles={recordCtx.userRoles}
            />
          ) : null}
        </div>
      </div>

      {view === "kanban" ? (
        <KanbanBoard
          data={data}
          settings={kanban}
          canMove={recordCtx.canEditValues}
          recordCtx={recordCtx}
          quickCreateSource={quickCreateSource}
        />
      ) : (
        <KanbanList data={data} recordCtx={recordCtx} />
      )}
    </div>
  );
}
