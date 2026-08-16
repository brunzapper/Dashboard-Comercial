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
  loadCompDetailContext,
  loadFactorDetail,
  type FactorDetailResult,
} from "@/lib/comp/detail";
import { createClient } from "@/lib/supabase/server";

export interface FactorDetailInput {
  planId: string;
  factorId: string;
  memberId: string;
  memberLabel: string;
  year: number;
  month: number;
}

export async function loadCompFactorDetail(
  input: FactorDetailInput
): Promise<FactorDetailResult> {
  const session = await getSessionInfo();
  if (!session) return { ok: false, message: "Sessão expirada." };
  if (await isSettingsAreaDenied("remuneracao"))
    return { ok: false, message: "Acesso a esta área foi bloqueado." };
  if (!session.roles.includes("admin"))
    return { ok: false, message: "Apenas administradores." };
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
