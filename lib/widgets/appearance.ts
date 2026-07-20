// Versão: 1.1 | Data: 20/07/2026
// Fase 10: helpers puros de render de aparência, compartilhados entre o fundo do
// dashboard, os charts e as tabelas. Sem estado/UI — só transforma config em CSS.
// v1.1 (20/07/2026): top-N configurável (AppearanceSettings.categoryLimit) —
//   topWithOther ganha o limite por parâmetro e limitCategories generaliza o
//   corte p/ linhas completas de barra (soma métricas/__cmp e funde __money).
import { foldBreakdowns } from "@/lib/widgets/currency";
import type {
  AppearanceSettings,
  DashboardSettings,
  GridLines,
  TableAlign,
  WidgetRow,
} from "@/lib/widgets/types";

export const MAX_CATEGORIES = 5;

// Normaliza o "Agrupar por" da tabela numa lista ordenada de níveis (hierarquia).
// Aceita a config antiga (string = 1 nível) e a nova (string[] = multinível),
// descartando entradas vazias. Compartilhado pelos dois renderizadores de tabela
// e pela UI do builder.
export function groupByLevels(gb?: string | string[]): string[] {
  return Array.isArray(gb) ? gb.filter(Boolean) : gb ? [gb] : [];
}

// Reduz categorias a top-N por valor + "Outros" (pizza/funil). Compartilhado
// entre o chart e o editor de aparência p/ que a ordem/índice das fatias case.
// `limit` (AppearanceSettings.categoryLimit) configura N e o bucket "Outros";
// ausente = defaults clássicos (teto 5 com "Outros").
export function topWithOther(
  rows: Record<string, unknown>[],
  dimKey: string,
  metricKey: string,
  limit?: AppearanceSettings["categoryLimit"]
): { name: string; value: number }[] {
  const n = Math.max(1, Math.floor(limit?.n ?? MAX_CATEGORIES));
  const others = limit?.others ?? true;
  const mapped = rows.map((r) => ({
    name: String(r[dimKey] ?? "—"),
    value: Number(r[metricKey]) || 0,
  }));
  if (mapped.length <= n) return mapped;
  const sorted = [...mapped].sort((a, b) => b.value - a.value);
  if (!others) return sorted.slice(0, n);
  const top = sorted.slice(0, n - 1);
  const other = sorted.slice(n - 1).reduce((s, x) => s + x.value, 0);
  return [...top, { name: "Outros", value: other }];
}

// Top-N p/ gráficos de barra: corta as LINHAS completas pela 1ª métrica
// (desc) e, opcionalmente, agrega o resto numa linha sintética "Outros" —
// somando cada métrica e o valor comparado (__cmp) e fundindo o detalhamento
// monetário (__money). Métricas intensivas (média/razão calculada) somam
// numericamente no "Outros" — aproximação de exibição, documentada. Só ativa
// com categoryLimit configurado (sem config = sem corte; barra clássica).
export function limitCategories(
  rows: Record<string, unknown>[],
  dimKey: string,
  metricKeys: string[],
  limit: NonNullable<AppearanceSettings["categoryLimit"]>
): Record<string, unknown>[] {
  const n = Math.max(1, Math.floor(limit.n ?? MAX_CATEGORIES));
  const others = limit.others ?? true;
  if (rows.length <= n) return rows;
  const first = metricKeys[0];
  const sorted = [...rows].sort(
    (a, b) => (Number(b[first]) || 0) - (Number(a[first]) || 0)
  );
  if (!others) return sorted.slice(0, n);
  const top = sorted.slice(0, n - 1);
  const rest = sorted.slice(n - 1) as WidgetRow[];
  const other: WidgetRow = { [dimKey]: "Outros" };
  for (const key of metricKeys) {
    let sum = 0;
    let has = false;
    let cmpSum = 0;
    let cmpHas = false;
    const moneys = [];
    for (const r of rest) {
      const v = Number(r[key]);
      if (r[key] != null && Number.isFinite(v)) {
        sum += v;
        has = true;
      }
      const cv = r.__cmp?.[key];
      if (cv != null && Number.isFinite(Number(cv))) {
        cmpSum += Number(cv);
        cmpHas = true;
      }
      const bd = r.__money?.[key];
      if (bd) moneys.push(bd);
    }
    other[key] = has ? sum : null;
    if (cmpHas) {
      other.__cmp = { ...(other.__cmp ?? {}), [key]: cmpSum };
    }
    if (moneys.length > 0) {
      other.__money = {
        ...(other.__money ?? {}),
        [key]: foldBreakdowns(moneys),
      };
    }
  }
  return [...top, other];
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

// Alinhamento efetivo de uma célula/cabeçalho de tabela. Precedência:
// célula > linha > coluna > global > default do tipo (numérico à direita,
// texto à esquerda). `t` pode ser undefined (widget sem aparência configurada).
export function resolveAlign(
  t: NonNullable<AppearanceSettings["table"]> | undefined,
  o: { column: string; rowKey?: string; numeric?: boolean }
): TableAlign {
  return (
    (o.rowKey ? t?.cellAlign?.[`${o.rowKey}:${o.column}`] : undefined) ??
    (o.rowKey ? t?.rowAlign?.[o.rowKey] : undefined) ??
    t?.colAlign?.[o.column] ??
    t?.align ??
    (o.numeric ? "right" : "left")
  );
}

// Classe Tailwind correspondente ao alinhamento.
export function alignClass(a: TableAlign): string {
  return a === "right" ? "text-right" : a === "center" ? "text-center" : "text-left";
}

// Casas decimais efetivas de uma célula/coluna/widget. Precedência: célula >
// linha > coluna > widget (AppearanceSettings.decimals). undefined = "Auto"
// (o ponto de render mantém seu default atual).
export function resolveDecimals(
  ap: AppearanceSettings | undefined,
  o?: { column?: string; rowKey?: string }
): number | undefined {
  const t = ap?.table;
  return (
    (o?.rowKey && o?.column
      ? t?.cellDecimals?.[`${o.rowKey}:${o.column}`]
      : undefined) ??
    (o?.rowKey ? t?.rowDecimals?.[o.rowKey] : undefined) ??
    (o?.column ? t?.colDecimals?.[o.column] : undefined) ??
    ap?.decimals
  );
}

// Options de fração p/ toLocaleString/Intl: decimais configurados são FIXOS
// (min=max — 2 casas exibe "1,50"); sem config, só o teto default do chamador.
export function fracDigits(
  d: number | undefined,
  defMax = 2
): Intl.NumberFormatOptions {
  return d == null
    ? { maximumFractionDigits: defMax }
    : { minimumFractionDigits: d, maximumFractionDigits: d };
}

// Chave estável de uma coluna de MÉTRICA no modo registros (prefixo __metric:
// não colide com c.field). Compartilhada entre o render (record-list-table) e o
// sheet de aparência (alvos da formatação condicional) — o índice `i` é sobre a
// lista de métricas com field (metricList), desambiguando métricas idênticas.
export function recordListMetricKey(
  m: { field: string; agg: string },
  i: number
): string {
  return `__metric:${m.field}:${m.agg}:${i}`;
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
