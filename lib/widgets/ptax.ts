// Versão: 1.0 | Data: 12/07/2026
// Fonte automática das taxas cambiais: PTAX do Banco Central (API Olinda,
// pública, sem chave). Busca a série de cotações de FECHAMENTO de uma moeda num
// período e devolve a MÉDIA de `cotacaoVenda` (R$ por 1 unidade da moeda). Usada
// pelo botão "Atualizar agora" da tela Configurações → Moedas para preencher a
// taxa anual e as 4 trimestrais de um ano.
//   ⚠️ Em produção o host `olinda.bcb.gov.br` precisa estar liberado na política
//   de rede do ambiente.

const OLINDA_BASE =
  "https://olinda.bcb.gov.br/olinda/servico/PTAX/versao/v1/odata";

const PAGE_PAUSE_MS = 300;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// A API Olinda espera datas no formato MM-DD-AAAA.
function fmtDate(d: Date): string {
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${mm}-${dd}-${d.getUTCFullYear()}`;
}

interface PtaxRow {
  cotacaoCompra: number;
  cotacaoVenda: number;
  dataHoraCotacao: string;
  tipoBoletim: string;
}

/**
 * Média de `cotacaoVenda` (R$ por 1 unidade) dos boletins de Fechamento da moeda
 * no período [dataInicial, dataFinal]. BRL = 1. Retorna null quando não há dados
 * (período sem pregões, moeda não coberta, etc.).
 */
export async function fetchPtaxAverage(
  code: string,
  dataInicial: Date,
  dataFinal: Date
): Promise<number | null> {
  const c = code.trim().toUpperCase();
  if (c === "BRL") return 1;
  if (dataFinal < dataInicial) return null;

  const fn =
    "CotacaoMoedaPeriodo(moeda=@moeda,dataInicial=@dataInicial,dataFinalCotacao=@dataFinalCotacao)";
  const qs = new URLSearchParams({
    "@moeda": `'${c}'`,
    "@dataInicial": `'${fmtDate(dataInicial)}'`,
    "@dataFinalCotacao": `'${fmtDate(dataFinal)}'`,
    $format: "json",
    $select: "cotacaoVenda,dataHoraCotacao,tipoBoletim",
  });
  const url = `${OLINDA_BASE}/${fn}?${qs.toString()}`;

  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) {
    throw new Error(`PTAX ${c}: HTTP ${res.status}`);
  }
  const json = (await res.json()) as { value?: PtaxRow[] };
  const rows = (json.value ?? []).filter(
    (r) => r.tipoBoletim === "Fechamento" && Number.isFinite(Number(r.cotacaoVenda))
  );
  if (rows.length === 0) return null;
  const sum = rows.reduce((s, r) => s + Number(r.cotacaoVenda), 0);
  return sum / rows.length;
}

export interface YearQuarterRates {
  annual: number | null;
  quarters: [number | null, number | null, number | null, number | null];
}

// Intervalo [início, fim] de um trimestre (1..4) de um ano, em UTC.
function quarterRange(year: number, quarter: number): [Date, Date] {
  const startMonth = (quarter - 1) * 3; // 0,3,6,9
  const start = new Date(Date.UTC(year, startMonth, 1));
  const end = new Date(Date.UTC(year, startMonth + 3, 0)); // último dia do trimestre
  return [start, end];
}

/**
 * Calcula a média anual + as 4 médias trimestrais de uma moeda num ano. No ano
 * corrente, o fim de cada janela é limitado a "hoje" (sem cotações futuras).
 */
export async function computeYearAndQuarters(
  code: string,
  year: number
): Promise<YearQuarterRates> {
  const today = new Date();
  const cap = (d: Date): Date => (d > today ? today : d);

  const yearStart = new Date(Date.UTC(year, 0, 1));
  const yearEnd = cap(new Date(Date.UTC(year, 11, 31)));

  const annual =
    yearEnd < yearStart ? null : await fetchPtaxAverage(code, yearStart, yearEnd);

  const quarters: (number | null)[] = [];
  for (let q = 1; q <= 4; q++) {
    const [qStart, qEndRaw] = quarterRange(year, q);
    const qEnd = cap(qEndRaw);
    if (qEnd < qStart) {
      quarters.push(null);
      continue;
    }
    await sleep(PAGE_PAUSE_MS);
    quarters.push(await fetchPtaxAverage(code, qStart, qEnd));
  }

  return {
    annual,
    quarters: quarters as YearQuarterRates["quarters"],
  };
}
