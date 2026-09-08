// Versão: 1.0 | Data: 30/07/2026
// NÚCLEO da inserção de registros por IA (/registros → "Inserir com IA").
// Desenho (espelha o fluxo de dashboards): a IA NUNCA escreve —
// generateRecordsCore monta o prompt (catálogo da base + AMOSTRAS reais para
// copiar o formato), roda o laço de autocorreção (lib/ai/json-loop.ts) e
// devolve os registros VALIDADOS para a prévia (só colunas preenchidas,
// edição inline/remap no cliente); applyGeneratedRecordsCore re-valida o JSON
// (possivelmente editado) e insere UM A UM via createRecord — o choke point
// manual existente (lib/records/actions.ts), que herda gates, coerção
// (datas core ancoradas em Brasília), RLS records_insert (ramo manual),
// calculados inline, audit origin 'app', webhook record.created e
// auto-operações. Base alvo SEMPRE do seletor da UI, nunca do JSON. Teto de
// 10 registros por leva (MAX_AI_INSERT_RECORDS). Duplicados por título viram
// AVISO (não bloqueiam).
import "server-only";

import { getSessionInfo } from "@/lib/auth/session";
import { getActiveOrgId } from "@/lib/auth/org";
import { createClient } from "@/lib/supabase/server";
import { loadOrgAiConfig } from "@/lib/ai/config";
import { aiSection, runJsonGenerationLoop } from "@/lib/ai/json-loop";
import { todayBrasiliaIso } from "@/lib/date/today";
import { DATA_TYPE_LABELS, type DataType } from "@/lib/records/types";
import { createRecord } from "@/lib/records/actions";
import { recalcFormulaFieldsForRecords } from "@/lib/records/recalc";
import {
  isSampleValueFilled,
  sampleRefValue,
} from "@/lib/import/dashboard/sample";
import { sampleForBase, truncateSampleValue } from "@/lib/import/sample-db";
import { buildRecordsPromptText } from "@/lib/import/records/instructions";
import { loadRecordsEntryContext } from "@/lib/import/records/context";
import {
  validateRecordsInsert,
  type RecordsInsertValidation,
} from "@/lib/import/records/validate";
import type {
  EntryFieldSpec,
  EntryRecord,
  ParsedRecordInsert,
  RecordsEntryContext,
} from "@/lib/import/records/types";

export interface GenerateRecordsInput {
  /** Base alvo (seletor da UI — identidade nunca vem do JSON da IA). */
  sourceKey: string;
  /** Pedido deste turno (texto livre/colado). */
  description: string;
  /** Turnos de usuário anteriores da conversa (stateless; cap no laço). */
  priorTurns?: string[];
  /** Prévia pendente (JÁ com edições inline) — a resposta SUBSTITUI inteira. */
  pendingJson?: string;
}

export interface GenerateRecordsState {
  ok: boolean;
  message?: string;
  errors?: string[];
  /** Registros propostos (valores canônicos) — o cliente edita e re-serializa. */
  records?: EntryRecord[];
  /** Catálogo de campos aceitos (colunas, editores e alvos de remap da prévia). */
  fields?: EntryFieldSpec[];
  /** Títulos propostos que JÁ existem na base (aviso, não bloqueia). */
  duplicateTitles?: string[];
  summary?: string[];
  warnings?: string[];
}

export interface ApplyRecordsResultItem {
  index: number;
  title: string;
  ok: boolean;
  id?: string;
  message?: string;
}

export interface ApplyRecordsState {
  ok: boolean;
  message?: string;
  errors?: string[];
  results?: ApplyRecordsResultItem[];
  insertedCount?: number;
}

function typeLabelOf(f: EntryFieldSpec): string {
  return f.dataType === "relacao"
    ? "relação (use o NOME cadastrado)"
    : DATA_TYPE_LABELS[f.dataType as DataType];
}

// Padrão de ilike EXATO (case-insensitive): escapa os curingas do LIKE.
function ilikeExact(s: string): string {
  return s.replace(/([\\%_])/g, "\\$1");
}

type Supabase = Awaited<ReturnType<typeof createClient>>;

// Títulos propostos que já existem na base (comparação case-insensitive).
// ≤10 consultas pontuais indexadas — aviso simples, nunca bloqueia.
async function findDuplicateTitles(
  supabase: Supabase,
  recordType: string,
  records: ParsedRecordInsert[]
): Promise<string[]> {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const r of records) {
    const title = String(r.values.title ?? "").trim();
    const key = title.toLocaleLowerCase("pt-BR");
    if (!title || seen.has(key)) continue;
    seen.add(key);
    const { data } = await supabase
      .from("records")
      .select("id")
      .eq("record_type", recordType)
      .eq("is_mock", false)
      // Lixeira (0121): duplicado na lixeira não conta (restaurar pode
      // recriar o aviso — aceito, é só um aviso).
      .is("deleted_at", null)
      .ilike("title", ilikeExact(title))
      .limit(1);
    if ((data ?? []).length > 0) out.push(title);
  }
  return out;
}

async function buildSystemPrompt(
  supabase: Supabase,
  ctx: RecordsEntryContext,
  pendingJson: string | undefined
): Promise<string> {
  const catalog = {
    base: {
      key: ctx.sourceKey,
      label: ctx.sourceLabel,
      record_type: ctx.recordType,
    },
    campos: ctx.fields.map((f) => ({
      chave: f.key,
      rotulo: f.label,
      tipo: typeLabelOf(f),
      ...(f.options && f.options.length > 0
        ? {
            opcoes: f.options,
            ...(f.strictOptions ? {} : { opcoes_sao_sugestao: true }),
          }
        : {}),
    })),
  };

  // AMOSTRAS: registros reais da base (client RLS), só chaves preenchidas,
  // relações como NOME — o mesmo formato que a IA deve emitir.
  const refs = ctx.fields.map((f) => f.key);
  const { rows, uncoveredRefs } = await sampleForBase(
    supabase,
    ctx.recordType,
    refs
  );
  const respName = new Map(ctx.responsibles.map((r) => [r.id, r.name]));
  const opName = new Map(ctx.operations.map((o) => [o.id, o.name]));
  const registros = rows.map((row) => {
    const out: Record<string, unknown> = {};
    for (const ref of refs) {
      const raw = sampleRefValue(row, ref);
      if (!isSampleValueFilled(raw)) continue;
      if (ref === "responsible_id") {
        out[ref] = respName.get(String(raw)) ?? "(nome não cadastrado)";
      } else if (ref === "operation_id") {
        out[ref] = opName.get(String(raw)) ?? "(nome não cadastrado)";
      } else {
        out[ref] = truncateSampleValue(raw);
      }
    }
    return out;
  });
  const samplesNote =
    rows.length === 0
      ? "Base ainda sem registros — siga os tipos/opções de CAMPOS DA BASE."
      : uncoveredRefs.length > 0
        ? `Copie as convenções destes registros (EXCEÇÃO: datas saem como YYYY-MM-DD na sua resposta). Colunas sem nenhum dado hoje: ${uncoveredRefs.join(", ")}.`
        : "Copie as convenções destes registros (EXCEÇÃO: datas saem como YYYY-MM-DD na sua resposta).";

  let system = buildRecordsPromptText({
    baseLabel: `${ctx.sourceLabel} ("${ctx.sourceKey}")`,
    todayIso: todayBrasiliaIso(),
    catalogJson: JSON.stringify(catalog, null, 2),
    samplesJson: JSON.stringify(registros, null, 2),
    samplesNote,
  });

  const pending = (pendingJson ?? "").trim();
  if (pending) {
    system += aiSection(
      "PRÉVIA PENDENTE (AINDA NÃO APLICADA)",
      "No turno anterior você propôs os registros abaixo (o usuário pode tê-los " +
        "editado na prévia) e a inserção AINDA NÃO foi confirmada. Sua resposta " +
        "deste turno SUBSTITUI a proposta INTEIRA: re-inclua os registros que " +
        "continuarem desejados e aplique os ajustes pedidos.\n\n" +
        pending
    );
  }
  return system;
}

export async function generateRecordsCore(
  input: GenerateRecordsInput
): Promise<GenerateRecordsState> {
  const session = await getSessionInfo();
  if (!session) return { ok: false, message: "Sessão expirada." };
  if (!session.permissions.includes("edit_record_values")) {
    return { ok: false, message: "Você não tem permissão para criar registros." };
  }
  const description = input.description.trim();
  if (!description) {
    return { ok: false, message: "Descreva os registros a inserir." };
  }

  const supabase = await createClient();
  const ctxRes = await loadRecordsEntryContext(
    supabase,
    input.sourceKey,
    session.roles
  );
  if (!ctxRes.ok) return { ok: false, message: ctxRes.message };
  const { ctx } = ctxRes;

  const orgId = await getActiveOrgId();
  const aiConfig = orgId ? await loadOrgAiConfig(orgId) : null;
  if (!aiConfig) {
    return {
      ok: false,
      message:
        "IA não configurada para a organização — um administrador define o provedor em Configurações → Integrações.",
    };
  }

  const system = await buildSystemPrompt(supabase, ctx, input.pendingJson);

  const result = await runJsonGenerationLoop<
    Extract<RecordsInsertValidation, { ok: true }>
  >({
    config: aiConfig,
    system,
    priorTurns: input.priorTurns ?? [],
    description,
    validate: (raw) => {
      const v = validateRecordsInsert(raw, ctx);
      return v.ok ? { ok: true, value: v } : { ok: false, errors: v.errors };
    },
  });
  if (!result.ok) {
    return { ok: false, message: result.message, errors: result.errors };
  }

  const { records, warnings } = result.value;
  const duplicateTitles = await findDuplicateTitles(
    supabase,
    ctx.recordType,
    records
  );
  const allWarnings = [
    ...warnings,
    ...duplicateTitles.map(
      (t) => `Já existe registro com o título "${t}" nesta base (aviso — a inserção não é bloqueada).`
    ),
  ];
  const summary = records.map((r, i) => {
    const n = Object.keys(r.values).length;
    return `${i + 1}. ${String(r.values.title ?? "(sem nome)")} — ${n} campo(s)`;
  });

  return {
    ok: true,
    message:
      "Prévia pronta — revise os registros (edite células ou troque colunas se precisar) e confirme a inserção.",
    records: records.map((r) => r.values),
    fields: ctx.fields,
    duplicateTitles,
    summary,
    warnings: allWarnings,
  };
}

/**
 * Aplica a prévia confirmada: re-valida o JSON (NADA é confiado do cliente —
 * edições inline passam pelo MESMO validador) e insere cada registro via
 * createRecord (FormData idêntico ao do formulário manual). Falha parcial não
 * desfaz os já inseridos — o resultado é POR ITEM (precedente das ações em
 * massa do kanban). Pós-loop: um recalc DIRECIONADO (fórmulas com match: são
 * puladas no inline do createRecord e assentam aqui).
 */
export async function applyGeneratedRecordsCore(
  raw: string,
  args: { sourceKey: string }
): Promise<ApplyRecordsState> {
  const session = await getSessionInfo();
  if (!session) return { ok: false, message: "Sessão expirada." };
  if (!session.permissions.includes("edit_record_values")) {
    return { ok: false, message: "Você não tem permissão para criar registros." };
  }

  const supabase = await createClient();
  const ctxRes = await loadRecordsEntryContext(
    supabase,
    args.sourceKey,
    session.roles
  );
  if (!ctxRes.ok) return { ok: false, message: ctxRes.message };
  const { ctx } = ctxRes;

  const validation = validateRecordsInsert(raw, ctx);
  if (!validation.ok) {
    return {
      ok: false,
      message: "A prévia editada tem problemas — corrija e tente de novo.",
      errors: validation.errors,
    };
  }

  const results: ApplyRecordsResultItem[] = [];
  const insertedIds: string[] = [];
  for (let i = 0; i < validation.records.length; i++) {
    const rec = validation.records[i];
    const title = String(rec.values.title ?? "");
    const fd = new FormData();
    fd.set("source", ctx.sourceKey);
    for (const [key, val] of Object.entries(rec.values)) {
      if (key === "responsible_id") {
        if (rec.responsibleId) fd.set("responsible_id", rec.responsibleId);
        continue;
      }
      if (key === "operation_id") {
        if (rec.operationId) fd.set("operation_id", rec.operationId);
        continue;
      }
      if (key.startsWith("custom:")) {
        fd.set(`custom__${key.slice("custom:".length)}`, String(val));
        continue;
      }
      fd.set(`core__${key}`, String(val));
    }
    const res = await createRecord({}, fd);
    results.push({
      index: i,
      title,
      ok: Boolean(res.ok),
      id: res.id,
      message: res.ok ? undefined : res.message,
    });
    if (res.ok && res.id) insertedIds.push(res.id);
  }

  // Recalc direcionado (service role, id-scoped): assenta operandos match: que
  // o applyCalcFields inline pula de propósito. Best-effort.
  if (insertedIds.length > 0) {
    try {
      await recalcFormulaFieldsForRecords(insertedIds);
    } catch {
      /* o recalc geral do próximo sync/import cobre. */
    }
  }

  const total = validation.records.length;
  const okCount = insertedIds.length;
  const message =
    okCount === total
      ? `${okCount} registro(s) inserido(s).`
      : okCount > 0
        ? `${okCount} de ${total} registros inseridos — veja os erros por item.`
        : "Nenhum registro inserido — veja os erros por item.";
  return {
    ok: okCount === total,
    message,
    results,
    insertedCount: okCount,
  };
}
