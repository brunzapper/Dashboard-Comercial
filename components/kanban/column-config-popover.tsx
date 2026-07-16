// Versão: 1.1 | Data: 16/07/2026
// Configuração das colunas do kanban (owner/admin): ordem, rótulo, cor, WIP e
// ocultar; em boards de TAREFAS, também a antecedência do alerta de prazo
// (dueSoonDays) e a trava de exclusão por padrão. Persiste em settings.kanban
// via updateBoardSettings — ATENÇÃO: a action sobrescreve `settings` INTEIRO,
// então enviamos { ...settings, kanban: { ...kanban, ... } } (regra documentada
// em app/(app)/dashboards/actions.ts).
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, Settings2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { updateBoardSettings } from "@/app/(app)/dashboards/actions";
import type { DashboardSettings } from "@/lib/widgets/types";
import type { KanbanBoardData } from "@/lib/kanban/data";
import type { KanbanColumnOverride } from "@/lib/kanban/types";

interface Row extends KanbanColumnOverride {
  currentLabel: string;
}

export function ColumnConfigPopover({
  boardId,
  settings,
  data,
}: {
  boardId: string;
  settings: DashboardSettings;
  data: KanbanBoardData;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<Row[]>([]);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const isTasks = settings.kanban?.mode === "tarefas";
  const [dueSoonDays, setDueSoonDays] = useState<number | "">(
    settings.kanban?.tasks?.dueSoonDays ?? ""
  );
  const [lockByDefault, setLockByDefault] = useState(
    settings.kanban?.tasks?.lockByDefault ?? false
  );

  function init() {
    const overrides = settings.kanban?.columns ?? [];
    const byKey = new Map(overrides.map((o) => [o.key, o] as const));
    // Colunas visíveis (ordem atual do quadro) + ocultas (só nos overrides).
    const seen = new Set<string>();
    const next: Row[] = data.columns.map((c) => {
      seen.add(c.key);
      const ov = byKey.get(c.key);
      return {
        key: c.key,
        label: ov?.label ?? "",
        color: ov?.color ?? c.color,
        hidden: false,
        wipLimit: ov?.wipLimit ?? c.wipLimit,
        completesTask: ov?.completesTask ?? c.completesTask,
        currentLabel: c.label,
      };
    });
    for (const ov of overrides) {
      if (seen.has(ov.key) || !ov.hidden) continue;
      next.push({ ...ov, currentLabel: ov.label || ov.key });
    }
    setRows(next);
    setMessage(null);
  }

  function move(i: number, delta: number) {
    setRows((rs) => {
      const j = i + delta;
      if (j < 0 || j >= rs.length) return rs;
      const next = rs.slice();
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  }

  function patch(i: number, p: Partial<Row>) {
    setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...p } : r)));
  }

  async function save() {
    setSaving(true);
    setMessage(null);
    const columns: KanbanColumnOverride[] = rows.map((r) => {
      const out: KanbanColumnOverride = { key: r.key };
      if (r.label?.trim()) out.label = r.label.trim();
      if (r.color) out.color = r.color;
      if (r.hidden) out.hidden = true;
      if (r.wipLimit != null && r.wipLimit > 0) out.wipLimit = r.wipLimit;
      if (r.completesTask) out.completesTask = true;
      return out;
    });
    const res = await updateBoardSettings(boardId, {
      ...settings,
      kanban: {
        mode: "registros",
        ...settings.kanban,
        columns,
        ...(isTasks
          ? {
              tasks: {
                ...settings.kanban?.tasks,
                dueSoonDays:
                  dueSoonDays === "" ? undefined : Number(dueSoonDays),
                lockByDefault,
              },
            }
          : {}),
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
        if (v) init();
      }}
    >
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm">
          <Settings2 className="size-4" />
          Colunas
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-96">
        <div className="flex flex-col gap-2">
          <p className="text-sm font-medium">Colunas do quadro</p>
          <p className="text-muted-foreground text-xs">
            Ordem, rótulo, cor, limite (WIP) e ocultar. Rótulo vazio usa o valor
            do campo.
          </p>
          <div className="flex max-h-80 flex-col gap-2 overflow-y-auto">
            {rows.map((r, i) => (
              <div key={r.key} className="flex items-center gap-1.5 rounded border p-1.5">
                <div className="flex flex-col">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-5"
                    onClick={() => move(i, -1)}
                    aria-label="Subir coluna"
                  >
                    <ArrowUp className="size-3" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-5"
                    onClick={() => move(i, 1)}
                    aria-label="Descer coluna"
                  >
                    <ArrowDown className="size-3" />
                  </Button>
                </div>
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <Input
                    value={r.label ?? ""}
                    onChange={(e) => patch(i, { label: e.target.value })}
                    placeholder={r.currentLabel}
                    className="h-7 text-xs"
                    aria-label={`Rótulo da coluna ${r.currentLabel}`}
                  />
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      value={r.color ?? "#64748b"}
                      onChange={(e) => patch(i, { color: e.target.value })}
                      className="size-6 cursor-pointer rounded border"
                      aria-label={`Cor da coluna ${r.currentLabel}`}
                    />
                    <Input
                      type="number"
                      min={0}
                      value={r.wipLimit ?? ""}
                      onChange={(e) =>
                        patch(i, {
                          wipLimit: e.target.value
                            ? Number(e.target.value)
                            : undefined,
                        })
                      }
                      placeholder="WIP"
                      className="h-7 w-16 text-xs"
                      aria-label={`Limite WIP da coluna ${r.currentLabel}`}
                    />
                    <label className="text-muted-foreground flex items-center gap-1 text-xs">
                      <input
                        type="checkbox"
                        checked={Boolean(r.hidden)}
                        onChange={(e) => patch(i, { hidden: e.target.checked })}
                        className="size-3.5 accent-primary"
                      />
                      Ocultar
                    </label>
                  </div>
                </div>
              </div>
            ))}
          </div>
          {isTasks ? (
            <div className="flex flex-col gap-2 border-t pt-2">
              <label className="flex items-center justify-between gap-2 text-xs">
                <span>Alerta &quot;vence em breve&quot; (dias)</span>
                <Input
                  type="number"
                  min={0}
                  value={dueSoonDays}
                  onChange={(e) =>
                    setDueSoonDays(
                      e.target.value === "" ? "" : Number(e.target.value)
                    )
                  }
                  placeholder="3"
                  className="h-7 w-16 text-xs"
                  aria-label="Dias de antecedência do alerta"
                />
              </label>
              <label className="flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={lockByDefault}
                  onChange={(e) => setLockByDefault(e.target.checked)}
                  className="size-3.5 accent-primary"
                />
                Novas tarefas nascem travadas (só admin/gestor excluem)
              </label>
            </div>
          ) : null}
          {message ? (
            <p className="text-destructive text-xs" role="status">
              {message}
            </p>
          ) : null}
          <Button size="sm" onClick={save} disabled={saving}>
            {saving ? "Salvando..." : "Salvar colunas"}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
