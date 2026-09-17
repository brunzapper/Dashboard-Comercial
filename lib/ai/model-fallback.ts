// Versão: 1.0 | Data: 17/09/2026
// Rebaixamento de modelo do Gemini quando o degrau atual satura.
//
// O problema: o `fetchProvider` (lib/ai/util.ts) já repete a CHAMADA três
// vezes num 503/429 — mas sempre no MESMO modelo. Se o `gemini-3.8-flash`
// está lotado, repetir nele três vezes em dois segundos não resolve nada, e o
// turno inteiro morre (as três tentativas dos laços de autocorreção são só
// para resposta que não passa no VALIDADOR, não para transporte). Sobrecarga,
// porém, é do MODELO: o degrau anterior quase sempre responde.
//
// Onde isto mora e por quê: pendurado no `case "gemini"` do `getAiClient`
// (lib/ai/index.ts), que é por onde passam as DUAS únicas call sites
// (`json-loop.ts` e `generate-dashboard.ts`) e, por elas, todas as superfícies
// de IA. Mesma razão do `fetchProvider`: a política tem UM dono — nunca por
// adaptador, nunca por superfície. Em arquivo próprio porque o `index.ts` é a
// fábrica de quatro linhas ("provedor novo = um case aqui") e esta é uma
// política de um provedor só, com testes próprios.
//
// O que NÃO desce um degrau, e por quê cada um:
//   - 404 no modelo CONFIGURADO: é nome errado ou org sem acesso, e a pessoa
//     precisa ler isso para arrumar o campo. Descer mascararia um erro de
//     digitação e mandaria a conta para um modelo que ninguém escolheu.
//   - 401/403/400: chave e payload valem para a conta inteira; trocar de
//     modelo só atrasa a mensagem que resolve.
//   - AiTruncatedError: a resposta estourou o teto de tokens. Modelo menor não
//     conserta prompt grande — e ainda queimaria a escada inteira.
//   - bloqueio de segurança, timeout, queda de rede: idem, mais o abort, que é
//     o teto do turno e não se contorna.
// Já um 404/403 num CANDIDATO continua descendo: aquele degrau não foi escolha
// de ninguém, e a causa real do turno segue sendo a sobrecarga do primeiro.

import {
  AiHttpError,
  AiOverloadError,
  type AiClientConfig,
  type AiTextClient,
} from "./types";
import { GEMINI_MODEL_ATTEMPTS, geminiFallbackModels } from "./models";
import { createGeminiClient } from "./gemini";

/**
 * Teto de tempo da DESCIDA inteira, contado desde o início da chamada.
 *
 * O `signal` é um `AbortSignal.timeout(120_000)` criado pelo chamador por
 * tentativa de VALIDAÇÃO, e a escada roda dentro de UMA dessas — os três
 * modelos dividem aqueles 120 s, não têm 120 s cada. Pior caso por degrau:
 * 3 requisições + 2 esperas de até 8 s (o `Retry-After` é capado lá).
 *
 * O corte em 60 s existe para a escada não comer o orçamento do TURNO: os dois
 * laços só iniciam a tentativa seguinte se ainda houver 120 s de folga dentro
 * dos 240 s. Se a descida gastasse os 120 s da primeira tentativa, o turno
 * acabaria ali — sem nenhuma retentativa de validação.
 */
const DESCENT_BUDGET_MS = 60_000;

/** A frase do aviso — dona única, para não nascer uma segunda redação. */
export function modelDowngradeNotice(
  from: string,
  to: string,
  status: number
): string {
  return `${from} está sobrecarregado (${status}). Tentando ${to}…`;
}

/**
 * O erro que sobra quando a escada inteira falha: o overload ORIGINAL, com os
 * substitutos anexados.
 *
 * É o original porque é ele que é acionável ("tente de novo em instantes"); o
 * último erro pode ser um 404 sobre um modelo que o usuário nunca escolheu.
 * A frase continua começando com o nome do provedor — o `json-loop.ts` decide
 * por `startsWith(providerLabel)` se prefixa "Falha ao chamar a IA (gemini): ",
 * e sem isso a mensagem voltaria a ser "…(gemini): Gemini está…".
 */
function withTriedModels(
  err: AiOverloadError,
  tried: string[]
): AiOverloadError {
  if (tried.length < 2) return err;
  return new AiOverloadError(
    err.provider,
    err.status,
    err.body,
    `${err.message} Também tentei ${tried.slice(1).join(" e ")}, sem sucesso.`
  );
}

/**
 * Embrulha o adaptador do Gemini com a escada. `create` é injetável só para os
 * testes poderem programar falhas sem rede.
 */
export function createGeminiClientWithFallback(
  config: AiClientConfig,
  create: (config: AiClientConfig) => AiTextClient = createGeminiClient
): AiTextClient {
  return {
    async generateText(input) {
      const chain = [config.model, ...geminiFallbackModels(config.model)].slice(
        0,
        GEMINI_MODEL_ATTEMPTS
      );
      const t0 = Date.now();
      let firstOverload: AiOverloadError | null = null;

      for (let i = 0; i < chain.length; i++) {
        const model = chain[i];

        // A trava contra emitir duas vezes. Hoje o `AiOverloadError` só nasce
        // ANTES do primeiro evento do stream (o `fetchProvider` repete antes
        // de entregar a `Response`), então o caso não acontece — mas a trava
        // não depende disso continuar verdade.
        //
        // O ternário não é estilo: criar um `onThought` quando o chamador não
        // passou um ligaria `thinkingConfig.includeThoughts` no corpo do
        // Gemini em todas as superfícies que hoje vêm sem ele. É a regra de
        // custo do projeto — nunca ligar raciocínio onde vem desligado.
        let emitted = false;
        const onThought = input.onThought
          ? (chunk: string) => {
              emitted = true;
              input.onThought?.(chunk);
            }
          : undefined;

        try {
          return await create({ ...config, model }).generateText({
            ...input,
            onThought,
          });
        } catch (err) {
          const overload = err instanceof AiOverloadError ? err : null;
          if (i === 0) {
            // A descida só COMEÇA por sobrecarga.
            if (!overload) throw err;
            firstOverload = overload;
          } else if (!(err instanceof AiHttpError)) {
            // Num candidato, só erro de RESPOSTA do provedor (404 sem acesso,
            // 503 de novo) continua a descida; truncado/bloqueio/rede/abort
            // param aqui e devolvem o original.
            break;
          }

          if (emitted) throw err;

          const next = chain[i + 1];
          if (!next) break;
          if (input.signal?.aborted) break;
          if (Date.now() - t0 > DESCENT_BUDGET_MS) break;

          const status = overload?.status ?? (err as AiHttpError).status;
          const notice = modelDowngradeNotice(model, next, status);
          console.warn(`[ai] ${notice}`);
          input.onNotice?.(notice);
        }
      }

      // Só se chega aqui depois de um overload no primeiro degrau — todo
      // outro caminho já lançou ou devolveu.
      if (!firstOverload) throw new Error("Gemini não retornou conteúdo.");
      throw withTriedModels(firstOverload, chain);
    },
  };
}
