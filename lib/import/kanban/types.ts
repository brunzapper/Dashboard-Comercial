// Versão: 1.0 | Data: 07/09/2026
// Contrato do assistente de IA do QUADRO KANBAN (padrão §4.17). Duas seções
// OPCIONAIS numa resposta: `quadro` (delta de KanbanSettings) e `automacoes`
// (lista COMPLETA de regras). O ALVO — widget ou board dedicado — vem SEMPRE
// da UI, nunca do JSON; ids de regra também não viajam (o casamento é por
// NOME, no molde do contrato de operações).
//
// Serve as duas superfícies do mesmo tipo: a página `/kanbans/[id]` (board
// `kind='kanban'`, config em `dashboards.settings.kanban`) e a página cheia do
// widget `/kanbans/w/[widgetId]` (`widgets.settings.kanban`). O widget DENTRO
// de um dashboard já é coberto pelo import de dashboard (§4.11).
import type { AutomationRule } from "@/lib/kanban/automations/types";
import type { KanbanSettings } from "@/lib/kanban/types";

export const KANBAN_CONFIG_FORMAT = "kanban-config";
export const KANBAN_CONFIG_VERSION = 1;

/**
 * Teto de regras por resposta. O engine já tem o seu (MAX_ACTIONS_PER_RUN =
 * 200 AÇÕES por quadro/rodada); este é o do LOTE — quantas regras a IA pode
 * (re)escrever de uma vez.
 */
export const MAX_AI_AUTOMATION_RULES = 20;

/** Uma regra proposta. `id` NUNCA vem do JSON — o apply casa por nome. */
export interface ParsedAutomationRule {
  nome: string;
  ativa: boolean;
  /** Ordem de avaliação (0-based, na ordem em que vieram no array). */
  posicao: number;
  rule: AutomationRule;
}

export interface ParsedKanbanConfig {
  /** Delta de KanbanSettings já saneado; ausente = não mexe no quadro. */
  quadro?: KanbanSettings;
  /**
   * Lista COMPLETA das regras desejadas; ausente = não mexe nas automações.
   * Presente = o apply reconcilia (cria/atualiza/reordena o que veio, DESATIVA
   * o que sumiu — nunca exclui: excluir é da UI, precedente de operações).
   */
  automacoes?: ParsedAutomationRule[];
}

/** Catálogo FRESCO carregado pelo core (na geração E no apply). */
export interface KanbanConfigContext {
  /** Config atual do quadro (o delta é mesclado sobre ela no apply). */
  atual: KanbanSettings;
  /** Rótulo do quadro, só para o prompt. */
  quadroLabel: string;
  /** Keys de Base/Sub-base do catálogo efetivo. */
  sourceKeys: string[];
  /** Keys de Base RAIZ (métrica `linked` e refs `match:` só aceitam raiz). */
  rootSourceKeys: string[];
  /** Refs de campo aceitas em groupField/card/filtros, com rótulo. */
  fields: { ref: string; label: string }[];
  /** Refs GRAVÁVEIS pela ação `set_field` (mesma régua de setFieldTargetError). */
  settableFields: { ref: string; label: string }[];
  /** Options dos campos seleção (picker de valor das condições): ref → options. */
  selectOptionsByField: Record<string, string[]>;
  /** Colunas atuais do quadro (alvo de `move_to_column`), na ordem exibida. */
  columns: { key: string; label: string }[];
  /** Regras já cadastradas, na ordem de avaliação. */
  automacoes: { nome: string; ativa: boolean }[];
}

export type KanbanConfigValidation =
  | { ok: true; value: ParsedKanbanConfig; warnings: string[] }
  | { ok: false; errors: string[] };
