// Versão: 1.0 | Data: 17/07/2026
// Campos de APARÊNCIA do kanban (controlado): quadro, colunas, cards,
// contadores e seletor de visão (Quadro/Lista/Agenda). Compartilhado entre o
// editor de aparência do WIDGET (widget-appearance-sheet, seção "Kanban") e o
// popover "Aparência" da página dedicada (board-appearance-popover). Só emite
// onChange — quem persiste é o chamador (saveWidgetSettings/updateBoardSettings
// com spread completo do settings).
"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { ColorField } from "@/components/dashboards/appearance-controls";
import type { KanbanAppearance } from "@/lib/kanban/types";

function numOrUndef(v: string): number | undefined {
  const n = Number(v);
  return v === "" || !Number.isFinite(n) || n <= 0 ? undefined : n;
}

export function KanbanAppearanceSection({
  value,
  onChange,
}: {
  value: KanbanAppearance;
  onChange: (next: KanbanAppearance) => void;
}) {
  const patch = (p: Partial<KanbanAppearance>) => onChange({ ...value, ...p });
  const patchColumn = (p: Partial<NonNullable<KanbanAppearance["column"]>>) =>
    patch({ column: { ...value.column, ...p } });
  const patchCard = (p: Partial<NonNullable<KanbanAppearance["card"]>>) =>
    patch({ card: { ...value.card, ...p } });
  const patchCounter = (p: Partial<NonNullable<KanbanAppearance["counter"]>>) =>
    patch({ counter: { ...value.counter, ...p } });
  const patchSwitcher = (
    p: Partial<NonNullable<KanbanAppearance["switcher"]>>
  ) => patch({ switcher: { ...value.switcher, ...p } });

  return (
    <div className="flex flex-col gap-4">
      {/* ---------- Quadro ---------- */}
      <div className="flex flex-col gap-2">
        <p className="text-muted-foreground text-xs font-medium">Quadro</p>
        <ColorField
          label="Fundo do quadro"
          value={value.boardBg}
          onChange={(v) => patch({ boardBg: v })}
          onClear={() => patch({ boardBg: undefined })}
        />
      </div>

      {/* ---------- Colunas ---------- */}
      <div className="flex flex-col gap-2 border-t pt-3">
        <p className="text-muted-foreground text-xs font-medium">Colunas</p>
        <ColorField
          label="Fundo da coluna"
          value={value.column?.bg}
          onChange={(v) => patchColumn({ bg: v })}
          onClear={() => patchColumn({ bg: undefined })}
        />
        <ColorField
          label="Borda da coluna"
          value={value.column?.border}
          onChange={(v) => patchColumn({ border: v })}
          onClear={() => patchColumn({ border: undefined })}
        />
        <ColorField
          label="Fundo do cabeçalho"
          value={value.column?.headerBg}
          onChange={(v) => patchColumn({ headerBg: v })}
          onClear={() => patchColumn({ headerBg: undefined })}
        />
        <ColorField
          label="Texto do cabeçalho"
          value={value.column?.headerColor}
          onChange={(v) => patchColumn({ headerColor: v })}
          onClear={() => patchColumn({ headerColor: undefined })}
        />
        <div className="flex flex-col gap-1">
          <Label className="text-xs">Raio da coluna (px)</Label>
          <Input
            type="number"
            min={0}
            value={value.column?.radius ?? ""}
            onChange={(e) => patchColumn({ radius: numOrUndef(e.target.value) })}
            className="h-8 w-24"
            placeholder="8"
          />
        </div>
      </div>

      {/* ---------- Cards ---------- */}
      <div className="flex flex-col gap-2 border-t pt-3">
        <p className="text-muted-foreground text-xs font-medium">Cards</p>
        <ColorField
          label="Fundo do card"
          value={value.card?.bg}
          onChange={(v) => patchCard({ bg: v })}
          onClear={() => patchCard({ bg: undefined })}
        />
        <ColorField
          label="Texto do card"
          value={value.card?.text}
          onChange={(v) => patchCard({ text: v })}
          onClear={() => patchCard({ text: undefined })}
        />
        <ColorField
          label="Borda do card"
          value={value.card?.border}
          onChange={(v) => patchCard({ border: v })}
          onClear={() => patchCard({ border: undefined })}
        />
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1">
            <Label className="text-xs">Raio do card (px)</Label>
            <Input
              type="number"
              min={0}
              value={value.card?.radius ?? ""}
              onChange={(e) => patchCard({ radius: numOrUndef(e.target.value) })}
              className="h-8"
              placeholder="6"
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label className="text-xs">Fonte do card (px)</Label>
            <Input
              type="number"
              min={8}
              value={value.card?.fontSize ?? ""}
              onChange={(e) =>
                patchCard({ fontSize: numOrUndef(e.target.value) })
              }
              className="h-8"
              placeholder="14"
            />
          </div>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <Checkbox
            checked={value.card?.showStripe ?? true}
            onCheckedChange={(v) =>
              patchCard({ showStripe: v === true ? undefined : false })
            }
          />
          Faixa lateral colorida (campo de cor)
        </label>
      </div>

      {/* ---------- Contadores / métrica ---------- */}
      <div className="flex flex-col gap-2 border-t pt-3">
        <p className="text-muted-foreground text-xs font-medium">
          Contadores e métrica
        </p>
        <ColorField
          label="Fundo do contador"
          value={value.counter?.bg}
          onChange={(v) => patchCounter({ bg: v })}
          onClear={() => patchCounter({ bg: undefined })}
        />
        <ColorField
          label="Texto do contador"
          value={value.counter?.color}
          onChange={(v) => patchCounter({ color: v })}
          onClear={() => patchCounter({ color: undefined })}
        />
        <ColorField
          label="Cor da métrica do cabeçalho"
          value={value.metricColor}
          onChange={(v) => patch({ metricColor: v })}
          onClear={() => patch({ metricColor: undefined })}
        />
      </div>

      {/* ---------- Abas de visão (Quadro/Lista/Agenda) ---------- */}
      <div className="flex flex-col gap-2 border-t pt-3">
        <p className="text-muted-foreground text-xs font-medium">
          Abas de visão (Quadro/Lista/Agenda)
        </p>
        <ColorField
          label="Fundo da aba ativa"
          value={value.switcher?.activeBg}
          onChange={(v) => patchSwitcher({ activeBg: v })}
          onClear={() => patchSwitcher({ activeBg: undefined })}
        />
        <ColorField
          label="Texto da aba ativa"
          value={value.switcher?.activeText}
          onChange={(v) => patchSwitcher({ activeText: v })}
          onClear={() => patchSwitcher({ activeText: undefined })}
        />
        <ColorField
          label="Fundo das abas inativas"
          value={value.switcher?.inactiveBg}
          onChange={(v) => patchSwitcher({ inactiveBg: v })}
          onClear={() => patchSwitcher({ inactiveBg: undefined })}
        />
        <ColorField
          label="Texto das abas inativas"
          value={value.switcher?.inactiveText}
          onChange={(v) => patchSwitcher({ inactiveText: v })}
          onClear={() => patchSwitcher({ inactiveText: undefined })}
        />
      </div>
    </div>
  );
}
