// Versão: 1.0 | Data: 31/07/2026
// Contrato do assistente de IA de OPERAÇÕES (padrão §4.17): lote de até 15
// ações declarativas (criar/editar/vincular/desvincular) identificadas por
// NOME — ids NUNCA vêm do JSON (o validador resolve contra o catálogo; 0
// hits lista os cadastrados, >1 = ambiguidade). Sem ação de EXCLUSÃO (fica
// na UI — destrutivo: cascade em vínculos/metas). Operações AUTOMÁTICAS de
// parceria (auto_source_record_id) são intocáveis (invariante 22).
import type { WidgetFilter } from "@/lib/widgets/types";

export const OPERATIONS_EDIT_FORMAT = "operacoes-edit";
export const OPERATIONS_EDIT_VERSION = 1;
export const MAX_AI_OPERATION_ACTIONS = 15;

/**
 * Alvo de operação resolvido: existente (id do banco) ou criada NESTE lote
 * (índice da ação `criar` correspondente — o apply troca pelo id devolvido
 * por createOperation na hora).
 */
export type OperationTargetRef =
  | { kind: "existente"; id: string; nome: string }
  | { kind: "nova"; index: number; nome: string };

export interface ParsedOperationCreate {
  acao: "criar";
  nome: string;
  pai: OperationTargetRef | null; // null = raiz
  perfil?: WidgetFilter[];
}

export interface ParsedOperationEdit {
  acao: "editar";
  alvo: { id: string; nome: string }; // sempre EXISTENTE (nova ⇒ ajuste o criar)
  novoNome?: string;
  // undefined = não mexe; null = vira raiz; ref = novo pai.
  novoPai?: OperationTargetRef | null;
  ativa?: boolean;
  // undefined = não mexe; null = limpar; lista = substitui INTEIRA.
  perfil?: WidgetFilter[] | null;
}

export interface ParsedOperationLink {
  acao: "vincular";
  responsavel: { id: string; nome: string };
  operacao: OperationTargetRef;
  prioridade: number; // inteiro >= 1 (1 = primária)
}

export interface ParsedOperationUnlink {
  acao: "desvincular";
  responsavel: { id: string; nome: string };
  operacao: { id: string; nome: string }; // vínculo só existe com EXISTENTE
}

export type ParsedOperationAction =
  | ParsedOperationCreate
  | ParsedOperationEdit
  | ParsedOperationLink
  | ParsedOperationUnlink;

/** Catálogo carregado pelo core (contexto FRESCO na geração E no apply). */
export interface OperationsEditContext {
  operations: {
    id: string;
    name: string;
    parentId: string | null;
    active: boolean;
    auto: boolean; // auto_source_record_id não-nulo — intocável pela IA
  }[];
  responsibles: { id: string; name: string; active: boolean }[];
  links: { responsibleId: string; operationId: string; priority: number }[];
  // Refs aceitas em `perfil[].field` (CORE_FIELDS + `custom:<field_key>`).
  profileFields: string[];
  // Keys aceitas em `perfil[].sources`.
  sourceKeys: string[];
}

export type OperationsEditValidation =
  | { ok: true; actions: ParsedOperationAction[]; warnings: string[] }
  | { ok: false; errors: string[] };
