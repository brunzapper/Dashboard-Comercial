// Versão: 1.0 | Data: 18/09/2026
// v1.0 (18/09/2026): FAMÍLIAS da Base manual — o mesmo número repartido.
//
// O problema que isto resolve: a Base manual (0142) é uma lista PLANA, e vários
// lançamentos do mesmo dado SOMAM. Só que "Total de interações: 1000", "por
// canal: 500 ligação + 500 e-mail" e "por responsável: 200 Paulo + 400
// Gabriella + 350 Daniela + 50 sem responsável direto" são QUATRO LEITURAS DO
// MESMO 1000 — lançar as quatro na base plana daria 3500.
//
// Três conceitos, e a distinção é load-bearing:
//  * FAMÍLIA   — um eixo categórico ("Canal"). É da ORGANIZAÇÃO e reutilizável:
//    a dimensão `manualdim:canal` tem UM significado no dashboard inteiro, e é
//    isso que permite um gráfico repartir dois dados diferentes pelo mesmo eixo.
//  * MEMBRO    — um valor do eixo ("Ligação"). A ORDEM (`sort_order`) é a ordem
//    das barras no gráfico.
//  * COORDENADA — o que UM lançamento endereça: `{ "canal": "ligacao" }`.
//
// E o conceito que faz tudo funcionar: o NÍVEL de um lançamento é o CONJUNTO de
// famílias que ele endereça (as chaves de `coords`). A regra, em `levels.ts`:
// **níveis NUNCA somam entre si**.
//
// As chaves de família e de membro são IMUTÁVEIS, pela mesma razão do
// `manual_series.key` e do `presetKey`: a família é citada por
// `manualdim:<chave>` numa dimensão gravada e o membro é citado no VALOR de um
// filtro gravado. Renomear o rótulo é livre; mover a chave orfanaria em
// silêncio.
//
// Módulo PURO e client-safe (a UI, o validador da IA e o engine leem daqui).

import { MANUAL_KEY_RE } from "./types";

/**
 * O ref de DIMENSÃO/FILTRO de uma família. Namespace PRÓPRIO, separado do
 * `manual:` das métricas — e os dois NÃO colidem: `"manualdim:canal"` não
 * começa com `"manual:"` (o caractere no índice 6 é `d`, não `:`), então
 * `parseManualRef` devolve null para um eixo e `isManualBasisKey` diz false.
 * A não-colisão está pinada em `families.test.ts`: é a defesa contra alguém
 * "simplificar" um dos dois prefixos depois.
 *
 * A separação é semântica, não cosmética: `manual:<dado>` é uma MÉTRICA (e
 * nunca dimensão/filtro/coluna); `manualdim:<familia>` é dimensão e filtro (e
 * nunca métrica nem operando).
 */
export const MANUAL_AXIS_PREFIX = "manualdim:";

/** Grupo das famílias nos dropdowns de dimensão e de filtro. */
export const MANUAL_FAMILY_GROUP = "Famílias da Base manual";

/**
 * As famílias EMBUTIDAS. Elas NÃO são linhas de `manual_families`: vivem aqui,
 * como o registry em CÓDIGO de `mapping_domains` (0119), então não há linha a
 * semear por organização nem trigger de "indeletável".
 *
 * A diferença que as torna especiais é que os membros delas JÁ existem no
 * sistema (responsáveis e operações de verdade) e a coordenada é ESPELHADA nas
 * colunas `responsible_id`/`operation_id` do lançamento. É isso que faz o
 * número digitado casar com as linhas de REGISTRO numa dimensão "por
 * responsável" — e o dobramento apelido→principal (0101) vale para ele de
 * graça, porque quem projeta é o plano `responsible` de sempre.
 *
 * `dimField` é a dimensão de widget que as endereça: elas NÃO têm ref
 * `manualdim:` próprio, porque a dimensão de registro já existe e criar um
 * segundo ref para o mesmo eixo faria um gráfico "por responsável" divergir de
 * outro só pela escolha do ref.
 */
export const BUILTIN_MANUAL_FAMILIES = [
  { key: "responsavel", label: "Responsável", dimField: "responsible_id" },
  { key: "operacao", label: "Operação", dimField: "operation_id" },
] as const;

export type BuiltinManualFamilyKey =
  (typeof BUILTIN_MANUAL_FAMILIES)[number]["key"];

export function isBuiltinManualFamily(key: string): boolean {
  return BUILTIN_MANUAL_FAMILIES.some((f) => f.key === key);
}

/** A chave de família embutida que uma dimensão de registro endereça. */
export function builtinFamilyOfDimField(field: string): string | null {
  return BUILTIN_MANUAL_FAMILIES.find((f) => f.dimField === field)?.key ?? null;
}

/**
 * O rótulo de uma família, embutida ou cadastrada. Usado onde só se tem a
 * CHAVE (a declaração por dado guarda chave, não id).
 */
export function familyLabelOfKey(
  key: string,
  families: readonly ManualFamily[]
): string {
  const builtin = BUILTIN_MANUAL_FAMILIES.find((f) => f.key === key);
  if (builtin) return builtin.label;
  return families.find((f) => f.key === key)?.label ?? key;
}

/** Uma família cadastrada. */
export interface ManualFamily {
  id: string;
  key: string;
  label: string;
  sort_order: number;
}

/** Um membro de uma família. */
export interface ManualFamilyMember {
  id: string;
  family_id: string;
  key: string;
  label: string;
  sort_order: number;
}

/**
 * O catálogo dos EIXOS, como os consumidores de fórmula precisam dele: as
 * famílias, os membros e a DECLARAÇÃO por dado.
 *
 * A declaração é o que limita a emissão dos operandos com escopo. Sem ela
 * seriam dados × famílias × membros — e a maior parte dessas combinações não
 * existe (um dado de mensageria não se reparte por "Segmento").
 */
export interface ManualAxisCatalog {
  families: ManualFamily[];
  members: ManualFamilyMember[];
  /** `series_id` → chaves de família declaradas. */
  declarations: Record<string, string[]>;
}

export const EMPTY_MANUAL_AXIS_CATALOG: ManualAxisCatalog = {
  families: [],
  members: [],
  declarations: {},
};

/**
 * O que um lançamento endereça: chave de família → chave de membro.
 *
 * As duas formas de "vazio" são DIFERENTES e a distinção é a feature inteira:
 *  * chave AUSENTE  — o lançamento não endereça essa família (outro nível);
 *  * valor `null`   — o lançamento endereça o RESIDUAL dela ("sem responsável
 *    direto" é um grupo legítimo de 50, não a ausência de informação).
 *
 * `{"resp": null}` e `{}` são valores jsonb DISTINTOS no Postgres, então o
 * índice único os trata como slots diferentes sem nenhum sentinela de texto.
 * Em TypeScript a distinção só sobrevive se ninguém escrever `coords[axis]`
 * cru — use `coordDeclares` (a chave existe?) e `coordMember` (qual membro?),
 * que são os ÚNICOS acessores. `if (!coords[axis])` trataria o residual como
 * ausente, e é o bug mais fácil de deixar passar em review.
 */
export type ManualCoords = Record<string, string | null>;

export const EMPTY_MANUAL_COORDS: ManualCoords = {};

/** Chave de família de um ref `manualdim:<chave>` válido, ou null. */
export function parseManualAxisRef(ref: string): string | null {
  if (!ref.startsWith(MANUAL_AXIS_PREFIX)) return null;
  const key = ref.slice(MANUAL_AXIS_PREFIX.length);
  return MANUAL_KEY_RE.test(key) ? key : null;
}

export function manualAxisRef(key: string): string {
  return `${MANUAL_AXIS_PREFIX}${key}`;
}

export function isManualAxisRef(ref: string): boolean {
  return parseManualAxisRef(ref) != null;
}

/**
 * Rótulo de um ref `manualdim:<chave>`, ou null quando o ref não é de família.
 * Dono ÚNICO — a família NÃO é um `AvailableField`, então o `fieldLabel` do
 * engine/construtor devolveria o ref cru e o eixo sairia "manualdim:canal".
 * Precedente exato do `manualSeriesLabel`, incluindo o fallback: família
 * inexistente devolve a CHAVE (ela pode ter sido excluída depois que o widget
 * foi salvo, e "canal" lê melhor que "manualdim:canal" num eixo).
 */
export function manualFamilyLabel(
  ref: string,
  families: readonly ManualFamily[]
): string | null {
  const key = parseManualAxisRef(ref);
  if (!key) return null;
  return families.find((f) => f.key === key)?.label ?? key;
}

/**
 * O rótulo do RESIDUAL de uma família. "Sem Canal" é um GRUPO, e por isso
 * nunca pode sair como "—", que a tela inteira usa para "não sei" — os 50 sem
 * responsável direto são um número conhecido.
 */
export function manualResidualLabel(familyLabel: string): string {
  return `Sem ${familyLabel}`;
}

/** A família existe? (usado para recusar eixo desconhecido em runtime.) */
export function manualFamilyByKey(
  key: string,
  families: readonly ManualFamily[]
): ManualFamily | null {
  return families.find((f) => f.key === key) ?? null;
}

/** Os membros de uma família, na ordem de exibição. */
export function manualMembersOf(
  familyKey: string,
  families: readonly ManualFamily[],
  members: readonly ManualFamilyMember[]
): ManualFamilyMember[] {
  const fam = manualFamilyByKey(familyKey, families);
  if (!fam) return [];
  return members
    .filter((m) => m.family_id === fam.id)
    .slice()
    .sort(
      (a, b) =>
        a.sort_order - b.sort_order || a.label.localeCompare(b.label, "pt-BR")
    );
}

/**
 * Rótulo de exibição de UM valor de eixo. `member` null é o residual.
 * Membro desconhecido devolve a própria chave (mesma regra do fallback acima).
 */
export function manualMemberLabel(
  familyKey: string,
  member: string | null,
  families: readonly ManualFamily[],
  members: readonly ManualFamilyMember[]
): string {
  const fam = manualFamilyByKey(familyKey, families);
  if (member == null) return manualResidualLabel(fam?.label ?? familyKey);
  if (!fam) return member;
  return (
    members.find((m) => m.family_id === fam.id && m.key === member)?.label ??
    member
  );
}

/** O lançamento endereça esta família? (chave presente, valor podendo ser null.) */
export function coordDeclares(coords: ManualCoords, axis: string): boolean {
  return Object.prototype.hasOwnProperty.call(coords, axis);
}

/**
 * O membro endereçado, ou null — que significa RESIDUAL quando
 * `coordDeclares` é true, e "família não declarada" quando é false. Os dois
 * casos são diferentes e só `coordDeclares` os separa.
 */
export function coordMember(coords: ManualCoords, axis: string): string | null {
  return coordDeclares(coords, axis) ? coords[axis] ?? null : null;
}

/**
 * O NÍVEL: as famílias que o lançamento endereça, em ordem determinística.
 * Derivado das coordenadas, nunca gravado numa coluna própria.
 */
export function entryLevel(coords: ManualCoords): string[] {
  return Object.keys(coords).sort();
}

/** Identidade de um nível, para chave de `Map` e desempate determinístico. */
export function manualLevelKey(axes: readonly string[]): string {
  return axes.slice().sort().join("|");
}

/**
 * Serialização canônica das coordenadas. Só EM MEMÓRIA (chave de `Map` e
 * identidade de linha na grade): no banco quem canonicaliza é o próprio jsonb,
 * que normaliza ordem de chaves, espaços e duplicatas — foi por isso que a
 * coluna `coords` pôde entrar direto no índice único, sem uma coluna
 * denormalizada com dever de espelho entre SQL e TypeScript.
 *
 * O residual (`null`) serializa diferente de um membro chamado "" porque a
 * chave de membro nunca é vazia (`MANUAL_KEY_RE` exige a primeira letra).
 */
export function manualCoordsKey(coords: ManualCoords): string {
  const keys = Object.keys(coords).sort();
  return keys.map((k) => `${k}=${coords[k] ?? ""}`).join("|");
}

/**
 * Saneamento na ENTRADA (o loader e o validador da IA). Fail-closed por chave:
 * o que não é chave válida com valor string/null simplesmente não existe — uma
 * coordenada suja não pode derrubar a base inteira (mesma leniência do parse
 * de `detailGrouping`).
 */
export function parseManualCoords(raw: unknown): ManualCoords {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return EMPTY_MANUAL_COORDS;
  }
  const out: ManualCoords = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!MANUAL_KEY_RE.test(k)) continue;
    if (v == null) {
      out[k] = null;
      continue;
    }
    if (typeof v !== "string") continue;
    if (!MANUAL_KEY_RE.test(v)) continue;
    out[k] = v;
  }
  return out;
}
