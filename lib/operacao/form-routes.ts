// Versão: 1.0 | Data: 08/09/2026
// Rotas dos formulários do Workflow (0126) — módulo PURO e CLIENT-SAFE.
//
// Existe separado de lib/operacao/cards.ts pelo mesmo motivo que
// lib/ai/operacao/scopes.ts: o `cards.ts` importa `checkSettingsArea` e o
// client do Supabase, então é server-only e não pode ser puxado por um
// componente client. O manager da fábrica é client (precisa do clipboard para
// copiar o link) e só precisa saber montar a rota.
//
// Rota própria sob /operacao/f/ de propósito: a chave do formulário é
// escolhida pelo usuário e colidiria com uma sub-área do produto se a rota
// fosse /operacao/<chave> — um formulário chamado "agenda" sequestraria a
// Agenda.

/** Prefixo da rota de todo formulário. */
export const FORM_CARD_PREFIX = "/operacao/f";

/** Rota de um formulário — a URL que se copia e compartilha com o time. */
export function formSchemaHref(key: string): string {
  return `${FORM_CARD_PREFIX}/${key}`;
}

/** Prefixo da KEY do card de formulário no catálogo fundido. Namespace
 *  próprio para nunca colidir com a key de um módulo em código. */
export const FORM_CARD_KEY_PREFIX = "form:";
