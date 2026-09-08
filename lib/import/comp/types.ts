// Versão: 1.0 | Data: 08/09/2026
// Contrato do assistente de IA de REMUNERAÇÃO (padrão §4.17). Duas seções
// OPCIONAIS numa resposta: `plano` (DELTA do comp_plans.config) e `metas`
// (alvos por membro × fator).
//
// O PLANO e o MÊS vêm do seletor da UI, nunca do JSON — mesma regra de "a base
// vem do seletor". E ids NUNCA viajam: membro por display_name, operação por
// nome, fator pelo RÓTULO. Isso não é só estilo — `CompFactor.id` é a chave de
// `inputs.overrides.factors`, de `detailGrouping.byFactor` e, via `metricKey`,
// das linhas de `goals`: deixar a IA emiti-lo convidaria a órfãos em todos os
// meses já lançados. Fator casado por rótulo HERDA o id existente; fator novo
// ganha id no servidor e `metricKey: "__auto__"`, que o savePlan resolve.
import type { WidgetFilter } from "@/lib/widgets/types";

export const COMP_EDIT_FORMAT = "remuneracao-edit";
export const COMP_EDIT_VERSION = 1;

/**
 * Teto do lote de metas. Cada alvo é uma chamada de `saveTarget` — que relê o
 * plano, o canon, os alvos e as taxas — então o lote é serial e caro; sem teto
 * um "preencha o ano todo para o time" viraria centenas de rodadas.
 */
export const MAX_AI_COMP_TARGETS = 100;

/** Fator proposto. Tudo opcional menos o nome: é um DELTA sobre o existente. */
export interface ParsedCompFactor {
  /** Rótulo — a IDENTIDADE do fator neste contrato. */
  nome: string;
  /** Renomear: o casamento continua sendo por `nome` (o rótulo ATUAL). */
  novoNome?: string;
  pesoPct?: number;
  /** Fórmula do realizado em TEXTO estilo planilha (o servidor tokeniza). */
  formulaTexto?: string;
  /** Keys de Base; [] = todas as fontes. */
  fontes?: string[];
  /** Condições do recorte (WidgetFilter[]; `operation_id` é proibido). */
  filtros?: WidgetFilter[];
  /** Ref de campo que identifica o membro no registro (em vez de responsável). */
  campoDeMembro?: string | null;
  moeda?: boolean;
  capPct?: number | null;
  floorPct?: number | null;
  alvoPadrao?: number | null;
  moedaDoAlvo?: string | null;
}

/** Faixa de um bloco de comissão. */
export interface ParsedCompTier {
  aPartirDe: number;
  /** kind "pct": percentual sobre a base. */
  percentual?: number;
  /** kind "flat"/"per_unit": valor em R$. */
  valor?: number;
}

/** Bloco de comissão proposto. Identidade pelo RÓTULO, como o fator. */
export interface ParsedCompCommission {
  nome: string;
  /** Rótulo do fator que DISPARA a faixa. */
  gatilho: string;
  /** "base" = base variável do plano; senão o RÓTULO do fator-base. */
  base: "base" | { fator: string };
  tipo?: "pct" | "flat" | "per_unit";
  /** O que define a faixa: atingimento % (default) ou realizado absoluto. */
  faixaPor?: "attainment" | "realized";
  faixas: ParsedCompTier[];
}

export interface ParsedCompPlan {
  nome?: string;
  ativo?: boolean;
  /** "mes_anterior" = o lançamento de M apura M-1. null = mês do lançamento. */
  apuracao?: "mes_anterior" | null;
  /** Membros por NOME; ausente = não mexe. */
  membros?: string[];
  /** Operações por NOME cujos membros entram; ausente = não mexe. */
  operacoesDeMembros?: string[];
  /** Fatores propostos (delta por rótulo). */
  fatores?: ParsedCompFactor[];
  /** Blocos de comissão — a lista COMPLETA desejada quando presente. */
  comissoes?: ParsedCompCommission[];
  /** Fórmula livre do total em TEXTO; null limpa. */
  formulaTotalTexto?: string | null;
}

/** Uma célula de meta. `valor: null` EXCLUI a linha de goals (nunca target 0). */
export interface ParsedCompTarget {
  membro: string;
  fator: string;
  valor: number | null;
}

export interface ParsedCompEdit {
  plano?: ParsedCompPlan;
  metas?: ParsedCompTarget[];
}

/** Catálogo FRESCO carregado pelo core (na geração E no apply). */
export interface CompEditContext {
  planId: string;
  planName: string;
  /**
   * Estado ATUAL do plano. É o default de `ativo` no merge: sem ele, um delta
   * de `plano` que não fale de "ativo" REATIVARIA um plano desativado —
   * exatamente o tipo de perda silenciosa que o merge existe para evitar.
   */
  planActive: boolean;
  /** Config atual PARSEADA — o delta é mesclado sobre ela. */
  atualJson: string;
  /** Rótulos dos fatores existentes (a identidade do contrato). */
  fatores: { nome: string; pesoPct: number; formulaTexto: string }[];
  /** Rótulos dos blocos de comissão existentes. */
  comissoes: string[];
  /** Membros elegíveis, por nome canônico. */
  membros: { nome: string }[];
  /** Operações ativas, por nome. */
  operacoes: string[];
  /** Keys de Base do catálogo. */
  fontes: string[];
  /** Refs de campo aceitas em `campoDeMembro`/`filtros`, com rótulo. */
  campos: { ref: string; label: string }[];
  /** Moedas habilitadas (aceitas em `moedaDoAlvo`). */
  moedas: string[];
  /** Ano/mês do LANÇAMENTO selecionado na UI (as metas são deste recorte). */
  ano: number;
  mes: number;
}

export type CompEditValidation =
  | { ok: true; value: ParsedCompEdit; warnings: string[] }
  | { ok: false; errors: string[] };
