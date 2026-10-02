"use client";
// Versão: 1.0 | Data: 02/10/2026
// v1.0 (02/10/2026): estilo PADRÃO dos dashboards da organização
//   (organizations.ui_prefs.dashboardStyle — lib/dashboards/style.ts). Vale para
//   todo dashboard que não escolheu um estilo próprio (⋮ → Estilo e
//   apresentação); trocar aqui não reescreve nenhum board, então voltar ao
//   Clássico desfaz tudo. Save otimista com revert (useBackgroundSave).
import { useState } from "react";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useBackgroundSave } from "@/lib/feedback/use-background-save";
import {
  DASHBOARD_STYLE_OPTIONS,
  DEFAULT_DASHBOARD_STYLE,
  isDashboardStyleKey,
} from "@/lib/dashboards/style";
import { saveOrgDashboardStyle } from "@/app/(app)/configuracoes/tema/actions";

export function OrgDashboardStyleForm({ initial }: { initial: string | null }) {
  const [value, setValue] = useState<string>(
    isDashboardStyleKey(initial) ? initial : DEFAULT_DASHBOARD_STYLE
  );
  const { save, hasPending } = useBackgroundSave();
  const current = DASHBOARD_STYLE_OPTIONS.find((o) => o.value === value);

  return (
    <div className="flex max-w-md flex-col gap-1.5">
      <Select
        value={value}
        disabled={hasPending}
        onValueChange={(next) => {
          const before = value;
          setValue(next);
          save({
            key: "dashboard-style",
            context: "Não foi possível salvar o estilo padrão",
            action: () =>
              saveOrgDashboardStyle(
                next === DEFAULT_DASHBOARD_STYLE ? null : next
              ),
            revert: () => setValue(before),
          });
        }}
      >
        <SelectTrigger className="h-9" aria-label="Estilo padrão dos dashboards">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {DASHBOARD_STYLE_OPTIONS.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {current ? (
        <p className="text-muted-foreground text-xs">{current.description}</p>
      ) : null}
    </div>
  );
}
