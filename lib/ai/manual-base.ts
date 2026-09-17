// Versão: 1.0 | Data: 17/09/2026
// NÚCLEO do assistente da BASE MANUAL (0142) — padrão §4.17.
//
// A IA NUNCA escreve: `generateManualBaseCore` valida a resposta contra o
// catálogo FRESCO e devolve PRÉVIA; `applyManualBaseCore` RE-VALIDA com
// catálogo fresco e aplica item a item SÓ pelos choke points existentes
// (saveManualSeries/saveManualEntry). A muralha é a RLS da 0142 — nada de
// service role.
//
// O apply faz os DADOS antes dos LANÇAMENTOS, na mesma chamada: um lançamento
// de um dado que a resposta acabou de declarar precisa do id que só existe
// depois do insert. Falha na criação de um dado derruba os lançamentos DELE, e
// só deles — o resto do lote passa (resultado POR ITEM, como nos demais
// contratos).
//
// Por que não existe verbo de exclusão: ver lib/import/manual-base/types.ts.
// O que existe é o UPSERT do choke point, e é ele que faz "ir atualizando
// conforme o mês avança" funcionar sem duplicar nada.
import "server-only";

import { getActiveOrgId } from "@/lib/auth/org";
import { checkSettingsArea } from "@/lib/auth/access";
import { getSessionInfo } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { loadOrgAiConfig } from "@/lib/ai/config";
import { aiSection, runJsonGenerationLoop } from "@/lib/ai/json-loop";
import { loadManualBase } from "@/lib/manual-base/load";
import { manualPeriodLabelOf } from "@/lib/manual-base/label";
import { buildManualBasePromptText } from "@/lib/import/manual-base/instructions";
import {
  serializeManualBaseEdit,
  validateManualBaseEdit,
} from "@/lib/import/manual-base/validate";
import type {
  ManualBaseEditContext,
  ParsedManualBaseEdit,
} from "@/lib/import/manual-base/types";
import {
  saveManualEntry,
  saveManualSeries,
} from "@/app/(app)/registros/base-manual/actions";
import {
  EMPTY_MANUAL_BASE_SESSION,
  MANUAL_BASE_MAX_CHAT,
  MANUAL_BASE_MAX_TURNS,
  manualBaseSessionKey,
  readManualBaseSessionRow,
  toManualBaseSessionState,
  writeManualBaseSessionRow,
  type ManualBaseChatEntry,
  type ManualBaseSessionState,
} from "@/lib/ai/manual-base-session";

/** O estado que o turno devolve — a sessão, mais o veredito DESTE turno. */
export type ManualBaseTurnState = ManualBaseSessionState;

export interface GenerateManualBaseInput {
  description: string;
  priorTurns?: string[];
  /** Prévia pendente — a resposta SUBSTITUI a proposta inteira. */
  pendingJson?: string;
  onThought?: (chunk: string) => void;
  /** Aviso do sistema (rebaixamento de modelo) — efêmero, como o raciocínio. */
  onNotice?: (text: string) => void;
}

export interface ManualBaseGenerateState {
  ok: boolean;
  message?: string;
  errors?: string[];
  /** JSON canônico da prévia — é ELE que o servidor guarda e o apply relê. */
  pendingJson?: string;
  summary?: string[];
  warnings?: string[];
}

export interface ApplyManualBaseItem {
  index: number;
  label: string;
  ok: boolean;
  message?: string;
}

export interface ApplyManualBaseState {
  ok: boolean;
  message?: string;
  errors?: string[];
  results?: ApplyManualBaseItem[];
  appliedCount?: number;
}

/** Hoje em Brasília (`YYYY-MM-DD`) — o read side inteiro é prefix-based. */
function todayBrasilia(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

async function gate(): Promise<string | null> {
  const s = await getSessionInfo();
  if (!s) return "Sessão expirada.";
  if (!s.permissions.includes("edit_record_values")) {
    return "Você não tem permissão para editar a Base manual.";
  }
  if (!(await checkSettingsArea("base_manual"))) {
    return "Você não tem acesso à Base manual.";
  }
  return null;
}

interface LoadedContext {
  ctx: ManualBaseEditContext;
  catalogJson: string;
}

/** Contexto FRESCO — carregado na geração E de novo no apply. */
async function loadManualBaseEditContext(): Promise<LoadedContext> {
  const supabase = await createClient();
  const orgId = await getActiveOrgId();
  const [base, { data: respData }, { data: opData }] = await Promise.all([
    loadManualBase(supabase, orgId),
    supabase
      .from("responsibles")
      .select("id, display_name")
      .eq("active", true)
      .order("display_name"),
    supabase.from("operations").select("id, name").eq("active", true).order("name"),
  ]);

  const ctx: ManualBaseEditContext = {
    series: base.series.map((s) => ({ id: s.id, key: s.key, label: s.label })),
    responsibles: ((respData ?? []) as { id: string; display_name: string | null }[])
      .map((r) => ({ id: r.id, name: (r.display_name ?? "").trim() }))
      .filter((r) => r.name !== ""),
    operations: ((opData ?? []) as { id: string; name: string | null }[])
      .map((o) => ({ id: o.id, name: (o.name ?? "").trim() }))
      .filter((o) => o.name !== ""),
    today: todayBrasilia(),
  };

  // O catálogo mostra os lançamentos que JÁ existem, resumidos: sem eles a IA
  // não tem como saber que o mês já foi lançado, e proporia números novos onde
  // o certo é atualizar.
  const seriesById = new Map(base.series.map((s) => [s.id, s]));
  const opById = new Map(ctx.operations.map((o) => [o.id, o.name]));
  const respById = new Map(ctx.responsibles.map((r) => [r.id, r.name]));
  const catalogJson = JSON.stringify(
    {
      hoje: ctx.today,
      dados: base.series.map((s) => ({ rotulo: s.label, chave: s.key })),
      operacoes: ctx.operations.map((o) => o.name),
      responsaveis: ctx.responsibles.map((r) => r.name),
      lancamentos_existentes: base.entries.slice(0, 200).map((e) => ({
        dado: seriesById.get(e.series_id)?.label ?? null,
        periodo: `${e.period_start} a ${e.period_end}`,
        valor: e.value,
        operacao: e.operation_id ? (opById.get(e.operation_id) ?? null) : null,
        responsavel: e.responsible_id
          ? (respById.get(e.responsible_id) ?? null)
          : null,
      })),
    },
    null,
    2
  );

  return { ctx, catalogJson };
}

/** Uma linha de resumo por item da prévia, em pt-BR. */
function summarize(parsed: ParsedManualBaseEdit): string[] {
  const out: string[] = [];
  for (const s of parsed.series) {
    out.push(`Criar o dado “${s.label}”.`);
  }
  for (const e of parsed.entries) {
    const quem = e.operationName
      ? ` · ${e.operationName}`
      : e.responsibleName
        ? ` · ${e.responsibleName}`
        : "";
    out.push(
      `${e.seriesLabel}: ${e.value} em ${manualPeriodLabelOf(e.periodStart, e.periodEnd)}${quem}`
    );
  }
  return out.map((l, i) => `${i + 1}. ${l}`);
}

export async function generateManualBaseCore(
  input: GenerateManualBaseInput
): Promise<ManualBaseGenerateState> {
  const err = await gate();
  if (err) return { ok: false, message: err };
  const description = input.description.trim();
  if (!description) {
    return { ok: false, message: "Cole a tabela ou descreva os números." };
  }

  const orgId = await getActiveOrgId();
  const aiConfig = orgId ? await loadOrgAiConfig(orgId) : null;
  if (!aiConfig) {
    return {
      ok: false,
      message:
        "IA não configurada para a organização — um administrador define o provedor em Configurações → Integrações. Você ainda pode usar “Copiar prompt” e colar a resposta de uma IA externa.",
    };
  }

  const { ctx, catalogJson } = await loadManualBaseEditContext();
  let system = buildManualBasePromptText({ catalogJson });
  const pending = (input.pendingJson ?? "").trim();
  if (pending) {
    system += aiSection(
      "PRÉVIA PENDENTE (AINDA NÃO APLICADA)",
      "No turno anterior você propôs os lançamentos abaixo e o usuário AINDA " +
        "NÃO confirmou. Sua resposta deste turno SUBSTITUI a proposta " +
        "INTEIRA: re-inclua o que continuar desejado.\n\n" +
        pending
    );
  }

  const result = await runJsonGenerationLoop<{
    parsed: ParsedManualBaseEdit;
    warnings: string[];
  }>({
    config: aiConfig,
    system,
    priorTurns: input.priorTurns ?? [],
    description,
    onThought: input.onThought,
    onNotice: input.onNotice,
    validate: (raw) => {
      const v = validateManualBaseEdit(raw, ctx);
      if (!v.ok) return { ok: false, errors: v.errors };
      return { ok: true, value: { parsed: v.parsed, warnings: v.warnings } };
    },
  });
  if (!result.ok) {
    return { ok: false, message: result.message, errors: result.errors };
  }
  const { parsed, warnings } = result.value;
  return {
    ok: true,
    message: "Prévia pronta — confira os números e confirme.",
    pendingJson: serializeManualBaseEdit(parsed),
    summary: summarize(parsed),
    warnings,
  };
}

/** Valida um JSON COLADO (fluxo de IA externa) — mesma prévia, sem IA. */
export async function previewManualBaseCore(
  raw: string
): Promise<ManualBaseGenerateState> {
  const err = await gate();
  if (err) return { ok: false, message: err };
  if (!raw.trim()) return { ok: false, message: "Cole o JSON devolvido pela IA." };
  const { ctx } = await loadManualBaseEditContext();
  const v = validateManualBaseEdit(raw, ctx);
  if (!v.ok) {
    return {
      ok: false,
      message: "O JSON tem problemas — corrija na IA externa e cole de novo.",
      errors: v.errors,
    };
  }
  return {
    ok: true,
    message: "Prévia pronta — confira os números e confirme.",
    pendingJson: serializeManualBaseEdit(v.parsed),
    summary: summarize(v.parsed),
    warnings: v.warnings,
  };
}

/** Prompt completo p/ IA externa: MESMO SPEC do chat + catálogo atual. */
export async function buildManualBasePromptCore(): Promise<{
  ok: boolean;
  message?: string;
  prompt?: string;
}> {
  const err = await gate();
  if (err) return { ok: false, message: err };
  const { catalogJson } = await loadManualBaseEditContext();
  return { ok: true, prompt: buildManualBasePromptText({ catalogJson }) };
}

/**
 * Aplica a prévia. O JSON vem da LINHA da sessão (nunca de um argumento do
 * cliente) e é RE-VALIDADO aqui com catálogo fresco: entre a prévia e o
 * clique, alguém pode ter criado o dado, renomeado a operação ou lançado o mês.
 */
export async function applyManualBaseCore(
  pendingJson: string
): Promise<ApplyManualBaseState> {
  const err = await gate();
  if (err) return { ok: false, message: err };
  if (!pendingJson.trim()) {
    return { ok: false, message: "Não há prévia para aplicar." };
  }
  const { ctx } = await loadManualBaseEditContext();
  const v = validateManualBaseEdit(pendingJson, ctx);
  if (!v.ok) {
    return {
      ok: false,
      message: "A prévia não vale mais — peça uma nova.",
      errors: v.errors,
    };
  }

  const results: ApplyManualBaseItem[] = [];
  let index = 0;

  // 1) DADOS novos primeiro: os lançamentos deles precisam do id.
  const idByKey = new Map(ctx.series.map((s) => [s.key, s.id]));
  const failedSeries = new Set<string>();
  for (const s of v.parsed.series) {
    const res = await saveManualSeries(
      { label: s.label, key: s.key },
      { revalidate: false }
    );
    results.push({
      index: index++,
      label: `Dado “${s.label}”`,
      ok: res.ok,
      message: res.message,
    });
    if (res.ok && res.id) idByKey.set(s.key, res.id);
    else failedSeries.add(s.key);
  }

  // 2) LANÇAMENTOS. UPSERT pela chave natural — reenviar o mês atualiza.
  for (const e of v.parsed.entries) {
    const label = `${e.seriesLabel}: ${e.value} em ${manualPeriodLabelOf(e.periodStart, e.periodEnd)}`;
    const seriesId = idByKey.get(e.seriesKey);
    if (!seriesId || failedSeries.has(e.seriesKey)) {
      results.push({
        index: index++,
        label,
        ok: false,
        message: "O dado deste lançamento não pôde ser criado.",
      });
      continue;
    }
    const res = await saveManualEntry(
      {
        seriesId,
        periodStart: e.periodStart,
        periodEnd: e.periodEnd,
        value: e.value,
        responsibleId: e.responsibleId,
        operationId: e.operationId,
        spread: e.spread,
      },
      { revalidate: false }
    );
    results.push({ index: index++, label, ok: res.ok, message: res.message });
  }

  const appliedCount = results.filter((r) => r.ok).length;
  return {
    ok: appliedCount > 0,
    message:
      appliedCount === results.length
        ? `${appliedCount} de ${results.length} aplicados.`
        : `${appliedCount} de ${results.length} aplicados — veja o que falhou.`,
    results,
    appliedCount,
  };
}

/**
 * O TURNO da conversa. É ele que a rota NDJSON chama — gate, turnos e
 * persistência ficam AQUI, no núcleo, para não existirem duas cópias (a rota é
 * casca, como nas outras três superfícies de turno do sistema).
 *
 * O raciocínio do modelo (`onThought`) é EFÊMERO: viaja pelo cano e nunca
 * entra na linha da sessão.
 */
export async function runManualBaseTurnCore(input: {
  description: string;
  onThought?: (chunk: string) => void;
  onNotice?: (text: string) => void;
}): Promise<ManualBaseTurnState> {
  const k = await manualBaseSessionKey();
  if (!k.ok) {
    return { ...EMPTY_MANUAL_BASE_SESSION, ok: false, message: k.message };
  }
  const row = await readManualBaseSessionRow(k);

  const description = input.description.trim();
  if (!description) {
    return {
      ...toManualBaseSessionState(row),
      ok: false,
      message: "Cole a tabela ou descreva os números.",
    };
  }

  const res = await generateManualBaseCore({
    description,
    priorTurns: row.turns,
    pendingJson: row.pending?.json,
    onThought: input.onThought,
    onNotice: input.onNotice,
  });

  // Turno que FALHOU entra no log (o usuário precisa ver o que deu errado) mas
  // não vira turno reinjetado: repetir um pedido que não gerou JSON válido só
  // gastaria contexto.
  const chat: ManualBaseChatEntry[] = [
    ...row.chat,
    { role: "user", text: description },
    { role: "assistant", text: res.message ?? (res.ok ? "Prévia pronta." : "Falhou.") },
  ];
  const next = {
    turns: res.ok
      ? [...row.turns, description].slice(-MANUAL_BASE_MAX_TURNS)
      : row.turns,
    chat: chat.slice(-MANUAL_BASE_MAX_CHAT),
    pending:
      res.ok && res.pendingJson
        ? {
            json: res.pendingJson,
            summary: res.summary ?? [],
            warnings: res.warnings ?? [],
          }
        : row.pending,
  };
  await writeManualBaseSessionRow(k, next);
  return {
    ...toManualBaseSessionState(next),
    ok: res.ok,
    message: res.message,
    errors: res.errors,
  };
}
