// Versão: 1.0 | Data: 20/07/2026
// Loader dos dias não úteis (tabela non_working_days, migração 0081) como
// Set<"YYYY-MM-DD"> para os utilitários de lib/date/business-days.ts.
// Mesma resiliência dos demais loaders de lib/config/: qualquer falha (tabela
// ausente pré-migração, erro de rede) devolve Set vazio — o cálculo de dia
// útil degrada para "seg–sex" em vez de quebrar o dashboard.
// RLS: leitura p/ autenticados; o viewer público de snapshots carrega via
// service role (PASSTHROUGH_TABLES em lib/snapshots/db-adapter.ts), sem
// policy anon (regra do projeto).
import { cache } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";

export interface NonWorkingDay {
  day: string; // ISO "YYYY-MM-DD"
  label: string;
}

/** Set de dias não úteis (chave do cálculo de dia útil). */
export const loadNonWorkingDays = cache(async function loadNonWorkingDays(
  supabase: SupabaseClient
): Promise<Set<string>> {
  try {
    const { data, error } = await supabase
      .from("non_working_days")
      .select("day");
    if (error || !data) return new Set();
    return new Set(
      data
        .map((r) => String(r.day ?? "").slice(0, 10))
        .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))
    );
  } catch {
    return new Set();
  }
});

/** Lista completa (data + rótulo) para a UI de Configurações → Metas. */
export const loadNonWorkingDayRows = cache(
  async function loadNonWorkingDayRows(
    supabase: SupabaseClient
  ): Promise<NonWorkingDay[]> {
    try {
      const { data, error } = await supabase
        .from("non_working_days")
        .select("day, label")
        .order("day", { ascending: true });
      if (error || !data) return [];
      return data
        .map((r) => ({
          day: String(r.day ?? "").slice(0, 10),
          label: String(r.label ?? ""),
        }))
        .filter((r) => /^\d{4}-\d{2}-\d{2}$/.test(r.day));
    } catch {
      return [];
    }
  }
);
