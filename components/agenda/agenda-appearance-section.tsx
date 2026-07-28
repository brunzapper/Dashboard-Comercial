// Versão: 1.0 | Data: 28/07/2026
// Campos de APARÊNCIA da agenda (controlado): cabeçalho Seg–Dom, células
// (fundo/grade/raio/densidade, hoje, fim de semana) e chips por tipo de item
// (tarefa/registro/anotação). Montado na seção "Agenda" do
// widget-appearance-sheet — só emite onChange; quem persiste é o chamador
// (merge preservando settings.agenda). Cores de STATUS de tarefa
// (atrasada/em breve) e a cor individual da anotação têm precedência sobre as
// cores daqui (semântica > estética — a AgendaView aplica essa regra).
"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Combobox } from "@/components/ui/combobox";
import { ColorField } from "@/components/dashboards/appearance-controls";
import type { AgendaAppearance } from "@/lib/agenda/types";

function numOrUndef(v: string): number | undefined {
  const n = Number(v);
  return v === "" || !Number.isFinite(n) || n <= 0 ? undefined : n;
}

const DENSITY_OPTIONS = [
  { value: "compacta", label: "Compacta" },
  { value: "normal", label: "Normal" },
  { value: "espacosa", label: "Espaçosa" },
];

export function AgendaAppearanceSection({
  value,
  onChange,
}: {
  value: AgendaAppearance;
  onChange: (next: AgendaAppearance) => void;
}) {
  const patch = (p: Partial<AgendaAppearance>) => onChange({ ...value, ...p });
  const patchHeader = (p: Partial<NonNullable<AgendaAppearance["header"]>>) =>
    patch({ header: { ...value.header, ...p } });
  const patchCell = (p: Partial<NonNullable<AgendaAppearance["cell"]>>) =>
    patch({ cell: { ...value.cell, ...p } });
  const patchChip = (p: Partial<NonNullable<AgendaAppearance["chip"]>>) =>
    patch({ chip: { ...value.chip, ...p } });
  const patchChipKind = (
    kind: "task" | "record" | "note",
    p: Partial<{ bg?: string; text?: string; border?: string }>
  ) => patchChip({ [kind]: { ...value.chip?.[kind], ...p } });

  return (
    <div className="flex flex-col gap-4">
      {/* ---------- Cabeçalho (Seg–Dom) ---------- */}
      <div className="flex flex-col gap-2">
        <p className="text-muted-foreground text-xs font-medium">
          Cabeçalho (Seg–Dom)
        </p>
        <ColorField
          label="Fundo do cabeçalho"
          value={value.header?.bg}
          onChange={(v) => patchHeader({ bg: v })}
          onClear={() => patchHeader({ bg: undefined })}
        />
        <ColorField
          label="Texto do cabeçalho"
          value={value.header?.color}
          onChange={(v) => patchHeader({ color: v })}
          onClear={() => patchHeader({ color: undefined })}
        />
      </div>

      {/* ---------- Células ---------- */}
      <div className="flex flex-col gap-2 border-t pt-3">
        <p className="text-muted-foreground text-xs font-medium">Células</p>
        <div className="flex flex-col gap-1">
          <Label className="text-xs">Densidade (altura da linha)</Label>
          <Combobox
            options={DENSITY_OPTIONS}
            value={value.density ?? "normal"}
            onValueChange={(v) =>
              patch({
                density:
                  v === "normal"
                    ? undefined
                    : (v as AgendaAppearance["density"]),
              })
            }
            className="w-40"
            aria-label="Densidade"
          />
        </div>
        <ColorField
          label="Fundo das células"
          value={value.cell?.bg}
          onChange={(v) => patchCell({ bg: v })}
          onClear={() => patchCell({ bg: undefined })}
        />
        <ColorField
          label="Linhas da grade"
          value={value.cell?.border}
          onChange={(v) => patchCell({ border: v })}
          onClear={() => patchCell({ border: undefined })}
        />
        <ColorField
          label="Fundo de hoje"
          value={value.todayBg}
          onChange={(v) => patch({ todayBg: v })}
          onClear={() => patch({ todayBg: undefined })}
        />
        <ColorField
          label="Fundo do fim de semana"
          value={value.weekendBg}
          onChange={(v) => patch({ weekendBg: v })}
          onClear={() => patch({ weekendBg: undefined })}
        />
        <div className="flex flex-col gap-1">
          <Label className="text-xs">Raio da grade (px)</Label>
          <Input
            type="number"
            min={0}
            value={value.cell?.radius ?? ""}
            onChange={(e) => patchCell({ radius: numOrUndef(e.target.value) })}
            className="h-8 w-24"
            placeholder="8"
          />
        </div>
        <label className="flex items-center gap-2 text-sm">
          <Checkbox
            checked={value.dimOutsideMonth !== false}
            onCheckedChange={(v) =>
              patch({ dimOutsideMonth: v === true ? undefined : false })
            }
          />
          Esmaecer dias fora do mês
        </label>
      </div>

      {/* ---------- Chips ---------- */}
      <div className="flex flex-col gap-2 border-t pt-3">
        <p className="text-muted-foreground text-xs font-medium">Chips</p>
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1">
            <Label className="text-xs">Fonte (px)</Label>
            <Input
              type="number"
              min={8}
              value={value.chip?.fontSize ?? ""}
              onChange={(e) =>
                patchChip({ fontSize: numOrUndef(e.target.value) })
              }
              className="h-8"
              placeholder="11"
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label className="text-xs">Raio (px)</Label>
            <Input
              type="number"
              min={0}
              value={value.chip?.radius ?? ""}
              onChange={(e) =>
                patchChip({ radius: numOrUndef(e.target.value) })
              }
              className="h-8"
              placeholder="4"
            />
          </div>
        </div>
        <p className="text-muted-foreground text-xs">
          Tarefas — atrasada/em breve mantêm as cores de status.
        </p>
        <ColorField
          label="Fundo da tarefa"
          value={value.chip?.task?.bg}
          onChange={(v) => patchChipKind("task", { bg: v })}
          onClear={() => patchChipKind("task", { bg: undefined })}
        />
        <ColorField
          label="Texto da tarefa"
          value={value.chip?.task?.text}
          onChange={(v) => patchChipKind("task", { text: v })}
          onClear={() => patchChipKind("task", { text: undefined })}
        />
        <ColorField
          label="Fundo do registro"
          value={value.chip?.record?.bg}
          onChange={(v) => patchChipKind("record", { bg: v })}
          onClear={() => patchChipKind("record", { bg: undefined })}
        />
        <ColorField
          label="Texto do registro"
          value={value.chip?.record?.text}
          onChange={(v) => patchChipKind("record", { text: v })}
          onClear={() => patchChipKind("record", { text: undefined })}
        />
        <ColorField
          label="Borda do registro"
          value={value.chip?.record?.border}
          onChange={(v) => patchChipKind("record", { border: v })}
          onClear={() => patchChipKind("record", { border: undefined })}
        />
      </div>
    </div>
  );
}
