// Versão: 1.0 | Data: 17/09/2026
// O rótulo de um período de lançamento, em pt-BR — dono ÚNICO da frase.
// Vive fora de components/ porque o core do assistente (server-only) também o
// usa para montar a prévia; duplicar a formatação faria a prévia e a grade
// falarem de "Agosto/2026" e "01/08/2026 – 31/08/2026" para a mesma linha.
const MESES_PT = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];

const br = (iso: string): string => {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
};

/** Último dia do mês de um `YYYY-MM` (aritmética UTC — sem fuso). */
export function monthEndOf(ym: string): string {
  const m = ym.match(/^(\d{4})-(\d{2})/);
  if (!m) return ym;
  const last = new Date(Date.UTC(Number(m[1]), Number(m[2]), 0)).getUTCDate();
  return `${m[1]}-${m[2]}-${String(last).padStart(2, "0")}`;
}

/** Mês cheio vira "Agosto/2026" — que é como quem lança pensa. */
export function manualPeriodLabelOf(start: string, end: string): string {
  if (start === end) return br(start);
  const m = start.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m && m[3] === "01" && end === monthEndOf(start.slice(0, 7))) {
    return `${MESES_PT[Number(m[2]) - 1]}/${m[1]}`;
  }
  return `${br(start)} – ${br(end)}`;
}
