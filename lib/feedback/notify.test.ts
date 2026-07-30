// Versão: 1.0 | Data: 29/07/2026
// Testes do helper único de feedback (notifyOnError): toast SÓ na falha —
// ok:false toasta com contexto+descrição, rejeição toasta mensagem de conexão
// e resolve undefined (nunca relança), ok:true/void ficam em silêncio.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { error: vi.fn() }),
}));

import { toast } from "sonner";
import { notifyActionError, notifyOnError } from "@/lib/feedback/notify";

const toastError = vi.mocked(toast.error);

beforeEach(() => {
  toastError.mockClear();
});

describe("notifyOnError", () => {
  it("ok:false → toast.error com contexto e a mensagem da action", async () => {
    const res = await notifyOnError(
      Promise.resolve({ ok: false, message: "RLS negou." }),
      "Não foi possível salvar"
    );
    expect(res).toEqual({ ok: false, message: "RLS negou." });
    expect(toastError).toHaveBeenCalledWith("Não foi possível salvar", {
      description: "RLS negou.",
    });
  });

  it("ok:false sem message → toast.error só com o contexto", async () => {
    await notifyOnError(Promise.resolve({ ok: false }), "Falhou");
    expect(toastError).toHaveBeenCalledWith("Falhou", undefined);
  });

  it("rejeição → toast de conexão e resolve undefined (nunca relança)", async () => {
    const res = await notifyOnError(
      Promise.reject(new Error("network")),
      "Não foi possível salvar"
    );
    expect(res).toBeUndefined();
    expect(toastError).toHaveBeenCalledWith("Não foi possível salvar", {
      description: "Falha de conexão. Tente novamente.",
    });
  });

  it("ok:true → silêncio e resultado repassado", async () => {
    const res = await notifyOnError(
      Promise.resolve({ ok: true, message: "Criado." }),
      "Contexto"
    );
    expect(res).toEqual({ ok: true, message: "Criado." });
    expect(toastError).not.toHaveBeenCalled();
  });

  it("Promise<void> resolvida → silêncio", async () => {
    const res = await notifyOnError(Promise.resolve(undefined), "Contexto");
    expect(res).toBeUndefined();
    expect(toastError).not.toHaveBeenCalled();
  });
});

describe("notifyActionError", () => {
  it("emite toast.error direto com descrição opcional", () => {
    notifyActionError("Contexto", "detalhe");
    expect(toastError).toHaveBeenCalledWith("Contexto", {
      description: "detalhe",
    });
    notifyActionError("Só contexto");
    expect(toastError).toHaveBeenCalledWith("Só contexto", undefined);
  });
});
