// Versão: 1.0 | Data: 17/09/2026
// Server Actions da BASE MANUAL (0142) — os CHOKE POINTS de escrita.
//
// Tudo que grava na Base manual passa por aqui: a página Registros → Base
// manual, o gestor do ⋮ do dashboard, o widget "Base do Dashboard" e o apply
// do assistente de IA. Um segundo caminho de escrita seria a régua paralela
// que a invariante 25 proíbe — e é justamente por existirem três superfícies
// que ele seria fácil de criar sem querer.
//
// Escrita SEMPRE com o client RLS do usuário: a policy da 0142 é a muralha
// (`edit_record_values` para lançamento, admin para excluir um DADO). O gate
// aqui é conveniência de UX — ele dá a mensagem, a RLS dá a garantia.
//
// A org é carimbada EXPLICITAMENTE (não há trigger de stamp): sem org ativa a
// action falha ALTO, em vez de escrever na organização padrão.
//
// `revalidate: false` é o padrão do projeto para save fora de formulário
// (lib/feedback/use-background-save.ts): o cliente agenda UM router.refresh()
// debounced, que é o reconciliador único.
"use server";

import { revalidatePath } from "next/cache";

import { getActiveOrgId } from "@/lib/auth/org";
import { isSettingsAreaDenied } from "@/lib/auth/access";
import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { slugify } from "@/lib/records/slug";
import {
  DEFAULT_MANUAL_SPREAD,
  MANUAL_KEY_RE,
  isManualSpread,
  type ManualSpread,
} from "@/lib/manual-base/types";

export interface ManualActionState {
  ok: boolean;
  message?: string;
  /** Id da linha criada/atualizada — o apply da IA encadeia com ele. */
  id?: string;
}

export interface ManualWriteOpts {
  /** Padrão do projeto: o cliente reconcilia com um refresh debounced. */
  revalidate?: boolean;
}

const AREA = "base_manual";

/**
 * Gate de escrita: sessão + a permissão de digitar valores (a mesma dos
 * registros manuais) + o override individual `deny` da área, que barra também
 * a escrita, não só a page.
 */
async function requireManualWrite(): Promise<{ userId: string; orgId: string }> {
  const session = await requireSession();
  if (!session.permissions.includes("edit_record_values")) {
    throw new Error("Você não tem permissão para editar a Base manual.");
  }
  if (await isSettingsAreaDenied(AREA)) {
    throw new Error("Seu acesso à Base manual foi removido.");
  }
  const orgId = await getActiveOrgId();
  if (!orgId) {
    // Falha ALTO: sem org ativa, um insert cairia na organização padrão.
    throw new Error("Nenhuma organização ativa.");
  }
  return { userId: session.user.id, orgId };
}

function refresh(opts?: ManualWriteOpts) {
  if (opts?.revalidate) revalidatePath("/registros/base-manual");
}

const cleanText = (v: FormDataEntryValue | null | string, max: number): string =>
  String(v ?? "")
    .trim()
    .slice(0, max);

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

// ===================== DADOS (manual_series) =====================

export interface ManualSeriesInput {
  id?: string;
  label: string;
  /** Só na criação: ausente = derivada do rótulo. IMUTÁVEL depois — é o que
   *  as fórmulas gravadas citam (`manual:<chave>`). */
  key?: string;
  defaultSpread?: ManualSpread;
  sortOrder?: number;
}

export async function saveManualSeries(
  input: ManualSeriesInput,
  opts?: ManualWriteOpts
): Promise<ManualActionState> {
  let ctx: { userId: string; orgId: string };
  try {
    ctx = await requireManualWrite();
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
  const label = cleanText(input.label, 80);
  if (label.length < 2) {
    return { ok: false, message: "Dê um nome ao dado (ex.: “# Emails replied”)." };
  }
  const supabase = await createClient();
  const spread = isManualSpread(input.defaultSpread)
    ? input.defaultSpread
    : DEFAULT_MANUAL_SPREAD;

  if (input.id) {
    // A CHAVE não entra no update de propósito: mudá-la orfanaria toda fórmula
    // que a cita, em silêncio.
    const { error } = await supabase
      .from("manual_series")
      .update({
        label,
        default_spread: spread,
        ...(input.sortOrder != null ? { sort_order: input.sortOrder } : {}),
      })
      .eq("id", input.id);
    if (error) return { ok: false, message: error.message };
    refresh(opts);
    return { ok: true, id: input.id };
  }

  const key = (input.key ? cleanText(input.key, 40) : slugify(label).slice(0, 40))
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "_")
    .replace(/^_+/, "");
  if (!MANUAL_KEY_RE.test(key)) {
    return {
      ok: false,
      message:
        "Não consegui gerar uma chave a partir desse nome. Comece com uma letra.",
    };
  }
  const { data: dup } = await supabase
    .from("manual_series")
    .select("id")
    .eq("organization_id", ctx.orgId)
    .eq("key", key)
    .limit(1);
  if (dup && dup.length > 0) {
    return { ok: false, message: `Já existe um dado com a chave “${key}”.` };
  }
  const { data, error } = await supabase
    .from("manual_series")
    .insert({
      organization_id: ctx.orgId,
      key,
      label,
      default_spread: spread,
      sort_order: input.sortOrder ?? 0,
      created_by: ctx.userId,
    })
    .select("id")
    .single();
  if (error) return { ok: false, message: error.message };
  refresh(opts);
  return { ok: true, id: String(data?.id ?? "") };
}

/** Exclui um DADO e, com ele, os lançamentos (cascade). Admin-only na RLS —
 *  fórmulas que o citavam passam a exibir "—", nunca um número errado. */
export async function deleteManualSeries(
  id: string,
  opts?: ManualWriteOpts
): Promise<ManualActionState> {
  try {
    await requireManualWrite();
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
  const supabase = await createClient();
  const { error } = await supabase.from("manual_series").delete().eq("id", id);
  if (error) {
    return {
      ok: false,
      message:
        "Não foi possível excluir o dado. Excluir um dado da Base manual é ação de administrador.",
    };
  }
  refresh(opts);
  return { ok: true };
}

// ===================== LANÇAMENTOS (manual_entries) =====================

export interface ManualEntryInput {
  id?: string;
  seriesId: string;
  periodStart: string;
  periodEnd: string;
  value: number | null;
  responsibleId?: string | null;
  operationId?: string | null;
  spread?: ManualSpread;
  note?: string | null;
}

/**
 * Grava um lançamento. Sem `id`, é UPSERT pela chave natural (dado × período ×
 * atribuição) — é o que faz "relançar a tabela do mês" atualizar em vez de
 * duplicar, tanto na mão quanto pela IA. O índice único da 0142 é a trava de
 * verdade; este onConflict é a forma amigável dela.
 */
export async function saveManualEntry(
  input: ManualEntryInput,
  opts?: ManualWriteOpts
): Promise<ManualActionState> {
  let ctx: { userId: string; orgId: string };
  try {
    ctx = await requireManualWrite();
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
  if (!input.seriesId) return { ok: false, message: "Escolha o dado." };
  const start = cleanText(input.periodStart, 10);
  const end = cleanText(input.periodEnd, 10) || start;
  if (!DAY_RE.test(start) || !DAY_RE.test(end)) {
    return { ok: false, message: "Informe o período no formato AAAA-MM-DD." };
  }
  if (end < start) {
    return { ok: false, message: "O fim do período não pode ser antes do início." };
  }
  const value = Number(input.value);
  if (!Number.isFinite(value)) {
    return { ok: false, message: "Informe um número para o valor." };
  }
  const spread = isManualSpread(input.spread) ? input.spread : undefined;

  const supabase = await createClient();
  const row = {
    series_id: input.seriesId,
    period_start: start,
    period_end: end,
    value,
    responsible_id: input.responsibleId || null,
    operation_id: input.operationId || null,
    note: input.note ? cleanText(input.note, 300) : null,
    updated_by: ctx.userId,
    ...(spread ? { spread } : {}),
  };

  if (input.id) {
    const { error } = await supabase
      .from("manual_entries")
      .update(row)
      .eq("id", input.id);
    if (error) return { ok: false, message: error.message };
    refresh(opts);
    return { ok: true, id: input.id };
  }

  const { data, error } = await supabase
    .from("manual_entries")
    .upsert(
      {
        organization_id: ctx.orgId,
        created_by: ctx.userId,
        // Sem `spread` explícito, herda o padrão do DADO — resolvido aqui para
        // o upsert não sobrescrever com o default da coluna.
        spread: spread ?? (await defaultSpreadOf(supabase, input.seriesId)),
        ...row,
      },
      {
        onConflict:
          "organization_id,series_id,period_start,period_end,responsible_id,operation_id",
      }
    )
    .select("id")
    .single();
  if (error) return { ok: false, message: error.message };
  refresh(opts);
  return { ok: true, id: String(data?.id ?? "") };
}

async function defaultSpreadOf(
  supabase: Awaited<ReturnType<typeof createClient>>,
  seriesId: string
): Promise<ManualSpread> {
  const { data } = await supabase
    .from("manual_series")
    .select("default_spread")
    .eq("id", seriesId)
    .maybeSingle();
  return isManualSpread(data?.default_spread)
    ? data.default_spread
    : DEFAULT_MANUAL_SPREAD;
}

export async function deleteManualEntry(
  id: string,
  opts?: ManualWriteOpts
): Promise<ManualActionState> {
  try {
    await requireManualWrite();
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
  const supabase = await createClient();
  const { error } = await supabase.from("manual_entries").delete().eq("id", id);
  if (error) return { ok: false, message: error.message };
  refresh(opts);
  return { ok: true };
}
