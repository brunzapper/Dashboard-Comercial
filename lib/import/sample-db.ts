// Versão: 1.0 | Data: 30/07/2026
// Amostragem de registros de UMA Base para prompts de IA — movida VERBATIM de
// app/(app)/dashboards/import-prompt-actions.ts (v1.1) para ser compartilhada
// entre o prompt de dashboards e o de inserção de registros por IA
// (lib/ai/insert-records.ts) sem duplicar a lógica de cobertura.
// Estratégia: janela recente (400 linhas) + seleção gulosa de cobertura de
// colunas (lib/import/dashboard/sample.ts); colunas descobertas ganham 1 busca
// complementar cada e a seleção roda de novo sobre a união. Consulta SEMPRE com
// o client RLS do usuário (isolamento de org/visibilidade de graça).
import "server-only";

import type { createClient } from "@/lib/supabase/server";
import {
  isSampleValueFilled,
  sampleRefValue,
  selectCoverageSample,
  SAMPLE_TARGET,
  type SampleRecordLike,
} from "@/lib/import/dashboard/sample";

type Supabase = Awaited<ReturnType<typeof createClient>>;

// Mesmas colunas da tela de Registros (a amostra mostra o registro inteiro).
export const SAMPLE_RECORD_COLS =
  "id, record_type, source_system, title, pipeline, stage, value, mrr, currency, sale_type, channel, closed, closed_at, opened_at, source_created_at, responsible_id, operation_id, lead_time_days, custom_fields";

const WINDOW_ROWS = 400; // janela recente varrida pela seleção gulosa
const MAX_COMPLEMENT_QUERIES = 40; // teto de buscas por coluna descoberta (por Base)
const MAX_STR = 200; // trunca strings longas na amostra

/** Trunca strings longas de amostra (convenção dos prompts de IA). */
export function truncateSampleValue(v: unknown): unknown {
  if (typeof v === "string" && v.length > MAX_STR) {
    return `${v.slice(0, MAX_STR)}…`;
  }
  return v;
}

// Amostra de UMA Base: janela recente + gulosa; colunas descobertas ganham 1
// busca complementar cada e a seleção roda de novo sobre a união.
export async function sampleForBase(
  supabase: Supabase,
  recordType: string,
  refs: string[]
): Promise<{ rows: SampleRecordLike[]; uncoveredRefs: string[] }> {
  const { data: windowData } = await supabase
    .from("records")
    .select(SAMPLE_RECORD_COLS)
    .eq("record_type", recordType)
    .eq("is_mock", false)
    // Lixeira (0121): amostras da IA nunca saem da lixeira.
    .is("deleted_at", null)
    .order("source_created_at", { ascending: false, nullsFirst: false })
    .limit(WINDOW_ROWS);
  let pool = (windowData ?? []) as unknown as SampleRecordLike[];
  let picked = selectCoverageSample(pool, refs, SAMPLE_TARGET);

  const toComplement = picked.uncoveredRefs.slice(0, MAX_COMPLEMENT_QUERIES);
  if (toComplement.length > 0 && pool.length > 0) {
    const extras: SampleRecordLike[] = [];
    for (const ref of toComplement) {
      const col = ref.startsWith("custom:")
        ? `custom_fields->>${ref.slice("custom:".length)}`
        : ref;
      const { data } = await supabase
        .from("records")
        .select(SAMPLE_RECORD_COLS)
        .eq("record_type", recordType)
        .eq("is_mock", false)
        .is("deleted_at", null)
        .not(col, "is", null)
        .order("source_created_at", { ascending: false, nullsFirst: false })
        .limit(3);
      for (const row of (data ?? []) as unknown as SampleRecordLike[]) {
        if (isSampleValueFilled(sampleRefValue(row, ref))) {
          extras.push(row);
          break;
        }
      }
    }
    if (extras.length > 0) {
      pool = [...pool, ...extras];
      picked = selectCoverageSample(pool, refs, SAMPLE_TARGET);
    }
  }
  return { rows: picked.rows, uncoveredRefs: picked.uncoveredRefs };
}
