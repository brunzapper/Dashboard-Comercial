// Versão: 1.0 | Data: 09/10/2026
// v1.0 (09/10/2026): quais regras viram TRONCO de série na Tree.
//
// O tronco da árvore são as ocorrências PREVISTAS (derivadas do calendário),
// não as tarefas — é isso que deixa o galho vazio de quem ninguém abriu. Mas
// "prevista" só faz sentido enquanto alguém vai abrir a ocorrência: com a
// regra DESLIGADA o tick não cria mais nada, e projetar o calendário dela
// desenharia uma fila de ocorrências que nunca vão existir. Regra desligada não
// projeta; as tarefas que ela já criou seguem como fatos avulsos do registro.
//
// Puro (sem I/O) para o teste pinar a regra sem banco.
import { parseAutomationRule } from "@/lib/kanban/automations/types";
import type { SeriesConfig } from "@/lib/series/types";

export interface SeriesRuleRow {
  id: unknown;
  name: unknown;
  rule: unknown;
  /** Ausente (leitura antiga) = ligada: só um `false` explícito desliga. */
  enabled?: unknown;
}

export interface ProjectableSeries {
  ruleId: string;
  name: string;
  config: SeriesConfig;
}

/**
 * As séries a projetar, na ORDEM de `ruleIds` (a primeira é a primária — é a
 * janela dela que recorta os fatos avulsos).
 */
export function projectableSeries(
  ruleIds: string[],
  rows: SeriesRuleRow[]
): ProjectableSeries[] {
  const byId = new Map(rows.map((r) => [String(r.id), r]));
  const out: ProjectableSeries[] = [];
  for (const id of ruleIds) {
    const row = byId.get(id);
    if (!row) continue;
    // v1.0 (09/10/2026): regra desligada não projeta ocorrências.
    if (row.enabled === false) continue;
    const parsed = parseAutomationRule(row.rule);
    if (parsed?.action.type !== "create_task_series") continue;
    out.push({
      ruleId: id,
      name: (row.name as string) || "",
      config: parsed.action.series,
    });
  }
  return out;
}
