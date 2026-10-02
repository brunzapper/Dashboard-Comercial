// Versão: 1.0 | Data: 02/10/2026
// v1.0 (02/10/2026): aritmética PURA de meses (AAAA-MM) do seletor de meses
//   (components/ui/month-range-picker.tsx). Os meses da Tree e das colunas de
//   meta eram digitados como texto ("2026-10, 2026-11"); o seletor monta a
//   lista por intervalo de/até e por atalhos (trimestre, ano, próximos N).

export function monthKey(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, "0")}`;
}

/** Soma `n` meses a uma chave AAAA-MM. */
export function addMonths(key: string, n: number): string {
  const y = Number(key.slice(0, 4));
  const m = Number(key.slice(5, 7));
  const idx = y * 12 + (m - 1) + n;
  return monthKey(Math.floor(idx / 12), (idx % 12) + 1);
}

/** Meses de `from` a `to` (inclusive), no máximo `max`. Invertido ⇒ troca. */
export function monthSpan(from: string, to: string, max: number): string[] {
  let a = from;
  let b = to;
  if (a > b) [a, b] = [b, a];
  const out: string[] = [];
  for (let k = a; k <= b && out.length < max; k = addMonths(k, 1)) out.push(k);
  return out;
}

/** Atalhos relativos a hoje (AAAA-MM-DD), resolvidos em meses FIXOS. */
export function monthPreset(
  preset: "trimestre" | "proximo_trimestre" | "ano" | "proximos3" | "ultimos3",
  todayIso: string
): string[] {
  const y = Number(todayIso.slice(0, 4));
  const m = Number(todayIso.slice(5, 7));
  const cur = monthKey(y, m);
  const qStart = monthKey(y, Math.floor((m - 1) / 3) * 3 + 1);
  switch (preset) {
    case "trimestre":
      return monthSpan(qStart, addMonths(qStart, 2), 12);
    case "proximo_trimestre":
      return monthSpan(addMonths(qStart, 3), addMonths(qStart, 5), 12);
    case "ano":
      return monthSpan(monthKey(y, 1), monthKey(y, 12), 12);
    case "proximos3":
      return monthSpan(cur, addMonths(cur, 2), 12);
    case "ultimos3":
      return monthSpan(addMonths(cur, -2), cur, 12);
  }
}
