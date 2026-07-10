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

// Ordena itens genéricos conforme uma ordem manual de chaves; itens fora da
// ordem preservam a ordem original ao final. Usado p/ colunas, linhas e
// categorias (columnOrder/rowOrder/categoryOrder).
export function applyManualOrder<T>(
  items: T[],
  order: string[] | undefined,
  keyOf: (item: T) => string
): T[] {
  if (!order || order.length === 0) return items;
  const rank = new Map(order.map((k, i) => [k, i]));
  const inOrder = items
    .filter((it) => rank.has(keyOf(it)))
    .sort((a, b) => rank.get(keyOf(a))! - rank.get(keyOf(b))!);
  const rest = items.filter((it) => !rank.has(keyOf(it)));
  return [...inOrder, ...rest];
}

// Compat: ordena chaves de coluna conforme columnOrder.
export function orderedColumns<T extends string>(
  cols: T[],
  order: string[] | undefined
): T[] {
  return applyManualOrder(cols, order, (c) => c);
}

// Chave estável de uma linha: valores das dimensões juntos (tabela agregada) ou
// o id do registro (lista). Usada p/ cores por linha/célula e reordenação.
export function rowKeyOf(
  row: Record<string, unknown>,
  keys: string[]
): string {
  return keys.map((k) => String(row[k] ?? "")).join("¦");
}

// Ordena linhas por uma coluna. asc/desc auto-detecta numérico (inclui datas
// ISO, comparáveis como string) vs texto (locale). `dir === "color"` ordena
// pela posição da cor de preenchimento da linha em colorOrder (via `fillOf`).
export function sortRows(
  rows: Record<string, unknown>[],
  sort: NonNullable<AppearanceSettings["table"]>["sort"] | undefined,
  fillOf?: (row: Record<string, unknown>) => string | undefined
): Record<string, unknown>[] {
  if (!sort || !sort.column) return rows;
  const { column, dir, colorOrder } = sort;
  const copy = [...rows];
  if (dir === "color") {
    const rank = new Map((colorOrder ?? []).map((c, i) => [c, i]));
    const rankOf = (r: Record<string, unknown>) => {
      const c = fillOf?.(r);
      return c && rank.has(c) ? rank.get(c)! : Number.MAX_SAFE_INTEGER;
    };
    copy.sort((a, b) => rankOf(a) - rankOf(b));
    return copy;
  }
  copy.sort((a, b) => {
    const av = a[column];
    const bv = b[column];
    const an = Number(av);
    const bn = Number(bv);
    const bothNum =
      av !== "" && bv !== "" && !Number.isNaN(an) && !Number.isNaN(bn);
    const cmp = bothNum
      ? an - bn
      : String(av ?? "").localeCompare(String(bv ?? ""), "pt-BR");
    return dir === "desc" ? -cmp : cmp;
  });
  return copy;
}

// Move dragKey para a posição de targetKey dentro da ordem atual de chaves,
// retornando a nova ordem completa (usado pelas alças de arraste).
export function reorderKeys(
  currentOrder: string[],
  dragKey: string,
  targetKey: string
): string[] {
  if (dragKey === targetKey) return currentOrder;
  const next = [...currentOrder];
  const from = next.indexOf(dragKey);
  const to = next.indexOf(targetKey);
  if (from < 0 || to < 0) return currentOrder;
  next.splice(to, 0, next.splice(from, 1)[0]);
  return next;
}

// Cores de preenchimento distintas presentes (p/ montar a janela "Por cor").
export function distinctFills(fills: (string | undefined)[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const f of fills) {
    if (f && !seen.has(f)) {
      seen.add(f);
      out.push(f);
    }
  }
  return out;
}
