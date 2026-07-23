// Versão: 1.1 | Data: 23/07/2026
// v1.1 (23/07/2026): multi-Base — o usuário marca UMA OU VÁRIAS Bases; o
//   prompt leva o modelo e a amostra (cobertura de colunas) de CADA Base
//   marcada + as Conexões (match_rules habilitadas) que as ligam, para a IA
//   montar dashboards combinados (unified:/match:/conversões entre Bases).
// Server action do botão "Copiar prompt" do modo "Importar dashboard (IA)":
// monta o texto copiado para o clipboard = especificação do JSON
// (lib/import/dashboard/instructions.ts) + MODELO DAS BASES selecionadas
// (campos core + personalizados com tipos/opções, Sub-bases, campos
// unificados, conexões, nomes de responsáveis/operações) + AMOSTRAS de ~20
// registros POR BASE com COBERTURA GARANTIDA de colunas
// (lib/import/dashboard/sample.ts): janela recente + busca complementar por
// coluna descoberta + nova passada gulosa. A variante "completo" anexa o
// manual de construção (docs/) lido do disco — o arquivo é incluído no bundle
// da Vercel via outputFileTracingIncludes (next.config.ts).
"use server";

import { promises as fs } from "fs";
import path from "path";

import { getSessionInfo } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { loadSources } from "@/lib/config/sources";
import { fieldAppliesToSource, recordTypeOf, type SourceDef } from "@/lib/sources";
import { CORE_FIELDS } from "@/lib/widgets/fields";
import { isCoreDef } from "@/lib/records/core-defs";
import type { DataType } from "@/lib/records/types";
import {
  isSampleValueFilled,
  sampleRefValue,
  selectCoverageSample,
  SAMPLE_TARGET,
  type SampleRecordLike,
} from "@/lib/import/dashboard/sample";
import { buildImportPromptText } from "@/lib/import/dashboard/instructions";

export type ImportPromptVariant = "compacto" | "completo";

export interface ImportPromptState {
  ok?: boolean;
  message?: string;
  prompt?: string;
}

// Mesmas colunas da tela de Registros (a amostra mostra o registro inteiro).
const RECORD_COLS =
  "id, record_type, source_system, title, pipeline, stage, value, mrr, currency, sale_type, channel, closed, closed_at, opened_at, source_created_at, responsible_id, operation_id, lead_time_days, custom_fields";

// Colunas do núcleo expostas na amostra/modelo (subset com significado de
// negócio; carimbos internos ficam de fora).
const SAMPLE_CORE_REFS = [
  "title",
  "pipeline",
  "stage",
  "value",
  "mrr",
  "currency",
  "sale_type",
  "channel",
  "closed",
  "closed_at",
  "opened_at",
  "source_created_at",
  "responsible_id",
  "operation_id",
  "lead_time_days",
] as const;

const WINDOW_ROWS = 400; // janela recente varrida pela seleção gulosa
const MAX_COMPLEMENT_QUERIES = 40; // teto de buscas por coluna descoberta (por Base)
const MAX_STR = 200; // trunca strings longas na amostra

const MANUAL_PATH = path.join(
  process.cwd(),
  "docs",
  "manual-de-construcao-de-dashboards.md"
);

interface FieldDefRow {
  field_key: string;
  label: string | null;
  data_type: DataType;
  options: string[] | null;
  applies_to: string[] | null;
  source_system: string | null;
  show_in_builder: boolean | null;
}

function coreTypeOf(f: (typeof CORE_FIELDS)[number]): string {
  if (f.isDate) return "data";
  if (f.isMoney) return "moeda";
  if (f.isNumeric) return "numero";
  return "texto";
}

function truncate(v: unknown): unknown {
  if (typeof v === "string" && v.length > MAX_STR) {
    return `${v.slice(0, MAX_STR)}…`;
  }
  return v;
}

// Amostra de UMA Base: janela recente + gulosa; colunas descobertas ganham 1
// busca complementar cada e a seleção roda de novo sobre a união.
async function sampleForBase(
  supabase: Awaited<ReturnType<typeof createClient>>,
  recordType: string,
  refs: string[]
): Promise<{ rows: SampleRecordLike[]; uncoveredRefs: string[] }> {
  const { data: windowData } = await supabase
    .from("records")
    .select(RECORD_COLS)
    .eq("record_type", recordType)
    .eq("is_mock", false)
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
        .select(RECORD_COLS)
        .eq("record_type", recordType)
        .eq("is_mock", false)
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

export async function buildImportPrompt(
  sourceKeys: string[],
  variant: ImportPromptVariant
): Promise<ImportPromptState> {
  const session = await getSessionInfo();
  if (!session) return { ok: false, message: "Sessão expirada." };
  if (!session.permissions.includes("create_dashboards")) {
    return { ok: false, message: "Você não tem permissão para criar dashboards." };
  }
  const supabase = await createClient();
  const sources = await loadSources(supabase);
  const selected: SourceDef[] = [];
  for (const key of sourceKeys) {
    const def = sources.find((s) => s.key === key && !s.parentKey);
    if (def && !selected.some((s) => s.key === def.key)) selected.push(def);
  }
  if (selected.length === 0) {
    return { ok: false, message: "Selecione ao menos uma Base válida." };
  }
  const selectedTypes = new Set(selected.map((b) => recordTypeOf(b.key, sources)));

  // ---- Catálogos compartilhados (uma consulta só) ----
  const [
    { data: defsData },
    { data: corrData },
    { data: respData },
    { data: opData },
    { data: matchData },
  ] = await Promise.all([
    supabase
      .from("field_definitions")
      .select(
        "field_key, label, data_type, options, applies_to, source_system, show_in_builder"
      )
      .order("sort_order", { ascending: true }),
    supabase
      .from("field_correspondences")
      .select("key, label, field_correspondence_members(source_key, field_ref)"),
    supabase.from("responsibles").select("id, display_name").eq("active", true),
    supabase.from("operations").select("id, name"),
    supabase
      .from("match_rules")
      .select("label, source_a, source_b, field_a_1, field_b_1, field_a_2, field_b_2")
      .eq("enabled", true),
  ]);
  const defs = (defsData ?? []) as FieldDefRow[];
  const respLabels = new Map(
    ((respData ?? []) as { id: string; display_name: string | null }[]).map(
      (r) => [r.id, r.display_name ?? r.id]
    )
  );
  const opLabels = new Map(
    ((opData ?? []) as { id: string; name: string | null }[]).map((o) => [
      o.id,
      o.name ?? o.id,
    ])
  );
  const sourceKeyByType = new Map(
    sources.filter((s) => !s.parentKey).map((s) => [s.recordType, s.key])
  );

  // Conexões (regras de match) que tocam alguma Base selecionada — habilitam
  // os refs `match:<base>:<ref>` entre os pares listados.
  const conexoes = ((matchData ?? []) as {
    label: string;
    source_a: string;
    source_b: string;
    field_a_1: string;
    field_b_1: string;
    field_a_2: string | null;
    field_b_2: string | null;
  }[])
    .filter((m) => selectedTypes.has(m.source_a) || selectedTypes.has(m.source_b))
    .map((m) => ({
      label: m.label,
      base_a: sourceKeyByType.get(m.source_a) ?? m.source_a,
      base_b: sourceKeyByType.get(m.source_b) ?? m.source_b,
      pares_de_campos: [
        { a: m.field_a_1, b: m.field_b_1 },
        ...(m.field_a_2 && m.field_b_2
          ? [{ a: m.field_a_2, b: m.field_b_2 }]
          : []),
      ],
    }));

  // ---- Modelo por Base + amostras por Base ----
  const customDefsOf = (base: SourceDef) =>
    defs.filter(
      (d) =>
        !isCoreDef(d) &&
        d.show_in_builder !== false &&
        fieldAppliesToSource(d.applies_to, base.key, sources)
    );

  const baseModels: unknown[] = [];
  const sampleBlocks: unknown[] = [];
  let anyRows = false;
  for (const base of selected) {
    const recordType = recordTypeOf(base.key, sources);
    const customDefs = customDefsOf(base);
    baseModels.push({
      key: base.key,
      label: base.label,
      record_type: recordType,
      campo_de_data_padrao: base.defaultPeriodField,
      sub_bases: sources
        .filter((s) => s.parentKey === base.key)
        .map((s) => ({
          key: s.key,
          label: s.label,
          campo_de_data: s.defaultPeriodField,
          recorte: s.filter ?? [],
        })),
      campos_personalizados: customDefs.map((d) => ({
        ref: `custom:${d.field_key}`,
        label: d.label ?? d.field_key,
        tipo: d.data_type,
        ...(d.options && d.options.length > 0 ? { opcoes: d.options } : {}),
      })),
    });

    const refs = [
      ...SAMPLE_CORE_REFS,
      ...customDefs
        .filter((d) => d.data_type !== "calculado_agg")
        .map((d) => `custom:${d.field_key}`),
    ];
    const { rows, uncoveredRefs } = await sampleForBase(
      supabase,
      recordType,
      refs
    );
    anyRows = anyRows || rows.length > 0;
    const registros = rows.map((row) => {
      const out: Record<string, unknown> = {};
      for (const ref of refs) {
        const raw = sampleRefValue(row, ref);
        if (!isSampleValueFilled(raw)) continue; // amostra compacta: só preenchidos
        if (ref === "responsible_id") {
          out[ref] = respLabels.get(String(raw)) ?? "(nome não cadastrado)";
        } else if (ref === "operation_id") {
          out[ref] = opLabels.get(String(raw)) ?? "(nome não cadastrado)";
        } else {
          out[ref] = truncate(raw);
        }
      }
      return out;
    });
    sampleBlocks.push({
      base: base.key,
      observacoes:
        rows.length === 0
          ? "Base ainda sem registros — importe os dados dela antes de usar em widgets."
          : uncoveredRefs.length > 0
            ? `Colunas SEM NENHUM dado no banco hoje (existem, mas estão vazias): ${uncoveredRefs.join(", ")}.`
            : "Todas as colunas têm pelo menos um exemplo preenchido na amostra.",
      registros,
    });
  }
  if (!anyRows) {
    return {
      ok: false,
      message:
        "As Bases selecionadas ainda não têm registros — importe os dados primeiro (Registros → Importar).",
    };
  }

  const model = {
    bases: baseModels,
    outras_bases: sources
      .filter((s) => !s.parentKey && !selected.some((b) => b.key === s.key))
      .map((s) => ({
        key: s.key,
        label: s.label,
        record_type: s.recordType,
        campo_de_data_padrao: s.defaultPeriodField,
      })),
    colunas_do_nucleo: CORE_FIELDS.map((f) => ({
      ref: f.field,
      label: f.label,
      tipo: coreTypeOf(f),
    })),
    campos_unificados: ((corrData ?? []) as {
      key: string;
      label: string | null;
      field_correspondence_members: { source_key: string; field_ref: string }[];
    }[]).map((c) => ({
      ref: `unified:${c.key}`,
      label: c.label ?? c.key,
      membros: c.field_correspondence_members,
    })),
    conexoes,
    responsaveis: [...respLabels.values()].sort(),
    operacoes: [...opLabels.values()].sort(),
  };

  const sampleNote = [
    "Um bloco de amostra por Base (chaves ausentes num registro = campo vazio nele).",
    "responsible_id/operation_id mostram o NOME cadastrado (no banco são ids);",
    "em condições de fórmula, compare por esse nome.",
  ].join("\n");

  // ---- Variante "completo": anexa o manual de construção inteiro ----
  let manual: string | undefined;
  if (variant === "completo") {
    try {
      manual = await fs.readFile(MANUAL_PATH, "utf8");
    } catch {
      manual = undefined; // segue sem o anexo (o prompt compacto é completo em si)
    }
  }

  const prompt = buildImportPromptText({
    basesLabel: selected.map((b) => `${b.label} ("${b.key}")`).join(", "),
    baseModelJson: JSON.stringify(model, null, 2),
    sampleJson: JSON.stringify(sampleBlocks, null, 2),
    sampleNote,
    manual,
  });
  return {
    ok: true,
    prompt,
    message:
      variant === "completo" && !manual
        ? "Prompt copiado (não foi possível anexar o manual completo — usada a versão compacta)."
        : undefined,
  };
}
