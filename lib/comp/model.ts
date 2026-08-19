// Versão: 1.7 | Data: 17/08/2026
// v1.7: CompDetailGrouping virou `byFactor[factorId] = { into, folded }` — o
// bloco PRINCIPAL que recebe os operandos dobrados. O shape anterior
// (`separateByFactor`, chaves com bloco próprio) tornava a engrenagem inerte
// num fator de 2 operandos: desmarcar UM deixava um sobrando (grupo de um = o
// próprio bloco) e desmarcar os dois esvaziava a lista, que o save descartava.
// Entrada com `folded` vazio cai no parse — "nada a dobrar" é o padrão, e
// guardá-la recriaria essa ambiguidade. `separateByFactor` fica só-leitura: a
// conversão mora em groupOperands, que tem a lista de operandos.
// Versão: 1.6 | Data: 01/08/2026
// v1.6: MEMÓRIA DE CÁLCULO no breakdown de comissão — CompCommissionBlockBreakdown
// ganha campos DERIVADOS na leitura (basis/basisLabel/basisMoney/triggerLabel/
// triggerMoney/memberTiersApplied); nada persiste (computed segue snapshot cru)
// e o agregado `commission`/espelho ficam intocados. Rótulos pt-BR da memória
// vivem SÓ em lib/comp/commission-label.ts (grade + my-comp-view).
// v1.5: RECORTE DO FATOR com UI (factor.filters) — parse endurecido: op
// restrito aos 10 operadores de UI de FILTER_OPS (internos eq_ci/*_num
// rejeitados), `in` normalizado p/ array de strings (string legada com
// vírgulas aceita), ops sem valor perdem o valor, `sources` por-filtro é
// DESCARTADO (factor.sources já define o universo da consulta) e teto
// MAX_FACTOR_FILTERS. O engine aplica os filtros ANTES do filtro de membro,
// na MESMA consulta (pipeline completo de runCalculatedWidget).
// v1.4: APURAÇÃO SOBRE O MÊS ANTERIOR (config.apuracao: "mes_anterior") — o
// lançamento do mês M (pagamento) apura realizado/metas/taxas sobre M-1.
// Contrato anti-dupla-conversão: year/month nas assinaturas públicas é SEMPRE
// o mês do LANÇAMENTO; o deslocamento acontece via apuracaoRef DENTRO dos
// loaders do engine (loadTargetsByMember/loadTargetRatesForConfig) e nos
// pontos únicos do recompute/saveTarget — call sites nunca passam mês já
// deslocado. Entry (period_year/month), espelho e navegação ficam em M.
// `mes_corrente` no raw é NORMALIZADO para ausência da chave (compat).
// v1.3: comissão MULTI-BLOCO (config.commissions[]; legado `commission` é
// NORMALIZADO no parse p/ um bloco id "comissao" — o tipo parseado expõe SÓ
// `commissions`), kinds de faixa pct/flat/per_unit, seleção por atingimento OU
// por realizado absoluto (tierBy), match de membro por campo do registro
// (factor.memberField — injeção é do ENGINE), alvo padrão do plano
// (factor.defaultTarget — fallback quando não há linha de goals; nunca
// gravado) e alvo em moeda estrangeira (factor.targetCurrency — convertido a
// BRL na LEITURA via targetRates resolvido pelos CALLERS; taxa ausente ⇒
// atingimento null + targetRateMissing, NUNCA 1:1). config.presetKey é a
// identidade de plano criado por preset e SOBREVIVE ao round-trip do save.
// v1.2: membros por OPERAÇÃO (memberOperationIds) — helpers puros
// resolveOperationMembers/explicitMemberIds combinam manual ∪ operações; a
// resolução opId→ids canônicos é dos CALLERS (loadOperationScopes + canon).
// Modelo PURO da remuneração variável (0112). Um plano (comp_plans.config,
// jsonb versionado — parse FAIL-CLOSED, padrão kanban_automations) define
// fatores com peso %, fórmula AGREGADA (realizado computado pelo engine via
// runCalculatedWidget — nunca aqui), vínculo `metricKey` com o registry de
// metas (alvos são LINHAS de `goals`, scope 'responsible', id canônico) e,
// opcionalmente, uma fórmula LIVRE de total que compõe as MESMAS variáveis
// efetivas (sincronia total com a estrutura padrão).
// v1.1: comissão por FAIXAS de atingimento (config.commission) — % sobre uma
// base (base variável ou realizado de um fator) escolhida pelo atingimento
// EFETIVO do fator gatilho; tabela por membro (memberTiers) vence a do plano.
// O cálculo é NATIVO em computeEntry (nunca fórmula gerada — override por
// membro não caberia numa fórmula por plano) e a fórmula livre compõe via
// ref `comp:comissao` (sem soma automática, semântica do comp:bonus).
// computeEntry deriva o detalhamento NA LEITURA: efetivo = manual ?? calculado
// em cada variável — recompute regrava só o snapshot CRU (computed.realized) e
// nunca toca os overrides; editar peso/base/override atualiza tudo sem
// re-consulta. A fórmula livre avalia SÓ por evaluateFormula sobre o mapa
// `comp:*` montado aqui — nunca parser/avaliador paralelo (invariante 26).
import {
  evaluateFormula,
  type Formula,
  type FormulaToken,
} from "@/lib/records/formulas";
import type { OperandRef } from "@/lib/records/date-operands";
import type { FilterOp, WidgetFilter } from "@/lib/widgets/types";
import { FILTER_OPS, opHasNoValue } from "@/lib/widgets/filter-ops";
import { DEFAULT_PERIOD_FIELD, type DashboardPeriod } from "@/lib/widgets/period";
import type { SourceDef } from "@/lib/sources";

// Tetos de sanidade do jsonb (a UI limita antes; o parse rejeita acima).
export const MAX_FACTORS = 12;
export const MAX_BONUSES = 20;
export const MAX_TOTAL_FORMULA_TOKENS = 200;
export const MAX_COMMISSION_TIERS = 12; // por tabela (plano ou membro)
export const MAX_COMMISSION_MEMBER_OVERRIDES = 400;
export const MAX_COMMISSION_BLOCKS = 6;
export const MAX_FACTOR_FILTERS = 12;

/** Fator do plano: componente ponderado da remuneração. */
export interface CompFactor {
  id: string; // estável (chave de overrides/targets) — NUNCA regenerar no save
  label: string;
  weightPct: number; // peso literal (Σ não precisa dar 100)
  // Chave no registry goal_metrics (sync_config): os ALVOS por pessoa×mês são
  // linhas de `goals` com esta métrica — a área Metas gerencia os mesmos.
  metricKey: string;
  money: boolean; // formata alvo/realizado como R$ (senão número puro)
  formula: Formula; // fórmula AGREGADA do realizado (contexto "aggregate")
  sources: string[]; // fontes do recorte ([] = todas as fontes)
  // Recorte extra do fator (condições em E), editado no plan-editor. Só os 10
  // operadores de UI (FILTER_OPS); `in` é array de strings; `sources`
  // por-filtro não existe aqui (factor.sources define o universo). O ENGINE
  // aplica ANTES do filtro de membro, na MESMA consulta.
  filters?: WidgetFilter[];
  capPct?: number; // teto do atingimento CALCULADO (override manual ignora)
  floorPct?: number; // piso idem
  // Ref de campo (ex. "custom:sdr_reuniao") que identifica o MEMBRO no
  // registro por NOME em vez de responsible_id. A injeção do filtro (op `in`
  // com os display_names do grupo canônico do membro) é do ENGINE — aqui só o
  // contrato. Ausente = filtro responsible_id eq (comportamento clássico).
  memberField?: string;
  // Alvo padrão do mês quando NÃO há linha de goals p/ membro×mês (meta "por
  // sub-operação"). Fallback de LEITURA — nunca vira linha de goals; digitar
  // na célula grava um goal (override), limpar deleta e volta ao padrão.
  defaultTarget?: number;
  // Moeda em que alvo/defaultTarget são DIGITADOS (ex. "USD"). Conversão a
  // BRL acontece na LEITURA (computeEntry) pela taxa do trimestre passada
  // pelos callers (targetRates); ausente = BRL (sem conversão).
  targetCurrency?: string;
}

/** Tipo de payout de um bloco de comissão. */
export type CompTierKind = "pct" | "flat" | "per_unit";

/**
 * Faixa de um bloco. `fromPct` (nome mantido p/ compat de JSON) é o limiar
 * "a partir de" na UNIDADE do tierBy do bloco (atingimento % OU realizado
 * absoluto). kind "pct" usa `ratePct` (% sobre a base); "flat" usa `amount`
 * (R$ fixo); "per_unit" usa `amount` (R$ × realizado do fator-base).
 */
export interface CompCommissionTier {
  fromPct: number; // >= 0; estritamente crescente dentro da tabela
  ratePct?: number; // kind "pct": >= 0 (0 = faixa que zera)
  amount?: number; // kind "flat"/"per_unit": >= 0
}

/**
 * Bloco de comissão por faixas: o valor EFETIVO do gatilho (atingimento pós
 * override/cap/floor, ou realizado efetivo quando tierBy "realized") escolhe
 * a faixa (maior `fromPct` satisfeito vence, `>=`); o payout segue o kind —
 * % sobre a base (variável ou realizado EFETIVO de um fator), R$ fixo, ou R$
 * por unidade do realizado do fator-base (per_unit EXIGE basisKind "factor").
 * `memberTiers` (id CANÔNICO) substitui a tabela inteira do plano para aquele
 * membro; entrada órfã (membro fora do plano) nunca é selecionada e nunca é
 * podada no save (memberIds vazio = "todos os ativos", que muda).
 */
export interface CompCommissionBlock {
  id: string; // estável (chave de breakdown/labels) — NUNCA regenerar no save
  label?: string;
  triggerFactorId: string;
  basisKind: "base" | "factor";
  basisFactorId?: string; // obrigatório sse basisKind === "factor"
  tierBy?: "attainment" | "realized"; // default "attainment"
  kind?: CompTierKind; // default "pct"
  tiers: CompCommissionTier[]; // >= 1
  memberTiers?: Record<string, CompCommissionTier[]>;
}

/** Um fator: qual bloco RECEBE e o que foi dobrado nele. */
export interface CompFactorGrouping {
  /** Chave de basis do operando cujo bloco recebe os dobrados. */
  into: string;
  /** Chaves de basis somadas dentro do `into` (nunca vazio — ver o parse). */
  folded: string[];
}

/**
 * Apresentação do DETALHAMENTO por registro (lib/comp/detail.ts), por PLANO —
 * vale para todos os membros, porque a fórmula é do plano. Governa só o
 * AGRUPAMENTO dos blocos; o recorte de cada operando é intocado.
 *
 * `byFactor[factorId]` diz quem RECEBE (`into`) e o que entra nele (`folded`);
 * operando fora dos dois mantém bloco próprio. Fator ausente = padrão (cada
 * operando no seu bloco).
 *
 * Entrada com `folded` vazio é DESCARTADA no parse: "nada a dobrar" é o
 * padrão, e guardar a chave vazia recriaria a ambiguidade que tornou a 1ª
 * versão inerte (lista vazia lida como "sem configuração").
 *
 * `separateByFactor` é o formato LEGADO da 1ª versão (chaves com bloco
 * próprio). Só leitura: `groupOperands` o converte usando a lista de operandos
 * — que o parse não tem — para `into` = 1ª listada, `folded` = as demais.
 */
export interface CompDetailGrouping {
  byFactor: Record<string, CompFactorGrouping>;
  separateByFactor?: Record<string, string[]>;
}

export interface CompPlanConfig {
  v: 1;
  factors: CompFactor[];
  // Responsáveis (ids CANÔNICOS) inscritos; ausente/vazio = todos os ativos.
  memberIds?: string[];
  // Operações (ids de `operations`) cujos membros entram no plano: subárvore
  // VIVA de responsible_operations, canonicalizada e intersectada com os
  // ativos pelo CALLER (resolução é I/O — loadOperationScopes; o parse é
  // puro). PRESENÇA da chave ⇒ lista explícita SEMPRE (mesmo resolvendo
  // vazio — nunca cair no "todos os ativos": parceria profile-only não pode
  // inflar o plano em silêncio).
  memberOperationIds?: string[];
  // Fórmula LIVRE do total (operandos comp:*). Ausente/null = composição
  // estruturada: base × Σ(peso% × ating%) + bônus.
  totalFormula?: Formula | null;
  // Blocos de comissão por faixas (opcional; ausente/vazio = sem comissão).
  // O jsonb legado `commission` (objeto único, v1.1) é NORMALIZADO no parse
  // para um bloco `{id:"comissao", kind:"pct", tierBy:"attainment", ...}` —
  // o tipo parseado expõe SÓ esta chave.
  commissions?: CompCommissionBlock[];
  // Agrupamento dos blocos do detalhamento (engrenagem da Visão geral).
  // Ausente = cada operando em bloco próprio. Como o `presetKey`, precisa ser
  // preservado explicitamente no parse E re-emitido pelo save do editor.
  detailGrouping?: CompDetailGrouping;
  // Identidade de plano criado por PRESET (ensure-only no apply). O parse a
  // preserva explicitamente para que o round-trip do save do editor não a
  // derrube (senão o re-apply do preset duplicaria o plano).
  presetKey?: string;
  // Janela de apuração: "mes_anterior" = o lançamento do mês M calcula
  // realizado/metas/taxas sobre M-1 (paga em Julho o realizado de Junho).
  // Ausente = mês do próprio lançamento (compat; "mes_corrente" no raw é
  // normalizado para ausência). Desloca APENAS a leitura de dados — entry,
  // espelho e navegação seguem no mês de pagamento M.
  apuracao?: "mes_anterior";
}

/** Override manual das variáveis derivadas de um fator (efetivo = manual ?? calculado). */
export interface CompFactorOverride {
  realized?: number;
  attainmentPct?: number;
  payout?: number;
}

export interface CompBonus {
  id: string;
  label: string;
  amount: number;
}

/** comp_entries.inputs — SEM targets (alvos vivem em goals). */
export interface CompEntryInputs {
  overrides: {
    factors: Record<string, CompFactorOverride>;
    commission?: number;
    total?: number;
  };
  bonuses: CompBonus[];
  note?: string;
}

/** comp_entries.computed — snapshot CRU do recompute (nunca derivados). */
export interface CompComputedRaw {
  v: 1;
  at: string; // ISO do recompute
  realized: Record<string, number | null>; // por fator (null = sem valor)
  errors?: Record<string, string>; // falha de consulta por fator
  // Janela APURADA no recompute (mês de referência do realizado). Ausente em
  // snapshots legados — a UI deriva via apuracaoRef(config) como fallback.
  ref?: { year: number; month: number };
}

/** Detalhamento efetivo de um fator (derivado na leitura). */
export interface CompFactorBreakdown {
  target: number | null; // na unidade DIGITADA (targetCurrency do fator)
  realized: number | null;
  attainmentPct: number | null;
  payout: number;
  overridden: { realized: boolean; attainmentPct: boolean; payout: boolean };
  // De onde saiu o alvo: linha de goals, defaultTarget do plano, ou nenhum.
  targetSource: "goal" | "default" | null;
  // Alvo convertido a BRL (== target sem targetCurrency); null quando não há
  // alvo OU a taxa da moeda falta (targetRateMissing).
  targetBRL: number | null;
  // targetCurrency presente + alvo digitado + taxa ausente ⇒ true (atingimento
  // fica null — fail-closed, nunca converter 1:1).
  targetRateMissing?: boolean;
}

/** Detalhamento de UM bloco de comissão (sempre o CALCULADO — override é só na soma). */
export interface CompCommissionBlockBreakdown {
  blockId: string;
  label: string; // label do bloco ?? "Comissão N"
  value: number;
  tier: CompCommissionTier | null; // faixa satisfeita (null = nenhuma)
  triggerValue: number | null; // valor EFETIVO usado na seleção (na unidade do tierBy)
  tierBy: "attainment" | "realized";
  kind: CompTierKind;
  // Memória de cálculo (derivada na leitura — nunca persistida). `basis` é o
  // multiplicando efetivo do payout; null em kind "flat" (nada é multiplicado).
  basis: number | null;
  basisLabel: string | null; // "Base variável" | label do fator-base; null em flat
  basisMoney: boolean; // formata basis como R$ (base variável ou fator money)
  triggerLabel: string; // label do fator gatilho (fallback: id)
  triggerMoney: boolean; // tierBy "realized" com fator gatilho money ⇒ limiar/gatilho em R$
  memberTiersApplied: boolean; // a tabela de faixas do MEMBRO venceu a do plano
}

/**
 * Detalhamento AGREGADO da comissão (derivado na leitura). `value` = manual
 * (override da SOMA) ?? Σ dos blocos; `tier`/`triggerAttainmentPct` só quando
 * há exatamente UM bloco (senão null — o detalhe fica em commissionBlocks).
 */
export interface CompCommissionBreakdown {
  value: number; // efetivo = manual ?? calculado
  tier: CompCommissionTier | null; // faixa satisfeita (null = nenhuma/multi-bloco)
  triggerAttainmentPct: number | null; // gatilho EFETIVO (null em multi-bloco)
  overridden: boolean;
}

/** Detalhamento efetivo da linha (responsável×mês). */
export interface CompBreakdown {
  base: number;
  byFactor: Record<string, CompFactorBreakdown>;
  factorsTotal: number;
  // Um item por bloco de config.commissions (ordem do config); vazio = sem comissão.
  commissionBlocks: CompCommissionBlockBreakdown[];
  // null = plano sem comissão (a coluna/linha não existe na UI).
  commission: CompCommissionBreakdown | null;
  bonusTotal: number;
  // null = fórmula livre presente com resultado inválido (div/0, ref ausente).
  total: number | null;
  totalOverridden: boolean;
  totalFromFormula: boolean;
  totalFormulaError: boolean;
  weightSumPct: number; // p/ o badge "Σ pesos" (sem normalização silenciosa)
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function finiteOrNull(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** Arredondamento de dinheiro (2 casas) — só no nível payout/total. */
export function roundMoney(v: number): number {
  return Math.round((v + Number.EPSILON) * 100) / 100;
}

// Operadores aceitos no recorte do fator: SEMPRE derivado de FILTER_OPS
// (nunca lista paralela) — os internos do RPC (eq_ci/*_num/in_ci) ficam fora.
const UI_FILTER_OPS = new Set<string>(FILTER_OPS.map((o) => o.op));

const isScalar = (v: unknown): v is string | number | boolean =>
  typeof v === "string" || typeof v === "number" || typeof v === "boolean";

function parseFilter(raw: unknown): WidgetFilter | null {
  if (!isRecord(raw)) return null;
  const { field, op } = raw;
  if (typeof field !== "string" || field === "") return null;
  if (typeof op !== "string" || !UI_FILTER_OPS.has(op)) return null;
  const filterOp = op as FilterOp;
  // `sources` por-filtro é descartado de propósito: o universo da consulta do
  // fator é factor.sources — alvo por-filtro não acrescenta expressividade.
  if (opHasNoValue(filterOp)) return { field, op: filterOp };
  if (filterOp === "in") {
    // Array de escalares (pickers) ou string legada com vírgulas (digitação).
    const list = Array.isArray(raw.value)
      ? raw.value.every(isScalar)
        ? raw.value.map((v) => String(v).trim()).filter(Boolean)
        : null
      : typeof raw.value === "string"
        ? raw.value
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean)
        : null;
    if (!list || list.length === 0) return null;
    return { field, op: filterOp, value: list };
  }
  if (!isScalar(raw.value)) return null;
  return { field, op: filterOp, value: raw.value };
}

// Fórmula persistida: exige o shape {tokens:[...]} com tokens-objeto. A
// validação semântica (refs/estrutura) é do validateFormulaForContext no save;
// aqui só o contrato estrutural (fail-closed p/ jsonb adulterado).
function parseFormula(raw: unknown, maxTokens?: number): Formula | null {
  if (!isRecord(raw) || !Array.isArray(raw.tokens)) return null;
  if (raw.tokens.length === 0) return null;
  if (maxTokens != null && raw.tokens.length > maxTokens) return null;
  for (const t of raw.tokens) {
    if (!isRecord(t) || typeof t.kind !== "string") return null;
  }
  const out: Formula = { tokens: raw.tokens as FormulaToken[] };
  if (typeof raw.source === "string") out.source = raw.source;
  return out;
}

function parseFactor(raw: unknown): CompFactor | null {
  if (!isRecord(raw)) return null;
  const { id, label, metricKey } = raw;
  if (typeof id !== "string" || id === "") return null;
  if (typeof label !== "string" || label.trim() === "") return null;
  if (typeof metricKey !== "string" || metricKey === "") return null;
  const weightPct = finiteOrNull(raw.weightPct);
  if (weightPct == null || weightPct < 0) return null;
  const formula = parseFormula(raw.formula);
  if (!formula) return null;
  const sourcesRaw = Array.isArray(raw.sources) ? raw.sources : [];
  const sources: string[] = [];
  for (const s of sourcesRaw) {
    if (typeof s !== "string" || s === "") return null;
    sources.push(s);
  }
  const capPct = finiteOrNull(raw.capPct);
  const floorPct = finiteOrNull(raw.floorPct);
  if (capPct != null && floorPct != null && floorPct > capPct) return null;
  if (raw.memberField != null && (typeof raw.memberField !== "string" || raw.memberField === ""))
    return null;
  const defaultTarget = raw.defaultTarget != null ? finiteOrNull(raw.defaultTarget) : undefined;
  if (defaultTarget === null || (defaultTarget != null && defaultTarget < 0)) return null;
  if (
    raw.targetCurrency != null &&
    (typeof raw.targetCurrency !== "string" || !/^[A-Z]{3}$/.test(raw.targetCurrency))
  )
    return null;
  const out: CompFactor = {
    id,
    label: label.trim(),
    weightPct,
    metricKey,
    money: raw.money !== false, // default true
    formula,
    sources,
  };
  if (raw.filters != null) {
    if (!Array.isArray(raw.filters)) return null;
    if (raw.filters.length > MAX_FACTOR_FILTERS) return null;
    const filters: WidgetFilter[] = [];
    for (const f of raw.filters) {
      const parsed = parseFilter(f);
      if (!parsed) return null;
      filters.push(parsed);
    }
    if (filters.length > 0) out.filters = filters;
  }
  if (capPct != null) out.capPct = capPct;
  if (floorPct != null) out.floorPct = floorPct;
  if (typeof raw.memberField === "string" && raw.memberField !== "")
    out.memberField = raw.memberField;
  if (defaultTarget != null) out.defaultTarget = defaultTarget;
  if (typeof raw.targetCurrency === "string" && raw.targetCurrency !== "")
    out.targetCurrency = raw.targetCurrency;
  return out;
}

// Tabela de faixas: >= 1, fromPct >= 0 estritamente crescente (cobre
// ordenação E duplicata num só check); a coluna de valor depende do kind —
// "pct" exige ratePct >= 0, "flat"/"per_unit" exigem amount >= 0.
function parseTiers(raw: unknown, kind: CompTierKind): CompCommissionTier[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  if (raw.length > MAX_COMMISSION_TIERS) return null;
  const out: CompCommissionTier[] = [];
  let prev = -Infinity;
  for (const t of raw) {
    if (!isRecord(t)) return null;
    const fromPct = finiteOrNull(t.fromPct);
    if (fromPct == null || fromPct < 0 || fromPct <= prev) return null;
    prev = fromPct;
    if (kind === "pct") {
      const ratePct = finiteOrNull(t.ratePct);
      if (ratePct == null || ratePct < 0) return null;
      out.push({ fromPct, ratePct });
    } else {
      const amount = finiteOrNull(t.amount);
      if (amount == null || amount < 0) return null;
      out.push({ fromPct, amount });
    }
  }
  return out;
}

// Bloco de comissão: FAIL-CLOSED (referência a fator fantasma computaria
// silenciosamente errado — espírito da invariante 26; o editor valida antes
// com mensagem própria, aqui é a muralha contra jsonb adulterado).
// `forcedId` injeta a identidade do bloco LEGADO (`commission` sem `id`).
function parseCommissionBlock(
  raw: unknown,
  factorIds: Set<string>,
  forcedId?: string
): CompCommissionBlock | null {
  if (!isRecord(raw)) return null;
  const id = forcedId ?? raw.id;
  if (typeof id !== "string" || id === "") return null;
  const { triggerFactorId, basisKind } = raw;
  if (typeof triggerFactorId !== "string" || !factorIds.has(triggerFactorId))
    return null;
  if (basisKind !== "base" && basisKind !== "factor") return null;
  if (raw.kind != null && raw.kind !== "pct" && raw.kind !== "flat" && raw.kind !== "per_unit")
    return null;
  const kind: CompTierKind = (raw.kind as CompTierKind | undefined) ?? "pct";
  if (raw.tierBy != null && raw.tierBy !== "attainment" && raw.tierBy !== "realized")
    return null;
  const tierBy = (raw.tierBy as "attainment" | "realized" | undefined) ?? "attainment";
  // per_unit multiplica o realizado do fator-base — sem fator-base não há
  // "unidade"; exigir basisKind "factor" aqui evita config que computaria 0
  // em silêncio.
  if (kind === "per_unit" && basisKind !== "factor") return null;
  // O bloco parseado é CANÔNICO: kind/tierBy sempre explícitos (defaults
  // resolvidos aqui, nunca nos consumidores).
  const out: CompCommissionBlock = {
    id,
    triggerFactorId,
    basisKind,
    tierBy,
    kind,
    tiers: [],
  };
  if (typeof raw.label === "string" && raw.label.trim() !== "")
    out.label = raw.label.trim();
  if (basisKind === "factor") {
    const b = raw.basisFactorId;
    if (typeof b !== "string" || !factorIds.has(b)) return null;
    out.basisFactorId = b;
  }
  const tiers = parseTiers(raw.tiers, kind);
  if (!tiers) return null;
  out.tiers = tiers;
  if (raw.memberTiers != null) {
    if (!isRecord(raw.memberTiers)) return null;
    const entries = Object.entries(raw.memberTiers);
    if (entries.length > MAX_COMMISSION_MEMBER_OVERRIDES) return null;
    const memberTiers: Record<string, CompCommissionTier[]> = {};
    for (const [mid, t] of entries) {
      if (mid === "") return null;
      const parsed = parseTiers(t, kind);
      if (!parsed) return null;
      memberTiers[mid] = parsed;
    }
    if (entries.length > 0) out.memberTiers = memberTiers;
  }
  return out;
}

/**
 * Parse FAIL-CLOSED de comp_plans.config: qualquer estrutura fora do contrato
 * (v errado, fator sem id/fórmula, peso não-numérico, floor>cap, ids
 * duplicados, totalFormula acima do teto, comissão apontando fator
 * inexistente…) retorna null — o chamador exibe "Configuração do plano
 * inválida", nunca "roda como der".
 */
export function parseCompPlanConfig(raw: unknown): CompPlanConfig | null {
  if (!isRecord(raw) || raw.v !== 1) return null;
  const factorsRaw = Array.isArray(raw.factors) ? raw.factors : null;
  if (!factorsRaw || factorsRaw.length > MAX_FACTORS) return null;
  const factors: CompFactor[] = [];
  const seen = new Set<string>();
  for (const f of factorsRaw) {
    const parsed = parseFactor(f);
    if (!parsed || seen.has(parsed.id)) return null;
    seen.add(parsed.id);
    factors.push(parsed);
  }
  const out: CompPlanConfig = { v: 1, factors };
  if (Array.isArray(raw.memberIds)) {
    const ids: string[] = [];
    for (const m of raw.memberIds) {
      if (typeof m !== "string" || m === "") return null;
      ids.push(m);
    }
    if (ids.length > 0) out.memberIds = ids;
  }
  if (Array.isArray(raw.memberOperationIds)) {
    const ids: string[] = [];
    for (const m of raw.memberOperationIds) {
      if (typeof m !== "string" || m === "") return null;
      ids.push(m);
    }
    if (ids.length > 0) out.memberOperationIds = ids;
  }
  if (raw.totalFormula != null) {
    const tf = parseFormula(raw.totalFormula, MAX_TOTAL_FORMULA_TOKENS);
    if (!tf) return null;
    out.totalFormula = tf;
  }
  // `commissions` (v1.3) tem precedência; na ausência dela, o objeto legado
  // `commission` (v1.1) é normalizado para UM bloco canônico id "comissao" —
  // comportamento byte-idêntico (pct × atingimento) e migração preguiçosa no
  // próximo save (que persiste o parseado).
  if (raw.commissions != null) {
    if (!Array.isArray(raw.commissions)) return null;
    if (raw.commissions.length > MAX_COMMISSION_BLOCKS) return null;
    const blocks: CompCommissionBlock[] = [];
    const blockIds = new Set<string>();
    for (const b of raw.commissions) {
      const parsed = parseCommissionBlock(b, seen);
      if (!parsed || blockIds.has(parsed.id)) return null;
      blockIds.add(parsed.id);
      blocks.push(parsed);
    }
    if (blocks.length > 0) out.commissions = blocks;
  } else if (raw.commission != null) {
    const c = parseCommissionBlock(raw.commission, seen, "comissao");
    if (!c) return null;
    out.commissions = [c];
  }
  if (raw.presetKey != null) {
    if (typeof raw.presetKey !== "string" || raw.presetKey === "") return null;
    out.presetKey = raw.presetKey;
  }
  // Agrupamento do detalhamento: LENIENTE (diferente do resto do config).
  // É preferência de apresentação — entrada torta deve cair sozinha, nunca
  // invalidar o plano e travar o cálculo da remuneração de todo mundo.
  if (isRecord(raw.detailGrouping)) {
    const keyList = (v: unknown): string[] =>
      Array.isArray(v)
        ? [...new Set(v.filter((k): k is string => typeof k === "string" && k !== ""))]
        : [];
    const byFactor: Record<string, CompFactorGrouping> = {};
    if (isRecord(raw.detailGrouping.byFactor)) {
      for (const [fid, entry] of Object.entries(raw.detailGrouping.byFactor)) {
        if (!seen.has(fid) || !isRecord(entry)) continue; // fator sumiu: órfã cai
        const into = entry.into;
        if (typeof into !== "string" || into === "") continue;
        // Dobrar o principal em si mesmo não existe; e `folded` vazio é o
        // padrão, não uma configuração — a entrada inteira cai.
        const folded = keyList(entry.folded).filter((k) => k !== into);
        if (folded.length > 0) byFactor[fid] = { into, folded };
      }
    }
    const legacy: Record<string, string[]> = {};
    if (isRecord(raw.detailGrouping.separateByFactor)) {
      for (const [fid, keys] of Object.entries(raw.detailGrouping.separateByFactor)) {
        if (!seen.has(fid) || byFactor[fid]) continue; // shape novo vence o legado
        const list = keyList(keys);
        if (list.length > 0) legacy[fid] = list;
      }
    }
    if (Object.keys(byFactor).length > 0 || Object.keys(legacy).length > 0) {
      out.detailGrouping = {
        byFactor,
        ...(Object.keys(legacy).length > 0 ? { separateByFactor: legacy } : {}),
      };
    }
  }
  if (raw.apuracao != null) {
    // "mes_corrente" é aceito no raw mas normalizado para AUSÊNCIA da chave
    // (config canônico — o save do editor e o backfill ficam idempotentes).
    if (raw.apuracao !== "mes_anterior" && raw.apuracao !== "mes_corrente")
      return null;
    if (raw.apuracao === "mes_anterior") out.apuracao = "mes_anterior";
  }
  return out;
}

/**
 * Parse LENIENTE (por chave) de comp_entries.inputs: valor inválido cai, o
 * resto sobrevive — um override corrompido nunca derruba a linha inteira.
 */
export function parseCompEntryInputs(raw: unknown): CompEntryInputs {
  const out: CompEntryInputs = { overrides: { factors: {} }, bonuses: [] };
  if (!isRecord(raw)) return out;
  const ov = isRecord(raw.overrides) ? raw.overrides : {};
  if (isRecord(ov.factors)) {
    for (const [fid, v] of Object.entries(ov.factors)) {
      if (!isRecord(v)) continue;
      const entry: CompFactorOverride = {};
      const realized = finiteOrNull(v.realized);
      const attainmentPct = finiteOrNull(v.attainmentPct);
      const payout = finiteOrNull(v.payout);
      if (realized != null) entry.realized = realized;
      if (attainmentPct != null) entry.attainmentPct = attainmentPct;
      if (payout != null) entry.payout = payout;
      if (Object.keys(entry).length > 0) out.overrides.factors[fid] = entry;
    }
  }
  const commission = finiteOrNull(ov.commission);
  if (commission != null) out.overrides.commission = commission;
  const total = finiteOrNull(ov.total);
  if (total != null) out.overrides.total = total;
  if (Array.isArray(raw.bonuses)) {
    for (const b of raw.bonuses) {
      if (out.bonuses.length >= MAX_BONUSES) break;
      if (!isRecord(b)) continue;
      const amount = finiteOrNull(b.amount);
      if (typeof b.id !== "string" || b.id === "") continue;
      if (typeof b.label !== "string") continue;
      if (amount == null) continue;
      out.bonuses.push({ id: b.id, label: b.label, amount });
    }
  }
  if (typeof raw.note === "string" && raw.note !== "") out.note = raw.note;
  return out;
}

// Clamp do atingimento CALCULADO (override manual vale verbatim — manual é
// manual; o cap/floor existe p/ domar a derivação, não a exceção).
function clampAtt(att: number | null, factor: CompFactor): number | null {
  if (att == null) return null;
  let v = att;
  if (factor.capPct != null && v > factor.capPct) v = factor.capPct;
  if (factor.floorPct != null && v < factor.floorPct) v = factor.floorPct;
  return v;
}

/** Refs da fórmula livre de total (prefixo comp:f: evita colidir com comp:base). */
export function compFactorRef(
  factorId: string,
  kind: "realizado" | "alvo" | "ating" | "valor"
): string {
  return `comp:f:${factorId}:${kind}`;
}

/**
 * Achata os membros resolvidos das operações do plano: ordem do config →
 * ordem do array resolvido; dedup por id. `operationMembersById` já vem
 * CANONICALIZADO do caller (operationMembersFromScopes no server); operação
 * ausente do mapa (excluída/sem resolução) contribui zero.
 */
export function resolveOperationMembers(
  memberOperationIds: string[] | undefined,
  operationMembersById: Record<string, string[]>
): string[] {
  if (!memberOperationIds || memberOperationIds.length === 0) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const opId of memberOperationIds) {
    for (const id of operationMembersById[opId] ?? []) {
      if (seen.has(id)) continue;
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}

/**
 * Lista EXPLÍCITA de membros do plano (manuais ∪ operações, ordem manual
 * primeiro, dedup) ou null = "todos os ativos". `memberOperationIds` presente
 * ⇒ NUNCA null, mesmo resolvendo vazio (fail-closed — o plano fica sem
 * membros em vez de virar "empresa inteira" em silêncio).
 */
export function explicitMemberIds(
  config: CompPlanConfig,
  operationMemberIds: string[]
): string[] | null {
  const manual = config.memberIds ?? [];
  const hasOps = (config.memberOperationIds?.length ?? 0) > 0;
  if (manual.length === 0 && !hasOps) return null;
  const out: string[] = [];
  const seen = new Set<string>();
  for (const id of [...manual, ...operationMemberIds]) {
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

export const COMP_BASE_REF = "comp:base";
export const COMP_BONUS_REF = "comp:bonus";
export const COMP_FACTORS_REF = "comp:fatores";
export const COMP_COMMISSION_REF = "comp:comissao";

/**
 * Tabela de faixas efetiva de um membro num BLOCO: a própria (memberTiers)
 * substitui a do plano INTEIRA; sem memberId (ou sem override) vale a do
 * plano.
 */
export function resolveCommissionTiers(
  block: CompCommissionBlock,
  memberId?: string | null
): CompCommissionTier[] {
  if (memberId && block.memberTiers?.[memberId]) return block.memberTiers[memberId];
  return block.tiers;
}

/**
 * Faixa satisfeita: maior `fromPct` com valor >= fromPct (limiar exato
 * entra). `value` está na unidade do tierBy do bloco (atingimento % ou
 * realizado absoluto). Abaixo da menor faixa, ou valor null, nenhuma (⇒ 0).
 */
export function selectCommissionTier(
  tiers: CompCommissionTier[],
  value: number | null
): CompCommissionTier | null {
  if (value == null) return null;
  let best: CompCommissionTier | null = null;
  for (const t of tiers) {
    if (value >= t.fromPct && (best == null || t.fromPct > best.fromPct))
      best = t;
  }
  return best;
}

/** Moedas de alvo usadas pelo config (dedup) — insumo do resolveTargetRates dos callers. */
export function factorTargetCurrencies(config: CompPlanConfig): string[] {
  const out: string[] = [];
  for (const f of config.factors) {
    if (f.targetCurrency && !out.includes(f.targetCurrency)) out.push(f.targetCurrency);
  }
  return out;
}

/**
 * Catálogo de operandos da fórmula livre de total — derivado do config (os
 * operandos aparecem/somem em sincronia com os fatores). Consumido pelo
 * FormulaEditor (context "record") e pela validação do savePlan: MESMO módulo
 * nos dois lados (nunca listas paralelas).
 */
export function compOperandCatalog(config: CompPlanConfig): OperandRef[] {
  const out: OperandRef[] = [];
  for (const f of config.factors) {
    out.push(
      { ref: compFactorRef(f.id, "realizado"), label: `${f.label} — Realizado`, group: "Fatores" },
      { ref: compFactorRef(f.id, "alvo"), label: `${f.label} — Alvo`, group: "Fatores" },
      { ref: compFactorRef(f.id, "ating"), label: `${f.label} — Ating. (%)`, group: "Fatores" },
      { ref: compFactorRef(f.id, "valor"), label: `${f.label} — Valor (R$)`, group: "Fatores" }
    );
  }
  out.push(
    { ref: COMP_BASE_REF, label: "Base variável", group: "Totais" },
    { ref: COMP_BONUS_REF, label: "Total de bônus", group: "Totais" },
    { ref: COMP_FACTORS_REF, label: "Total dos fatores", group: "Totais" }
  );
  // Só com comissão configurada — o operando some/aparece em sincronia, e
  // desligar a comissão com a ref em uso reprova a fórmula no save de graça.
  if ((config.commissions?.length ?? 0) > 0) {
    out.push({
      ref: COMP_COMMISSION_REF,
      label: "Comissão (R$)",
      group: "Totais",
    });
  }
  return out;
}

/**
 * Deriva o detalhamento EFETIVO de uma linha: overrides aplicados variável a
 * variável, cap/floor só no calculado, fórmula livre (se houver) sobre as
 * variáveis já efetivas, e `overrides.total` vencendo tudo nos dois modos.
 * `realized` vem de computed.realized (snapshot cru); `targets` vem de `goals`
 * (chaveado por factorId, já dobrado p/ o responsável canônico — ausência cai
 * no defaultTarget do fator). `memberId` (id CANÔNICO da linha) seleciona a
 * tabela de faixas do membro — ausente, vale a do plano. `targetRates` (moeda
 * → R$/unidade no trimestre do mês) é resolvido pelos CALLERS (computeEntry é
 * puro); fator com targetCurrency e taxa ausente fica com atingimento null +
 * targetRateMissing — NUNCA converte 1:1.
 */
export function computeEntry(
  config: CompPlanConfig,
  baseAmount: number | null | undefined,
  inputs: CompEntryInputs,
  realized: Record<string, number | null>,
  targets: Record<string, number | null>,
  memberId?: string | null,
  targetRates?: Record<string, number | null>
): CompBreakdown {
  const base =
    typeof baseAmount === "number" && Number.isFinite(baseAmount)
      ? baseAmount
      : 0;
  const byFactor: Record<string, CompFactorBreakdown> = {};
  let factorsTotal = 0;
  let weightSumPct = 0;
  for (const f of config.factors) {
    weightSumPct += f.weightPct;
    const ov = inputs.overrides.factors[f.id] ?? {};
    // Alvo efetivo: linha de goals ?? defaultTarget do plano (unidade DIGITADA).
    const goalTarget = targets[f.id] ?? null;
    const target = goalTarget ?? f.defaultTarget ?? null;
    const targetSource: "goal" | "default" | null =
      goalTarget != null ? "goal" : target != null ? "default" : null;
    // Conversão a BRL: sem targetCurrency é identidade; com, exige taxa do
    // caller — ausente/null ⇒ targetBRL null (atingimento null, fail-closed).
    let targetBRL: number | null = target;
    let targetRateMissing = false;
    if (f.targetCurrency && target != null) {
      const rate = targetRates?.[f.targetCurrency];
      if (typeof rate === "number" && Number.isFinite(rate)) {
        targetBRL = target * rate;
      } else {
        targetBRL = null;
        targetRateMissing = true;
      }
    }
    const realizedEff = ov.realized ?? realized[f.id] ?? null;
    const attRaw =
      targetBRL != null && targetBRL !== 0 && realizedEff != null
        ? (realizedEff / targetBRL) * 100
        : null;
    const attEff = ov.attainmentPct ?? clampAtt(attRaw, f);
    const payout =
      ov.payout ??
      (attEff != null
        ? roundMoney(base * (f.weightPct / 100) * (attEff / 100))
        : 0);
    factorsTotal += payout;
    byFactor[f.id] = {
      target,
      realized: realizedEff,
      attainmentPct: attEff,
      payout,
      overridden: {
        realized: ov.realized != null,
        attainmentPct: ov.attainmentPct != null,
        payout: ov.payout != null,
      },
      targetSource,
      targetBRL,
      ...(targetRateMissing ? { targetRateMissing: true } : {}),
    };
  }
  factorsTotal = roundMoney(factorsTotal);
  const bonusTotal = roundMoney(
    inputs.bonuses.reduce((acc, b) => acc + b.amount, 0)
  );

  // Comissão por faixas, um BLOCO por vez: o gatilho EFETIVO (atingimento
  // pós override/cap/floor, ou realizado efetivo quando tierBy "realized" —
  // byFactor já é efetivo) escolhe a faixa; o payout segue o kind. Sem faixa
  // satisfeita ou base ausente ⇒ 0 (nunca fabricar). O override manual é da
  // SOMA (agregado) — os blocos exibem sempre o calculado.
  const blocks = config.commissions ?? [];
  const commissionBlocks: CompCommissionBlockBreakdown[] = [];
  let blocksSum = 0;
  const factorById = new Map(config.factors.map((f) => [f.id, f]));
  blocks.forEach((b, i) => {
    const kind = b.kind ?? "pct";
    const tierBy = b.tierBy ?? "attainment";
    const trigger = byFactor[b.triggerFactorId];
    const triggerValue =
      tierBy === "realized"
        ? (trigger?.realized ?? null)
        : (trigger?.attainmentPct ?? null);
    const tiers = resolveCommissionTiers(b, memberId);
    const tier = selectCommissionTier(tiers, triggerValue);
    const basis =
      b.basisKind === "base"
        ? base
        : (byFactor[b.basisFactorId ?? ""]?.realized ?? null);
    let value = 0;
    if (tier != null) {
      if (kind === "flat") {
        value = roundMoney(tier.amount ?? 0);
      } else if (kind === "per_unit") {
        value = basis != null ? roundMoney((tier.amount ?? 0) * basis) : 0;
      } else {
        value = basis != null ? roundMoney(basis * ((tier.ratePct ?? 0) / 100)) : 0;
      }
    }
    blocksSum += value;
    const basisFactor = factorById.get(b.basisFactorId ?? "");
    const triggerFactor = factorById.get(b.triggerFactorId);
    commissionBlocks.push({
      blockId: b.id,
      label: b.label ?? `Comissão ${i + 1}`,
      value,
      tier,
      triggerValue,
      tierBy,
      kind,
      basis: kind === "flat" ? null : basis,
      basisLabel:
        kind === "flat"
          ? null
          : b.basisKind === "base"
            ? "Base variável"
            : (basisFactor?.label ?? b.basisFactorId ?? null),
      basisMoney:
        kind !== "flat" &&
        (b.basisKind === "base" || (basisFactor?.money ?? false)),
      triggerLabel: triggerFactor?.label ?? b.triggerFactorId,
      triggerMoney: tierBy === "realized" && (triggerFactor?.money ?? false),
      memberTiersApplied: Boolean(memberId && b.memberTiers?.[memberId]),
    });
  });
  let commission: CompCommissionBreakdown | null = null;
  if (blocks.length > 0) {
    const ovCommission = inputs.overrides.commission;
    const single = commissionBlocks.length === 1 ? commissionBlocks[0] : null;
    commission = {
      value: ovCommission ?? roundMoney(blocksSum),
      tier: single?.tier ?? null,
      triggerAttainmentPct:
        single && single.tierBy === "attainment" ? single.triggerValue : null,
      overridden: ovCommission != null,
    };
  }
  const commissionValue = commission?.value ?? 0;

  let totalComputed: number | null;
  let totalFromFormula = false;
  let totalFormulaError = false;
  if (config.totalFormula) {
    totalFromFormula = true;
    const ctx: Record<string, number | null> = {
      [COMP_BASE_REF]: base,
      [COMP_BONUS_REF]: bonusTotal,
      [COMP_FACTORS_REF]: factorsTotal,
    };
    // Sem soma automática no modo fórmula — a fórmula compõe explicitamente
    // (mesma semântica do comp:bonus); ref presente só com comissão ativa.
    if (commission != null) ctx[COMP_COMMISSION_REF] = commission.value;
    for (const f of config.factors) {
      const b = byFactor[f.id];
      ctx[compFactorRef(f.id, "realizado")] = b.realized;
      ctx[compFactorRef(f.id, "alvo")] = b.target;
      ctx[compFactorRef(f.id, "ating")] = b.attainmentPct;
      ctx[compFactorRef(f.id, "valor")] = b.payout;
    }
    const r = evaluateFormula(config.totalFormula, ctx);
    if (typeof r === "number" && Number.isFinite(r)) {
      totalComputed = roundMoney(r);
    } else {
      totalComputed = null;
      totalFormulaError = true;
    }
  } else {
    totalComputed = roundMoney(factorsTotal + commissionValue + bonusTotal);
  }

  const totalOverridden = inputs.overrides.total != null;
  const total = totalOverridden ? (inputs.overrides.total as number) : totalComputed;
  return {
    base,
    byFactor,
    factorsTotal,
    commissionBlocks,
    commission,
    bonusTotal,
    total,
    totalOverridden,
    totalFromFormula,
    totalFormulaError,
    weightSumPct,
  };
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

export function lastDayOfMonth(year: number, month: number): number {
  // Dia 0 do mês seguinte em UTC — imune a fuso/DST do runtime.
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * Mês APURADO de um lançamento: recebe o mês do LANÇAMENTO (pagamento) e
 * devolve o mês de referência dos dados — M-1 quando o plano apura sobre o
 * mês anterior (rollover de ano incluso), o próprio M caso contrário.
 * Este helper é o ÚNICO ponto de deslocamento (aplicado dentro dos loaders
 * do engine e nos pontos únicos de recompute/saveTarget — nunca em call
 * sites, que sempre falam o mês do lançamento; ver contrato no topo).
 */
export function apuracaoRef(
  year: number,
  month: number,
  config: Pick<CompPlanConfig, "apuracao">
): { year: number; month: number } {
  if (config.apuracao !== "mes_anterior") return { year, month };
  return month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 };
}

/**
 * Período do mês (semântica da barra do dashboard): bounds YYYY-MM-DD +
 * `fieldBySource` cobrindo TODAS as fontes do catálogo (raízes e subs) pela
 * coluna de data padrão de cada uma — sem isso a perna de uma fonte cujo
 * default não é `closed_at` perderia registros em silêncio.
 */
export function monthPeriod(
  year: number,
  month: number,
  catalog: SourceDef[]
): DashboardPeriod {
  const fieldBySource: Record<string, string> = {};
  for (const s of catalog) {
    fieldBySource[s.key] = s.defaultPeriodField || DEFAULT_PERIOD_FIELD;
  }
  return {
    field: DEFAULT_PERIOD_FIELD,
    from: `${year}-${pad2(month)}-01`,
    to: `${year}-${pad2(month)}-${pad2(lastDayOfMonth(year, month))}`,
    fieldBySource,
  };
}
