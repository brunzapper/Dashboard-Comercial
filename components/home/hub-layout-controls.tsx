// Versão: 1.0 | Data: 12/09/2026
// Controles de disposição do hub / painel de Operação (0141): grade↔lista,
// número de colunas e os dois interruptores de conteúdo do card (descrição e
// nível de acesso).
//
// Escreve na camada do USUÁRIO (saveUiPrefs). Chave TRAVADA pela organização
// chega com `locked` e o controle fica desabilitado com o motivo no title —
// esconder o controle faria parecer defeito; desabilitado com explicação diz
// que existe e quem decide.
//
// Save otimista em background (a regra do projeto para save fora de formulário):
// estado local aplica na hora, a action roda com revalidate desligado e o
// refresh de reconciliação é agendado uma vez. Sem o refresh o RSC do hub
// continuaria servindo a grade antiga.
"use client";

import { useState } from "react";
import { LayoutGrid, List, Minus, Plus } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { useBackgroundSave } from "@/lib/feedback/use-background-save";
import { saveUiPrefs } from "@/app/(app)/dashboards/actions";
import {
  MAX_HUB_COLUMNS,
  MIN_HUB_COLUMNS,
  type HubLayout,
  type UiPrefKey,
  type UiPrefs,
} from "@/lib/config/ui-prefs";

const LOCKED_HINT = "Definido pela organização";

export interface HubLayoutControlKeys {
  layout: UiPrefKey;
  columns: UiPrefKey;
  showDescription: UiPrefKey;
  showAccess: UiPrefKey;
}

export function HubLayoutControls({
  keys,
  layout: initialLayout,
  columns: initialColumns,
  showDescription: initialDesc,
  showAccess: initialAccess,
  locked,
  /** Rótulo do interruptor de acesso — muda de sentido entre as famílias. */
  accessLabel = "Nível de acesso",
}: {
  keys: HubLayoutControlKeys;
  layout: HubLayout;
  columns: number;
  showDescription: boolean;
  showAccess: boolean;
  locked: UiPrefKey[];
  accessLabel?: string;
}) {
  const [layout, setLayout] = useState(initialLayout);
  const [columns, setColumns] = useState(initialColumns);
  const [showDescription, setShowDescription] = useState(initialDesc);
  const [showAccess, setShowAccess] = useState(initialAccess);
  const { save, pendingKeys } = useBackgroundSave();

  const lockedSet = new Set(locked);
  const isLocked = (k: UiPrefKey) => lockedSet.has(k);

  // Um save por CHAVE (refcount do hook é por key): dois cliques seguidos no
  // stepper de colunas contam como um pending só.
  function commit<K extends UiPrefKey>(
    key: K,
    value: UiPrefs[K],
    revert: () => void
  ) {
    save({
      key: String(key),
      context: "Não foi possível salvar a preferência de exibição",
      action: () => saveUiPrefs({ [key]: value } as UiPrefs),
      revert,
    });
  }

  function setLayoutTo(next: HubLayout) {
    if (isLocked(keys.layout) || next === layout) return;
    const prev = layout;
    setLayout(next);
    commit(keys.layout, next, () => setLayout(prev));
  }

  function stepColumns(delta: number) {
    if (isLocked(keys.columns)) return;
    const next = Math.min(
      MAX_HUB_COLUMNS,
      Math.max(MIN_HUB_COLUMNS, columns + delta)
    );
    if (next === columns) return;
    const prev = columns;
    setColumns(next);
    commit(keys.columns, next, () => setColumns(prev));
  }

  const busy = pendingKeys.size > 0;

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      {/* grade ↔ lista */}
      <div
        className="flex items-center rounded-md border p-0.5"
        role="group"
        aria-label="Formato dos cards"
      >
        {(
          [
            { value: "grid", Icon: LayoutGrid, label: "Grade" },
            { value: "list", Icon: List, label: "Lista" },
          ] as const
        ).map(({ value, Icon, label }) => (
          <button
            key={value}
            type="button"
            onClick={() => setLayoutTo(value)}
            disabled={isLocked(keys.layout)}
            aria-pressed={layout === value}
            title={isLocked(keys.layout) ? LOCKED_HINT : label}
            className={cn(
              "rounded-sm p-1.5 transition-colors disabled:opacity-50",
              layout === value
                ? "bg-brand/10 text-brand"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            <Icon className="size-4" />
            <span className="sr-only">{label}</span>
          </button>
        ))}
      </div>

      {/* número de colunas — só faz sentido em grade */}
      {layout === "grid" ? (
        <div
          className="flex items-center gap-1"
          title={isLocked(keys.columns) ? LOCKED_HINT : undefined}
        >
          <span className="text-muted-foreground text-sm">Colunas</span>
          <Button
            variant="outline"
            size="icon"
            className="size-7"
            onClick={() => stepColumns(-1)}
            disabled={isLocked(keys.columns) || columns <= MIN_HUB_COLUMNS}
            aria-label="Menos colunas"
          >
            <Minus className="size-3.5" />
          </Button>
          <span
            className="w-4 text-center text-sm tabular-nums"
            aria-live="polite"
          >
            {columns}
          </span>
          <Button
            variant="outline"
            size="icon"
            className="size-7"
            onClick={() => stepColumns(1)}
            disabled={isLocked(keys.columns) || columns >= MAX_HUB_COLUMNS}
            aria-label="Mais colunas"
          >
            <Plus className="size-3.5" />
          </Button>
        </div>
      ) : null}

      <label
        className="flex items-center gap-1.5"
        title={isLocked(keys.showDescription) ? LOCKED_HINT : undefined}
      >
        <Checkbox
          checked={showDescription}
          disabled={isLocked(keys.showDescription)}
          onCheckedChange={(v) => {
            const next = v === true;
            const prev = showDescription;
            setShowDescription(next);
            commit(keys.showDescription, next, () => setShowDescription(prev));
          }}
        />
        <Label className="cursor-pointer text-sm font-normal">Descrição</Label>
      </label>

      <label
        className="flex items-center gap-1.5"
        title={isLocked(keys.showAccess) ? LOCKED_HINT : undefined}
      >
        <Checkbox
          checked={showAccess}
          disabled={isLocked(keys.showAccess)}
          onCheckedChange={(v) => {
            const next = v === true;
            const prev = showAccess;
            setShowAccess(next);
            commit(keys.showAccess, next, () => setShowAccess(prev));
          }}
        />
        <Label className="cursor-pointer text-sm font-normal">
          {accessLabel}
        </Label>
      </label>

      <span
        aria-live="polite"
        className={cn(
          "text-muted-foreground text-xs transition-opacity",
          busy ? "opacity-100" : "opacity-0"
        )}
      >
        Salvando…
      </span>
    </div>
  );
}
