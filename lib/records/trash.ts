// Versão: 1.0 | Data: 07/08/2026
// Helpers PUROS da Lixeira de registros (soft delete 0121): janela de
// retenção de 30 dias + rótulo de expiração. Espelham os helpers da Lixeira
// de boards do hub (app/(app)/page.tsx, TTL 14d) — TTLs diferentes por
// produto: registro é DADO (janela maior), board é chrome.
// A página /registros/lixeira usa withinRecordsTrashTtl como defesa em
// profundidade (vencidos somem da lista mesmo sem o cron de purga instalado —
// supabase/apply/pg-cron-purge-records-trash.sql faz a limpeza física).

export const RECORDS_TRASH_TTL_DAYS = 30;
export const RECORDS_TRASH_TTL_MS = RECORDS_TRASH_TTL_DAYS * 86_400_000;

/** Registro na lixeira ainda dentro da janela de 30 dias? */
export function withinRecordsTrashTtl(
  deletedAt: string | null,
  now: number = Date.now()
): boolean {
  return now - new Date(deletedAt ?? 0).getTime() < RECORDS_TRASH_TTL_MS;
}

/** "Expira em N dias" (teto: recém-excluído = 30 dias; vencido = "Expira hoje"). */
export function recordsTrashExpiryLabel(
  deletedAt: string | null,
  now: number = Date.now()
): string {
  const at = deletedAt ? new Date(deletedAt).getTime() : now;
  const days = Math.ceil((at + RECORDS_TRASH_TTL_MS - now) / 86_400_000);
  if (days <= 0) return "Expira hoje";
  return days === 1 ? "Expira em 1 dia" : `Expira em ${days} dias`;
}
