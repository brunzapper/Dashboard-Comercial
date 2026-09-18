// Versão: 1.0 | Data: 18/09/2026
// v1.0 (18/09/2026): a fronteira entre os filtros de WIDGET e as coordenadas da
//   Base manual (0143). Dono ÚNICO da tradução.
//
// Por que existe: um filtro `manualdim:<familia>` NÃO é campo de registro. Se
// ele chegasse a `resolveFilters`/`resolveFkFilterNames`/`p_filters`, o RPC
// receberia uma coluna inexistente. Então ele é SEPARADO no começo de
// `runWidget` e resolvido no engine — a mesma disciplina de tudo mais na Base
// manual (invariante 41): o par de RPCs de widget fica INTOCADO.
//
// O que um filtro de coordenada significa: ele (a) acrescenta a família ao
// conjunto PEDIDO na escolha do nível e (b) recorta os membros. Num widget
// MISTO ele restringe **somente as métricas da Base manual** — a métrica de
// registro ao lado fica inalterada. A assimetria é deliberada, e é a mesma que
// já valia na 0142 na direção oposta: os filtros de registro do widget nunca
// recortaram os lançamentos. Meia-simetria seria pior que duas regras claras, e
// mudar a direção existente alteraria o número de widgets já salvos.
//
// Operadores: só `eq`/`neq`/`in` (e `neq` sobre lista = "not in"). Em especial
// **`is_null` NÃO é aceito**, e a razão é a distinção que sustenta a feature:
// ele confundiria "não declarou a família" (outro nível) com "declarou o
// RESIDUAL" (este nível). O residual é um MEMBRO selecionável na lista de
// valores ("Sem Canal"), não a ausência de valor.
//
// Módulo PURO.

import type { FilterOp, WidgetFilter } from "@/lib/widgets/types";

import { parseManualAxisRef } from "./families";
import type { ManualCoordFilter } from "./levels";

/**
 * O valor-sentinela do RESIDUAL num filtro gravado. Precisa ser uma string
 * porque `WidgetFilter.value` viaja por JSON e por `<select>`; `null` cru
 * sobreviveria ao jsonb mas não ao formulário.
 *
 * Não colide com chave de membro: `MANUAL_KEY_RE` exige começar com letra
 * minúscula, e este começa com `_`.
 */
export const MANUAL_RESIDUAL_VALUE = "__sem__";

/** Operadores que um filtro de coordenada aceita. */
export const MANUAL_COORD_OPS: FilterOp[] = ["eq", "neq", "in"];

export function isManualCoordOp(op: FilterOp): boolean {
  return MANUAL_COORD_OPS.includes(op);
}

function memberList(value: unknown): (string | null)[] {
  const raw = Array.isArray(value) ? value : [value];
  const out: (string | null)[] = [];
  for (const v of raw) {
    if (v == null) continue;
    const str = String(v).trim();
    if (!str) continue;
    out.push(str === MANUAL_RESIDUAL_VALUE ? null : str);
  }
  return out;
}

export interface ManualFilterSplit {
  /** Os filtros que seguem para o caminho de registros, intocados. */
  record: WidgetFilter[];
  /** Os de coordenada, traduzidos. */
  coords: ManualCoordFilter[];
}

/**
 * Separa os filtros de coordenada dos de registro.
 *
 * Filtro de coordenada com operador ou valor inválido é DESCARTADO (não vira
 * recorte nem vai ao RPC): ele não pode virar filtro de registro, e derrubar a
 * rodada por causa de uma linha de configuração ruim seria pior que ignorá-la —
 * o construtor só oferece os operadores aceitos, então chegar aqui já é
 * anomalia. A régua de oferta vive no construtor e no validador do import.
 */
export function splitManualCoordFilters(
  filters: readonly WidgetFilter[]
): ManualFilterSplit {
  const record: WidgetFilter[] = [];
  const coords: ManualCoordFilter[] = [];
  for (const f of filters) {
    const axis = parseManualAxisRef(f.field);
    if (axis == null) {
      record.push(f);
      continue;
    }
    if (!isManualCoordOp(f.op)) continue;
    const members = memberList(f.value);
    if (members.length === 0) continue;
    coords.push({ axis, members, negate: f.op === "neq" });
  }
  return { record, coords };
}
