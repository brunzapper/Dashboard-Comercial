// Versão: 1.1 | Data: 08/09/2026
// v1.1 (08/09/2026): entra o escopo `remuneracao` (contrato remuneracao-edit).
// Metadata PURA dos escopos de IA da Operação — catálogo em código, espelho de
// lib/operacao/cards.ts. Este arquivo é CLIENT-SAFE de propósito: o painel vive
// no layout e precisa do rótulo/gate de papel, enquanto `cards.ts` é
// server-only (importa checkSettingsArea). Os handlers (gate real, contexto,
// prompt, validação, apply, desfazer) ficam em ./handlers.ts, `server-only`.
//
// Escopo novo = entrada aqui + handler lá + a MESMA checklist de cards.ts
// (chave em ORG_FEATURES/AREA_GATES/AREA_FEATURES; a chave de área é
// HISTÓRICA — nunca renomear, os overrides gravados a referenciam).

export interface OperacaoAiScopeMeta {
  /** = chave de ÁREA (AREA_GATES) — também é `operacao_ai_sessions.scope`. */
  key: string;
  /** Título do painel. */
  label: string;
  /** Uma linha explicando o que este escopo sabe fazer. */
  description: string;
  /** Rota que ativa o painel (prefixo do pathname). */
  href: string;
  /**
   * Escrita restrita a admin. A área `remuneracao` NÃO tem gate de papel
   * (AREA_GATES.remuneracao = {}) e a page ramifica para "Minha remuneração":
   * sem esta marca, um vendedor veria um painel de ESCRITA que o servidor
   * recusaria a cada turno.
   */
  adminOnly: boolean;
  /** Placeholder do campo de mensagem — ancora o usuário no que dá para pedir. */
  placeholder: string;
}

export const OPERACAO_AI_SCOPES: OperacaoAiScopeMeta[] = [
  {
    key: "mapeamentos",
    label: "IA dos Mapeamentos",
    description:
      "Classifica os valores pendentes do de-para conversando — mesma prévia e mesma aplicação da tela.",
    href: "/operacao/mapeamentos",
    adminOnly: true,
    placeholder:
      "Ex.: classifique os cargos pendentes; o que parecer estágio vai para Júnior.",
  },
  {
    key: "remuneracao",
    label: "IA da Remuneração",
    description:
      "Ajusta fatores, pesos, faixas de comissão e metas do plano aberto — sempre com prévia antes de aplicar.",
    href: "/operacao/remuneracao",
    adminOnly: true,
    placeholder:
      "Ex.: crie um fator de reuniões com peso 30% e defina meta de 50 mil para a Maria.",
  },
];

/** Escopo cujo `href` casa com o pathname atual (mais específico primeiro). */
export function scopeForPath(
  pathname: string,
  scopes: OperacaoAiScopeMeta[] = OPERACAO_AI_SCOPES
): OperacaoAiScopeMeta | null {
  const match = scopes
    .filter((s) => pathname === s.href || pathname.startsWith(`${s.href}/`))
    .sort((a, b) => b.href.length - a.href.length);
  return match[0] ?? null;
}
