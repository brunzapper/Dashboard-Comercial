// Versão: 1.0 | Data: 08/09/2026
// Carga e persistência dos esquemas de Workflow (0125).
//
// O seed de fábrica é ENSURE-IF-ABSENT por `key`: uma vez criado, o esquema é
// do admin — reaplicar nunca sobrescreve a configuração dele (mesmo contrato do
// `presetKey` nos presets de dashboard). É a diferença entre "trazer o
// formulário pronto" e "desfazer a customização a cada visita à página".
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  BITRIX_LEAD_FORM_DESCRIPTION,
  BITRIX_LEAD_FORM_KEY,
  BITRIX_LEAD_FORM_LABEL,
  bitrixLeadFormDefinition,
} from "./seeds/bitrix-lead-form";
import { parseWorkflowDefinition, type WorkflowDefinition } from "./types";

export interface WorkflowSchemaRow {
  id: string;
  key: string;
  label: string;
  description: string | null;
  enabled: boolean;
  /** null = o jsonb não passou no parse fail-closed (a UI diz isso). */
  definition: WorkflowDefinition | null;
  updatedAt: string | null;
}

interface RawRow {
  id: string;
  key: string;
  label: string;
  description: string | null;
  enabled: boolean;
  definition: unknown;
  updated_at: string | null;
}

function toRow(r: RawRow): WorkflowSchemaRow {
  return {
    id: r.id,
    key: r.key,
    label: r.label,
    description: r.description,
    enabled: r.enabled,
    definition: parseWorkflowDefinition(r.definition),
    updatedAt: r.updated_at,
  };
}

const SELECT = "id, key, label, description, enabled, definition, updated_at";

export async function loadWorkflowSchemas(
  db: SupabaseClient,
  orgId: string | null
): Promise<WorkflowSchemaRow[]> {
  let query = db.from("workflow_schemas").select(SELECT).order("label");
  if (orgId) query = query.eq("organization_id", orgId);
  const { data, error } = await query;
  if (error || !data) return [];
  return (data as RawRow[]).map(toRow);
}

export async function loadWorkflowSchemaByKey(
  db: SupabaseClient,
  orgId: string | null,
  key: string
): Promise<WorkflowSchemaRow | null> {
  let query = db.from("workflow_schemas").select(SELECT).eq("key", key);
  if (orgId) query = query.eq("organization_id", orgId);
  const { data, error } = await query.maybeSingle();
  if (error || !data) return null;
  return toRow(data as RawRow);
}

/**
 * Garante os esquemas de fábrica da org. Idempotente e NÃO destrutivo: o
 * esquema que já existe é deixado exatamente como está, inclusive desligado.
 * Best-effort — a página não deixa de abrir porque o seed falhou.
 */
export async function ensureDefaultWorkflowSchemas(
  db: SupabaseClient,
  orgId: string
): Promise<void> {
  const factory = [
    {
      key: BITRIX_LEAD_FORM_KEY,
      label: BITRIX_LEAD_FORM_LABEL,
      description: BITRIX_LEAD_FORM_DESCRIPTION,
      definition: bitrixLeadFormDefinition(),
    },
  ];

  const { data, error } = await db
    .from("workflow_schemas")
    .select("key")
    .eq("organization_id", orgId);
  if (error) {
    console.error(`ensureDefaultWorkflowSchemas: leitura falhou: ${error.message}`);
    return;
  }
  const present = new Set((data ?? []).map((r) => r.key as string));
  const missing = factory.filter((f) => !present.has(f.key));
  if (missing.length === 0) return;

  const { error: insErr } = await db.from("workflow_schemas").insert(
    missing.map((f) => ({
      organization_id: orgId,
      key: f.key,
      label: f.label,
      description: f.description,
      definition: f.definition,
      enabled: true,
    }))
  );
  if (insErr) {
    // Corrida entre duas abas cai no índice único — não é erro de verdade.
    console.error(
      `ensureDefaultWorkflowSchemas: insert falhou: ${insErr.message}`
    );
  }
}
