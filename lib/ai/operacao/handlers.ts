// Versão: 1.1 | Data: 08/09/2026
// v1.1 (08/09/2026): handler do escopo `remuneracao` (delega a
// lib/ai/comp-plan.ts — plano por savePlan, metas por saveTarget).
// Handlers SERVER-ONLY dos escopos de IA da Operação. Um handler é a ponte
// entre o painel genérico (session.ts) e o núcleo de cada área — ele NÃO
// implementa validação nem escrita: delega aos cores que já existem, que já
// seguem o padrão §4.17 (validam, devolvem prévia, re-validam no apply e
// escrevem só pelos choke points).
//
// `restore` é OPCIONAL: escopo sem Desfazer devolve `hasUndo:false` e a UI diz
// isso, em vez de simular um undo que não desfaz o efeito colateral.
import "server-only";

import {
  applyMappingsClassifyCore,
  buildMappingsPromptCore,
  generateMappingsCore,
  previewMappingsCore,
} from "@/lib/ai/classify-mappings";
import {
  applyCompEditCore,
  buildCompPromptCore,
  formatCompTarget,
  generateCompEditCore,
  parseCompTarget,
  previewCompEditCore,
  restoreCompSnapshotCore,
  type CompUndoSnapshot,
} from "@/lib/ai/comp-plan";
import { serializeMappingsClassify } from "@/lib/import/mappings/validate";
import { OPERACAO_AI_SCOPES, type OperacaoAiScopeMeta } from "./scopes";

/** Resultado de um turno/prévia, já no vocabulário do painel. */
export interface ScopeTurnResult {
  ok: boolean;
  message?: string;
  errors?: string[];
  /** JSON canônico da proposta — vai para `pending.json` da sessão. */
  json?: string;
  summary?: string[];
  warnings?: string[];
}

export interface ScopeApplyResult {
  ok: boolean;
  message?: string;
  errors?: string[];
  appliedCount?: number;
  /** Snapshot pré-apply; ausente = este escopo não oferece Desfazer. */
  snapshot?: unknown;
}

export interface OperacaoAiHandler {
  meta: OperacaoAiScopeMeta;
  /**
   * O sub-alvo desta conversa (domínio, plano…), vindo da UI. Devolve null
   * quando o valor recebido não serve — o painel pede para escolher na tela.
   */
  normalizeTarget(target: string): string | null;
  /** Um turno de conversa. */
  turn(input: {
    target: string;
    description: string;
    priorTurns: string[];
    pendingJson?: string;
  }): Promise<ScopeTurnResult>;
  /** Valida um JSON colado (IA externa) — mesma prévia, sem IA. */
  preview(target: string, raw: string): Promise<ScopeTurnResult>;
  /** Texto do "Copiar prompt" — o MESMO system do chat. */
  buildPrompt(target: string): Promise<{ ok: boolean; prompt?: string; message?: string }>;
  /** Aplica a proposta (re-valida com contexto FRESCO lá dentro). */
  apply(target: string, raw: string): Promise<ScopeApplyResult>;
  /** Desfazer. Ausente = escopo sem undo. */
  restore?(snapshot: unknown): Promise<{ ok: boolean; message?: string }>;
}

function metaOf(key: string): OperacaoAiScopeMeta {
  const meta = OPERACAO_AI_SCOPES.find((s) => s.key === key);
  if (!meta) throw new Error(`Escopo de IA da Operação desconhecido: ${key}`);
  return meta;
}

// ---------------------------------------------------------------- mapeamentos
// Reuso PURO do núcleo de lib/ai/classify-mappings.ts: zero contrato novo, zero
// validador novo. O sheet "Classificar com IA" da tela continua existindo — ele
// é a porta do fluxo offline (CSV/colar) e da prévia editável célula a célula;
// o painel é a porta conversacional. Mesmo core, duas superfícies.
//
// SEM Desfazer no v1 (`restore` ausente): o apply grava as entradas E
// materializa os campos nos registros (applyValueMappings, service role) e
// sincroniza a tarefa de pendências. Um undo fiel exigiria reaplicar o domínio
// inteiro; um parcial deixaria os registros com o espelho antigo — pior que
// não ter.
const mapeamentos: OperacaoAiHandler = {
  meta: metaOf("mapeamentos"),
  normalizeTarget: (target) => (target.trim() ? target.trim() : null),
  async turn(input) {
    const res = await generateMappingsCore({
      domainKey: input.target,
      description: input.description,
      priorTurns: input.priorTurns,
      pendingJson: input.pendingJson,
    });
    return {
      ok: res.ok,
      message: res.message,
      errors: res.errors,
      json: res.items ? serializeMappingsClassify(input.target, res.items) : undefined,
      summary: res.summary,
      warnings: res.warnings,
    };
  },
  async preview(target, raw) {
    const res = await previewMappingsCore(target, raw);
    return {
      ok: res.ok,
      message: res.message,
      errors: res.errors,
      json: res.items ? serializeMappingsClassify(target, res.items) : undefined,
      summary: res.summary,
      warnings: res.warnings,
    };
  },
  buildPrompt: (target) => buildMappingsPromptCore(target),
  async apply(target, raw) {
    const res = await applyMappingsClassifyCore(target, raw);
    return {
      ok: res.ok,
      message: res.message,
      errors:
        res.errors ??
        (res.failed ?? []).map((f) => `${f.rawValue}: ${f.message}`),
      appliedCount: res.appliedCount,
    };
  },
};

// ---------------------------------------------------------------- remuneração
// O alvo é o recorte que a UI tem aberto — "<planId>:<ano>-<mes>" — e ele
// NUNCA vem do JSON: é o que garante que uma prévia gerada com o plano X não
// seja aplicada no plano Y depois de o usuário trocar de pill (o apply da
// sessão ainda confere o alvo gravado no `pending`).
//
// COM Desfazer: o snapshot pré-apply guarda o plano inteiro e o valor ANTERIOR
// de cada meta tocada, e o restore reescreve pelos MESMOS choke points. A
// ressalva honesta é a métrica de meta de um fator novo: `registerGoalMetrics`
// é aditivo, então ela permanece no catálogo (o restore diz isso).
const remuneracao: OperacaoAiHandler = {
  meta: metaOf("remuneracao"),
  normalizeTarget: (target) => {
    const t = parseCompTarget(target);
    return t ? formatCompTarget(t) : null;
  },
  async turn(input) {
    const t = parseCompTarget(input.target);
    if (!t) return { ok: false, message: "Selecione um plano e um mês na tela." };
    const res = await generateCompEditCore({
      target: t,
      description: input.description,
      priorTurns: input.priorTurns,
      pendingJson: input.pendingJson,
    });
    return res;
  },
  async preview(target, raw) {
    const t = parseCompTarget(target);
    if (!t) return { ok: false, message: "Selecione um plano e um mês na tela." };
    return previewCompEditCore(t, raw);
  },
  async buildPrompt(target) {
    const t = parseCompTarget(target);
    if (!t) return { ok: false, message: "Selecione um plano e um mês na tela." };
    return buildCompPromptCore(t);
  },
  async apply(target, raw) {
    const t = parseCompTarget(target);
    if (!t) return { ok: false, message: "Selecione um plano e um mês na tela." };
    return applyCompEditCore(t, raw);
  },
  restore: (snapshot) =>
    restoreCompSnapshotCore(snapshot as CompUndoSnapshot),
};

const HANDLERS: OperacaoAiHandler[] = [mapeamentos, remuneracao];

export function handlerFor(scope: string): OperacaoAiHandler | null {
  return HANDLERS.find((h) => h.meta.key === scope) ?? null;
}
