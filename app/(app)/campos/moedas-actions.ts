// Versão: 1.1 | Data: 27/07/2026
// Server Actions da aba Campos → Moedas. Habilita/desabilita moedas do
// sistema e mantém as taxas de conversão (R$ por 1 unidade) por ano/trimestre —
// à mão OU via média PTAX do Banco Central. RLS de currencies/currency_rates
// exige manage_field_definitions (admin). Regra = último a escrever vence.
// v1.1 (27/07/2026): movida de /configuracoes/moedas para aba de /campos.
//   A CHAVE de área segue "moedas" (histórica — overrides gravados).
// v1.2 (22/08/2026): moedas/taxas viraram POR ORGANIZAÇÃO (0123). Toda escrita
//   carimba organization_id e recorta por ele (a unicidade é composta agora —
//   onConflict "organization_id,code,year,quarter"). Sem o carimbo o usuário de
//   outra org falharia ALTO no WITH CHECK da RLS; sem o recorte, um update por
//   `code` só alcançaria a própria org de qualquer forma (RLS), mas deixamos
//   explícito — padrão dos demais writers org-scoped.
"use server";

import { revalidatePath } from "next/cache";

import { getSessionInfo } from "@/lib/auth/session";
import { isSettingsAreaDenied } from "@/lib/auth/access";
import { getActiveOrgId } from "@/lib/auth/org";
import { createClient } from "@/lib/supabase/server";
import { recalcAllFormulaFields } from "@/lib/records/recalc";
import { computeYearAndQuarters } from "@/lib/widgets/ptax";

export interface CurrencyActionState {
  ok?: boolean;
  message?: string;
}

async function ensureCanManage(): Promise<
  { orgId: string } | { error: string }
> {
  const session = await getSessionInfo();
  if (!session) return { error: "Sessão expirada." };
  if (!session.permissions.includes("manage_field_definitions")) {
    return { error: "Apenas administradores podem gerenciar moedas." };
  }
  if (await isSettingsAreaDenied("moedas")) {
    return { error: "Acesso a esta área foi bloqueado." };
  }
  const orgId = await getActiveOrgId();
  if (!orgId) return { error: "Organização não encontrada." };
  return { orgId };
}

function revalidateAll() {
  revalidatePath("/campos");
  revalidatePath("/registros");
  revalidatePath("/dashboards/[id]", "page");
}

/** Liga/desliga uma moeda do sistema (aparece ou não nos seletores). */
export async function toggleCurrencyEnabled(
  code: string,
  enabled: boolean
): Promise<CurrencyActionState> {
  const gate = await ensureCanManage();
  if ("error" in gate) return { ok: false, message: gate.error };
  const supabase = await createClient();
  const { error } = await supabase
    .from("currencies")
    .update({ enabled })
    .eq("organization_id", gate.orgId)
    .eq("code", code);
  if (error) return { ok: false, message: error.message };
  revalidateAll();
  return { ok: true };
}

/**
 * Grava (ou limpa) uma taxa manual para (code, year, quarter). `rate` vazio/inválido
 * remove a linha. quarter 0 = anual; 1..4 = trimestral.
 */
export async function upsertCurrencyRate(
  code: string,
  year: number,
  quarter: number,
  rate: number | null
): Promise<CurrencyActionState> {
  const gate = await ensureCanManage();
  if ("error" in gate) return { ok: false, message: gate.error };
  const supabase = await createClient();
  if (rate == null || !Number.isFinite(rate)) {
    const { error } = await supabase
      .from("currency_rates")
      .delete()
      .eq("organization_id", gate.orgId)
      .eq("code", code)
      .eq("year", year)
      .eq("quarter", quarter);
    if (error) return { ok: false, message: error.message };
  } else {
    const { error } = await supabase.from("currency_rates").upsert(
      {
        organization_id: gate.orgId,
        code,
        year,
        quarter,
        rate,
        source: "manual",
        updated_at: new Date().toISOString(),
      },
      { onConflict: "organization_id,code,year,quarter" }
    );
    if (error) return { ok: false, message: error.message };
  }
  await recalcAllFormulaFields();
  revalidateAll();
  return { ok: true };
}

/**
 * Busca as médias PTAX (anual + T1..T4) de uma moeda num ano e grava as que
 * existirem (source='ptax'). Sobrescreve valores manuais e vice-versa.
 */
export async function refreshRatesFromPtax(
  code: string,
  year: number
): Promise<CurrencyActionState> {
  const gate = await ensureCanManage();
  if ("error" in gate) return { ok: false, message: gate.error };
  if (code.toUpperCase() === "BRL") {
    return { ok: false, message: "O Real é a moeda base (taxa fixa 1)." };
  }

  let rates;
  try {
    rates = await computeYearAndQuarters(code, year);
  } catch (e) {
    return { ok: false, message: `Falha ao consultar o PTAX: ${(e as Error).message}` };
  }

  const supabase = await createClient();
  const now = new Date().toISOString();
  const rows: {
    organization_id: string;
    code: string;
    year: number;
    quarter: number;
    rate: number;
    source: string;
    updated_at: string;
  }[] = [];
  const base = { organization_id: gate.orgId, code, year, source: "ptax", updated_at: now };
  if (rates.annual != null) rows.push({ ...base, quarter: 0, rate: rates.annual });
  rates.quarters.forEach((r, i) => {
    if (r != null) rows.push({ ...base, quarter: i + 1, rate: r });
  });

  if (rows.length === 0) {
    return { ok: false, message: "Sem cotações PTAX para o período." };
  }

  const { error } = await supabase
    .from("currency_rates")
    .upsert(rows, { onConflict: "organization_id,code,year,quarter" });
  if (error) return { ok: false, message: error.message };

  await recalcAllFormulaFields();
  revalidateAll();
  return { ok: true, message: `Taxas de ${code} (${year}) atualizadas pelo PTAX.` };
}
