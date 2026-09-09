// Versão: 1.2 | Data: 09/09/2026
// v1.2 (09/09/2026): o seed passa a rodar UMA VEZ por organização, marcado em
//   `sync_config` ('workflow_seeded'). Ensure-if-absent por `key` era certo
//   enquanto não dava para EXCLUIR um esquema: agora, excluir o de fábrica e
//   voltar à página o traria de volta — "excluir" seria uma promessa que a tela
//   desmente na visita seguinte. Entra também `workflowKeyFromLabel`, que
//   deriva a chave do rótulo (o usuário nomeia o fluxo, não a identidade dele).
// Versão: 1.1 | Data: 08/09/2026
// v1.1 (08/09/2026): o esquema carrega GATILHO e SUPERFÍCIE (0126). Entra
//   `loadFormSchemaCards` — a leitura enxuta que o hub e o layout de /operacao
//   fazem por request para montar os cards, sem trazer o `definition` inteiro
//   (que é grande e não é usado para desenhar um card).
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

/** Marcador do seed por org (uma linha em sync_config, sem migração). */
export const WORKFLOW_SEEDED_KEY = "workflow_seeded";

/**
 * Chave de um esquema a partir do rótulo. O usuário nomeia o FLUXO; a chave é
 * identidade (imutável, e é ela que a URL do formulário usa), então é derivada
 * e não perguntada. Mesmo slug do CHECK da 0125: começa por letra, minúsculas,
 * dígitos e `_`, até 40 caracteres.
 */
export function workflowKeyFromLabel(label: string): string {
  const base = label
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40)
    .replace(/_+$/g, "");
  // Rótulo só de símbolos/dígitos não gera chave válida — nome genérico é
  // melhor que uma chave que o banco recusa.
  return /^[a-z]/.test(base) ? base : `fluxo_${base}`.slice(0, 40);
}

/**
 * Primeira chave livre a partir do rótulo. Colisão ganha sufixo numérico —
 * precedente da action de Bases, onde `data_sources.key` faz o mesmo.
 */
export function uniqueWorkflowKey(label: string, taken: Set<string>): string {
  const base = workflowKeyFromLabel(label);
  if (!taken.has(base)) return base;
  for (let i = 2; i < 100; i += 1) {
    const suffix = `_${i}`;
    const candidate = `${base.slice(0, 40 - suffix.length)}${suffix}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${base.slice(0, 34)}_${Date.now().toString(36).slice(-5)}`;
}

/** O que inicia o esquema — e, por consequência, onde ele aparece. */
export type WorkflowTriggerKind = "form" | "automacao";

export interface WorkflowSchemaRow {
  id: string;
  key: string;
  label: string;
  description: string | null;
  enabled: boolean;
  triggerKind: WorkflowTriggerKind;
  /** Formulário aparece como card no hub (false = existe só pela URL). */
  showCard: boolean;
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
  trigger_kind: string | null;
  show_card: boolean | null;
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
    // Coluna nova (0126): linha anterior à migração é formulário com card —
    // era o único comportamento que existia.
    triggerKind: r.trigger_kind === "automacao" ? "automacao" : "form",
    showCard: r.show_card !== false,
    definition: parseWorkflowDefinition(r.definition),
    updatedAt: r.updated_at,
  };
}

const SELECT =
  "id, key, label, description, enabled, trigger_kind, show_card, definition, updated_at";

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

/** O mínimo para desenhar um card/sub-aba — sem o `definition`. */
export interface WorkflowFormCard {
  key: string;
  label: string;
  description: string | null;
}

/**
 * Formulários ATIVOS da org que pedem card. Leitura por request do hub e do
 * layout de /operacao, então traz só as quatro colunas do card — puxar o
 * `definition` de cada esquema para escrever um título seria payload à toa.
 *
 * Falha de leitura devolve lista vazia: o hub perde os cards de formulário,
 * nunca a página inteira (mesma resiliência de loadSources).
 */
export async function loadFormSchemaCards(
  db: SupabaseClient,
  orgId: string | null
): Promise<WorkflowFormCard[]> {
  let query = db
    .from("workflow_schemas")
    .select("key, label, description")
    .eq("enabled", true)
    .eq("trigger_kind", "form")
    .eq("show_card", true)
    .order("label");
  if (orgId) query = query.eq("organization_id", orgId);
  const { data, error } = await query;
  if (error || !data) return [];
  return data.map((r) => ({
    key: r.key as string,
    label: r.label as string,
    description: (r.description as string | null) ?? null,
  }));
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

  // Semeia UMA VEZ por org. Sem este marcador, excluir o esquema de fábrica e
  // voltar à página o traria de volta.
  const { data: mark } = await db
    .from("sync_config")
    .select("key")
    .eq("organization_id", orgId)
    .eq("key", WORKFLOW_SEEDED_KEY)
    .maybeSingle();
  if (mark) return;

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
  // Marca ANTES de sair: org que já tem o esquema (semeada na versão anterior)
  // não deve ser re-semeada se um dia ele for excluído.
  const mark_ = async () => {
    await db
      .from("sync_config")
      .upsert(
        {
          organization_id: orgId,
          key: WORKFLOW_SEEDED_KEY,
          value: { at: new Date().toISOString() },
        },
        { onConflict: "organization_id,key" }
      );
  };
  if (missing.length === 0) {
    await mark_();
    return;
  }

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
    return;
  }
  await mark_();
}
