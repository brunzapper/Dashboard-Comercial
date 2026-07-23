// Versão: 1.0 | Data: 23/07/2026
// Autorização das rotas internas de sync/tick/webhooks pelo SYNC_SECRET.
// Comparação CONSTANT-TIME (timingSafeEqual sobre o sha256 dos dois lados —
// comprimento fixo de 32 bytes, sem vazar tamanho) para não abrir um canal de
// timing no segredo. Mesmo padrão da rota de ingest (api/ingest/[source]).
import { createHash, timingSafeEqual } from "node:crypto";

import { getSyncSecret } from "@/lib/env";

function sha256(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

/**
 * Autoriza uma requisição interna pelo SYNC_SECRET, aceito via header
 * `x-sync-secret` ou `Authorization: Bearer <segredo>`. Retorna false quando o
 * header está ausente ou não confere.
 */
export function syncSecretAuthorized(request: Request): boolean {
  const secret = getSyncSecret();
  const header =
    request.headers.get("x-sync-secret") ??
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
    null;
  if (header === null) return false;
  return timingSafeEqual(sha256(header), sha256(secret));
}
