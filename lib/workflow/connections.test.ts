// Versão: 1.0 | Data: 08/09/2026
// A regra de segurança do subsistema, pinada: o esquema endereça uma CHAVE do
// registry, e o registry escolhe o getter em tempo de compilação. Se estes
// testes caírem, é porque alguém abriu caminho para `process.env[<dado>]`.
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  isWorkflowConnectionKey,
  resolveWorkflowConnection,
  WORKFLOW_CONNECTIONS,
  WORKFLOW_CONNECTION_KEYS,
  workflowConnectionStatus,
} from "./connections";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("registry de conexões", () => {
  it("toda entrada tem envName e um getter próprio", () => {
    for (const key of WORKFLOW_CONNECTION_KEYS) {
      const def = WORKFLOW_CONNECTIONS[key];
      expect(def.envName).toMatch(/^[A-Z][A-Z0-9_]*$/);
      expect(typeof def.resolve).toBe("function");
    }
  });

  it("chave fora do registry é ERRO, nunca uma leitura de ambiente", () => {
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "segredo-que-nao-deve-vazar");
    for (const forjada of [
      "SUPABASE_SERVICE_ROLE_KEY",
      "KEY_ENCRYPTION_KEY",
      "PATH",
      "",
    ]) {
      expect(isWorkflowConnectionKey(forjada)).toBe(false);
      expect(() => resolveWorkflowConnection(forjada)).toThrow(
        /Conexão desconhecida/
      );
    }
  });

  it("chave herdada de Object.prototype não passa", () => {
    // hasOwnProperty, não `in` — "constructor"/"toString" existem na cadeia.
    expect(isWorkflowConnectionKey("constructor")).toBe(false);
    expect(isWorkflowConnectionKey("toString")).toBe(false);
  });

  it("resolve devolve o valor da variável correspondente", () => {
    vi.stubEnv("BITRIX_WEBHOOK_URL", "https://portal.bitrix24.com.br/rest/1/tok/");
    expect(resolveWorkflowConnection("bitrix_webhook")).toBe(
      "https://portal.bitrix24.com.br/rest/1/tok/"
    );
  });
});

describe("workflowConnectionStatus", () => {
  it("expõe presença, jamais o valor", () => {
    vi.stubEnv("BITRIX_WEBHOOK_URL", "https://portal.bitrix24.com.br/rest/1/tok/");
    const st = workflowConnectionStatus("bitrix_webhook")!;
    expect(st.configured).toBe(true);
    expect(st.envName).toBe("BITRIX_WEBHOOK_URL");
    // Nenhum campo do status pode carregar o segredo até a UI.
    expect(JSON.stringify(st)).not.toContain("tok");
  });

  it("variável ausente vira `configured: false` em vez de estourar", () => {
    vi.stubEnv("BITRIX_WEBHOOK_URL", "");
    expect(workflowConnectionStatus("bitrix_webhook")?.configured).toBe(false);
  });

  it("chave desconhecida devolve null", () => {
    expect(workflowConnectionStatus("nao_existe")).toBeNull();
  });
});
