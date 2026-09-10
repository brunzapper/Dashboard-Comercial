// Versão: 1.0 | Data: 10/09/2026
// A RETENTATIVA de transporte da IA.
//
// O caso real que ela existe para resolver: o Gemini devolveu 503 ("high
// demand… try again later") no "Salvar e analisar" da Tree, e o turno morreu
// na primeira tentativa — as três tentativas do `runJsonGenerationLoop` são só
// para resposta que não passa no validador, nunca para falha de transporte.
//
// O que estes testes protegem é a LINHA entre os dois tipos de falha: 429/5xx
// e queda de rede repetem; 4xx de contrato (chave errada, payload inválido)
// falha na primeira, porque repetir não muda nada e só atrasa o erro que a
// pessoa precisa ler. E o abort nunca repete: o teto do turno já passou.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  AI_HTTP_ATTEMPTS,
  backoffMs,
  overloadMessage,
  postProviderJson,
  retryAfterMs,
  streamProviderSse,
} from "./util";

/** Sem espera real: as retentativas seriam segundos de teste por caso. */
beforeEach(() => {
  vi.useFakeTimers();
  // O `sleep` interno resolve por setTimeout; adiantar o relógio a cada tick
  // deixa o await passar sem prender a suíte.
  vi.spyOn(globalThis, "setTimeout").mockImplementation(((fn: () => void) => {
    fn();
    return 0 as unknown as NodeJS.Timeout;
  }) as typeof setTimeout);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const json = (body: unknown, init?: ResponseInit) =>
  new Response(JSON.stringify(body), init);

const OVERLOADED = {
  error: {
    code: 503,
    message: "This model is currently experiencing high demand.",
    status: "UNAVAILABLE",
  },
};

describe("503 do provedor: repete em vez de matar o turno", () => {
  it("um 503 seguido de sucesso devolve a resposta boa", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json(OVERLOADED, { status: 503 }))
      .mockResolvedValueOnce(json({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(postProviderJson("Gemini", "u", {})).resolves.toEqual({
      ok: true,
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("503 em todas as tentativas vira frase legível, não o JSON cru", async () => {
    const fetchMock = vi.fn(async () => json(OVERLOADED, { status: 503 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(postProviderJson("Gemini", "u", {})).rejects.toThrow(
      /Gemini está sobrecarregado no momento \(503\)/
    );
    expect(fetchMock).toHaveBeenCalledTimes(AI_HTTP_ATTEMPTS);
  });

  it("429 fala de limite de uso, não de sobrecarga", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json({ error: { message: "quota" } }, { status: 429 }))
    );
    await expect(postProviderJson("Gemini", "u", {})).rejects.toThrow(
      /atingiu o limite de uso \(429\)/
    );
  });
});

describe("o que NÃO se repete", () => {
  it("4xx de contrato falha na PRIMEIRA, com o corpo para depurar", async () => {
    const fetchMock = vi.fn(async () => new Response("chave inválida", { status: 403 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(postProviderJson("Gemini", "u", {})).rejects.toThrow(
      "Gemini respondeu 403: chave inválida"
    );
    // A mensagem é byte-idêntica à de antes da v1.2 — e uma chamada só.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("400 de payload também falha na primeira", async () => {
    const fetchMock = vi.fn(async () => new Response("bad request", { status: 400 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(postProviderJson("Claude", "u", {})).rejects.toThrow(
      "Claude respondeu 400: bad request"
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("timeout/cancelamento nunca repete — o teto do turno já passou", async () => {
    const fetchMock = vi.fn(async () => {
      throw new DOMException("timed out", "TimeoutError");
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(postProviderJson("Gemini", "u", {})).rejects.toThrow(
      "Tempo limite ao chamar Gemini."
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("queda de rede repete, mas a última desiste com a mensagem de rede", async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error("ECONNRESET");
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(postProviderJson("OpenAI", "u", {})).rejects.toThrow(
      "Falha de rede ao chamar OpenAI: ECONNRESET"
    );
    expect(fetchMock).toHaveBeenCalledTimes(AI_HTTP_ATTEMPTS);
  });
});

describe("o stream SSE herda a mesma regra", () => {
  function sse(chunks: string[]): Response {
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

  it("repete o 503 ANTES de entregar qualquer evento", async () => {
    // A repetição só é segura aqui porque nada foi consumido ainda: stream já
    // começado nunca reinicia (o painel veria o raciocínio duplicado).
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json(OVERLOADED, { status: 503 }))
      .mockResolvedValueOnce(sse(['data: {"a":1}\n\n']));
    vi.stubGlobal("fetch", fetchMock);

    const seen: unknown[] = [];
    for await (const evt of streamProviderSse<{ a: number }>("Gemini", "u", {})) {
      seen.push(evt);
    }
    expect(seen).toEqual([{ a: 1 }]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("quanto esperar", () => {
  it("o Retry-After do provedor vence, nas duas formas do cabeçalho", () => {
    expect(retryAfterMs("2")).toBe(2000);
    // Data HTTP no futuro próximo.
    const at = new Date(Date.now() + 3000).toUTCString();
    expect(retryAfterMs(at)).toBeGreaterThan(0);
    expect(retryAfterMs(null)).toBeNull();
    expect(retryAfterMs("qualquer coisa")).toBeNull();
  });

  it("Retry-After absurdo é limitado — não prende o turno esperando", () => {
    expect(retryAfterMs("600")).toBe(8000);
  });

  it("a espera cresce, tem jitter e tem teto", () => {
    // Com o jitter no piso e no topo, a janela de cada tentativa.
    expect(backoffMs(0, () => 0)).toBe(350);
    expect(backoffMs(0, () => 0.999)).toBeLessThanOrEqual(700);
    expect(backoffMs(1, () => 0)).toBe(700);
    expect(backoffMs(9, () => 0.999)).toBeLessThanOrEqual(8000);
  });
});

describe("a frase que o usuário lê", () => {
  it("aproveita a mensagem do provedor e joga o JSON fora", () => {
    const msg = overloadMessage("Gemini", 503, JSON.stringify(OVERLOADED));
    expect(msg).toContain("This model is currently experiencing high demand.");
    expect(msg).not.toContain('"status"');
    expect(msg).not.toContain("{");
  });

  it("corpo que não é JSON não vira detalhe — o status já diz o essencial", () => {
    const msg = overloadMessage("Gemini", 503, "<html>502 Bad Gateway</html>");
    expect(msg).toContain("(503)");
    expect(msg).not.toContain("<html>");
  });
});
