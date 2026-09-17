// Versão: 1.1 | Data: 17/09/2026
// v1.1 (17/09/2026): a ESCADA do Gemini (GEMINI_MODEL_LADDER) e o catálogo de
//   sugestões atualizado. Duas coisas motivaram:
//
//   1. Sobrecarga é do MODELO, não da chave — quando o degrau atual satura, o
//      anterior costuma responder. A escada é o que o rebaixamento
//      (lib/ai/model-fallback.ts) percorre; ela mora AQUI porque é catálogo,
//      e catálogo de modelo já era responsabilidade deste arquivo.
//   2. A lista de sugestões ainda oferecia `gemini-2.0-flash`, que o Google
//      DESLIGOU. Quem salvasse a sugestão levava 404 não-retentável em TODAS
//      as superfícies de IA ao mesmo tempo — e 404 não rebaixa, de propósito
//      (é erro de configuração, e mascarar um nome errado é pior).
// Catálogo (puro, client-safe) de provedores e modelos SUGERIDOS por provedor.
// As listas são só atalhos de UI — o campo de modelo aceita valor livre, então
// não travam o usuário numa versão específica. O 1º item de cada lista é o
// default sugerido ao trocar de provedor. Comece pelo Gemini (plano gratuito);
// Claude/OpenAI ficam prontos para migração futura.

import type { AiProvider } from "./types";

export const AI_PROVIDER_LABELS: Record<AiProvider, string> = {
  gemini: "Google Gemini",
  claude: "Anthropic Claude",
  openai: "OpenAI",
};

/**
 * Modelos de TEXTO estáveis do Gemini em ordem de LANÇAMENTO (mais novo →
 * mais antigo), com a data ao lado para o próximo a mexer aqui não precisar
 * conferir no Google.
 *
 * É cronológica, e só cronológica: um degrau pode ser mais capaz que o
 * anterior (`gemini-3.5-flash-lite` saiu DEPOIS de `gemini-3.5-flash`).
 * Não reordene por "tamanho" nem por preço — a regra pedida é "a próxima
 * inferior por ordem de lançamento", e reordenar mudaria em silêncio o que o
 * rebaixamento faz.
 *
 * Só ESTÁVEIS: modelo `-preview` é retirado sem aviso, e um degrau que virou
 * 404 gasta uma rodada da escada à toa.
 */
export const GEMINI_MODEL_LADDER = [
  "gemini-3.8-flash", // 02/09/2026
  "gemini-3.7-flash", // 13/08/2026
  "gemini-3.6-flash", // 21/07/2026
  "gemini-3.5-flash-lite", // 21/07/2026
  "gemini-3.5-flash", // 19/05/2026
  "gemini-3.1-flash-lite", // 07/05/2026
  "gemini-2.5-pro", // 17/06/2025
  "gemini-2.5-flash", // 17/06/2025
  "gemini-2.5-flash-lite", // 22/07/2025
] as const;

/** Modelos tentados por CHAMADA: o configurado + os rebaixamentos. */
export const GEMINI_MODEL_ATTEMPTS = 3;

export const AI_MODELS_BY_PROVIDER: Record<AiProvider, string[]> = {
  // Sugestões = um recorte da escada (o teste de models fiscaliza que são
  // subconjunto dela): o mais novo, o Pro para quem quer raciocínio mais
  // pesado, e um lite para quem quer volume barato.
  gemini: ["gemini-3.8-flash", "gemini-2.5-pro", "gemini-3.5-flash-lite"],
  claude: ["claude-opus-4-8", "claude-sonnet-5", "claude-haiku-4-5"],
  openai: ["gpt-5", "gpt-5-mini", "gpt-4.1"],
};

export const DEFAULT_AI_PROVIDER: AiProvider = "gemini";

export function defaultModelFor(provider: AiProvider): string {
  return AI_MODELS_BY_PROVIDER[provider][0];
}

export function isAiProvider(value: unknown): value is AiProvider {
  return value === "gemini" || value === "claude" || value === "openai";
}

/** `models/Gemini-3.8-Flash ` → `gemini-3.8-flash`. */
function normalizeGeminiModel(model: string): string {
  return model.trim().toLowerCase().replace(/^models\//, "");
}

/**
 * Os SUBSTITUTOS de um modelo do Gemini, em ordem de tentativa — até
 * `GEMINI_MODEL_ATTEMPTS - 1` deles. Puro; a decisão de USAR está em
 * `lib/ai/model-fallback.ts`.
 *
 * O modelo configurado é TEXTO LIVRE (`ai_provider_config.model` não tem
 * check), então casar não é comparar strings:
 *
 * - casa o degrau exato, ou o degrau seguido de `-` (`gemini-3.5-flash-lite
 *   -preview-09-2026` é uma VARIANTE de `gemini-3.5-flash-lite`). A fronteira
 *   `-` é o que impede um hipotético `gemini-3.5-flashx` de casar;
 * - com mais de um casamento vence o MAIS LONGO, senão
 *   `gemini-3.5-flash-lite-…` cairia em `gemini-3.5-flash` e pularia o degrau
 *   certo;
 * - variante casada tenta PRIMEIRO o estável do próprio degrau: ele ainda não
 *   foi tentado, e é justamente o preview que costuma saturar antes.
 *
 * Fora da escada devolve `[]` — SEM rebaixamento, comportamento idêntico ao
 * de antes desta versão. Um nome que este arquivo não conhece é, quase
 * sempre, um modelo lançado DEPOIS dele (a lista envelhece sozinha); descer
 * para o topo da escada seria promover, em silêncio, para um modelo que
 * ninguém escolheu e que custa outro preço.
 */
export function geminiFallbackModels(model: string): string[] {
  const norm = normalizeGeminiModel(model);
  let idx = -1;
  GEMINI_MODEL_LADDER.forEach((rung, i) => {
    if (norm !== rung && !norm.startsWith(`${rung}-`)) return;
    if (idx < 0 || GEMINI_MODEL_LADDER[idx].length < rung.length) idx = i;
  });
  if (idx < 0) return [];

  const out: string[] = [];
  if (norm !== GEMINI_MODEL_LADDER[idx]) out.push(GEMINI_MODEL_LADDER[idx]);
  for (
    let i = idx + 1;
    i < GEMINI_MODEL_LADDER.length && out.length < GEMINI_MODEL_ATTEMPTS - 1;
    i++
  ) {
    out.push(GEMINI_MODEL_LADDER[i]);
  }
  return out;
}
