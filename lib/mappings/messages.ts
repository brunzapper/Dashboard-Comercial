// Versão: 1.0 | Data: 07/08/2026
// Textos PUROS da notificação de mapeamentos pendentes (título/descrição da
// tarefa) — módulo sem I/O para os testes não puxarem a cadeia `server-only`
// de lib/webhooks/emit (o I/O vive em lib/mappings/notify.ts).
import { mappingDomain } from "./domains";

const MAX_LISTED = 30;

export function unmappedTaskTitle(domainKey: string): string {
  const label = mappingDomain(domainKey)?.label ?? domainKey;
  return `Mapeamentos pendentes — ${label}`;
}

/** Descrição da tarefa de pendências (valores ordenados por volume). */
export function unmappedTaskDescription(
  domainKey: string,
  tally: Map<string, number>
): string {
  const domain = mappingDomain(domainKey);
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
  const fieldLabel = domain?.rawFieldLabel ?? domainKey;
  return (
    `${entries.length} valor(es) de "${fieldLabel}" sem classificação ` +
    `(${total} registro${total === 1 ? "" : "s"} afetado${total === 1 ? "" : "s"}):\n\n` +
    `${head}${rest}\n\n` +
    `Classifique em Workspace → Operação → Mapeamentos (/operacao/mapeamentos) ` +
    `e use "Aplicar agora".`
  );
}
