// Versão: 1.1 | Data: 18/09/2026
// v1.1 (18/09/2026): FAMÍLIAS (0143) — CRUD de família/membro/declaração e a
//   COORDENADA no lançamento, no MESMO choke point e sob o MESMO gate. Duas
//   coisas que valem ler antes de mexer:
//   * o `onConflict` ganhou `coords`, porque o índice natural ganhou. Sem isso o
//     total de agosto e a fatia "ligação" de agosto colapsariam no mesmo slot e
//     uma sobrescreveria a outra;
//   * a coordenada de uma família EMBUTIDA é ESPELHADA em
//     `responsible_id`/`operation_id` (applyBuiltinCoords). É o que mantém a
//     projeção sobre as dimensões de registro funcionando sem tocar no engine —
//     e o espelho tem dono único, aqui.
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
import {
  BUILTIN_MANUAL_FAMILIES,
  coordDeclares,
  coordMember,
  isBuiltinManualFamily,
  parseManualCoords,
  type ManualCoords,
} from "@/lib/manual-base/families";
import { loadManualBase } from "@/lib/manual-base/load";

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
  /** O que este lançamento endereça (0143). Ausente = nível ∅ (o total), que é
   *  o que toda linha era antes das famílias — por isso todo chamador antigo
   *  segue byte-idêntico. */
  coords?: ManualCoords;
}

/**
 * Grava um lançamento. Sem `id`, é UPSERT pela chave natural (dado × período ×
 * atribuição × COORDENADA) — é o que faz "relançar a tabela do mês" atualizar
 * em vez de duplicar, tanto na mão quanto pela IA. O índice único do banco é a
 * trava de verdade; este onConflict é a forma amigável dela.
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
  const coords = parseManualCoords(input.coords ?? {});
  // ESPELHO da família embutida: a coordenada é a verdade, a coluna FK é a
  // cópia que faz a projeção sobre a dimensão de registro funcionar. Ela vence
  // o campo solto do input — dois valores diferentes para a mesma coisa não
  // podem sobreviver ao save.
  const mirrored = applyBuiltinCoords(coords, {
    responsibleId: input.responsibleId || null,
    operationId: input.operationId || null,
  });
  const row = {
    series_id: input.seriesId,
    period_start: start,
    period_end: end,
    value,
    responsible_id: mirrored.responsibleId,
    operation_id: mirrored.operationId,
    coords,
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
        // `coords` ENTRA aqui porque entrou no índice único. jsonb normaliza
        // ordem de chaves e espaços, então ele mesmo é a forma canônica — não
        // há coluna denormalizada a manter em sincronia.
        onConflict:
          "organization_id,series_id,period_start,period_end,responsible_id,operation_id,coords",
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

// ===================== FAMÍLIAS (0143) =====================
//
// O espelho da família EMBUTIDA, num lugar só. A coordenada é a VERDADE (é ela
// que define o nível); `responsible_id`/`operation_id` são a CÓPIA, mantida para
// que a projeção sobre as dimensões de registro e o dobramento apelido→principal
// (0101) continuem funcionando sem uma linha de mudança em buckets.ts.
//
// Declarar a família com o RESIDUAL (`coords.responsavel = null`) zera a FK: é
// isso que faz "50 sem responsável direto" ser um grupo de 50 em vez de um
// lançamento não atribuído. Não declarar a família deixa a FK como está — o
// caminho da 0142, onde a atribuição existe mas não particiona nada.
function applyBuiltinCoords(
  coords: ManualCoords,
  current: { responsibleId: string | null; operationId: string | null }
): { responsibleId: string | null; operationId: string | null } {
  const out = { ...current };
  for (const fam of BUILTIN_MANUAL_FAMILIES) {
    if (!coordDeclares(coords, fam.key)) continue;
    const member = coordMember(coords, fam.key);
    if (fam.key === "responsavel") out.responsibleId = member;
    else if (fam.key === "operacao") out.operationId = member;
  }
  return out;
}

export interface ManualFamilyInput {
  id?: string;
  label: string;
  /** Só na criação. IMUTÁVEL depois: é o `<chave>` de `manualdim:<chave>` numa
   *  dimensão gravada e o eixo de um operando com escopo. */
  key?: string;
  sortOrder?: number;
}

/** Deriva uma chave de slug válida a partir do rótulo, ou null. */
function deriveKey(label: string, explicit?: string): string | null {
  const key = (explicit ? cleanText(explicit, 40) : slugify(label).slice(0, 40))
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "_")
    .replace(/^_+/, "");
  return MANUAL_KEY_RE.test(key) ? key : null;
}

export async function saveManualFamily(
  input: ManualFamilyInput,
  opts?: ManualWriteOpts
): Promise<ManualActionState> {
  let ctx: { userId: string; orgId: string };
  try {
    ctx = await requireManualWrite();
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
  const label = cleanText(input.label, 60);
  if (label.length < 2) {
    return { ok: false, message: "Dê um nome à família (ex.: “Canal”)." };
  }
  const supabase = await createClient();

  if (input.id) {
    // A CHAVE não entra no update, pela mesma razão do dado: dimensões e
    // operandos gravados a citam.
    const { error } = await supabase
      .from("manual_families")
      .update({
        label,
        ...(input.sortOrder != null ? { sort_order: input.sortOrder } : {}),
      })
      .eq("id", input.id);
    if (error) return { ok: false, message: error.message };
    refresh(opts);
    return { ok: true, id: input.id };
  }

  const key = deriveKey(label, input.key);
  if (!key) {
    return {
      ok: false,
      message:
        "Não consegui gerar uma chave a partir desse nome. Comece com uma letra.",
    };
  }
  // As embutidas vivem em CÓDIGO: uma linha com a mesma chave criaria dois
  // eixos com o mesmo nome, e o registry efetivo (código ∪ banco) faria o
  // código vencer — a linha ficaria invisível e confusa.
  if (isBuiltinManualFamily(key)) {
    return {
      ok: false,
      message: `“${label}” já existe como família do sistema. Use-a direto ao lançar.`,
    };
  }
  const { data: dup } = await supabase
    .from("manual_families")
    .select("id")
    .eq("organization_id", ctx.orgId)
    .eq("key", key)
    .limit(1);
  if (dup && dup.length > 0) {
    return { ok: false, message: `Já existe uma família com a chave “${key}”.` };
  }
  const { data, error } = await supabase
    .from("manual_families")
    .insert({
      organization_id: ctx.orgId,
      key,
      label,
      sort_order: input.sortOrder ?? 0,
      created_by: ctx.userId,
    })
    .select("id")
    .single();
  if (error) return { ok: false, message: error.message };
  refresh(opts);
  return { ok: true, id: String(data?.id ?? "") };
}

/**
 * Exclui uma família. Admin-only na RLS, e BLOQUEADA quando há lançamento que a
 * endereça: `on delete cascade` apagaria números digitados e `set null` os
 * transformaria em residual, colidindo com um residual de verdade. Recusar com a
 * contagem deixa a saída nas mãos de quem sabe o que aqueles números são.
 */
export async function deleteManualFamily(
  id: string,
  opts?: ManualWriteOpts
): Promise<ManualActionState> {
  let ctx: { userId: string; orgId: string };
  try {
    ctx = await requireManualWrite();
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
  const supabase = await createClient();
  const base = await loadManualBase(supabase, ctx.orgId);
  const fam = base.families.find((f) => f.id === id);
  if (!fam) return { ok: false, message: "Família não encontrada." };
  // A checagem roda EM MEMÓRIA: a base é pequena por natureza (são números
  // digitados à mão), e é um caminho só em vez de uma consulta jsonb a manter.
  const inUse = base.entries.filter((e) => coordDeclares(e.coords, fam.key)).length;
  if (inUse > 0) {
    return {
      ok: false,
      message:
        `${inUse} lançamento(s) usam “${fam.label}”. Renomeie a família, ou ` +
        `apague esses lançamentos primeiro.`,
    };
  }
  const { error } = await supabase.from("manual_families").delete().eq("id", id);
  if (error) {
    return {
      ok: false,
      message:
        "Não foi possível excluir a família. Excluir uma família é ação de administrador.",
    };
  }
  refresh(opts);
  return { ok: true };
}

export interface ManualFamilyMemberInput {
  id?: string;
  familyId: string;
  label: string;
  key?: string;
  sortOrder?: number;
}

export async function saveManualFamilyMember(
  input: ManualFamilyMemberInput,
  opts?: ManualWriteOpts
): Promise<ManualActionState> {
  let ctx: { userId: string; orgId: string };
  try {
    ctx = await requireManualWrite();
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
  const label = cleanText(input.label, 60);
  if (label.length < 1) return { ok: false, message: "Dê um nome ao membro." };
  if (!input.familyId) return { ok: false, message: "Escolha a família." };
  const supabase = await createClient();

  if (input.id) {
    const { error } = await supabase
      .from("manual_family_members")
      .update({
        label,
        ...(input.sortOrder != null ? { sort_order: input.sortOrder } : {}),
      })
      .eq("id", input.id);
    if (error) return { ok: false, message: error.message };
    refresh(opts);
    return { ok: true, id: input.id };
  }

  const key = deriveKey(label, input.key);
  if (!key) {
    return {
      ok: false,
      message:
        "Não consegui gerar uma chave a partir desse nome. Comece com uma letra.",
    };
  }
  const { data, error } = await supabase
    .from("manual_family_members")
    .insert({
      organization_id: ctx.orgId,
      family_id: input.familyId,
      key,
      label,
      sort_order: input.sortOrder ?? 0,
      created_by: ctx.userId,
    })
    .select("id")
    .single();
  if (error) {
    return {
      ok: false,
      message: error.message.includes("uq_manual_family_members_key")
        ? `Já existe um membro com a chave “${key}” nessa família.`
        : error.message,
    };
  }
  refresh(opts);
  return { ok: true, id: String(data?.id ?? "") };
}

/** Exclui um membro. Bloqueado em uso, pela mesma razão da família. */
export async function deleteManualFamilyMember(
  id: string,
  opts?: ManualWriteOpts
): Promise<ManualActionState> {
  let ctx: { userId: string; orgId: string };
  try {
    ctx = await requireManualWrite();
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
  const supabase = await createClient();
  const base = await loadManualBase(supabase, ctx.orgId);
  const member = base.members.find((m) => m.id === id);
  if (!member) return { ok: false, message: "Membro não encontrado." };
  const fam = base.families.find((f) => f.id === member.family_id);
  const inUse = fam
    ? base.entries.filter((e) => coordMember(e.coords, fam.key) === member.key)
        .length
    : 0;
  if (inUse > 0) {
    return {
      ok: false,
      message:
        `${inUse} lançamento(s) usam “${member.label}”. Renomeie o membro, ou ` +
        `apague esses lançamentos primeiro.`,
    };
  }
  const { error } = await supabase
    .from("manual_family_members")
    .delete()
    .eq("id", id);
  if (error) return { ok: false, message: error.message };
  refresh(opts);
  return { ok: true };
}

/**
 * Declara (ou retira) as famílias de um DADO. É o OPT-IN explícito do modelo de
 * níveis: sem declaração, todo lançamento do dado está no nível ∅ e a soma da
 * 0142 continua valendo — inclusive para quem já lançava com responsável.
 *
 * A lista chega COMPLETA (não é um delta): é o que a tela edita, e reconciliar
 * por diferença deixaria uma declaração retirada sobreviver a um F5.
 */
export async function setManualSeriesFamilies(
  seriesId: string,
  familyKeys: string[],
  opts?: ManualWriteOpts
): Promise<ManualActionState> {
  let ctx: { userId: string; orgId: string };
  try {
    ctx = await requireManualWrite();
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
  if (!seriesId) return { ok: false, message: "Escolha o dado." };
  const supabase = await createClient();
  const base = await loadManualBase(supabase, ctx.orgId);
  const valid = new Set([
    ...base.families.map((f) => f.key),
    ...BUILTIN_MANUAL_FAMILIES.map((f) => f.key),
  ]);
  const keys = [...new Set(familyKeys.map((k) => cleanText(k, 40)))].filter((k) =>
    valid.has(k)
  );

  const { error: delErr } = await supabase
    .from("manual_series_families")
    .delete()
    .eq("series_id", seriesId);
  if (delErr) return { ok: false, message: delErr.message };
  if (keys.length > 0) {
    const { error } = await supabase.from("manual_series_families").insert(
      keys.map((key, i) => ({
        organization_id: ctx.orgId,
        series_id: seriesId,
        family_key: key,
        sort_order: i,
      }))
    );
    if (error) return { ok: false, message: error.message };
  }
  refresh(opts);
  return { ok: true, id: seriesId };
}
