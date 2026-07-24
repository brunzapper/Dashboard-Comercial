// Versão: 1.0 | Data: 24/07/2026
// Pivot das pernas de sub-base p/ os gráficos (modos "stacked"/"grouped" de
// WidgetSettings.subSeriesMode): o branch multi-perna do engine emite a Base
// como dimensão LÍDER (dim_1) e a dimensão real desce p/ dim_2 — mas os
// gráficos de barra/linha plotam SÓ dimensions[0] como eixo. Este módulo puro
// (client-safe) pivota as linhas: 1 objeto por CATEGORIA (valor de dim_2) com
// uma chave sintética por (base × métrica) — cada sub-base vira uma série
// própria (empilhada ou lado a lado), com legenda pelo rótulo da sub.
// Só ativa quando o engine carimbou WidgetData.subSeries (nunca no modo
// "total", que já sai fundido sem a dim "Base"). Tabela/CSV não passam por
// aqui — consomem as linhas originais (Base como coluna).
import { foldBreakdowns, type MoneyBreakdown } from "./currency";
import type { WidgetData, WidgetRow } from "./types";

export interface SubSeriesEntry {
  // Chave sintética da série no objeto pivotado ("sb_<base>_<métrica>",
  // por ÍNDICE — rótulos com "." quebrariam o path-lookup do Recharts).
  dataKey: string;
  cmpKey: string; // `${dataKey}__cmp` (série fantasma da comparação)
  base: string; // rótulo da sub-base (valor de dim_1)
  baseIndex: number; // índice da base (cor da paleta)
  metricKey: string; // "metric_<n>" subjacente (formatação/moeda/percentual)
  name: string; // legenda: base (1 métrica) ou "base · métrica"
  // Última base do stack da sua métrica (só o segmento do topo arredonda).
  lastInStack: boolean;
}

export interface SubSeriesPivot {
  mode: "stacked" | "grouped";
  catKey: string; // dimensions[1].key — eixo de categorias (dimensão real)
  rows: WidgetRow[]; // 1 objeto por categoria, na ordem de 1ª ocorrência
  series: SubSeriesEntry[]; // métrica-major (as bases de uma métrica = 1 stack)
  // dataKey|cmpKey sintético → metric_<n> (formatação resolve pela métrica).
  keyMap: Record<string, string>;
}

// Chave do TOTAL da categoria (soma entre bases) por métrica — rank do top-N
// ("Outros") e da ordenação por valor sob o pivot.
export function subSeriesCatTotalKey(metricKey: string): string {
  return `__cat_total:${metricKey}`;
}

// Soma null-aware: ausente+null = null; número soma (null vira 0 ao somar com
// número — coerente com o fold do "Outros" do top-N).
function addNum(prev: unknown, v: unknown): number | null {
  const pn = typeof prev === "number" && Number.isFinite(prev) ? prev : null;
  const vn = v != null && Number.isFinite(Number(v)) ? Number(v) : null;
  if (pn == null && vn == null) return null;
  return (pn ?? 0) + (vn ?? 0);
}

/**
 * Pivota um WidgetData multi-perna (marcador `subSeries` + ≥2 dims) para o
 * shape dos gráficos. Sem marcador ou com 1 dim, retorna null (o chart segue o
 * caminho clássico). Com MAIS de 2 dims (multi-dimensão original — incomum em
 * gráfico), os valores além de dim_2 são fundidos por soma numérica na mesma
 * (base × categoria) — aproximação documentada.
 */
export function buildSubSeriesPivot(data: WidgetData): SubSeriesPivot | null {
  if (!data.subSeries || data.dimensions.length < 2) return null;
  const catKey = data.dimensions[1].key;
  const rows = data.rows;

  // Bases (valores de dim_1) na ordem de 1ª ocorrência — o engine concatena as
  // pernas em ordem, então a ordem das séries segue a seleção de fontes.
  const baseIdx = new Map<string, number>();
  for (const r of rows) {
    const b = String(r.dim_1 ?? "—");
    if (!baseIdx.has(b)) baseIdx.set(b, baseIdx.size);
  }
  const nBases = baseIdx.size;
  if (nBases === 0) return null;

  const singleMetric = data.metrics.length <= 1;
  const series: SubSeriesEntry[] = [];
  const keyMap: Record<string, string> = {};
  data.metrics.forEach((m, mi) => {
    for (const [b, bi] of baseIdx) {
      const dataKey = `sb_${bi}_${mi}`;
      const cmpKey = `${dataKey}__cmp`;
      series.push({
        dataKey,
        cmpKey,
        base: b,
        baseIndex: bi,
        metricKey: m.key,
        name: singleMetric ? b : `${b} · ${m.label}`,
        lastInStack: bi === nBases - 1,
      });
      keyMap[dataKey] = m.key;
      keyMap[cmpKey] = m.key;
    }
  });

  const outRows: WidgetRow[] = [];
  const accByCat = new Map<string, WidgetRow>();
  for (const r of rows) {
    const bi = baseIdx.get(String(r.dim_1 ?? "—"))!;
    const catRaw = r[catKey] ?? null;
    const ck = String(catRaw ?? "—");
    let acc = accByCat.get(ck);
    if (!acc) {
      acc = { [catKey]: catRaw };
      accByCat.set(ck, acc);
      outRows.push(acc);
    }
    data.metrics.forEach((m, mi) => {
      const dataKey = `sb_${bi}_${mi}`;
      const cmpKey = `${dataKey}__cmp`;
      const totalKey = subSeriesCatTotalKey(m.key);
      acc[dataKey] = addNum(acc[dataKey], r[m.key]);
      acc[totalKey] = addNum(acc[totalKey], r[m.key]);
      // Comparação: achatada na chave sintética (série fantasma do Recharts)
      // E no mapa __cmp (badges/rótulos de variação leem __cmp[dataKey]).
      const cv = r.__cmp?.[m.key];
      if (cv != null || cmpKey in acc) {
        const sum = addNum(acc[cmpKey], cv);
        acc[cmpKey] = sum;
        if (sum != null) acc.__cmp = { ...(acc.__cmp ?? {}), [dataKey]: sum };
      }
      // Detalhamento monetário sob a chave sintética (tooltip/rótulos).
      const bd = r.__money?.[m.key];
      if (bd) {
        const money: Record<string, MoneyBreakdown> = {
          ...(acc.__money ?? {}),
        };
        money[dataKey] = money[dataKey]
          ? foldBreakdowns([money[dataKey], bd])
          : bd;
        acc.__money = money;
      }
    });
    // Meta do bucket: a mesma meta global repetida por perna — 1º não-nulo.
    if (acc.__goal == null && r.__goal != null) acc.__goal = r.__goal;
  }

  return { mode: data.subSeries.mode, catKey, rows: outRows, series, keyMap };
}
