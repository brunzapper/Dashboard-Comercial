// Versão: 1.0 | Data: 31/07/2026
// NÚCLEO da ATUALIZAÇÃO EM MASSA de registros por IA (/registros → "Atualizar
// com IA"). Desenho (§4.17): a IA NUNCA escreve e NUNCA emite ids —
// generateRecordsUpdateCore valida o contrato (filtros + alterações,
// lib/import/records/update-validate) e resolve a PRÉVIA server-side
// obrigatória: os registros que casam saem de runRecordListWindow
// (lib/widgets/record-list — o caminho canônico do modo lista: predicado de
// sub-fonte, nome→id de FK, expansão canônica e regra 0052 dos mocks de
// graça; RPCs de widget INTOCADOS), com contagem exata + amostra antes→depois.
// applyRecordsUpdateCore RE-VALIDA com contexto fresco, RE-RESOLVE os ids no
// servidor (mesma consulta; recorte > teto aborta), pula mocks (reportados) e
// escreve SÓ por updateRecordValuesBulk (lib/records/bulk-update — client RLS
// do usuário, audit/recalc/webhook batelados). previewRecordsUpdateCore/
// buildRecordsUpdatePromptCore cobrem o fluxo copiar-prompt → colar-JSON de
// IA externa (funciona sem IA configurada). Base alvo SEMPRE do seletor da
// UI. Teto de 200 (MAX_AI_UPDATE_RECORDS = precedente das ações em massa).
import "server-only";

import { getSessionInfo } from "@/lib/auth/session";
import { getActiveOrgId } from "@/lib/auth/org";
import { createClient } from "@/lib/supabase/server";
import { loadOrgAiConfig } from "@/lib/ai/config";
import { aiSection, runJsonGenerationLoop } from "@/lib/ai/json-loop";
import { todayBrasiliaIso } from "@/lib/date/today";
import { DATA_TYPE_LABELS, type DataType, type FieldDefinition, type RecordRow } from "@/lib/records/types";
import { primaryOperationId } from "@/lib/sync/shared";
import { loadCorrespondences } from "@/lib/correspondences";
import { loadSources } from "@/lib/config/sources";
import { buildAvailableFields } from "@/lib/widgets/fields";
import { runRecordListWindow } from "@/lib/widgets/record-list";
import type { WidgetConfig } from "@/lib/widgets/types";
import { updateRecordValuesBulk } from "@/lib/records/bulk-update";
import type { BulkItemResult } from "@/lib/kanban/bulk-helpers";
import {
  isSampleValueFilled,
  sampleRefValue,
} from "@/lib/import/dashboard/sample";
import { sampleForBase, truncateSampleValue } from "@/lib/import/sample-db";
import { buildRecordsUpdatePromptText } from "@/lib/import/records/update-instructions";
import { loadRecordsUpdateContext } from "@/lib/import/records/context";
import {
  describeFilter,
  serializeRecordsUpdate,
  validateRecordsUpdate,
} from "@/lib/import/records/update-validate";
import {
  MAX_AI_UPDATE_RECORDS,
  RECORDS_UPDATE_SAMPLE_ROWS,
  type ParsedRecordsUpdate,
  type RecordsUpdateContext,
} from "@/lib/import/records/update-types";

export interface GenerateRecordsUpdateInput {
  /** Base alvo (seletor da UI — identidade nunca vem do JSON da IA). */
  sourceKey: string;
  /** Pedido deste turno (texto livre). */
  description: string;
  /** Turnos de usuário anteriores da conversa (stateless; cap no laço). */
  priorTurns?: string[];
  /** Prévia pendente — a resposta SUBSTITUI a proposta inteira. */
  pendingJson?: string;
}

/** Linha da amostra da prévia: valor atual → novo por campo alterado. */
export interface UpdateSampleRow {
  id: string;
  title: string;
  cells: { key: string; label: string; from: string; to: string }[];
}

/** Prévia server-side (contagem resolvida no SERVIDOR — nunca da IA). */
export interface RecordsUpdatePreview {
  /** Registros que casam os filtros (count exato da consulta). */
  total: number;
  /** total > teto — o apply é BLOQUEADO ("refine os filtros"). */
  overCap: boolean;
  /** Quantos do recorte são mocks (pulados no apply). */
  mockCount: number;
  sample: UpdateSampleRow[];
  /** Filtros em linguagem legível (chips). */
  filterLabels: string[];
  /** Alterações legíveis; `sync` marca campo de Sync (escrita local). */
  changeLabels: { key: string; label: string; value: string; sync?: boolean }[];
}

export interface GenerateRecordsUpdateState {
  ok: boolean;
  message?: string;
  errors?: string[];
  /** JSON canônico da proposta (reenviado no apply e no turno seguinte). */
  pendingJson?: string;
  preview?: RecordsUpdatePreview;
  warnings?: string[];
}

export interface ApplyRecordsUpdateState {
  ok: boolean;
  message?: string;
  errors?: string[];
  /** Registros efetivamente escritos. */
  changedCount?: number;
  /** Já estavam com os valores pedidos (nenhuma escrita). */
  noopCount?: number;
  /** Mocks pulados. */
  skippedMocks?: number;
  /** Falhas por item (título + motivo), p/ exibição. */
  failures?: { title: string; message: string }[];
}

const FIELD_DEF_COLS =
  "id, field_key, label, data_type, options, visible_to_roles, editable_by_roles, is_local, show_in_builder, formula, allow_negative, currency_code, currency_mode, show_as_percent, sort_order, applies_to, source_system, source_field_id, write_back";

type Supabase = Awaited<ReturnType<typeof createClient>>;

function typeLabelOf(f: { dataType: DataType | "relacao" }): string {
  return f.dataType === "relacao"
    ? "relação (use o NOME cadastrado)"
    : DATA_TYPE_LABELS[f.dataType as DataType];
}

// ---------------------------------------------------------------------------
// Prévia server-side: consulta canônica do modo lista com config sintética.
// ---------------------------------------------------------------------------

async function resolveMatches(
  supabase: Supabase,
  ctx: RecordsUpdateContext,
  update: ParsedRecordsUpdate
): Promise<{ rows: RecordRow[]; total: number }> {
  const [catalog, correspondences, { data: defRows }] = await Promise.all([
    loadSources(supabase),
    loadCorrespondences(supabase),
    supabase
      .from("field_definitions")
      .select(FIELD_DEF_COLS)
      .or("show_in_builder.eq.true,source_system.eq.core")
      .order("sort_order", { ascending: true }),
  ]);
  const available = buildAvailableFields(
    (defRows ?? []) as FieldDefinition[],
    correspondences,
    catalog
  );
  const config: WidgetConfig = {
    source: "records",
    sources: [ctx.sourceKey],
    dimensions: [],
    metrics: [],
    filters: update.filters,
    visual_type: "tabela",
    settings: { rowMode: "records" },
  };
  const { rows, total } = await runRecordListWindow(
    supabase,
    config,
    null,
    available,
    catalog,
    { offset: 0, maxRows: MAX_AI_UPDATE_RECORDS + 1 }
  );
  return { rows, total };
}

// Valor ATUAL de uma chave do contrato numa linha (exibição da amostra).
function currentValueOf(
  row: RecordRow,
  key: string,
  ctx: RecordsUpdateContext
): string {
  const r = row as unknown as Record<string, unknown>;
  let v: unknown;
  if (key.startsWith("custom:")) {
    v = (r.custom_fields as Record<string, unknown> | null)?.[
      key.slice("custom:".length)
    ];
  } else {
    v = r[key];
  }
  if (key === "responsible_id") {
    v = ctx.responsibles.find((x) => x.id === v)?.name ?? v;
  } else if (key === "operation_id") {
    v = ctx.operations.find((x) => x.id === v)?.name ?? v;
  }
  if (v == null || v === "") return "—";
  return String(v);
}

function buildPreview(
  ctx: RecordsUpdateContext,
  update: ParsedRecordsUpdate,
  rows: RecordRow[],
  total: number
): RecordsUpdatePreview {
  const specByKey = new Map(ctx.fields.map((f) => [f.key, f]));
  const changeKeys = Object.keys(update.changes);
  const sample: UpdateSampleRow[] = rows
    .slice(0, RECORDS_UPDATE_SAMPLE_ROWS)
    .map((row) => ({
      id: row.id,
      title: String((row as unknown as Record<string, unknown>).title ?? "—"),
      cells: changeKeys.map((key) => {
        const spec = specByKey.get(key);
        const to = update.changes[key];
        return {
          key,
          label: spec?.label ?? key,
          from: currentValueOf(row, key, ctx),
          to: to == null ? "—" : String(to),
        };
      }),
    }));
  return {
    total,
    overCap: total > MAX_AI_UPDATE_RECORDS,
    mockCount: rows.filter((r) => Boolean(r.is_mock)).length,
    sample,
    filterLabels: update.filters.map((f) => describeFilter(f, ctx.filterFields)),
    changeLabels: changeKeys.map((key) => {
      const spec = specByKey.get(key);
      const v = update.changes[key];
      return {
        key,
        label: spec?.label ?? key,
        value: v == null ? "(limpar)" : String(v),
        ...(spec?.sync ? { sync: true as const } : {}),
      };
    }),
  };
}

async function previewState(
  supabase: Supabase,
  ctx: RecordsUpdateContext,
  update: ParsedRecordsUpdate,
  warnings: string[]
): Promise<GenerateRecordsUpdateState> {
  const { rows, total } = await resolveMatches(supabase, ctx, update);
  const preview = buildPreview(ctx, update, rows, total);
  const allWarnings = [...warnings];
  if (preview.overCap) {
    allWarnings.push(
      `O recorte casa ${total} registros — acima do máximo de ${MAX_AI_UPDATE_RECORDS} por operação. Refine os filtros antes de aplicar.`
    );
  }
  if (preview.mockCount > 0) {
    allWarnings.push(
      `${preview.mockCount} registro(s) de demonstração no recorte serão pulados.`
    );
  }
  const syncTargets = preview.changeLabels.filter((c) => c.sync);
  if (syncTargets.length > 0) {
    allWarnings.push(
      `Campo(s) de Sync (${syncTargets.map((c) => c.label).join(", ")}): a escrita é local e fica protegida do sync; nada é gravado de volta no Bitrix.`
    );
  }
  return {
    ok: true,
    message:
      total === 0
        ? "Nenhum registro casa esses filtros — ajuste o pedido ou os filtros."
        : preview.overCap
          ? "Prévia pronta, mas o recorte excede o teto — refine os filtros."
          : `Prévia pronta — ${total} registro(s) serão alterados após a confirmação.`,
    pendingJson: serializeRecordsUpdate(update.filters, update.changes),
    preview,
    warnings: allWarnings,
  };
}

// ---------------------------------------------------------------------------
// Prompt
// ---------------------------------------------------------------------------

async function buildSystemPrompt(
  supabase: Supabase,
  ctx: RecordsUpdateContext,
  pendingJson: string | undefined
): Promise<string> {
  const catalog = {
    base: {
      key: ctx.sourceKey,
      label: ctx.sourceLabel,
      record_type: ctx.recordType,
    },
    campos_de_filtro: ctx.filterFields.map((f) => ({
      chave: f.key,
      rotulo: f.label,
      tipo: typeLabelOf(f),
      ...(f.options && f.options.length > 0 ? { opcoes: f.options } : {}),
    })),
    campos_de_alteracao: ctx.fields.map((f) => ({
      chave: f.key,
      rotulo: f.label,
      tipo: typeLabelOf(f),
      ...(f.options && f.options.length > 0
        ? {
            opcoes: f.options,
            ...(f.strictOptions ? {} : { opcoes_sao_sugestao: true }),
          }
        : {}),
      ...(f.sync ? { campo_de_sync: true } : {}),
    })),
  };

  // AMOSTRAS: convenções REAIS de valor (filtros e alterações usam a mesma
  // grafia dos dados) — mesmo formato do fluxo de inserção.
  const refs = [
    ...new Set([
      ...ctx.filterFields.map((f) => f.key),
      ...ctx.fields.map((f) => f.key),
    ]),
  ];
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
      ? "Base ainda sem registros — siga os tipos/opções do catálogo."
      : uncoveredRefs.length > 0
        ? `Use a MESMA grafia destes registros nos valores de filtro/alteração. Colunas sem nenhum dado hoje: ${uncoveredRefs.join(", ")}.`
        : "Use a MESMA grafia destes registros nos valores de filtro/alteração.";

  let system = buildRecordsUpdatePromptText({
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
      "No turno anterior você propôs a operação abaixo e o usuário AINDA NÃO " +
        "confirmou. Sua resposta deste turno SUBSTITUI a proposta INTEIRA.\n\n" +
        pending
    );
  }
  return system;
}

// ---------------------------------------------------------------------------
// Cores
// ---------------------------------------------------------------------------

async function gate(): Promise<
  | { ok: true; session: NonNullable<Awaited<ReturnType<typeof getSessionInfo>>> }
  | { ok: false; message: string }
> {
  const session = await getSessionInfo();
  if (!session) return { ok: false, message: "Sessão expirada." };
  if (!session.permissions.includes("edit_record_values")) {
    return {
      ok: false,
      message: "Você não tem permissão para editar registros.",
    };
  }
  return { ok: true, session };
}

export async function generateRecordsUpdateCore(
  input: GenerateRecordsUpdateInput
): Promise<GenerateRecordsUpdateState> {
  const g = await gate();
  if (!g.ok) return { ok: false, message: g.message };
  const description = input.description.trim();
  if (!description) {
    return { ok: false, message: "Descreva a atualização desejada." };
  }

  const supabase = await createClient();
  const ctxRes = await loadRecordsUpdateContext(
    supabase,
    input.sourceKey,
    g.session.roles
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

  const result = await runJsonGenerationLoop<{
    update: ParsedRecordsUpdate;
    warnings: string[];
  }>({
    config: aiConfig,
    system,
    priorTurns: input.priorTurns ?? [],
    description,
    validate: (raw) => {
      const v = validateRecordsUpdate(raw, ctx);
      if (!v.ok) return { ok: false, errors: v.errors };
      return { ok: true, value: { update: v.update, warnings: v.warnings } };
    },
  });
  if (!result.ok) {
    return { ok: false, message: result.message, errors: result.errors };
  }
  return previewState(
    supabase,
    ctx,
    result.value.update,
    result.value.warnings
  );
}

/** Valida um JSON COLADO (fluxo de IA externa) — mesma prévia, sem IA. */
export async function previewRecordsUpdateCore(
  raw: string,
  args: { sourceKey: string }
): Promise<GenerateRecordsUpdateState> {
  const g = await gate();
  if (!g.ok) return { ok: false, message: g.message };
  if (!raw.trim()) {
    return { ok: false, message: "Cole o JSON devolvido pela IA." };
  }
  const supabase = await createClient();
  const ctxRes = await loadRecordsUpdateContext(
    supabase,
    args.sourceKey,
    g.session.roles
  );
  if (!ctxRes.ok) return { ok: false, message: ctxRes.message };
  const v = validateRecordsUpdate(raw, ctxRes.ctx);
  if (!v.ok) {
    return {
      ok: false,
      message: "O JSON tem problemas — corrija na IA externa e cole de novo.",
      errors: v.errors,
    };
  }
  return previewState(supabase, ctxRes.ctx, v.update, v.warnings);
}

/** Prompt completo p/ IA externa: MESMO SPEC do chat + catálogo da base. */
export async function buildRecordsUpdatePromptCore(args: {
  sourceKey: string;
}): Promise<{ ok: boolean; prompt?: string; message?: string }> {
  const g = await gate();
  if (!g.ok) return { ok: false, message: g.message };
  const supabase = await createClient();
  const ctxRes = await loadRecordsUpdateContext(
    supabase,
    args.sourceKey,
    g.session.roles
  );
  if (!ctxRes.ok) return { ok: false, message: ctxRes.message };
  return {
    ok: true,
    prompt: await buildSystemPrompt(supabase, ctxRes.ctx, undefined),
  };
}

/**
 * Aplica a operação confirmada: RE-VALIDA o JSON com contexto FRESCO,
 * RE-RESOLVE os ids no servidor (o recorte pode ter mudado desde a prévia;
 * > teto aborta), pula mocks e escreve via updateRecordValuesBulk. Falha
 * parcial não desfaz — o resultado agrega contagens + falhas por item.
 */
export async function applyRecordsUpdateCore(
  raw: string,
  args: { sourceKey: string }
): Promise<ApplyRecordsUpdateState> {
  const g = await gate();
  if (!g.ok) return { ok: false, message: g.message };

  const supabase = await createClient();
  const ctxRes = await loadRecordsUpdateContext(
    supabase,
    args.sourceKey,
    g.session.roles
  );
  if (!ctxRes.ok) return { ok: false, message: ctxRes.message };
  const { ctx } = ctxRes;

  const validation = validateRecordsUpdate(raw, ctx);
  if (!validation.ok) {
    return {
      ok: false,
      message: "A proposta tem problemas — peça um ajuste e tente de novo.",
      errors: validation.errors,
    };
  }
  const update = validation.update;

  const { rows, total } = await resolveMatches(supabase, ctx, update);
  if (total > MAX_AI_UPDATE_RECORDS) {
    return {
      ok: false,
      message: `O recorte casa ${total} registros — acima do máximo de ${MAX_AI_UPDATE_RECORDS} por operação. Refine os filtros.`,
    };
  }
  const mocks = rows.filter((r) => Boolean(r.is_mock));
  const targets = rows.filter((r) => !r.is_mock);
  if (targets.length === 0) {
    return {
      ok: true,
      message:
        mocks.length > 0
          ? "Só registros de demonstração casam esses filtros — nada a alterar."
          : "Nenhum registro casa esses filtros — nada a alterar.",
      changedCount: 0,
      noopCount: 0,
      skippedMocks: mocks.length,
    };
  }

  // Responsável alterado sem operação explícita: deriva a operação principal
  // UMA vez (mesmo alvo p/ todos — espelho do efeito colateral do updateRecord).
  let operationId = update.operationId;
  if (update.responsibleId !== undefined && operationId === undefined) {
    operationId = await primaryOperationId(supabase, update.responsibleId);
  }

  const titleById = new Map(
    targets.map((r) => [
      r.id,
      String((r as unknown as Record<string, unknown>).title ?? r.id),
    ])
  );
  const { results, changedCount } = await updateRecordValuesBulk(
    supabase,
    targets.map((r) => r.id),
    {
      changes: update.changes,
      ...(update.responsibleId !== undefined
        ? { responsibleId: update.responsibleId }
        : {}),
      ...(operationId !== undefined ? { operationId } : {}),
      fields: ctx.fields,
      userId: g.session.user.id,
    }
  );

  const failures = results
    .filter((r: BulkItemResult) => !r.ok)
    .map((r) => ({
      title: titleById.get(r.id) ?? r.id,
      message: r.message ?? "Falha.",
    }));
  const noopCount = results.filter(
    (r) => r.ok && r.message === "Sem alterações."
  ).length;

  const parts = [`${changedCount} registro(s) atualizado(s)`];
  if (noopCount > 0) parts.push(`${noopCount} já estavam corretos`);
  if (mocks.length > 0) parts.push(`${mocks.length} de demonstração pulado(s)`);
  if (failures.length > 0) parts.push(`${failures.length} falha(s)`);
  return {
    ok: failures.length === 0,
    message: `${parts.join(" · ")}.`,
    changedCount,
    noopCount,
    skippedMocks: mocks.length,
    ...(failures.length > 0 ? { failures: failures.slice(0, 10) } : {}),
  };
}
