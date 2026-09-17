// Versão: 1.1 | Data: 17/09/2026
// v1.1 (17/09/2026): `manualSeriesLabel` — o rótulo de exibição de um ref
//   `manual:<chave>`. Existe porque a série NÃO é um AvailableField: o
//   `fieldLabel` do engine/builder devolveria o ref cru, e a métrica sairia
//   rotulada "Soma · manual:emails_replied" no gráfico. Dono ÚNICO da
//   resolução — builder, engine e validador do import leem daqui.
// A Base manual: números DIGITADOS que se misturam aos registros nas fórmulas
// dos widgets. Existe porque nem toda métrica vale o custo de virar registro —
// "5.261 contas alcançadas por e-mail em agosto" é UM número, não 5.261 linhas.
//
// Dois objetos, e a distinção é load-bearing:
//  * ManualSeries  — o DADO nomeado ("# Emails replied"). A `key` é o <chave>
//    do ref `manual:<chave>` que as fórmulas citam; renomear o rótulo nunca
//    move a chave (mesma razão do presetKey: o ref gravado sobreviveria).
//  * ManualEntry   — o LANÇAMENTO: um valor, um período próprio e, opcional,
//    responsável/operação. Vários lançamentos do mesmo dado SOMAM.
//
// Escopo: GLOBAL por organização, porém OCULTA — não é linha de `data_sources`,
// não tem `record_type` e nunca entra em `widgets.sources`. Por isso não
// aciona `planSourceLegs` nem o par de RPCs de widget (invariante 1): a Base
// manual resolve 100% no ENGINE.
//
// Módulo PURO e client-safe (a UI, o validador da IA e o engine leem daqui).

/** O ref de operando/métrica. `manual:<chave>` — namespace próprio, molde do
 *  `meta:<chave>` (lib/widgets/calc-metrics.ts). */
export const MANUAL_OPERAND_PREFIX = "manual:";

/** Grupo do operando no catálogo agregado (papel do GOAL_GROUP). */
export const MANUAL_GROUP = "Base manual";

/** Mesma regra de slug de `data_sources.key`/`mapping_domains.key`. */
export const MANUAL_KEY_RE = /^[a-z][a-z0-9_]{0,39}$/;

/**
 * Como UM lançamento é contado dentro de uma janela (o período do dashboard,
 * ou o bucket de uma dimensão de data). São quatro respostas legítimas para a
 * mesma pergunta, e a escolha é de quem lança — por isso vive na LINHA.
 */
export type ManualSpread =
  // Vale INTEIRO na janela que contém o início do lançamento.
  | "ancora"
  // Vale INTEIRO em toda janela que TOCA o lançamento (repete por bucket).
  | "intersecao"
  // Vale só quando o lançamento cabe INTEIRO na janela.
  | "contido"
  // valor ÷ dias do lançamento; só os dias dentro da janela contam.
  | "diario";

export const MANUAL_SPREADS: ManualSpread[] = [
  "ancora",
  "intersecao",
  "contido",
  "diario",
];

export const DEFAULT_MANUAL_SPREAD: ManualSpread = "ancora";

/**
 * Dono ÚNICO da frase de cada modo (regra do vocabulário como dado, 10/09/2026):
 * o seletor da UI, o SPEC da IA e as mensagens do validador leem DAQUI. A
 * descrição do `intersecao` diz na cara que ele repete — sem isso vira bug
 * reportado na primeira vez que alguém soma os meses.
 */
export const MANUAL_SPREAD_LABELS: Record<ManualSpread, string> = {
  ancora: "Valor cheio na data de início",
  intersecao: "Valor cheio em todo período que encostar",
  contido: "Valor cheio só se couber inteiro",
  diario: "Distribuir por igual entre os dias",
};

export const MANUAL_SPREAD_HINTS: Record<ManualSpread, string> = {
  ancora:
    "O lançamento conta inteiro no período/coluna que contém a data de início. " +
    "Num gráfico por dia, tudo aparece no primeiro dia.",
  intersecao:
    "O lançamento conta inteiro em CADA período que tocar o intervalo dele. " +
    "Some os meses com cuidado: o mesmo valor pode aparecer mais de uma vez.",
  contido:
    "O lançamento só conta quando o intervalo dele cabe inteiro no período. " +
    "Um recorte de 10 dias zera um lançamento mensal.",
  diario:
    "O valor é dividido pelos dias do lançamento e só os dias dentro do " +
    "período contam. É o modo que transforma um total mensal em série diária.",
};

export function isManualSpread(v: unknown): v is ManualSpread {
  return typeof v === "string" && (MANUAL_SPREADS as string[]).includes(v);
}

/** O dado nomeado. */
export interface ManualSeries {
  id: string;
  key: string;
  label: string;
  default_spread: ManualSpread;
  sort_order: number;
}

/** O lançamento. Datas são `YYYY-MM-DD` de Brasília — o read side inteiro é
 *  prefix-based (invariante 11); nunca `Date` com fuso. */
export interface ManualEntry {
  id: string;
  series_id: string;
  period_start: string;
  period_end: string;
  value: number;
  responsible_id: string | null;
  operation_id: string | null;
  spread: ManualSpread;
  note: string | null;
}

/** O par pronto para o engine: os dados e seus lançamentos. */
export interface ManualBaseData {
  series: ManualSeries[];
  entries: ManualEntry[];
}

export const EMPTY_MANUAL_BASE: ManualBaseData = { series: [], entries: [] };

/** Chave de um ref `manual:<chave>` válido, ou null. Espelho de parseGoalRef. */
export function parseManualRef(ref: string): string | null {
  if (!ref.startsWith(MANUAL_OPERAND_PREFIX)) return null;
  const key = ref.slice(MANUAL_OPERAND_PREFIX.length);
  return MANUAL_KEY_RE.test(key) ? key : null;
}

export function manualRef(key: string): string {
  return `${MANUAL_OPERAND_PREFIX}${key}`;
}

/**
 * Rótulo de exibição de um ref `manual:<chave>`, ou null quando o ref não é
 * manual. Dado inexistente devolve a CHAVE (nunca o ref cru com prefixo): a
 * série pode ter sido excluída depois que o widget foi salvo, e "emails_replied"
 * lê melhor que "manual:emails_replied" num eixo. (v1.1, 17/09/2026)
 */
export function manualSeriesLabel(
  field: string,
  series: ManualSeries[]
): string | null {
  const key = parseManualRef(field);
  if (!key) return null;
  return series.find((s) => s.key === key)?.label ?? key;
}

/**
 * Chave de basis de um operando manual. É o PRÓPRIO ref (molde do `aggif:`,
 * que também é lido direto do ctx) — e é o que faz `foldBasis` somar o valor
 * em subtotais e no Total geral sem nenhuma linha nova: a soma do trimestre é
 * a soma dos meses. Foi por isso que a Base manual virou basis em vez de const
 * abaixado como o `meta:`: meta não pode somar, quantidade pode.
 */
export function isManualBasisKey(key: string): boolean {
  return parseManualRef(key) != null;
}
