// Versão: 1.0 | Data: 12/07/2026
// Server Actions da tela Configurações → Moedas. Habilita/desabilita moedas do
// sistema e mantém as taxas de conversão (R$ por 1 unidade) por ano/trimestre —
// à mão OU via média PTAX do Banco Central. RLS de currencies/currency_rates
// exige manage_field_definitions (admin). Regra = último a escrever vence.
"use server";

import { revalidatePath } from "next/cache";

import { getSessionInfo } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { recalcAllFormulaFields } from "@/lib/records/recalc";
import { computeYearAndQuarters } from "@/lib/widgets/ptax";

export interface CurrencyActionState {
  ok?: boolean;
  message?: string;
}

async function ensureCanManage(): Promise<string | null> {
  const session = await getSessionInfo();
  if (!session) return "Sessão expirada.";
  if (!session.permissions.includes("manage_field_definitions")) {
    return "Apenas administradores podem gerenciar moedas.";
  }
  return null;
}

function revalidateAll() {
  revalidatePath("/configuracoes/moedas");
  revalidatePath("/registros");
  revalidatePath("/dashboards/[id]", "page");
}

/** Liga/desliga uma moeda do sistema (aparece ou não nos seletores). */
export async function toggleCurrencyEnabled(
  code: string,
  enabled: boolean
): Promise<void> {
  const err = await ensureCanManage();
  if (err) return;
  const supabase = await createClient();
  await supabase.from("currencies").update({ enabled }).eq("code", code);
  revalidateAll();
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
): Promise<void> {
  const err = await ensureCanManage();
  if (err) return;
  const supabase = await createClient();
  if (rate == null || !Number.isFinite(rate)) {
    await supabase
      .from("currency_rates")
      .delete()
      .eq("code", code)
      .eq("year", year)
      .eq("quarter", quarter);
  } else {
    await supabase.from("currency_rates").upsert(
      { code, year, quarter, rate, source: "manual", updated_at: new Date().toISOString() },
      { onConflict: "code,year,quarter" }
    );
  }
  await recalcAllFormulaFields();
  revalidateAll();
}

/**
 * Busca as médias PTAX (anual + T1..T4) de uma moeda num ano e grava as que
 * existirem (source='ptax'). Sobrescreve valores manuais e vice-versa.
 */
export async function refreshRatesFromPtax(
  code: string,
  year: number
): Promise<CurrencyActionState> {
  const err = await ensureCanManage();
  if (err) return { ok: false, message: err };
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
    code: string;
    year: number;
    quarter: number;
    rate: number;
    source: string;
    updated_at: string;
  }[] = [];
  if (rates.annual != null)
    rows.push({ code, year, quarter: 0, rate: rates.annual, source: "ptax", updated_at: now });
  rates.quarters.forEach((r, i) => {
    if (r != null)
      rows.push({ code, year, quarter: i + 1, rate: r, source: "ptax", updated_at: now });
  });

  if (rows.length === 0) {
    return { ok: false, message: "Sem cotações PTAX para o período." };
  }

  const { error } = await supabase
    .from("currency_rates")
    .upsert(rows, { onConflict: "code,year,quarter" });
  if (error) return { ok: false, message: error.message };

  await recalcAllFormulaFields();
  revalidateAll();
  return { ok: true, message: `Taxas de ${code} (${year}) atualizadas pelo PTAX.` };
}
