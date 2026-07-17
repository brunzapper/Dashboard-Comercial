// Versão: 2.0 | Data: 17/07/2026
// Configuração das colunas do kanban: ordem, rótulo, cor, WIP; em quadros de
// TAREFAS, também a antecedência do alerta de prazo (dueSoonDays) e a trava de
// exclusão por padrão; em quadros de REGISTROS por campo, o write-back e o
// checkbox "Ocultar" (seletor de fases visíveis — vetado em fases de período
// e desnecessário nas "Personalizar", onde o conjunto é do usuário).
// v2.0 (17/07/2026): generalizado p/ o WIDGET kanban — quem persiste é o
//   chamador via `onSave(nextKanban)` (página dedicada → updateBoardSettings
//   com spread completo do settings; widget → saveWidgetSettings idem); modos
//   tarefas/Personalizar ganham adicionar/remover coluna (teto
//   KANBAN_MAX_COLUMNS; remoção joga os cards na 1ª coluna).
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, Plus, Settings2, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import type { KanbanBoardData } from "@/lib/kanban/data";
import {
  KANBAN_MAX_COLUMNS,
  type KanbanColumnOverride,
  type KanbanSettings,
} from "@/lib/kanban/types";

interface Row extends KanbanColumnOverride {
  currentLabel: string;
}

export function ColumnConfigPopover({
  kanban,
  data,
  onSave,
}: {
  kanban: KanbanSettings;
  data: KanbanBoardData;
  // Persiste settings.kanban inteiro (o chamador faz o spread do resto).
  onSave: (next: KanbanSettings) => Promise<{ ok?: boolean; message?: string }>;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<Row[]>([]);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const isTasks = kanban.mode === "tarefas";
  const isCustom = kanban.mode === "registros" && kanban.columnSource === "custom";
  // Conjunto de colunas é DO USUÁRIO (tarefas/Personalizar): adiciona/remove.
  const canEditSet = isTasks || isCustom;
  // Seletor de fases visíveis: só fases derivadas de CAMPO (não de período).
  const canHide = kanban.mode === "registros" && !kanban.dateBucket && !isCustom;
  const [dueSoonDays, setDueSoonDays] = useState<number | "">(
    kanban.tasks?.dueSoonDays ?? ""
  );
  const [lockByDefault, setLockByDefault] = useState(
    kanban.tasks?.lockByDefault ?? false
  );
  // Write-back (modo registros por campo): mover um card grava a mudança de
  // volta ao Bitrix. Default desligado — mover altera só a cópia local (o
  // original da Sync fica intacto). Só surte efeito em registros de Sync e
  // campos mapeados. Nas colunas "Personalizar" não se aplica (mover não toca
  // no registro).
  const [writeBack, setWriteBack] = useState(kanban.writeBack ?? false);

  function init() {
    const overrides = kanban.columns ?? [];
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

  function addRow() {
    setRows((rs) => {
      if (rs.length >= KANBAN_MAX_COLUMNS) return rs;
      return [
        ...rs,
        {
          key: `c_${Date.now().toString(36)}`,
          label: "",
          currentLabel: "Nova coluna",
        },
      ];
    });
  }

  function removeRow(i: number) {
    setRows((rs) => rs.filter((_, idx) => idx !== i));
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
    const res = await onSave({
      ...kanban,
      columns,
      ...(isTasks
        ? {
            tasks: {
              ...kanban.tasks,
              dueSoonDays: dueSoonDays === "" ? undefined : Number(dueSoonDays),
              lockByDefault,
            },
          }
        : isCustom
          ? {}
          : { writeBack }),
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
            {canEditSet
              ? "Ordem, rótulo, cor, limite (WIP), adicionar e remover colunas."
              : canHide
                ? "Ordem, rótulo, cor, limite (WIP) e quais fases aparecem no quadro. Rótulo vazio usa o valor do campo."
                : "Ordem, rótulo, cor e limite (WIP). Rótulo vazio usa o nome do período."}
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
                    {canHide ? (
                      <label className="text-muted-foreground flex items-center gap-1 text-xs">
                        <input
                          type="checkbox"
                          checked={Boolean(r.hidden)}
                          onChange={(e) => patch(i, { hidden: e.target.checked })}
                          className="size-3.5 accent-primary"
                        />
                        Ocultar
                      </label>
                    ) : null}
                    {canEditSet ? (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="ml-auto size-5"
                        onClick={() => removeRow(i)}
                        aria-label={`Remover coluna ${r.currentLabel}`}
                        title="Remover coluna (os cards dela caem na primeira)"
                      >
                        <X className="size-3.5" />
                      </Button>
                    ) : null}
                  </div>
                </div>
              </div>
            ))}
          </div>
          {canEditSet ? (
            <Button
              variant="outline"
              size="sm"
              onClick={addRow}
              disabled={rows.length >= KANBAN_MAX_COLUMNS}
              className="gap-1"
            >
              <Plus className="size-3.5" />
              {rows.length >= KANBAN_MAX_COLUMNS
                ? `Limite de ${KANBAN_MAX_COLUMNS} colunas`
                : "Adicionar coluna"}
            </Button>
          ) : null}
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
          ) : isCustom ? null : (
            <div className="flex flex-col gap-1 border-t pt-2">
              <label className="flex items-start gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={writeBack}
                  onChange={(e) => setWriteBack(e.target.checked)}
                  className="mt-0.5 size-3.5 accent-primary"
                />
                <span>
                  Gravar alterações de volta no Bitrix (write-back)
                  <span className="text-muted-foreground block">
                    Desligado, mover um card altera só a cópia local — o registro
                    de origem na Sync fica intacto. Ligado, mover enfileira a
                    mudança para o Bitrix (só campos de Sync mapeados).
                  </span>
                </span>
              </label>
            </div>
          )}
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
