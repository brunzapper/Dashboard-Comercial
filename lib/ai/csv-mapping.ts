// Versão: 1.0 | Data: 30/07/2026
// NÚCLEO da sugestão de mapeamento de CSV por IA (wizard de /registros/
// importar, etapa 3). A IA resolve colunas com nomes diferentes dos campos e
// propõe campo novo para as sem destino — mas SÓ SUGERE: o resultado preenche
// o estado `plans` do wizard e o usuário revisa na tabela existente (a revisão
// é a confirmação). O fluxo de import em si (prepareImportFields/
// importCsvChunk/ingestRows) fica INTOCADO. Gate = admin (mesmo do wizard);
// as amostras de coluna vêm do CSV já parseado no browser — nenhuma consulta
// a registros aqui.
import "server-only";

import { getSessionInfo } from "@/lib/auth/session";
import { getActiveOrgId } from "@/lib/auth/org";
import { createClient } from "@/lib/supabase/server";
import { loadOrgAiConfig } from "@/lib/ai/config";
import { runJsonGenerationLoop } from "@/lib/ai/json-loop";
import { loadSources } from "@/lib/config/sources";
import { fieldAppliesToSource } from "@/lib/sources";
import { isCoreDef } from "@/lib/records/core-defs";
import { DATA_TYPE_LABELS, type DataType } from "@/lib/records/types";
import { buildCsvMappingPromptText } from "@/lib/import/csv-mapping/instructions";
import {
  validateCsvMapping,
  type CsvMappingItem,
  type CsvMappingValidation,
} from "@/lib/import/csv-mapping/validate";

const MAX_COLUMNS = 80; // teto de colunas enviadas ao prompt
const MAX_SAMPLES = 8; // amostras por coluna

export interface SuggestCsvMappingInput {
  /** Base alvo escolhida na etapa 2 do wizard. */
  sourceKey: string;
  /** Colunas do CSV com amostras de valores (do parse no browser). */
  columns: { name: string; samples: string[] }[];
}

export interface SuggestCsvMappingState {
  ok: boolean;
  message?: string;
  errors?: string[];
  /** Sugestão por coluna — o wizard aplica ao estado `plans`. */
  items?: CsvMappingItem[];
  warnings?: string[];
}

export async function suggestCsvMappingCore(
  input: SuggestCsvMappingInput
): Promise<SuggestCsvMappingState> {
  const session = await getSessionInfo();
  if (!session) return { ok: false, message: "Sessão expirada." };
  if (!session.roles.includes("admin")) {
    return { ok: false, message: "Apenas administradores importam CSV." };
  }
  const columns = input.columns
    .map((c) => ({
      name: String(c.name ?? "").trim(),
      samples: (c.samples ?? []).map(String).slice(0, MAX_SAMPLES),
    }))
    .filter((c) => c.name !== "")
    .slice(0, MAX_COLUMNS);
  if (columns.length === 0) {
    return { ok: false, message: "Nenhuma coluna de CSV para mapear." };
  }

  const supabase = await createClient();
  const sources = await loadSources(supabase);
  const sourceDef = sources.find((s) => s.key === input.sourceKey && !s.parentKey);
  if (!sourceDef) return { ok: false, message: "Base inválida." };

  const orgId = await getActiveOrgId();
  const aiConfig = orgId ? await loadOrgAiConfig(orgId) : null;
  if (!aiConfig) {
    return {
      ok: false,
      message:
        "IA não configurada para a organização — um administrador define o provedor em Configurações → Integrações.",
    };
  }

  // Campos existentes que podem RECEBER valores nesta base (mesmo recorte da
  // página do wizard: sem calculados, sem linhas core, applies_to da base).
  const { data: defsData } = await supabase
    .from("field_definitions")
    .select("field_key, label, data_type, applies_to, source_system")
    .not("data_type", "in", "(calculado,calculado_agg)")
    .order("label");
  const customFields = ((defsData ?? []) as {
    field_key: string;
    label: string | null;
    data_type: string;
    applies_to: string[] | null;
    source_system: string | null;
  }[]).filter(
    (f) =>
      !isCoreDef(f) &&
      fieldAppliesToSource(f.applies_to, sourceDef.key, sources)
  );

  const system = buildCsvMappingPromptText({
    baseLabel: `${sourceDef.label} ("${sourceDef.key}")`,
    columnsJson: JSON.stringify(
      columns.map((c) => ({ coluna: c.name, amostras: c.samples })),
      null,
      2
    ),
    customFieldsJson: JSON.stringify(
      customFields.map((f) => ({
        ref: `custom:${f.field_key}`,
        rotulo: f.label ?? f.field_key,
        tipo: DATA_TYPE_LABELS[f.data_type as DataType] ?? f.data_type,
      })),
      null,
      2
    ),
  });

  const ctx = {
    csvColumns: columns.map((c) => c.name),
    customFieldKeys: customFields.map((f) => f.field_key),
  };
  const result = await runJsonGenerationLoop<
    Extract<CsvMappingValidation, { ok: true }>
  >({
    config: aiConfig,
    system,
    priorTurns: [],
    description:
      "Proponha o mapeamento de TODAS as colunas listadas em COLUNAS DO CSV.",
    validate: (raw) => {
      const v = validateCsvMapping(raw, ctx);
      return v.ok ? { ok: true, value: v } : { ok: false, errors: v.errors };
    },
  });
  if (!result.ok) {
    return { ok: false, message: result.message, errors: result.errors };
  }
  return {
    ok: true,
    message: "Sugestão aplicada — revise cada destino antes de continuar.",
    items: result.value.items,
    warnings: result.value.warnings,
  };
}
