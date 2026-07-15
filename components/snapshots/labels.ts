// Versão: 1.0 | Data: 15/07/2026
// Rótulos compartilhados da UI de snapshots (painel do dashboard e a aba de
// Configurações). Client-safe: nada de node:crypto/service role aqui.
import type { RefreshMode, SnapshotListItem } from "@/lib/snapshots/types";

// 1..7 (ISO, segunda = 1) — mesmo contrato de snapshots.refresh_weekday.
export const WEEKDAY_OPTIONS: { value: number; label: string }[] = [
  { value: 1, label: "Segunda" },
  { value: 2, label: "Terça" },
  { value: 3, label: "Quarta" },
  { value: 4, label: "Quinta" },
  { value: 5, label: "Sexta" },
  { value: 6, label: "Sábado" },
  { value: 7, label: "Domingo" },
];

export const REFRESH_MODE_LABELS: Record<RefreshMode, string> = {
  manual: "Manual",
  hourly: "A cada hora",
  daily: "Diário",
  weekly: "Semanal",
};

export function scheduleLabel(
  s: Pick<SnapshotListItem, "refresh_mode" | "refresh_time" | "refresh_weekday">
): string {
  switch (s.refresh_mode) {
    case "hourly":
      return "A cada hora";
    case "daily":
      return `Diário às ${s.refresh_time ?? "06:00"}`;
    case "weekly": {
      const wd =
        WEEKDAY_OPTIONS.find((w) => w.value === s.refresh_weekday)?.label ??
        "Segunda";
      return `${wd} às ${s.refresh_time ?? "06:00"}`;
    }
    default:
      return "Manual";
  }
}

const DATE_TIME_FMT = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "America/Sao_Paulo",
  dateStyle: "short",
  timeStyle: "short",
});

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  return DATE_TIME_FMT.format(new Date(iso));
}
