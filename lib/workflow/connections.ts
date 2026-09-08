// Versão: 1.0 | Data: 08/09/2026
// CONEXÕES do Workflow (0125) — registry em CÓDIGO de "por qual credencial este
// passo fala com o mundo".
//
// A regra que este arquivo existe para impor: o esquema (jsonb, editável por
// admin) guarda a CHAVE do registry ("bitrix_webhook"), NUNCA o nome de uma
// variável de ambiente. Se o nome viesse do dado, o executor faria
// `process.env[<string gravável>]` — leitura arbitrária do ambiente do
// servidor, e quem edita um esquema leria SUPABASE_SERVICE_ROLE_KEY ou
// KEY_ENCRYPTION_KEY. Aqui a chave só endereça um GETTER TIPADO de lib/env.ts,
// escolhido em tempo de compilação.
//
// As chaves seguem morando nas Environment Variables da Vercel (o app não tem
// .env.local — ver lib/env.ts). A UI mostra o `envName` e um booleano de
// presença; o VALOR nunca sai do servidor.
//
// Conexão nova = entrada aqui + getter em lib/env.ts. Nada mais.
import { getBitrixWebhookUrl } from "@/lib/env";

export interface WorkflowConnectionDef {
  label: string;
  /** Nome da variável na Vercel — EXIBIDO ao admin, nunca lido do dado. */
  envName: string;
  /** Getter tipado de lib/env.ts. Lança com mensagem clara se ausente. */
  resolve: () => string;
  /** Uma linha sobre o que esta conexão permite fazer. */
  description: string;
}

export const WORKFLOW_CONNECTIONS = {
  bitrix_webhook: {
    label: "Bitrix24 — webhook REST",
    envName: "BITRIX_WEBHOOK_URL",
    resolve: getBitrixWebhookUrl,
    description:
      "URL base do webhook de entrada do portal. É a mesma credencial que o sync já usa para ler negócios e leads.",
  },
} as const satisfies Record<string, WorkflowConnectionDef>;

export type WorkflowConnectionKey = keyof typeof WORKFLOW_CONNECTIONS;

export const WORKFLOW_CONNECTION_KEYS = Object.keys(
  WORKFLOW_CONNECTIONS
) as WorkflowConnectionKey[];

/** A chave veio do jsonb — só passa se estiver no registry. */
export function isWorkflowConnectionKey(
  key: string
): key is WorkflowConnectionKey {
  return Object.prototype.hasOwnProperty.call(WORKFLOW_CONNECTIONS, key);
}

/**
 * Resolve a credencial de uma conexão. Chave fora do registry é ERRO ALTO —
 * jamais um fallback para `process.env[key]`.
 */
export function resolveWorkflowConnection(key: string): string {
  if (!isWorkflowConnectionKey(key)) {
    throw new Error(`Conexão desconhecida: "${key}".`);
  }
  return WORKFLOW_CONNECTIONS[key].resolve();
}

/**
 * Estado da conexão para a UI do admin: só o nome da variável e se ela está
 * configurada. O valor NUNCA atravessa o boundary servidor→cliente.
 */
export function workflowConnectionStatus(key: string): {
  key: string;
  label: string;
  envName: string;
  description: string;
  configured: boolean;
} | null {
  if (!isWorkflowConnectionKey(key)) return null;
  const def = WORKFLOW_CONNECTIONS[key];
  let configured = false;
  try {
    configured = def.resolve().trim() !== "";
  } catch {
    // requireEnv lança quando ausente — é exatamente "não configurada".
    configured = false;
  }
  return {
    key,
    label: def.label,
    envName: def.envName,
    description: def.description,
    configured,
  };
}
