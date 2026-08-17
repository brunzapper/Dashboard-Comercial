// Versão: 1.0 | Data: 16/08/2026
// Action do DIÁLOGO de conferência da Remuneração: "quais registros compõem o
// realizado deste membro × fator × mês". Casca fina — gates + client RLS do
// usuário — sobre o núcleo ÚNICO lib/comp/detail.ts, o mesmo que monta as abas
// Det-<Nome> do export p/ Google Planilhas (tela e planilha nunca divergem).
//
// Gates na ordem do sheets-actions.ts: sessão → área "remuneracao" → admin. O
// v1 é admin-only por decisão de produto (a RLS de `records` do vendedor não
// alcança registros de fator casado por memberField, o que devolveria um
// detalhe silenciosamente parcial). Quando o vendedor for habilitado, o ramo
// aqui é "admin OU memberId dentro do próprio grupo canônico" — a RLS de
// `records` segue sendo a muralha em qualquer caso.
"use server";

import { isSettingsAreaDenied } from "@/lib/auth/access";
import { getActiveOrgId } from "@/lib/auth/org";
import { getSessionInfo } from "@/lib/auth/session";
import {
  factorOperands,
  loadCompDetailContext,
  loadFactorDetail,
  type FactorDetailResult,
} from "@/lib/comp/detail";
import { parseCompPlanConfig, type CompDetailGrouping } from "@/lib/comp/model";
import { createClient } from "@/lib/supabase/server";

export interface FactorDetailInput {
  planId: string;
  factorId: string;
  memberId: string;
  memberLabel: string;
  year: number;
  month: number;
}

/** Gate comum: sessão → área → admin. Devolve o erro, ou null se pode seguir. */
async function requireCompAdmin(): Promise<{ ok: false; message: string } | null> {
  const session = await getSessionInfo();
  if (!session) return { ok: false, message: "Sessão expirada." };
  if (await isSettingsAreaDenied("remuneracao"))
    return { ok: false, message: "Acesso a esta área foi bloqueado." };
  if (!session.roles.includes("admin"))
    return { ok: false, message: "Apenas administradores." };
  return null;
}

export async function loadCompFactorDetail(
  input: FactorDetailInput
): Promise<FactorDetailResult> {
  const gate = await requireCompAdmin();
  if (gate) return gate;
  if (
    !Number.isInteger(input.year) ||
    input.year < 2000 ||
    input.year > 2100 ||
    !Number.isInteger(input.month) ||
    input.month < 1 ||
    input.month > 12
  )
    return { ok: false, message: "Período inválido." };
  if (!input.planId || !input.factorId || !input.memberId)
    return { ok: false, message: "Fator inválido." };

  const supabase = await createClient();
  const ctx = await loadCompDetailContext(supabase, {
    orgId: await getActiveOrgId(),
    year: input.year,
    month: input.month,
    memberIds: [input.memberId],
    planIds: [input.planId],
  });
  return loadFactorDetail(supabase, ctx, {
    planId: input.planId,
    factorId: input.factorId,
    memberId: input.memberId,
    memberLabel: input.memberLabel,
  });
}

/** Um operando do plano, para a engrenagem de agrupamento escolher. */
export interface PlanOperandOption {
  factorId: string;
  factorLabel: string;
  key: string;
  label: string;
}

export type PlanOperandsResult =
  | { ok: true; operands: PlanOperandOption[]; separateByFactor: Record<string, string[]> }
  | { ok: false; message: string };

/**
 * Operandos de um plano (a decomposição real da fórmula) + o agrupamento
 * gravado. A engrenagem não pode adivinhar as chaves: elas saem do MESMO
 * `factorOperands` que monta os blocos, senão o que se marca não é o que se vê.
 */
export async function loadPlanOperands(input: {
  planId: string;
  year: number;
  month: number;
}): Promise<PlanOperandsResult> {
  const gate = await requireCompAdmin();
  if (gate) return gate;
  const supabase = await createClient();
  const ctx = await loadCompDetailContext(supabase, {
    orgId: await getActiveOrgId(),
    year: input.year,
    month: input.month,
    memberIds: [],
    planIds: [input.planId],
  });
  const plan = ctx.plans.find((p) => p.row.id === input.planId);
  if (!plan) return { ok: false, message: "Plano não encontrado ou inativo." };
  const operands: PlanOperandOption[] = [];
  for (const factor of plan.config.factors) {
    for (const op of factorOperands(ctx, factor)) {
      operands.push({
        factorId: factor.id,
        factorLabel: factor.label,
        key: op.key,
        label: op.label,
      });
    }
  }
  return {
    ok: true,
    operands,
    separateByFactor: plan.config.detailGrouping?.separateByFactor ?? {},
  };
}

/**
 * Grava SÓ o agrupamento do detalhamento no config do plano. Re-parseia o
 * config atual e devolve o objeto parseado com a chave trocada — nunca monta o
 * config do zero, para não derrubar o que o editor grava.
 */
export async function saveDetailGrouping(input: {
  planId: string;
  separateByFactor: Record<string, string[]>;
}): Promise<{ ok: boolean; message?: string }> {
  const gate = await requireCompAdmin();
  if (gate) return gate;
  const supabase = await createClient();
  const { data } = await supabase
    .from("comp_plans")
    .select("config")
    .eq("id", input.planId)
    .maybeSingle();
  const config = parseCompPlanConfig((data as { config?: unknown } | null)?.config);
  if (!config) return { ok: false, message: "Configuração do plano inválida." };

  // Entrada vazia = volta ao padrão (cada operando em bloco próprio): a chave
  // some do config em vez de guardar um mapa vazio.
  const sep: Record<string, string[]> = {};
  for (const [fid, keys] of Object.entries(input.separateByFactor)) {
    const list = [...new Set(keys.filter((k) => typeof k === "string" && k !== ""))];
    if (list.length > 0) sep[fid] = list;
  }
  const grouping: CompDetailGrouping | undefined =
    Object.keys(sep).length > 0 ? { separateByFactor: sep } : undefined;
  const next = { ...config };
  if (grouping) next.detailGrouping = grouping;
  else delete next.detailGrouping;

  const { error } = await supabase
    .from("comp_plans")
    .update({ config: next })
    .eq("id", input.planId);
  if (error) return { ok: false, message: "Não foi possível salvar." };
  return { ok: true };
}
