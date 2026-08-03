// Versão: 1.0 | Data: 03/08/2026
// Checklist "Aplicar a" dos widgets de filtro (filtro/filtro_campo), agrupada
// por aba do dashboard. A seleção segue sendo a blacklist dinâmica
// `excludedTargets` (por id de widget) — o checkbox da aba é só um bulk-toggle
// dos ids ATUAIS dela (widget criado depois entra marcado, padrão global).
// Dashboard sem abas rende a lista plana de sempre, sem headers.
"use client";

import { Checkbox } from "@/components/ui/checkbox";
import type { Widget } from "@/lib/widgets/types";

export type TargetTab = { id: string; name: string; color?: string };

export type TargetTabGroup = {
  // null = dashboard sem abas (lista plana, sem checkbox de grupo).
  tab: TargetTab | null;
  widgets: Widget[];
};

// Agrupa os alvos na ordem de `settings.tabs` (a mesma da barra de abas).
// Aba efetiva de um widget = settings.tab quando existe no catálogo, senão a
// PRIMEIRA aba — mesma regra do `widgetTab` do shell/period-resolve (aba órfã
// nunca some da lista). Grupo sem widgets é omitido.
export function groupTargetsByTab(
  targets: Widget[],
  tabs: TargetTab[]
): TargetTabGroup[] {
  if (tabs.length === 0) return [{ tab: null, widgets: targets }];
  const tabIds = new Set(tabs.map((t) => t.id));
  const firstTabId = tabs[0]?.id ?? "";
  const byTab = new Map<string, Widget[]>();
  for (const w of targets) {
    const t = w.settings?.tab;
    const eff = t && tabIds.has(t) ? t : firstTabId;
    const list = byTab.get(eff);
    if (list) list.push(w);
    else byTab.set(eff, [w]);
  }
  return tabs
    .map((tab) => ({ tab, widgets: byTab.get(tab.id) ?? [] }))
    .filter((g) => g.widgets.length > 0);
}

export function TargetTabChecklist({
  targets,
  tabs,
  excluded,
  onToggle,
  onBulk,
}: {
  // Alvos JÁ recortados pelo builder (tipos elegíveis; no filtro_campo também
  // a sobreposição de bases) — o recorte vale dentro de cada grupo.
  targets: Widget[];
  tabs: TargetTab[];
  // Ids DESMARCADOS (estado corrente da blacklist).
  excluded: string[];
  onToggle: (id: string) => void;
  // Checkbox da aba: exclude=true adiciona todos os ids à blacklist.
  onBulk: (ids: string[], exclude: boolean) => void;
}) {
  const groups = groupTargetsByTab(targets, tabs);
  const excludedSet = new Set(excluded);
  return (
    <div className="flex flex-col gap-2 rounded-md border p-3">
      {groups.map((g, i) => {
        const ids = g.widgets.map((w) => w.id);
        const all = ids.every((id) => !excludedSet.has(id));
        const none = ids.every((id) => excludedSet.has(id));
        const state: boolean | "indeterminate" = all
          ? true
          : none
            ? false
            : "indeterminate";
        return (
          <div key={g.tab?.id ?? "__flat__"} className="flex flex-col gap-2">
            {g.tab ? (
              <label
                className={`text-muted-foreground flex items-center gap-2 text-xs font-medium ${i > 0 ? "mt-1" : ""}`}
              >
                <Checkbox
                  checked={state}
                  onCheckedChange={() => onBulk(ids, all)}
                  aria-label={`Aplicar a todos os widgets da aba ${g.tab.name}`}
                />
                {g.tab.color ? (
                  <span
                    aria-hidden
                    className="size-2 shrink-0 rounded-full"
                    style={{ backgroundColor: g.tab.color }}
                  />
                ) : null}
                {g.tab.name}
              </label>
            ) : null}
            {g.widgets.map((s) => (
              <label
                key={s.id}
                className={`flex items-center gap-2 text-sm ${g.tab ? "pl-5" : ""}`}
              >
                <Checkbox
                  checked={!excludedSet.has(s.id)}
                  onCheckedChange={() => onToggle(s.id)}
                />
                {s.title ?? "Sem título"}
              </label>
            ))}
          </div>
        );
      })}
    </div>
  );
}
