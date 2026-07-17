// Versão: 1.0 | Data: 17/07/2026
// Chaves de API (entrada) e segredos de webhook (saída) — SÓ NO SERVIDOR.
// Mesmo ciclo de vida do token de snapshot (lib/snapshots/token.ts): 256 bits
// aleatórios, o banco guarda APENAS o sha256 (api_keys.key_hash) e o plaintext
// é exibido UMA vez, na criação. Prefixos identificam o tipo à la Stripe:
//   dck_...   chave de API de entrada (dashboard-comercial key)
//   whsec_... segredo HMAC de endpoint de saída (este é cifrado, não hasheado —
//             assinar exige o plaintext; ver lib/crypto/secretbox.ts)
import { createHash, randomBytes } from "node:crypto";

export const API_KEY_PREFIX = "dck_";
export const WH_SECRET_PREFIX = "whsec_";

// dck_ + 43 chars base64url (32 bytes). Pré-gate: barra requisições malformadas
// antes de qualquer consulta (a rota responde 401 uniforme sem tocar o banco).
const API_KEY_RE = /^dck_[A-Za-z0-9_-]{43}$/;

/** Quantos chars do plaintext viram key_prefix (exibição na UI). */
const PREFIX_DISPLAY_CHARS = 10;

/** sha256 hex — a ÚNICA forma persistida de uma chave de API. */
export function hashKey(plaintext: string): string {
  return createHash("sha256").update(plaintext).digest("hex");
}

/** Gera uma chave de API nova (entrada). Plaintext exibido UMA vez. */
export function generateApiKey(): {
  plaintext: string;
  hash: string;
  prefix: string;
} {
  const plaintext = API_KEY_PREFIX + randomBytes(32).toString("base64url");
  return {
    plaintext,
    hash: hashKey(plaintext),
    prefix: plaintext.slice(0, PREFIX_DISPLAY_CHARS),
  };
}

/** Gera um segredo de assinatura para endpoint de saída (whsec_...). */
export function generateWebhookSecret(): string {
  return WH_SECRET_PREFIX + randomBytes(32).toString("base64url");
}

/** Formato válido de chave de API? (pré-gate sem tocar o banco) */
export function isApiKeyShaped(s: string): boolean {
  return API_KEY_RE.test(s);
}
