// Versão: 1.0 | Data: 11/09/2026
// O leitor de NDJSON dos turnos de IA.
//
// Ele existe por dois motivos que convém não esquecer, porque os dois já
// morderam: (1) turno de IA não pode ser Server Action — o Next as despacha uma
// de cada vez por cliente, e um turno de 240s congelava tudo, inclusive a
// leitura da Tree; (2) o laço estava copiado byte a byte em dois painéis, e o
// dock seria o terceiro.
//
// O que se pina aqui são os três casos que um laço escrito de novo erra: evento
// partido entre dois chunks, última linha sem `\n`, e stream que acaba sem o
// estado final.
import { describe, expect, it, vi } from "vitest";

import { readNdjsonTurn } from "./read-ndjson-turn";

/** Uma Response de verdade sobre os pedaços dados, na ordem. */
function streamOf(chunks: string[]): Response {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const c of chunks) controller.enqueue(encoder.encode(c));
        controller.close();
      },
    })
  );
}

const state = (s: unknown) => JSON.stringify({ type: "state", state: s });
const thought = (t: string) => JSON.stringify({ type: "thought", text: t });

describe("readNdjsonTurn", () => {
  it("devolve o estado da linha final", async () => {
    const res = streamOf([state({ ok: true, thread: { id: "t1" } }) + "\n"]);
    await expect(
      readNdjsonTurn<{ ok: boolean }>(res)
    ).resolves.toEqual({ ok: true, thread: { id: "t1" } });
  });

  it("junta evento PARTIDO entre dois chunks", async () => {
    // O caso que um laço ingênuo erra: `JSON.parse` de meio objeto.
    const full = state({ ok: true }) + "\n";
    const cut = Math.floor(full.length / 2);
    const res = streamOf([full.slice(0, cut), full.slice(cut)]);
    await expect(readNdjsonTurn<{ ok: boolean }>(res)).resolves.toEqual({
      ok: true,
    });
  });

  it("lê a última linha mesmo sem o \\n final", async () => {
    const res = streamOf([thought("a") + "\n", state({ ok: true })]);
    await expect(readNdjsonTurn<{ ok: boolean }>(res)).resolves.toEqual({
      ok: true,
    });
  });

  it("acumula o raciocínio na ordem e ignora linhas em branco", async () => {
    const seen: string[] = [];
    const res = streamOf([
      thought("Lendo ") + "\n",
      "\n",
      thought("as tarefas…") + "\n",
      state({ ok: true }) + "\n",
    ]);
    await readNdjsonTurn(res, { onThought: (c) => seen.push(c) });
    expect(seen.join("")).toBe("Lendo as tarefas…");
  });

  it("sem onThought, o raciocínio é simplesmente descartado", async () => {
    const res = streamOf([thought("x") + "\n", state({ ok: true }) + "\n"]);
    await expect(readNdjsonTurn(res)).resolves.toEqual({ ok: true });
  });

  it("stream sem estado final é erro — a rota promete a linha, inclusive no erro dela", async () => {
    const res = streamOf([thought("pensando") + "\n"]);
    await expect(readNdjsonTurn(res)).rejects.toThrow(
      "resposta incompleta do servidor."
    );
  });

  it("resposta não-ok vira erro com o status, sem tocar no corpo", async () => {
    const res = new Response("nope", { status: 403 });
    await expect(readNdjsonTurn(res)).rejects.toThrow(
      "o servidor respondeu 403."
    );
  });

  it("o raciocínio chega ANTES do fim — é ele que mantém o cano vivo", async () => {
    // Um POST de dois minutos sem byte trafegando apanha de timeout de
    // ociosidade em proxy; o teste garante que o consumidor vê o pedaço
    // enquanto o stream ainda está aberto, não só no final.
    const encoder = new TextEncoder();
    let push!: (s: string) => void;
    let done!: () => void;
    const res = new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          push = (s) => controller.enqueue(encoder.encode(s));
          done = () => controller.close();
        },
      })
    );
    const onThought = vi.fn();
    const pending = readNdjsonTurn(res, { onThought });
    push(thought("meio do caminho") + "\n");
    await vi.waitFor(() => expect(onThought).toHaveBeenCalledWith("meio do caminho"));
    push(state({ ok: true }) + "\n");
    done();
    await expect(pending).resolves.toEqual({ ok: true });
  });
});
