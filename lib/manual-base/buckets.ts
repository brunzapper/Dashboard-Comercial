// Versão: 1.0 | Data: 17/09/2026
// Projeção dos lançamentos nas DIMENSÕES de um widget — módulo PURO.
//
// O problema: as linhas do widget vêm agrupadas pelo RPC, e um lançamento
// manual precisa cair na MESMA tupla de `dim_1..dim_n` para se somar a elas.
// Duas regras fazem isso funcionar:
//
//  1. As chaves de bucket de data saem de `bucketCanonicalValue`
//     (lib/widgets/bucket-merge.ts) — o MESMO helper que espelha o
//     `date_trunc`/`extract` das RPCs (invariante 7). Nunca monte um formato
//     de bucket aqui: divergir dele quebra a paridade em silêncio.
//  2. Os dois lados são NORMALIZADOS antes de comparar. O RPC serializa um
//     bucket mensal como `2026-08-01T00:00:00` e o merge client-side como
//     `2026-08-01`; normalizar em vez de adivinhar a serialização torna a
//     costura imune a isso.
//
// Dimensões projetáveis: qualquer DATA com transform, `responsible_id` e
// `operation_id`. Qualquer outra (fase, campo personalizado, base…) faz a
// métrica manual degradar para "—" — um lançamento de mensageria não tem como
// se repartir por `stage`, e inventar um rateio seria pior que dizer "não sei".
//
// O algoritmo é UM só para os quatro modos: caminha os dias do lançamento
// (recortados pelo período), agrupa-os por tupla e decide a contribuição por
// tupla. É o que faz `weekday` funcionar — os dias de uma segunda-feira não
// formam um intervalo contíguo, então uma conta baseada em "janela do bucket"
// não daria conta dele.
import { bucketCanonicalValue } from "@/lib/widgets/bucket-merge";
import { caseDimActive } from "@/lib/widgets/case-dim";
import {
  dimWeekStart,
  effectiveWeekMode,
} from "@/lib/widgets/closed-week";
import type { WeekMode, WeekStart } from "@/lib/widgets/date-buckets";
import type { Dimension, Transform } from "@/lib/widgets/types";

import { dayIso, dayNum, type ManualWindow } from "./spread";
import type { ManualEntry } from "./types";

/** Como UMA dimensão do widget recebe um lançamento. */
export type ManualDimPlan =
  | {
      kind: "date";
      transform: Transform;
      weekMode: WeekMode;
      weekStart: WeekStart;
    }
  | { kind: "responsible" }
  | { kind: "operation" };

/** Valor normalizado de uma célula de dimensão (o que entra na tupla). */
export type ManualDimValue = string | number | null;

/** Transform de data que a Base manual sabe bucketizar. `none` fica de fora de
 *  propósito: o RPC agrupa pelo INSTANTE cru da coluna, e um lançamento não
 *  tem instante — só dia. */
export function manualSupportsTransform(t: Transform | undefined): boolean {
  return t != null && t !== "none";
}

/**
 * Normaliza o valor cru de uma dimensão (venha do RPC ou de um lançamento).
 * `weekday` é o caso especial: o RPC já devolve o isodow (1-7), não uma data.
 */
export function normalizeManualDimValue(
  raw: unknown,
  plan: ManualDimPlan
): ManualDimValue {
  if (plan.kind !== "date") {
    return raw == null || raw === "" ? null : String(raw);
  }
  if (plan.transform === "weekday") {
    const n = Number(raw);
    if (Number.isFinite(n) && n >= 1 && n <= 7) return n;
    // Ainda pode ser uma data (linha já fundida client-side não passa por aqui,
    // mas o caminho é barato e evita um furo silencioso).
    const canon = bucketCanonicalValue(raw, "weekday", plan.weekMode, plan.weekStart);
    return canon ?? null;
  }
  const canon = bucketCanonicalValue(
    raw,
    plan.transform,
    plan.weekMode,
    plan.weekStart
  );
  // Sem canônico (valor ilegível): mantém o cru como grupo próprio — ele
  // simplesmente nunca casa com um bucket manual, que é o desfecho correto.
  return canon ?? (raw == null || raw === "" ? null : String(raw));
}

/** Chave estável de uma tupla de dimensões. */
export function manualTupleKey(values: readonly ManualDimValue[]): string {
  return JSON.stringify(values);
}

export interface ManualProjection {
  /** tupla → { dims, valor por SÉRIE }. */
  byTuple: Map<
    string,
    { dims: ManualDimValue[]; bySeries: Map<string, number> }
  >;
}

export interface ManualProjectionInput {
  plans: readonly ManualDimPlan[];
  period: ManualWindow;
  /** Agrupamento de responsáveis (0101): apelido → principal. O lançamento
   *  atribuído a um apelido entra na linha do principal, como os registros. */
  canonicalById?: Record<string, string> | null;
}

const canonResp = (
  id: string | null,
  map: Record<string, string> | null | undefined
): string | null => (id == null ? null : (map?.[id] ?? id));

/** Dimensões do lançamento que NÃO variam por dia. */
function staticDims(
  entry: ManualEntry,
  plans: readonly ManualDimPlan[],
  canonicalById: Record<string, string> | null | undefined
): (ManualDimValue | undefined)[] {
  return plans.map((p) => {
    if (p.kind === "responsible") return canonResp(entry.responsible_id, canonicalById);
    if (p.kind === "operation") return entry.operation_id ?? null;
    return undefined; // data: resolvida por dia
  });
}

/**
 * Projeta os lançamentos nas tuplas de dimensão.
 *
 * Sem nenhuma dimensão de data, a tupla é constante por lançamento e a janela
 * é o período inteiro — o mesmo número que o caminho escalar (KPI/card) produz.
 * Com data, cada dia do lançamento escolhe sua tupla, e a contribuição sai da
 * regra do modo:
 *
 *  - `ancora`     → o valor inteiro na tupla do dia de INÍCIO;
 *  - `diario`     → valor ÷ dias do lançamento × dias caídos naquela tupla;
 *  - `intersecao` → o valor inteiro em CADA tupla tocada (repete de propósito);
 *  - `contido`    → o valor inteiro só na tupla que recebeu TODOS os dias do
 *                   lançamento — e só quando ele coube inteiro no período.
 */
export function projectManualEntries(
  entries: readonly ManualEntry[],
  input: ManualProjectionInput
): ManualProjection {
  const { plans, period, canonicalById } = input;
  const byTuple: ManualProjection["byTuple"] = new Map();

  const add = (dims: ManualDimValue[], seriesId: string, value: number) => {
    if (value === 0) return;
    const key = manualTupleKey(dims);
    let slot = byTuple.get(key);
    if (!slot) {
      slot = { dims, bySeries: new Map() };
      byTuple.set(key, slot);
    }
    slot.bySeries.set(seriesId, (slot.bySeries.get(seriesId) ?? 0) + value);
  };

  const hasDate = plans.some((p) => p.kind === "date");
  const pFrom = dayNum(period.from);
  const pTo = dayNum(period.to);

  for (const entry of entries) {
    const start = dayNum(entry.period_start);
    if (start == null) continue;
    const endRaw = dayNum(entry.period_end);
    const end = endRaw == null || endRaw < start ? start : endRaw;
    const value = Number(entry.value);
    if (!Number.isFinite(value)) continue;

    const base = staticDims(entry, plans, canonicalById);

    if (!hasDate) {
      // Tupla constante: a decisão é a mesma do caminho escalar.
      const dims = base.map((v) => v ?? null);
      const contained = (pFrom == null || start >= pFrom) && (pTo == null || end <= pTo);
      const touches = (pTo == null || start <= pTo) && (pFrom == null || end >= pFrom);
      const anchorIn = (pFrom == null || start >= pFrom) && (pTo == null || start <= pTo);
      let v = 0;
      switch (entry.spread) {
        case "ancora":
          v = anchorIn ? value : 0;
          break;
        case "intersecao":
          v = touches ? value : 0;
          break;
        case "contido":
          v = contained ? value : 0;
          break;
        case "diario": {
          const lo = pFrom == null ? start : Math.max(start, pFrom);
          const hi = pTo == null ? end : Math.min(end, pTo);
          v = hi < lo ? 0 : (value / (end - start + 1)) * (hi - lo + 1);
          break;
        }
      }
      add(dims, entry.series_id, v);
      continue;
    }

    // Caminho com data: caminha os dias recortados pelo período.
    const lo = pFrom == null ? start : Math.max(start, pFrom);
    const hi = pTo == null ? end : Math.min(end, pTo);
    if (hi < lo) continue;

    const totalDays = end - start + 1;
    // tupla → { dims, dias }
    const hits = new Map<string, { dims: ManualDimValue[]; days: number }>();
    let anchorKey: string | null = null;

    for (let d = lo; d <= hi; d++) {
      const iso = dayIso(d);
      const dims = plans.map((p, i) =>
        p.kind === "date" ? normalizeManualDimValue(iso, p) : (base[i] ?? null)
      );
      const key = manualTupleKey(dims);
      const slot = hits.get(key);
      if (slot) slot.days += 1;
      else hits.set(key, { dims, days: 1 });
      if (d === start) anchorKey = key;
    }

    switch (entry.spread) {
      case "ancora": {
        if (anchorKey == null) break; // início fora do período
        const slot = hits.get(anchorKey)!;
        add(slot.dims, entry.series_id, value);
        break;
      }
      case "diario":
        for (const slot of hits.values()) {
          add(slot.dims, entry.series_id, (value / totalDays) * slot.days);
        }
        break;
      case "intersecao":
        for (const slot of hits.values()) add(slot.dims, entry.series_id, value);
        break;
      case "contido": {
        // Precisa ter cabido no período E inteiro numa única tupla.
        const fitsPeriod = lo === start && hi === end;
        if (!fitsPeriod) break;
        for (const slot of hits.values()) {
          if (slot.days === totalDays) add(slot.dims, entry.series_id, value);
        }
        break;
      }
    }
  }

  return { byTuple };
}

/** Tupla normalizada de uma linha do RPC (as chaves são `dim_1..dim_n`). */
export function manualRowTuple(
  row: Record<string, unknown>,
  plans: readonly ManualDimPlan[]
): ManualDimValue[] {
  return plans.map((p, i) => normalizeManualDimValue(row[`dim_${i + 1}`], p));
}

/**
 * O plano de projeção de um widget, ou `null` quando alguma dimensão não é
 * projetável — e aí a métrica manual inteira degrada para "—".
 *
 * Fica de fora, de propósito:
 *  - dimensão que não é data/responsável/operação (não há como repartir);
 *  - data com `transform: "none"` (o RPC agrupa por instante, o lançamento só
 *    tem dia);
 *  - dimensão CONDICIONAL ATIVA (`caseFormula` sem transform) — ela
 *    reclassifica valores de registro, que um lançamento não tem;
 *  - dimensão com "Agrupar período" (`dateAgg`), que leva o widget inteiro
 *    para `runWidgetByPeriod` (agregação POR REGISTRO no app) — outro caminho,
 *    onde a métrica manual degrada para "—".
 */
export function manualDimPlans(
  dims: readonly Dimension[],
  isDateField: (field: string) => boolean
): ManualDimPlan[] | null {
  const out: ManualDimPlan[] = [];
  for (const d of dims) {
    if (caseDimActive(d) || d.dateAgg != null) return null;
    if (d.field === "responsible_id") {
      out.push({ kind: "responsible" });
      continue;
    }
    if (d.field === "operation_id") {
      out.push({ kind: "operation" });
      continue;
    }
    if (isDateField(d.field) && manualSupportsTransform(d.transform)) {
      out.push({
        kind: "date",
        transform: d.transform!,
        weekMode: effectiveWeekMode(d) ?? "restricted",
        weekStart: dimWeekStart(d),
      });
      continue;
    }
    return null;
  }
  return out;
}
