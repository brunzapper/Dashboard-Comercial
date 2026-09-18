// Versão: 1.0 | Data: 18/09/2026
// v1.0 (18/09/2026): A REGRA DE NÍVEIS — o que impede o mesmo número de ser
//   contado duas vezes.
//
// O NÍVEL de um lançamento é o conjunto de famílias que ele endereça
// (`entryLevel`, em families.ts). O dado do pedido original tem quatro:
//
//   nível ∅                  → 1000                      (o total)
//   nível {canal}            → 500 + 500                 (a margem por canal)
//   nível {resp}             → 200 + 400 + 350 + 50      (a margem por resp.)
//   nível {canal, resp}      → 100 + 250 + 150           (o cruzamento)
//
// São QUATRO LEITURAS DO MESMO 1000. Daí a regra, que é a feature inteira:
//
//   **NÍVEIS NUNCA SOMAM ENTRE SI.**
//
// Uma consulta escolhe UM nível e só lê os lançamentos DELE. Somar os quatro
// daria 3500; somar dois quaisquer já seria contagem dobrada.
//
// Qual nível? O conjunto PEDIDO `F` vem das dimensões `manualdim:` (que viram
// coluna na linha) mais os eixos citados em filtros de coordenada (que
// recortam e depois somam embora). Então:
//
//   1. candidatos = os níveis PRESENTES que contêm F;
//   2. nenhum ⇒ null ⇒ a métrica DAQUELE dado degrada para "—". Pedir uma
//      família que o dado não tem é "não sei", nunca zero;
//   3. vence o de MENOS famílias extras. Não é estética: somar embora um nível
//      INCOMPLETO devolve um total menor — o cruzamento do exemplo soma 500 de
//      1000, então perguntar "quanto deu no total?" tem de cair no nível ∅
//      (1000), não no cruzado (500);
//   4. empate ⇒ ordem lexicográfica da chave do nível, só para ser
//      determinístico (duas rodadas iguais não podem divergir).
//
// A consequência boa do passo 3: um dado que só tem a margem por canal responde
// "1000" para um card sem dimensão, somando embora o eixo. É a decisão de
// produto "sem o total lançado, soma a família mais grossa" — e o total
// lançado à mão, quando existe, SEMPRE vence, porque o nível ∅ tem zero
// famílias extras.
//
// Módulo PURO. Não conhece janela nem `spread`: quem soma é `spread.ts`, sobre
// os lançamentos que este módulo escolheu.

import {
  coordDeclares,
  coordMember,
  entryLevel,
  manualLevelKey,
  type ManualCoords,
} from "./families";
import type { ManualEntry } from "./types";

/**
 * Um recorte por coordenada, vindo de um filtro do widget.
 *
 * `members` lista chaves de membro; `null` na lista é o RESIDUAL ("Sem Canal"),
 * que é um grupo de verdade e por isso um valor selecionável — e é também a
 * razão de `is_null` NÃO ser uma operação válida aqui: ele confundiria
 * "não declarado" (outro nível) com "declarado residual" (este nível), que é a
 * distinção inteira.
 */
export interface ManualCoordFilter {
  axis: string;
  members: (string | null)[];
  /** `neq` / `not in`. */
  negate?: boolean;
}

export interface ManualLevelResolution {
  /** O nível escolhido, eixos ordenados. */
  level: string[];
  /** Só os lançamentos DAQUELE nível, já recortados pelos filtros. */
  entries: ManualEntry[];
  /** `level` menos os eixos pedidos como dimensão — o que será somado embora. */
  collapsed: string[];
}

export interface ManualLevelRequest {
  /** Eixos pedidos por DIMENSÃO (viram coluna na linha). */
  dimAxes: readonly string[];
  /** Eixos pedidos por FILTRO (recortam, depois somam embora). */
  filters: readonly ManualCoordFilter[];
}

/** Os níveis presentes nos lançamentos, em ordem determinística. */
export function manualLevels(entries: readonly ManualEntry[]): string[][] {
  const seen = new Map<string, string[]>();
  for (const e of entries) {
    const level = entryLevel(e.coords);
    const key = manualLevelKey(level);
    if (!seen.has(key)) seen.set(key, level);
  }
  return Array.from(seen.values()).sort(
    (a, b) => a.length - b.length || manualLevelKey(a).localeCompare(manualLevelKey(b))
  );
}

/** O lançamento passa por todos os filtros de coordenada? */
export function coordsMatchFilters(
  coords: ManualCoords,
  filters: readonly ManualCoordFilter[]
): boolean {
  for (const f of filters) {
    // Lançamento que não declara o eixo não pertence a este nível — quem o
    // exclui é a escolha do nível, não o filtro. Aqui só decidimos entre os
    // que JÁ estão no nível certo.
    if (!coordDeclares(coords, f.axis)) return false;
    const member = coordMember(coords, f.axis);
    const hit = f.members.some((m) => m === member);
    if (f.negate ? hit : !hit) return false;
  }
  return true;
}

/**
 * Escolhe o nível de UM dado e devolve os lançamentos dele já recortados.
 * `null` = nenhum nível compatível ⇒ a métrica daquele dado vira "—".
 *
 * `entries` já deve estar filtrado para UMA série (é o chamador quem sabe qual
 * dado está resolvendo — a escolha de nível é por DADO, e dois dados no mesmo
 * widget podem cair em níveis diferentes).
 */
export function resolveManualLevel(
  entries: readonly ManualEntry[],
  req: ManualLevelRequest
): ManualLevelResolution | null {
  const required = new Set<string>(req.dimAxes);
  for (const f of req.filters) required.add(f.axis);

  const candidates = manualLevels(entries).filter((level) => {
    const set = new Set(level);
    for (const axis of required) if (!set.has(axis)) return false;
    return true;
  });
  if (candidates.length === 0) return null;

  // `manualLevels` já devolve ordenado por (quantidade, chave) — o primeiro
  // candidato é o de menos famílias extras, com desempate determinístico.
  const level = candidates[0];
  const levelKey = manualLevelKey(level);
  const dimSet = new Set(req.dimAxes);

  return {
    level,
    entries: entries.filter(
      (e) =>
        manualLevelKey(entryLevel(e.coords)) === levelKey &&
        coordsMatchFilters(e.coords, req.filters)
    ),
    collapsed: level.filter((axis) => !dimSet.has(axis)),
  };
}
