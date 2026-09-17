// Versão: 1.0 | Data: 17/09/2026
// O REBAIXAMENTO de modelo do Gemini.
//
// O caso real: o `gemini-3.8-flash` satura, o `fetchProvider` repete três
// vezes NELE em dois segundos, e o turno inteiro morre — enquanto o degrau
// anterior estava respondendo normalmente no mesmo minuto.
//
// O que estes testes protegem é a LINHA de quando descer: só sobrecarga
// começa a descida (nome de modelo errado tem de continuar dando 404 na cara
// de quem digitou), um candidato indisponível não vira a mensagem final, e
// nada desce depois que o stream já falou com a tela. Mais a regra de custo:
// o embrulho do `onThought` não pode existir quando o chamador não passou um,
// senão liga `includeThoughts` onde ele vem desligado.
import { describe, expect, it, vi } from "vitest";

import {
  createGeminiClientWithFallback,
  modelDowngradeNotice,
} from "./model-fallback";
import {
  AI_MODELS_BY_PROVIDER,
  GEMINI_MODEL_ATTEMPTS,
  GEMINI_MODEL_LADDER,
  defaultModelFor,
  geminiFallbackModels,
} from "./models";
import {
  AiHttpError,
  AiOverloadError,
  AiTruncatedError,
  type AiClientConfig,
  type AiGenerateInput,
  type AiTextClient,
} from "./types";

const CONFIG: AiClientConfig = {
  provider: "gemini",
  model: "gemini-3.8-flash",
  apiKey: "k",
};

const overload = (status = 503) =>
  new AiOverloadError(
    "Gemini",
    status,
    "{}",
    `Gemini está sobrecarregado no momento (${status}) — tentei 3 vezes.`
  );

const httpError = (status: number) =>
  new AiHttpError("Gemini", status, "{}", `Gemini respondeu ${status}: {}`);

/**
 * Fábrica falsa: programa uma reação por MODELO e anota a ordem em que os
 * degraus foram tentados. Sem rede — o que se testa aqui é a política, não o
 * transporte (esse é o `util.test.ts`).
 */
function fakeCreate(
  byModel: Record<string, string | Error | ((i: AiGenerateInput) => string)>
) {
  const tried: string[] = [];
  const create = (config: AiClientConfig): AiTextClient => ({
    async generateText(input) {
      tried.push(config.model);
      const react = byModel[config.model];
      if (react === undefined) throw httpError(404);
      if (react instanceof Error) throw react;
      if (typeof react === "function") return react(input);
      return react;
    },
  });
  return { create, tried };
}

describe("a escada: quem vem depois de quem", () => {
  it("de um degrau exato, desce os dois seguintes", () => {
    expect(geminiFallbackModels("gemini-3.8-flash")).toEqual([
      "gemini-3.7-flash",
      "gemini-3.6-flash",
    ]);
  });

  it("normaliza o prefixo models/ e a caixa", () => {
    expect(geminiFallbackModels("  models/GEMINI-3.8-Flash ")).toEqual(
      geminiFallbackModels("gemini-3.8-flash")
    );
  });

  it("variante datada tenta PRIMEIRO o estável do próprio degrau", () => {
    expect(geminiFallbackModels("gemini-3.5-flash-preview-09-2026")).toEqual([
      "gemini-3.5-flash",
      "gemini-3.1-flash-lite",
    ]);
  });

  it("o maior prefixo vence — lite não cai no flash", () => {
    expect(geminiFallbackModels("gemini-3.5-flash-lite-preview-x")).toEqual([
      "gemini-3.5-flash-lite",
      "gemini-3.5-flash",
    ]);
  });

  it("o último degrau não tem para onde descer", () => {
    const last = GEMINI_MODEL_LADDER[GEMINI_MODEL_LADDER.length - 1];
    expect(geminiFallbackModels(last)).toEqual([]);
    const penult = GEMINI_MODEL_LADDER[GEMINI_MODEL_LADDER.length - 2];
    expect(geminiFallbackModels(penult)).toEqual([last]);
  });

  it("modelo fora da escada NÃO rebaixa — promover em silêncio seria pior", () => {
    expect(geminiFallbackModels("gemini-4.0-turbo")).toEqual([]);
    expect(geminiFallbackModels("gpt-5")).toEqual([]);
    expect(geminiFallbackModels("")).toEqual([]);
  });

  it("o próprio modelo nunca aparece na lista dele", () => {
    for (const rung of GEMINI_MODEL_LADDER) {
      const out = geminiFallbackModels(rung);
      expect(out).not.toContain(rung);
      expect(out.length).toBeLessThanOrEqual(GEMINI_MODEL_ATTEMPTS - 1);
    }
  });
});

describe("o catálogo e a escada não podem divergir", () => {
  it("toda sugestão do formulário é um degrau da escada", () => {
    // Sugerir um modelo fora da escada seria oferecer, na própria tela, a
    // configuração que não tem rebaixamento. Foi assim que a lista passou a
    // oferecer um modelo que o Google já tinha desligado.
    for (const m of AI_MODELS_BY_PROVIDER.gemini) {
      expect(GEMINI_MODEL_LADDER).toContain(m);
    }
  });

  it("o default sugerido é o topo da escada", () => {
    expect(defaultModelFor("gemini")).toBe(GEMINI_MODEL_LADDER[0]);
  });

  it("a escada não repete degrau", () => {
    expect(new Set(GEMINI_MODEL_LADDER).size).toBe(GEMINI_MODEL_LADDER.length);
  });
});

describe("quando o degrau atual satura", () => {
  it("desce para o próximo e devolve a resposta dele", async () => {
    const { create, tried } = fakeCreate({
      "gemini-3.8-flash": overload(),
      "gemini-3.7-flash": "{}",
    });
    const notices: string[] = [];

    const out = await createGeminiClientWithFallback(CONFIG, create).generateText({
      system: "s",
      messages: [],
      onNotice: (t) => notices.push(t),
    });

    expect(out).toBe("{}");
    expect(tried).toEqual(["gemini-3.8-flash", "gemini-3.7-flash"]);
    expect(notices).toEqual([
      modelDowngradeNotice("gemini-3.8-flash", "gemini-3.7-flash", 503),
    ]);
  });

  it("429 de limite de uso também desce", async () => {
    const { create, tried } = fakeCreate({
      "gemini-3.8-flash": overload(429),
      "gemini-3.7-flash": "ok",
    });
    await createGeminiClientWithFallback(CONFIG, create).generateText({
      system: "s",
      messages: [],
    });
    expect(tried).toHaveLength(2);
  });

  it("para no teto de modelos e devolve o overload ORIGINAL com o que tentou", async () => {
    const { create, tried } = fakeCreate({
      "gemini-3.8-flash": overload(),
      "gemini-3.7-flash": overload(),
      "gemini-3.6-flash": overload(),
      "gemini-3.5-flash-lite": "nunca deveria chegar aqui",
    });

    const err = await createGeminiClientWithFallback(CONFIG, create)
      .generateText({ system: "s", messages: [] })
      .catch((e) => e);

    expect(tried).toHaveLength(GEMINI_MODEL_ATTEMPTS);
    expect(tried).not.toContain("gemini-3.5-flash-lite");
    expect(err).toBeInstanceOf(AiOverloadError);
    // O json-loop decide por este prefixo se repete o nome do provedor.
    expect((err as Error).message.startsWith("Gemini")).toBe(true);
    expect((err as Error).message).toContain("gemini-3.7-flash");
    expect((err as Error).message).toContain("gemini-3.6-flash");
  });

  it("um candidato sem acesso (404) não interrompe a descida nem vira a mensagem", async () => {
    const { create, tried } = fakeCreate({
      "gemini-3.8-flash": overload(),
      "gemini-3.7-flash": httpError(404),
      "gemini-3.6-flash": "ok",
    });

    const out = await createGeminiClientWithFallback(CONFIG, create).generateText({
      system: "s",
      messages: [],
    });

    expect(out).toBe("ok");
    expect(tried).toEqual([
      "gemini-3.8-flash",
      "gemini-3.7-flash",
      "gemini-3.6-flash",
    ]);
  });

  it("modelo fora da escada falha como antes, sem tentar nada", async () => {
    const { create, tried } = fakeCreate({ "gemini-4.0-turbo": overload() });
    const err = await createGeminiClientWithFallback(
      { ...CONFIG, model: "gemini-4.0-turbo" },
      create
    )
      .generateText({ system: "s", messages: [] })
      .catch((e) => e);

    expect(tried).toEqual(["gemini-4.0-turbo"]);
    // Sem substituto, a frase é a mesma de sempre — nada de "Também tentei".
    expect((err as Error).message).not.toContain("Também tentei");
  });
});

describe("o que NÃO desce um degrau", () => {
  it("404 no modelo CONFIGURADO: é erro de digitação, e precisa aparecer", async () => {
    const { create, tried } = fakeCreate({
      "gemini-3.8-flash": httpError(404),
      "gemini-3.7-flash": "não deveria ser chamado",
    });

    const err = await createGeminiClientWithFallback(CONFIG, create)
      .generateText({ system: "s", messages: [] })
      .catch((e) => e);

    expect(tried).toEqual(["gemini-3.8-flash"]);
    expect((err as Error).message).toBe("Gemini respondeu 404: {}");
  });

  it("403 de chave errada falha na cara, como antes", async () => {
    const { create, tried } = fakeCreate({ "gemini-3.8-flash": httpError(403) });
    await expect(
      createGeminiClientWithFallback(CONFIG, create).generateText({
        system: "s",
        messages: [],
      })
    ).rejects.toThrow("Gemini respondeu 403");
    expect(tried).toHaveLength(1);
  });

  it("resposta truncada propaga intacta — modelo menor não conserta prompt grande", async () => {
    const { create, tried } = fakeCreate({
      "gemini-3.8-flash": new AiTruncatedError("Gemini"),
    });

    const err = await createGeminiClientWithFallback(CONFIG, create)
      .generateText({ system: "s", messages: [] })
      .catch((e) => e);

    expect(err).toBeInstanceOf(AiTruncatedError);
    expect(tried).toHaveLength(1);
  });

  it("truncado NUM CANDIDATO devolve o overload original, sem seguir descendo", async () => {
    const { create, tried } = fakeCreate({
      "gemini-3.8-flash": overload(),
      "gemini-3.7-flash": new AiTruncatedError("Gemini"),
      "gemini-3.6-flash": "não deveria ser chamado",
    });

    const err = await createGeminiClientWithFallback(CONFIG, create)
      .generateText({ system: "s", messages: [] })
      .catch((e) => e);

    expect(tried).toEqual(["gemini-3.8-flash", "gemini-3.7-flash"]);
    expect(err).toBeInstanceOf(AiOverloadError);
  });

  it("depois que o stream já falou com a tela, não rebaixa", async () => {
    const { create, tried } = fakeCreate({
      "gemini-3.8-flash": (input) => {
        input.onThought?.("pensando…");
        throw overload();
      },
      "gemini-3.7-flash": "não deveria ser chamado",
    });

    const err = await createGeminiClientWithFallback(CONFIG, create)
      .generateText({ system: "s", messages: [], onThought: () => {} })
      .catch((e) => e);

    expect(tried).toEqual(["gemini-3.8-flash"]);
    expect(err).toBeInstanceOf(AiOverloadError);
  });

  it("signal já abortado encerra a descida", async () => {
    const ac = new AbortController();
    ac.abort();
    const { create, tried } = fakeCreate({
      "gemini-3.8-flash": overload(),
      "gemini-3.7-flash": "não deveria ser chamado",
    });

    await createGeminiClientWithFallback(CONFIG, create)
      .generateText({ system: "s", messages: [], signal: ac.signal })
      .catch(() => {});

    expect(tried).toEqual(["gemini-3.8-flash"]);
  });
});

describe("regra de custo: raciocínio não se liga sozinho", () => {
  it("sem onThought do chamador, o adaptador também recebe undefined no degrau novo", async () => {
    const seen: (boolean | undefined)[] = [];
    const create = (config: AiClientConfig): AiTextClient => ({
      async generateText(input) {
        seen.push(input.onThought !== undefined);
        if (config.model === "gemini-3.8-flash") throw overload();
        return "ok";
      },
    });

    await createGeminiClientWithFallback(CONFIG, create).generateText({
      system: "s",
      messages: [],
    });

    expect(seen).toEqual([false, false]);
  });

  it("com onThought, o embrulho existe e repassa os pedaços do modelo novo", async () => {
    const chunks: string[] = [];
    const { create } = fakeCreate({
      "gemini-3.8-flash": overload(),
      "gemini-3.7-flash": (input) => {
        input.onThought?.("do modelo novo");
        return "ok";
      },
    });

    await createGeminiClientWithFallback(CONFIG, create).generateText({
      system: "s",
      messages: [],
      onThought: (c) => chunks.push(c),
    });

    expect(chunks).toEqual(["do modelo novo"]);
  });
});

describe("o aviso e o log", () => {
  it("o servidor registra a troca mesmo sem ninguém ouvindo na tela", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { create } = fakeCreate({
      "gemini-3.8-flash": overload(),
      "gemini-3.7-flash": "ok",
    });

    await createGeminiClientWithFallback(CONFIG, create).generateText({
      system: "s",
      messages: [],
    });

    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("gemini-3.7-flash")
    );
    warn.mockRestore();
  });
});
