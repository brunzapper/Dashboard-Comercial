// Versão: 1.3 | Data: 18/09/2026
// v1.3 (18/09/2026): eixo de família sem tupla nenhuma passa a emitir a FORMA
//   do eixo (uma linha por membro, métricas em "—"/0) em vez de devolver `[]`
//   e deixar o widget mudo. Ver o bloco no fim de `applyManualBase`.
// v1.2 (18/09/2026): os mapas passam a guardar REFS, não chaves de dado — é o
//   que faz o ESCOPO DE MEMBRO (`manual:x@canal=ligacao`) sobreviver até aqui.
//   Dois refs do MESMO dado com escopos diferentes são operandos DIFERENTES, e
//   por isso o slot da tupla passa a ser chaveado pelo ref (chaveá-lo por
//   `series_id`, como na 0142, faria um sobrescrever o outro).
// v1.1 (18/09/2026): FAMÍLIAS e NÍVEIS (0143). Três mudanças de forma:
//   * a escolha de nível é POR DADO, não por widget — `manual:vendas` e
//     `manual:interacoes` no mesmo card podem cair em níveis diferentes, e um
//     dado que não tem a família pedida degrada SÓ ele (antes era tudo-ou-nada
//     via `plans === null`);
//   * os FILTROS de coordenada entram aqui, não no payload do RPC;
//   * com eixo de família, as métricas de REGISTRO valem `null` e não 0 —
//     "não há como atribuir" não é "nenhum registro casou".
// A costura entre a Base manual e as linhas de um widget. Módulo PURO: recebe
// as linhas já computadas (e já fundidas por bucket) e devolve as linhas com
// os números digitados somados.
//
// Onde isto roda: no FIM de computeRows (lib/widgets/engine.ts), DEPOIS de
// contractCaseRows e mergeRowsByBucket. A ordem não é detalhe — é correção.
// Uma dimensão `custom:` com transform chega do RPC agrupada pelo valor CRU e
// só vira bucket no merge client-side; aplicar a Base manual antes faria duas
// linhas do mesmo mês receberem o mesmo valor manual, e o merge somaria as
// duas. Depois do merge existe uma linha por bucket, e uma só.
//
// Duas coisas acontecem aqui:
//
//  1. INJEÇÃO. Métrica manual recebe o valor do bucket; métrica CALCULADA
//     recebe o valor na basis (chave = o próprio ref) e é reavaliada. É a
//     basis, e não um const abaixado, que faz o subtotal e o Total geral
//     somarem certo — foldBasis é aditivo, que é o que uma quantidade quer.
//
//  2. LINHAS SINTÉTICAS. Um widget de mensageria tem métricas que são TODAS
//     manuais: o RPC não devolve linha nenhuma e não haveria barra para
//     desenhar. As tuplas que só existem na Base manual viram linhas, com as
//     métricas de registro em 0 (contagem) ou null (as demais) — a mesma
//     convenção de "grupo ausente na perna" que as pernas por fonte já usam.
//     É um desvio consciente da regra do Metric.sources, e só liga quando há
//     ref manual: widget existente fica byte-idêntico.
//
// Rotulagem de FK e ordenação acontecem DEPOIS, em runWidget — por isso a
// linha sintética carrega o id cru na dimensão e sai rotulada de graça.
import type { BasisValues } from "@/lib/widgets/calc-metrics";
import type { WidgetRow } from "@/lib/widgets/types";

import {
  manualRowTuple,
  manualTupleKey,
  projectManualEntries,
  type ManualDimPlan,
  type ManualDimValue,
} from "./buckets";
import { resolveManualLevel, type ManualCoordFilter } from "./levels";
import type { ManualWindow } from "./spread";
import { parseManualOperand, type ManualBaseData } from "./types";

/** As famílias que cada DADO declara: `series_id` → chaves. */
export type ManualDeclarationMap = Record<string, string[]>;

export interface ManualApplyInput {
  rows: WidgetRow[];
  /** Plano de projeção das dimensões; `null` = alguma dim não é projetável e
   *  TODA métrica manual degrada para "—". */
  plans: ManualDimPlan[] | null;
  base: ManualBaseData;
  period: ManualWindow;
  /** Agrupamento de responsáveis (0101) — apelido → principal. */
  canonicalById?: ReadonlyMap<string, string> | null;
  /** Métrica PLANA da Base manual: índice em config.metrics → REF (com escopo,
   *  se houver). */
  manualMetricKeys: Map<number, string>;
  /** Métrica CALCULADA que cita a Base manual: índice → REFS citados. */
  calcManualKeys: Map<number, string[]>;
  /** Reavalia a métrica calculada `idx` sobre a basis já com os valores
   *  manuais injetados. O engine fecha sobre a fórmula e a meta de moeda. */
  evalCalc: (idx: number, basis: BasisValues) => number | null;
  /** Quantas métricas a config tem (para preencher as linhas sintéticas). */
  metricCount: number;
  /** Agregação de cada métrica, para decidir o valor de uma linha sintética:
   *  contagem sem registro é 0; soma/média/min/máx sem registro é "—". */
  metricIsCount: (idx: number) => boolean;
  /** Filtros de COORDENADA do widget (0143). Nunca descem ao RPC: eles entram
   *  no conjunto pedido do nível e recortam os membros. */
  coordFilters?: readonly ManualCoordFilter[];
  /** As famílias que cada dado DECLARA (0143) — é o que faz uma família
   *  EMBUTIDA (`responsavel`/`operacao`) participar do nível. Sem declaração o
   *  dado fica no nível ∅ e a soma da 0142 continua valendo, mesmo com
   *  `responsible_id` preenchido. */
  declarations?: ManualDeclarationMap;
  /** Há eixo de FAMÍLIA no widget ⇒ métrica de REGISTRO vale `null`, nunca 0:
   *  nenhum registro é atribuível a um membro de família. */
  recordMetricsDegrade?: boolean;
}

/** O widget referencia a Base manual de alguma forma? Gate barato: sem isto,
 *  nada abaixo roda e o caminho segue byte-idêntico ao anterior. */
export function hasManualRefs(input: {
  manualMetricKeys: Map<number, string>;
  calcManualKeys: Map<number, string[]>;
}): boolean {
  if (input.manualMetricKeys.size > 0) return true;
  for (const keys of input.calcManualKeys.values()) {
    if (keys.length > 0) return true;
  }
  return false;
}

export function applyManualBase(input: ManualApplyInput): WidgetRow[] {
  const {
    rows,
    plans,
    base,
    period,
    canonicalById,
    manualMetricKeys,
    calcManualKeys,
    evalCalc,
    metricCount,
    metricIsCount,
  } = input;

  if (!hasManualRefs(input)) return rows;

  // Dimensão não projetável: a métrica manual não tem como se repartir. Vale
  // "—" explícito, nunca um rateio inventado nem o total repetido em toda
  // linha (que leria como dado verdadeiro).
  if (!plans) {
    for (const row of rows) {
      for (const idx of manualMetricKeys.keys()) row[`metric_${idx + 1}`] = null;
      for (const idx of calcManualKeys.keys()) row[`metric_${idx + 1}`] = null;
    }
    return rows;
  }

  // Só os lançamentos dos dados realmente citados.
  const wanted = new Set<string>([
    ...manualMetricKeys.values(),
    ...[...calcManualKeys.values()].flat(),
  ]);
  const idByKey = new Map(base.series.map((s) => [s.key, s.id]));

  // Os eixos que a RODADA pede. Um eixo de família pedido por DIMENSÃO vira
  // coluna na linha; um pedido só por FILTRO recorta e depois some (o card de
  // "ligações" não tem eixo nenhum na tela, mas precisa cair no nível do canal).
  const coordFilters = input.coordFilters ?? [];
  const dimAxes: string[] = [];
  // Dimensão de registro que uma família EMBUTIDA endereça. Ela só entra no
  // nível se o dado DECLARAR a família — é esse opt-in que mantém byte-idêntico
  // o comportamento de quem já lançava com responsável antes da 0143.
  const builtinAxes: string[] = [];
  for (const p of plans) {
    if (p.kind === "family") dimAxes.push(p.axis);
    else if (p.kind === "responsible") builtinAxes.push("responsavel");
    else if (p.kind === "operation") builtinAxes.push("operacao");
  }
  const declarations = input.declarations ?? {};

  // A escolha de nível é POR DADO, e é aqui que a projeção deixa de ser uma
  // rodada só: cada dado projeta OS LANÇAMENTOS DO NÍVEL DELE. As tuplas se
  // fundem naturalmente, porque o slot guarda o valor por `series_id`.
  const byTuple: ReturnType<typeof projectManualEntries>["byTuple"] = new Map();
  const degraded = new Set<string>();

  for (const ref of wanted) {
    const operand = parseManualOperand(ref);
    const seriesId = operand ? idByKey.get(operand.key) : undefined;
    if (!operand || !seriesId) {
      degraded.add(ref);
      continue;
    }
    const declared = new Set(declarations[seriesId] ?? []);
    // O ESCOPO do operando é um filtro de coordenada a mais — o mesmo mecanismo
    // do filtro do widget, e é ele que faz o eixo escopado entrar no conjunto
    // PEDIDO e depois somar embora.
    const filters: readonly ManualCoordFilter[] = operand.axis
      ? [...coordFilters, { axis: operand.axis, members: [operand.member] }]
      : coordFilters;
    const requested = [
      ...dimAxes,
      ...builtinAxes.filter((a) => declared.has(a)),
    ];
    const seriesEntries = base.entries.filter((e) => e.series_id === seriesId);
    const res = resolveManualLevel(seriesEntries, {
      dimAxes: requested,
      // Filtro de família NÃO declarada pelo dado não some em silêncio: ele
      // entra no pedido e o dado degrada para "—". Recortar por um eixo que o
      // dado não tem e mostrar o total cheio seria pior.
      filters,
    });
    if (!res) {
      degraded.add(ref);
      continue;
    }
    const projected = projectManualEntries(res.entries, {
      plans,
      period,
      canonicalById,
    });
    for (const [tupleKey, slot] of projected.byTuple) {
      // A projeção chaveia o valor por `series_id`; aqui ele é RE-CHAVEADO pelo
      // REF, porque dois operandos do mesmo dado com escopos diferentes têm de
      // conviver na mesma tupla.
      const value = [...slot.bySeries.values()].reduce((a, b) => a + b, 0);
      const target = byTuple.get(tupleKey);
      if (!target) {
        byTuple.set(tupleKey, {
          dims: slot.dims,
          bySeries: new Map([[ref, value]]),
        });
        continue;
      }
      target.bySeries.set(ref, (target.bySeries.get(ref) ?? 0) + value);
    }
  }

  // Valor de um dado numa tupla. Ausente = 0: um mês sem lançamento é zero
  // mensagem, não "não sei". Dado DEGRADADO (pediram uma família que ele não
  // tem) é `null` — "não sei" de verdade, nunca um zero que lê como fato.
  const valueOf = (
    slot: { bySeries: Map<string, number> } | undefined,
    ref: string
  ): number | null => {
    if (degraded.has(ref)) return null;
    if (!slot) return 0;
    return slot.bySeries.get(ref) ?? 0;
  };

  const injectInto = (basis: BasisValues | undefined, keys: string[], slot: {
    bySeries: Map<string, number>;
  } | undefined) => {
    if (!basis) return;
    for (const ref of keys) {
      const v = valueOf(slot, ref);
      // Operando degradado: a chave fica AUSENTE da basis, não em 0 — é a
      // ausência que faz a fórmula render "—" em vez de dividir por zero e
      // mentir. A chave de basis é o REF INTEIRO (com escopo).
      if (v == null) delete basis[ref];
      else basis[ref] = v;
    }
  };

  const seen = new Set<string>();
  for (const row of rows) {
    const tupleKey = manualTupleKey(manualRowTuple(row, plans));
    seen.add(tupleKey);
    const slot = byTuple.get(tupleKey);

    for (const [idx, key] of manualMetricKeys) {
      row[`metric_${idx + 1}`] = valueOf(slot, key);
    }
    for (const [idx, keys] of calcManualKeys) {
      if (keys.length === 0) continue;
      const own = row.__calcOpsBy?.[`metric_${idx + 1}`];
      injectInto(own, keys, slot);
      injectInto(row.__calcOps, keys, slot);
      const basis = own ?? row.__calcOps;
      if (basis) row[`metric_${idx + 1}`] = evalCalc(idx, basis);
    }
  }

  // Tuplas que só existem na Base manual.
  for (const [tupleKey, slot] of byTuple) {
    if (seen.has(tupleKey)) continue;
    const row = syntheticRow(slot.dims, {
      metricCount,
      metricIsCount,
      manualMetricKeys,
      calcManualKeys,
      valueOf: (key) => valueOf(slot, key),
      evalCalc,
      recordMetricsDegrade: input.recordMetricsDegrade === true,
    });
    rows.push(row);
  }

  // v1.3 (18/09/2026): A FORMA DO EIXO quando não sobrou tupla nenhuma.
  //
  // Num eixo de família o widget é manual-only e `computeRows` não roda
  // consulta de registros — chega aqui com `rows` vazio. Se, além disso, todo
  // dado citado degradou (pediram uma família que ele não declara) ou
  // simplesmente não há lançamento na janela, `byTuple` fica vazio e esta
  // função devolvia `[]`: o widget saía MUDO, enquanto o contrato do módulo é
  // dizer "não sei" em voz alta — o "—". Um board real caiu exatamente aí, com
  // cinco métricas de nível ∅ sob uma dimensão de família.
  //
  // Então emite o eixo: uma linha por MEMBRO declarado, com o valor que cada
  // ref merece — `null` ("—") se degradou, `0` se o dado tem a família mas
  // nada caiu na janela. A ordem/rotulagem vêm de graça em runWidget, que
  // ordena por `sort_order` e troca a chave pelo rótulo.
  //
  // Só com UM eixo: em duas famílias cruzadas, quais células existem é
  // exatamente o que não se sabe, e o produto cartesiano inventaria a
  // resposta — o mesmo motivo pelo qual não há rateio.
  const soleAxis =
    rows.length === 0 && byTuple.size === 0 && plans.length === 1 && plans[0].kind === "family"
      ? plans[0].axis
      : null;
  if (soleAxis != null) {
    const fam = base.families.find((f) => f.key === soleAxis);
    const members = fam
      ? base.members
          .filter((m) => m.family_id === fam.id)
          .slice()
          .sort((a, b) => a.sort_order - b.sort_order)
      : [];
    for (const m of members) {
      rows.push(
        syntheticRow([m.key], {
          metricCount,
          metricIsCount,
          manualMetricKeys,
          calcManualKeys,
          // `undefined` como slot: ref degradado vira null, ref resolvido sem
          // lançamento na janela vira 0 — a MESMA régua do resto da função.
          valueOf: (key) => valueOf(undefined, key),
          evalCalc,
          recordMetricsDegrade: input.recordMetricsDegrade === true,
        })
      );
    }
  }

  return rows;
}

function syntheticRow(
  dims: ManualDimValue[],
  o: {
    metricCount: number;
    metricIsCount: (idx: number) => boolean;
    manualMetricKeys: Map<number, string>;
    calcManualKeys: Map<number, string[]>;
    valueOf: (key: string) => number | null;
    evalCalc: (idx: number, basis: BasisValues) => number | null;
    recordMetricsDegrade?: boolean;
  }
): WidgetRow {
  const row: WidgetRow = {};
  dims.forEach((v, i) => {
    row[`dim_${i + 1}`] = v;
  });
  for (let i = 0; i < o.metricCount; i++) {
    // Contagem sem registro no grupo é 0 — mas num eixo de FAMÍLIA nem essa
    // leitura existe: nenhum registro é atribuível a "Ligação", então 0 seria
    // uma afirmação falsa e o valor certo é "—".
    row[`metric_${i + 1}`] =
      o.metricIsCount(i) && !o.recordMetricsDegrade ? 0 : null;
  }
  for (const [idx, key] of o.manualMetricKeys) {
    row[`metric_${idx + 1}`] = o.valueOf(key);
  }
  if (o.calcManualKeys.size > 0) {
    // Sem registro no grupo: contagens valem 0 e as demais chaves ficam
    // AUSENTES da basis (null no ctx) — é a mesma convenção do "grupo ausente
    // na perna". Quem preenche as chaves de registro é o engine, no fechamento
    // de evalCalc; aqui entram só as manuais.
    const basis: BasisValues = {};
    for (const [idx, keys] of o.calcManualKeys) {
      for (const ref of keys) {
        const v = o.valueOf(ref);
        if (v != null) basis[ref] = v;
      }
      row[`metric_${idx + 1}`] = o.evalCalc(idx, basis);
    }
    row.__calcOps = basis;
  }
  return row;
}
