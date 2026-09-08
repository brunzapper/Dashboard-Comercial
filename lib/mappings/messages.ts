// Versão: 1.1 | Data: 07/08/2026
// Textos PUROS da notificação de mapeamentos pendentes (título/descrição da
// tarefa) — módulo sem I/O para os testes não puxarem a cadeia `server-only`
// de lib/webhooks/emit (o I/O vive em lib/mappings/notify.ts). Recebe os
// RÓTULOS por parâmetro (não resolve o registry): desde os domínios
// dinâmicos (0119) o registry efetivo é assíncrono por org — o chamador
// (notify.ts) já tem o domínio carregado em mãos.

const MAX_LISTED = 30;

export function unmappedTaskTitle(domainLabel: string): string {
  return `Mapeamentos pendentes — ${domainLabel}`;
}

/** Descrição da tarefa de pendências (valores ordenados por volume). */
export function unmappedTaskDescription(
  rawFieldLabel: string,
  tally: Map<string, number>
): string {
  const entries = [...tally.entries()].sort((a, b) => b[1] - a[1]);
  const total = entries.reduce((s, [, n]) => s + n, 0);
  const head = entries
    .slice(0, MAX_LISTED)
    .map(([value, n]) => `• ${value} (${n} registro${n === 1 ? "" : "s"})`)
    .join("\n");
  const rest =
    entries.length > MAX_LISTED
      ? `\n…e mais ${entries.length - MAX_LISTED} valores.`
      : "";
  return (
    `${entries.length} valor(es) de "${rawFieldLabel}" sem classificação ` +
    `(${total} registro${total === 1 ? "" : "s"} afetado${total === 1 ? "" : "s"}):\n\n` +
    `${head}${rest}\n\n` +
    `Classifique em Workspace → Operação → Mapeamentos (/operacao/mapeamentos) ` +
    `e use "Aplicar agora".`
  );
}
