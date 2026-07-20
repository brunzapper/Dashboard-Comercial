// Versão: 1.0 | Data: 20/07/2026
// Registry PURO das métricas de meta (goals.metric). `goals.metric` sempre
// foi texto livre no banco (0016); este módulo dá vocabulário/rótulo às
// chaves: os builtins ('mrr' monetária, 'clientes') + métricas criadas pelo
// admin na tela de Metas (persistidas em sync_config 'goal_metrics' —
// lib/config/goal-metrics.ts). KPI modo meta e a linha de meta dos gráficos
// (goalLine) referenciam essas chaves; o REALIZADO nunca vem daqui — é a
// consulta do próprio widget.

export interface GoalMetricDef {
  key: string;
  label: string;
  /** Metas monetárias formatam alvo/falta como R$. */
  money?: boolean;
}

export const BUILTIN_GOAL_METRICS: GoalMetricDef[] = [
  { key: "mrr", label: "MRR", money: true },
  { key: "clientes", label: "Clientes" },
];

function cleanKey(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim().toLowerCase();
  return /^[a-z0-9_]{1,40}$/.test(s) ? s : null;
}

function cleanLabel(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return s.length > 0 && s.length <= 60 ? s : null;
}

/**
 * Builtins + métricas custom (valor cru do sync_config, tolerante a
 * ausente/inválido). Chave custom que colide com builtin é ignorada.
 */
export function mergeGoalMetrics(value: unknown): GoalMetricDef[] {
  const out = [...BUILTIN_GOAL_METRICS];
  const seen = new Set(out.map((m) => m.key));
  if (Array.isArray(value)) {
    for (const item of value) {
      const raw = (item ?? {}) as Record<string, unknown>;
      const key = cleanKey(raw.key);
      if (!key || seen.has(key)) continue;
      const label = cleanLabel(raw.label) ?? key;
      seen.add(key);
      out.push({ key, label, money: raw.money === true });
    }
  }
  return out;
}

/** Rótulo de uma chave; desconhecida exibe a própria chave (nunca esconder). */
export function goalMetricLabel(
  key: string,
  registry: GoalMetricDef[]
): string {
  return registry.find((m) => m.key === key)?.label ?? key;
}

/** Slug de chave a partir de um rótulo digitado ("SQL Inbound" → "sql_inbound"). */
export function goalMetricKeyFromLabel(label: string): string {
  return label
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
}
