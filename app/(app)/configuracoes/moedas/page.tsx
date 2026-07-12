// Versão: 1.1 | Data: 12/07/2026
// Tela Configurações → Moedas: mostra as moedas do sistema e as taxas de conversão
// (R$ por 1 unidade) por ano/trimestre. Admin (manage_field_definitions) edita;
// gestor/vendedor veem em modo somente leitura. A RLS de currencies/currency_rates
// libera a leitura para qualquer autenticado; a escrita segue restrita.
import { requireSession } from "@/lib/auth/session";
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
  const session = await requireSession();
  const canManage = session.permissions.includes("manage_field_definitions");

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
          {canManage
            ? 'Habilite as moedas do sistema e informe a taxa média (R$ por 1 unidade) por ano e por trimestre. Use "Atualizar agora" para preencher pela média do PTAX (Banco Central) — a taxa do trimestre tem prioridade sobre a anual; o Real é a base (taxa 1).'
            : "Moedas do sistema e suas taxas de conversão (R$ por 1 unidade) por ano e trimestre. Somente leitura."}
        </p>
      </div>
      <CurrenciesManager
        currencies={currencies as SystemCurrency[]}
        rates={rates}
        readOnly={!canManage}
      />
    </div>
  );
}
