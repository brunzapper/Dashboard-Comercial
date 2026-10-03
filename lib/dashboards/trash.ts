// Versão: 1.0 | Data: 03/10/2026
// Helpers PUROS da Lixeira de boards do hub (0087): janela de retenção de 14
// dias + rótulo de expiração. Espelham os de registros (lib/records/trash.ts,
// TTL 30d — registro é DADO, board é chrome).
//
// v1.0 (03/10/2026): extraídos de components/home/hub-cards.tsx. Aquele módulo
// virou "use client" (v2.0, 12/09/2026), e o Workspace (app/(app)/page.tsx, um
// Server Component) seguia CHAMANDO withinTrashTtl dele. Função importada de
// módulo client chega ao servidor como REFERÊNCIA de cliente, e chamá-la lança
// erro. Como a chamada ficava atrás de `status === "trashed" &&`, o Workspace
// só quebrava com algum board na Lixeira. Aqui, sem diretiva, o módulo serve aos
// dois lados.

export const BOARDS_TRASH_TTL_DAYS = 14;
export const BOARDS_TRASH_TTL_MS = BOARDS_TRASH_TTL_DAYS * 86_400_000;

/** Board na Lixeira ainda dentro da janela de 14 dias? */
export function withinBoardsTrashTtl(
  trashedAt: string | null,
  now: number = Date.now()
): boolean {
  return now - new Date(trashedAt ?? 0).getTime() < BOARDS_TRASH_TTL_MS;
}

/** "Expira em N dias" do card na Lixeira (teto: recém-excluído = 14 dias). */
export function boardsTrashExpiryLabel(
  trashedAt: string | null,
  now: number = Date.now()
): string {
  const at = trashedAt ? new Date(trashedAt).getTime() : now;
  const days = Math.ceil((at + BOARDS_TRASH_TTL_MS - now) / 86_400_000);
  if (days <= 0) return "Expira hoje";
  return days === 1 ? "Expira em 1 dia" : `Expira em ${days} dias`;
}
