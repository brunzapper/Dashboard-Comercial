// Versão: 1.0 | Data: 11/07/2026
// Formatação monetária por MOEDA do registro. Cada registro tem uma coluna
// `currency` (código ISO: "BRL", "USD", …) vinda do Bitrix. Até então todos os
// valores eram formatados como Real (BRL) fixo; aqui passamos a respeitar a moeda
// do registro (Real=BRL → R$, Dólar=USD → US$), com fallback para BRL quando o
// código está vazio/desconhecido. Também exportamos a lista de opções usada no
// select de edição da coluna Moeda.

// Opções do select de edição da coluna `currency` (registros individuais e a tela
// de Registros). O `value` é o código ISO gravado (e enviado ao Bitrix no
// write-back via CURRENCY_ID).
export const CURRENCY_OPTIONS: { value: string; label: string }[] = [
  { value: "BRL", label: "Real (R$)" },
  { value: "USD", label: "Dólar (US$)" },
  { value: "EUR", label: "Euro (€)" },
  { value: "GBP", label: "Libra (£)" },
  { value: "ARS", label: "Peso argentino ($)" },
];

// Código de moeda efetivo: usa o do registro quando é um código ISO de 3 letras;
// senão cai no BRL (comportamento legado).
export function resolveCurrencyCode(code?: string | null): string {
  const c = (code ?? "").trim().toUpperCase();
  return /^[A-Z]{3}$/.test(c) ? c : "BRL";
}

/**
 * Formata um valor monetário na moeda do registro. `value` pode ser number,
 * string numérica ou null; retorna "—" quando não é um número finito.
 */
export function formatMoney(value: unknown, currencyCode?: string | null): string {
  if (value == null || value === "") return "—";
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString("pt-BR", {
    style: "currency",
    currency: resolveCurrencyCode(currencyCode),
  });
}
