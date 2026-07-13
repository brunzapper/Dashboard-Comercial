// Versão: 1.0 | Data: 13/07/2026
// "Hoje" no fuso de Brasília (America/Sao_Paulo). O resto do código usa
// `new Date()` cru (UTC/local) — aqui centralizamos o dia atual em BRT p/ o
// campo sintético "Data atual" (coluna, KPI e operando de fórmula).
// Nada é armazenado por registro: estes helpers são chamados na leitura/cálculo.

const BRASILIA_TZ = "America/Sao_Paulo";

// Formata com en-CA para obter exatamente "YYYY-MM-DD" no fuso de Brasília.
const ISO_FMT = new Intl.DateTimeFormat("en-CA", {
  timeZone: BRASILIA_TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** Data de hoje em Brasília no formato ISO "YYYY-MM-DD". */
export function todayBrasiliaIso(now: Date = new Date()): string {
  return ISO_FMT.format(now);
}

/**
 * Meia-noite (UTC) do dia de hoje em Brasília, em epoch ms. Casa com como as
 * demais datas são parseadas no motor de fórmulas (`Date.parse("2026-07-13")`
 * = meia-noite UTC), então `data − hoje` continua dando dias inteiros corretos.
 */
export function todayBrasiliaMs(now: Date = new Date()): number {
  const [y, m, d] = todayBrasiliaIso(now).split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}
