// Versão: 1.1 | Data: 10/09/2026
// v1.1 (10/09/2026): o adaptador transmite SEMPRE. Os testes novos pinam as
// duas metades dessa decisão — sem `onThought` a chamada vai para
// `:streamGenerateContent` do mesmo jeito (era o `:generateContent` que
// apanhava 503 enquanto o painel do dashboard passava), e mesmo assim o corpo
// NÃO pede `thinkingConfig`: transmitir e pedir raciocínio são decisões
// diferentes, e a segunda tem regra de custo própria.
// Streaming do adaptador Gemini (raciocínio ao vivo): separação pensamento ×
// resposta por chunk (splitGeminiChunk, pura) e o parser SSE compartilhado
// (streamProviderSse, com fetch stubado) — sem rede real, sem banco.
import { afterEach, describe, expect, it, vi } from "vitest";

import { createGeminiClient, splitGeminiChunk } from "./gemini";
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

describe("o adaptador transmite sempre (v1.1)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function sseResponse(chunks: string[]): Response {
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

  /** Um chunk SSE do Gemini com um pedaço de texto de resposta. */
  const chunk = (text: string, thought = false) =>
    `data: ${JSON.stringify({
      candidates: [
        { content: { parts: [{ text, ...(thought ? { thought: true } : {}) }] } },
      ],
    })}\n\n`;

  /** O que a chamada REALMENTE pediu — é isso que os testes examinam. */
  interface Sent {
    url: string;
    body: { generationConfig: { thinkingConfig?: unknown } };
  }
  let sent: Sent;

  function stubFetch(chunks: string[]) {
    sent = { url: "", body: { generationConfig: {} } };
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      sent.url = String(url);
      sent.body = JSON.parse(String(init.body));
      return sseResponse(chunks);
    });
  }

  const client = () =>
    createGeminiClient({ provider: "gemini", model: "m", apiKey: "k" });

  it("SEM onThought ainda vai para :streamGenerateContent", async () => {
    // O caminho `:generateContent` era o que voltava 503 sob carga enquanto o
    // painel do dashboard (que transmite) passava, no mesmo minuto.
    stubFetch([chunk('{"a":'), chunk("1}")]);

    const out = await client().generateText({ system: "s", messages: [] });
    expect(out).toBe('{"a":1}');
    expect(sent.url).toContain(":streamGenerateContent");
    expect(sent.url).toContain("alt=sse");
  });

  it("…e mesmo assim NÃO pede thinkingConfig", async () => {
    stubFetch([chunk("{}")]);
    await client().generateText({ system: "s", messages: [] });
    expect(sent.body.generationConfig.thinkingConfig).toBeUndefined();
  });

  it("com onThought, pede os resumos e os repassa", async () => {
    stubFetch([chunk("Pensando…", true), chunk('{"ok":1}')]);

    const seen: string[] = [];
    const out = await client().generateText({
      system: "s",
      messages: [],
      onThought: (t) => seen.push(t),
    });
    expect(out).toBe('{"ok":1}');
    expect(seen).toEqual(["Pensando…"]);
    expect(sent.body.generationConfig.thinkingConfig).toEqual({
      includeThoughts: true,
    });
  });

  it("resposta vazia segue com o erro de sempre", async () => {
    stubFetch([chunk("   ")]);
    await expect(
      client().generateText({ system: "s", messages: [] })
    ).rejects.toThrow("Gemini não retornou conteúdo.");
  });

  it("MAX_TOKENS segue virando AiTruncatedError", async () => {
    stubFetch([
      `data: ${JSON.stringify({
        candidates: [
          { content: { parts: [{ text: "{" }] }, finishReason: "MAX_TOKENS" },
        ],
      })}\n\n`,
    ]);
    await expect(
      client().generateText({ system: "s", messages: [] })
    ).rejects.toThrow("foi cortada pelo limite de tokens");
  });
});
