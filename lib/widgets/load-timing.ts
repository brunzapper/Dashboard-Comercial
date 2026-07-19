// Versão: 1.0 | Data: 19/07/2026
// Cronômetro do load do dashboard (server-only): mede as seções do render da
// página ([id]/page.tsx) e cada widget task, e monta a linha de resumo
// `[dashboard:timing]` — a primeira coisa a olhar quando o dashboard "ficou
// lento" (docs/manual-de-manutencao.md §5). Módulo separado do RSC de
// propósito: `performance.now()` no corpo do componente dispara a regra
// react-hooks/purity (pensada para client components); aqui a medição é
// observabilidade legítima de servidor, encapsulada fora do render.

interface WidgetTiming {
  id: string;
  title: string;
  ms: number;
  error: boolean;
}

export type LoadSection = "base" | "widgets" | "fkLabels" | "quickFilters";

export interface DashboardLoadTiming {
  /** Executa `fn` cronometrando e registra a duração da seção. */
  measure<T>(name: LoadSection, fn: () => Promise<T>): Promise<T>;
  /**
   * Cronometra um widget task (execução, sem a espera na fila do limitador —
   * o chamador nos envolve por dentro dele). `errored` é lida ao final para
   * marcar tasks que falharam (ex.: statement timeout → WidgetData.error).
   */
  widgetTask<T>(
    info: { id: string; title: string },
    fn: () => Promise<T>,
    errored: () => boolean
  ): Promise<T>;
  /** Loga o resumo (1 linha por render): total, seções e top 5 widgets. */
  log(dashboardName: string): void;
}

export function startDashboardLoadTiming(): DashboardLoadTiming {
  const t0 = performance.now();
  const sections = new Map<LoadSection, number>();
  const widgets: WidgetTiming[] = [];
  return {
    async measure(name, fn) {
      const s = performance.now();
      try {
        return await fn();
      } finally {
        sections.set(name, performance.now() - s);
      }
    },
    async widgetTask(info, fn, errored) {
      const s = performance.now();
      try {
        return await fn();
      } finally {
        widgets.push({
          ...info,
          ms: performance.now() - s,
          error: errored(),
        });
      }
    },
    log(dashboardName) {
      const ms = (n: LoadSection) => Math.round(sections.get(n) ?? 0);
      const top = [...widgets]
        .sort((a, b) => b.ms - a.ms)
        .slice(0, 5)
        .map(
          (t) =>
            `${t.title}#${t.id.slice(0, 8)}=${Math.round(t.ms)}ms${t.error ? "(erro)" : ""}`
        )
        .join(" | ");
      const errs = widgets.filter((t) => t.error).length;
      console.log(
        `[dashboard:timing] "${dashboardName}" total=${Math.round(performance.now() - t0)}ms ` +
          `base=${ms("base")}ms widgets=${ms("widgets")}ms ` +
          `(${widgets.length} widgets${errs > 0 ? `, ${errs} com erro` : ""}) ` +
          `fkLabels=${ms("fkLabels")}ms quickFilters=${ms("quickFilters")}ms | ` +
          `top: ${top || "—"}`
      );
    },
  };
}
