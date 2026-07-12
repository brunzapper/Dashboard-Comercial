// Versão: 1.0 | Data: 12/07/2026
// Tela Configurações → Moedas (admin): habilita as moedas do sistema e mantém as
// taxas de conversão (R$ por 1 unidade) por ano/trimestre — manuais ou via PTAX.
import { requirePermission } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import {
  loadAllCurrencies,
  type SystemCurrency,
} from "@/lib/widgets/currency";
import {
  CurrenciesManager,
  type CurrencyRateRow,
} from "@/components/configuracoes/currencies-manager";

export default async function MoedasPage() {
  await requirePermission("manage_field_definitions");

  const supabase = await createClient();
  const [currencies, { data: ratesData }] = await Promise.all([
    loadAllCurrencies(supabase),
    supabase
      .from("currency_rates")
      .select("code, year, quarter, rate, source")
      .order("year", { ascending: false }),
  ]);

  const rates = (ratesData ?? []).map((r) => ({
    code: r.code as string,
    year: r.year as number,
    quarter: r.quarter as number,
    rate: Number(r.rate),
    source: (r.source as string | null) ?? null,
  })) as CurrencyRateRow[];

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Moedas</h1>
        <p className="text-muted-foreground text-sm">
          Habilite as moedas do sistema e informe a taxa média (R$ por 1 unidade)
          por ano e por trimestre. Use &quot;Atualizar agora&quot; para preencher
          pela média do PTAX (Banco Central) — a taxa do trimestre tem prioridade
          sobre a anual; o Real é a base (taxa 1).
        </p>
      </div>
      <CurrenciesManager
        currencies={currencies as SystemCurrency[]}
        rates={rates}
      />
    </div>
  );
}
