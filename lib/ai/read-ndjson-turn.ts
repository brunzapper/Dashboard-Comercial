// Versão: 1.0 | Data: 11/09/2026
// Leitura do NDJSON de um turno de IA — o laço que estava DUPLICADO byte a byte
// em `ai-edit-panel.tsx` e `ai-operacao-panel.tsx`, extraído quando o dock da
// Tree virou o terceiro consumidor.
//
// Por que as rotas de turno transmitem, em vez de devolver um JSON e pronto:
//
//  1. Server Action não serve para turno de IA. O Next despacha Server Actions
//     UMA DE CADA VEZ por cliente, então um turno de dois minutos congela todas
//     as outras — inclusive a leitura que a tela precisa fazer enquanto espera.
//     A própria documentação manda usar Route Handler nesse caso.
//  2. Um POST de dois minutos sem byte nenhum trafegando é o que proxies cortam
//     por ociosidade. As linhas de `thought` mantêm o cano vivo, e o
//     `x-accel-buffering: no` da rota impede o buffering.
//
// O protocolo: uma linha JSON por evento. `{"type":"thought"}` é efêmero (nunca
// persistido) e `{"type":"state"}` vem SEMPRE por último — inclusive em erro de
// gate, que é o que faz o chamador ter sempre um estado canônico para absorver.
"use client";

export interface NdjsonTurnOptions {
  /** Raciocínio ao vivo do modelo, em pedaços. Ignorado se omitido. */
  onThought?: (chunk: string) => void;
}

/**
 * Lê o stream até o fim e devolve o ESTADO final.
 *
 * Genérico no estado de propósito: cada superfície tem o seu
 * (`AiEditSessionState`, `OperacaoAiState`, `CommentThread`), e o laço não
 * precisa saber nada sobre ele.
 *
 * Lança quando a resposta não é ok, quando não há corpo, ou quando o stream
 * acaba sem a linha de estado — as três mensagens são as que os painéis já
 * mostravam antes da extração.
 */
export async function readNdjsonTurn<TState>(
  res: Response,
  opts: NdjsonTurnOptions = {}
): Promise<TState> {
  if (!res.ok || !res.body) {
    throw new Error(`o servidor respondeu ${res.status}.`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let finalState: TState | null = null;

  const handleLine = (raw: string): void => {
    const trimmed = raw.trim();
    // Linha em branco é normal no fim do stream, não é evento.
    if (!trimmed) return;
    const evt = JSON.parse(trimmed) as
      | { type: "thought"; text: string }
      | { type: "state"; state: TState };
    if (evt.type === "thought") opts.onThought?.(evt.text);
    else if (evt.type === "state") finalState = evt.state;
  };

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    // `stream: true`: um evento pode chegar partido entre dois chunks, e
    // decodificar cada pedaço isolado quebraria caractere multibyte no meio.
    buffer += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buffer.indexOf("\n")) >= 0) {
      handleLine(buffer.slice(0, nl));
      buffer = buffer.slice(nl + 1);
    }
  }
  // A última linha pode vir sem o `\n` final.
  if (buffer.trim()) handleLine(buffer);

  if (finalState == null) throw new Error("resposta incompleta do servidor.");
  return finalState;
}
