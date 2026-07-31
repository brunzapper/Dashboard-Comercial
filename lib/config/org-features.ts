// Versão: 1.0 | Data: 31/07/2026
// Recursos SOB DEMANDA por organização (0114): catálogo + parse + loaders da
// tabela `org_features` (uma linha por org, jsonb { "<feature>": true }).
// Semântica FAIL-CLOSED: sem linha, sem chave ou valor não-true = recurso
// DESLIGADO; chave desconhecida é descartada no normalize. A escrita é
// service-role-only (console /owner — app/owner/actions.ts): recurso sob
// demanda é decisão do app owner, nunca do org_admin. O gate de ÁREA vive em
// lib/auth/access.ts (AREA_FEATURES — feature-off vence até override allow);
// o de PRESET em PresetDashboard.requiresFeature (lista + applyPreset +
// generatePresets). Dados existentes nunca são apagados/escondidos por aqui.
import { cache } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";

// Catálogo dos recursos sob demanda (fonte de verdade do console /owner e da
// validação da action). Adicionar recurso novo = entrada aqui + gates.
export const ORG_FEATURES = [
  {
    key: "remuneracao",
    label: "Remuneração variável",
    description:
      "Planos de remuneração, grade mensal com publicação em espelho e o " +
      "preset Remuneração Variável (construído sob demanda).",
  },
] as const;

export type OrgFeatureKey = (typeof ORG_FEATURES)[number]["key"];

export type OrgFeatureMap = Record<OrgFeatureKey, boolean>;

const FEATURE_KEYS = new Set<string>(ORG_FEATURES.map((f) => f.key));

/** Parse fail-closed do jsonb `features`: só chaves do catálogo, só `true`
 * literal liga; qualquer outra coisa (linha ausente, lixo, string "true")
 * fica desligado. */
export function normalizeOrgFeatures(v: unknown): OrgFeatureMap {
  const out = Object.fromEntries(
    ORG_FEATURES.map((f) => [f.key, false])
  ) as OrgFeatureMap;
  if (typeof v !== "object" || v === null || Array.isArray(v)) return out;
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    if (FEATURE_KEYS.has(k) && val === true) out[k as OrgFeatureKey] = true;
  }
  return out;
}

/** Features da org (client do usuário — a RLS de select cobre membros; o
 * viewer público nunca chama isto). Falha de consulta = tudo off. */
export const loadOrgFeatures = cache(async function loadOrgFeatures(
  supabase: SupabaseClient,
  orgId: string | null
): Promise<OrgFeatureMap> {
  if (!orgId) return normalizeOrgFeatures(null);
  try {
    const { data } = await supabase
      .from("org_features")
      .select("features")
      .eq("organization_id", orgId)
      .maybeSingle();
    return normalizeOrgFeatures(data?.features ?? null);
  } catch {
    return normalizeOrgFeatures(null);
  }
});
