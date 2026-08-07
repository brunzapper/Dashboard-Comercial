// Versão: 1.0 | Data: 07/08/2026
// Export PURO (client-safe) de um domínio de mapeamento para trabalhar fora
// do app (IA externa/planilha):
//   - CSV = TEMPLATE das PENDÊNCIAS: cabeçalho `valor;<fieldKeys>` com as
//     colunas de saída vazias — byte-compatível com os aliases aceitos por
//     `csvToClassifyJson` (lib/import/mappings/csv.ts), então o arquivo
//     preenchido COLA de volta no assistente sem conversão. Só pendências:
//     o validador do contrato rejeita valor que não esteja pendente, então
//     linhas já mapeadas quebrariam o round-trip.
//   - JSON = DUMP de trabalho do domínio (campo cru, categorias aceitas,
//     mapeados como exemplos e pendências) — insumo para IA externa; a
//     RESPOSTA volta no formato do contrato (o prompt copiado do assistente
//     já ensina o envelope) ou no próprio CSV.
import { buildCsv } from "@/lib/export/csv";
import type { DomainOverview } from "./overview";

/** CSV template: pendências com colunas de saída vazias. */
export function domainCsv(overview: DomainOverview): string {
  const headers = ["valor", ...overview.targets.map((t) => t.fieldKey)];
  const rows = overview.unmapped.map((u) => [
    u.value,
    ...overview.targets.map(() => ""),
  ]);
  return buildCsv(headers, rows);
}

/** Dump JSON de trabalho: categorias + exemplos mapeados + pendências. */
export function domainJson(overview: DomainOverview): string {
  return JSON.stringify(
    {
      dominio: overview.key,
      rotulo: overview.label,
      campo_cru: overview.rawFieldLabel,
      categorias_aceitas: Object.fromEntries(
        overview.targets.map((t) => [
          t.fieldKey,
          overview.optionsByTarget[t.fieldKey] ?? [],
        ])
      ),
      mapeados: overview.mappings.map((m) => ({
        valor: m.rawValue,
        saidas: m.outputs,
        origem: m.origin,
      })),
      pendentes: overview.unmapped.map((u) => ({
        valor: u.value,
        registros: u.count,
      })),
    },
    null,
    2
  );
}
