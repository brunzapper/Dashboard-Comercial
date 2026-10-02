// Versão: 1.0 | Data: 02/10/2026
// v1.0 (02/10/2026): tons de STATUS de indicador num lugar só (antes moravam
//   no widget da Tabela de metas e a Tree os importava de lá, sempre com as
//   cores Tailwind fixas). Num board com ESTILO os tons seguem os tokens do
//   estilo (`ds-good/warn/bad`), como a tabela de slide já fazia.
import type { IndicatorStatus } from "@/lib/indicators/model";

/** Pílula (fundo + texto) — o visual Clássico. */
export const STATUS_TONE: Record<IndicatorStatus, string> = {
  ok: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  atencao: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  fora: "bg-red-500/15 text-red-700 dark:text-red-300",
  sem_dado: "bg-muted text-muted-foreground",
};

/** Só o texto colorido, pelos tokens do estilo. */
export const STATUS_TEXT_TONE: Record<IndicatorStatus, string> = {
  ok: "text-ds-good",
  atencao: "text-ds-warn",
  fora: "text-ds-bad",
  sem_dado: "text-muted-foreground",
};

/** Barrinha de atingimento, pelos tokens do estilo. */
export const STATUS_BAR_TONE: Record<IndicatorStatus, string> = {
  ok: "bg-ds-good",
  atencao: "bg-ds-warn",
  fora: "bg-ds-bad",
  sem_dado: "bg-muted-foreground",
};

/** Classe do valor por status: pílula no Clássico, texto num board com estilo. */
export function statusToneClass(status: IndicatorStatus, styled: boolean): string {
  return styled ? STATUS_TEXT_TONE[status] : STATUS_TONE[status];
}
