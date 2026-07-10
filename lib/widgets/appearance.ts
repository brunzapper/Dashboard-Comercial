// Versão: 1.0 | Data: 10/07/2026
// Fase 10: helpers puros de render de aparência, compartilhados entre o fundo do
// dashboard, os charts e as tabelas. Sem estado/UI — só transforma config em CSS.
import type { AppearanceSettings, DashboardSettings, GridLines } from "@/lib/widgets/types";

export const MAX_CATEGORIES = 5;

// Reduz categorias a top-N por valor + "Outros" (pizza/funil). Compartilhado
// entre o chart e o editor de aparência p/ que a ordem/índice das fatias case.
export function topWithOther(
  rows: Record<string, unknown>[],
  dimKey: string,
  metricKey: string
): { name: string; value: number }[] {
  const mapped = rows.map((r) => ({
    name: String(r[dimKey] ?? "—"),
    value: Number(r[metricKey]) || 0,
  }));
  if (mapped.length <= MAX_CATEGORIES) return mapped;
  const sorted = [...mapped].sort((a, b) => b.value - a.value);
  const top = sorted.slice(0, MAX_CATEGORIES - 1);
  const other = sorted
    .slice(MAX_CATEGORIES - 1)
    .reduce((s, x) => s + x.value, 0);
  return [...top, { name: "Outros", value: other }];
}

// CSS de fundo do dashboard (sólido ou gradiente). undefined = sem override.
export function dashboardBackgroundCss(
  bg: DashboardSettings["background"] | undefined
): string | undefined {
  if (!bg) return undefined;
  if (bg.mode === "solid") return bg.color || undefined;
  if (bg.mode === "gradient") {
    const from = bg.from || "#ffffff";
    const to = bg.to || "#e5e7eb";
    const angle = bg.angle ?? 135;
    return `linear-gradient(${angle}deg, ${from}, ${to})`;
  }
  return undefined;
}

// Traduz o modo de linhas de grade em flags horizontal/vertical (CartesianGrid).
export function gridFlags(g: GridLines | undefined): {
  horizontal: boolean;
  vertical: boolean;
} {
  switch (g) {
    case "none":
      return { horizontal: false, vertical: false };
    case "horizontal":
      return { horizontal: true, vertical: false };
    case "vertical":
      return { horizontal: false, vertical: true };
    case "both":
      return { horizontal: true, vertical: true };
    default:
      // fallback = comportamento atual (só horizontais).
      return { horizontal: true, vertical: false };
  }
}

// Ordena as chaves de coluna de uma tabela conforme columnOrder (colunas fora da
// ordem preservam a ordem original ao final).
export function orderedColumns<T extends string>(
  cols: T[],
  order: string[] | undefined
): T[] {
  if (!order || order.length === 0) return cols;
  const set = new Set(cols as string[]);
  const inOrder = order.filter((c): c is T => set.has(c));
  const rest = cols.filter((c) => !inOrder.includes(c));
  return [...inOrder, ...rest];
}

// Ordena linhas por uma coluna, conforme dir. `colorOf` mapeia o valor da célula
// (linha) para uma cor efetiva (usado por dir === "color").
export function sortRows(
  rows: Record<string, unknown>[],
  sort: NonNullable<AppearanceSettings["table"]>["sort"] | undefined,
  colorOf?: (row: Record<string, unknown>) => string
): Record<string, unknown>[] {
  if (!sort || !sort.column) return rows;
  const { column, dir } = sort;
  const copy = [...rows];
  copy.sort((a, b) => {
    if (dir === "color" && colorOf) {
      return colorOf(a).localeCompare(colorOf(b));
    }
    const av = a[column];
    const bv = b[column];
    if (dir === "alpha") {
      return String(av ?? "").localeCompare(String(bv ?? ""), "pt-BR");
    }
    const an = Number(av);
    const bn = Number(bv);
    const bothNum = !Number.isNaN(an) && !Number.isNaN(bn);
    const cmp = bothNum
      ? an - bn
      : String(av ?? "").localeCompare(String(bv ?? ""), "pt-BR");
    return dir === "desc" ? -cmp : cmp;
  });
  return copy;
}
