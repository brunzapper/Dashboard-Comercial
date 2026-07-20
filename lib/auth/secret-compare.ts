// Versão: 1.0 | Data: 20/07/2026
// Comparação TIMING-SAFE de segredos de rota (SYNC_SECRET): sha256 dos dois
// lados iguala os comprimentos e timingSafeEqual elimina o vazamento por tempo
// de comparação — mesmo padrão do bearer do /api/ingest. Criado na auditoria
// de 20/07/2026: as rotas de tick comparavam com `===`.
import { createHash, timingSafeEqual } from "node:crypto";

export function timingSafeSecretEqual(
  candidate: string | null,
  secret: string
): boolean {
  if (candidate == null) return false;
  const a = createHash("sha256").update(candidate).digest();
  const b = createHash("sha256").update(secret).digest();
  return timingSafeEqual(a, b);
}
