// Versão: 1.0 | Data: 26/07/2026
// Streaming do adaptador Gemini (raciocínio ao vivo): separação pensamento ×
// resposta por chunk (splitGeminiChunk, pura) e o parser SSE compartilhado
// (streamProviderSse, com fetch stubado) — sem rede real, sem banco.
import { afterEach, describe, expect, it, vi } from "vitest";

import { splitGeminiChunk } from "./gemini";
import { streamProviderSse } from "./util";

describe("splitGeminiChunk", () => {
  it("separa resumos de pensamento (thought: true) do texto da resposta", () => {
    const out = splitGeminiChunk({
      candidates: [
        {
          content: {
            parts: [
              { text: "Analisando os widgets…", thought: true },
              { text: '{"formato":' },
              { text: '"dash"}' },
            ],
          },
        },
      ],
    });
    expect(out.thoughts).toEqual(["Analisando os widgets…"]);
    expect(out.text).toBe('{"formato":"dash"}');
    expect(out.finishReason).toBeUndefined();
    expect(out.blockReason).toBeUndefined();
  });

  it("propaga finishReason e blockReason; ignora parts sem texto", () => {
    const out = splitGeminiChunk({
      candidates: [
        { content: { parts: [{ thought: true }, {}] }, finishReason: "MAX_TOKENS" },
      ],
      promptFeedback: { blockReason: "SAFETY" },
    });
    expect(out.thoughts).toEqual([]);
    expect(out.text).toBe("");
    expect(out.finishReason).toBe("MAX_TOKENS");
    expect(out.blockReason).toBe("SAFETY");
  });

  it("chunk vazio/sem candidates não quebra", () => {
    expect(splitGeminiChunk({})).toEqual({
      thoughts: [],
      text: "",
      finishReason: undefined,
      blockReason: undefined,
    });
  });
});

describe("streamProviderSse", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function sseResponse(chunks: string[], init?: ResponseInit): Response {
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const c of chunks) controller.enqueue(encoder.encode(c));
        controller.close();
      },
    });
    return new Response(body, init);
  }

  it("itera payloads data: em ordem, tolerando CRLF e eventos quebrados no meio", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        sseResponse([
          'data: {"a":1}\r\n\r\ndata: {"a"',
          ':2}\n\n: comentário\ndata: [DONE]\n',
        ])
      )
    );
    const seen: unknown[] = [];
    for await (const evt of streamProviderSse<{ a: number }>("Gemini", "u", {})) {
      seen.push(evt);
    }
    expect(seen).toEqual([{ a: 1 }, { a: 2 }]);
  });

  it("status != 2xx vira erro legível com trecho do corpo", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("chave inválida", { status: 403 }))
    );
    const it_ = streamProviderSse("Gemini", "u", {});
    await expect(it_.next()).rejects.toThrow("Gemini respondeu 403: chave inválida");
  });

  it("payload data: que não é JSON vira erro legível", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => sseResponse(["data: {oops\n"]))
    );
    const it_ = streamProviderSse("Gemini", "u", {});
    await expect(it_.next()).rejects.toThrow(
      "Gemini devolveu um evento SSE que não é JSON válido."
    );
  });
});
