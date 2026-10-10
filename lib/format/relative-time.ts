// Versão: 1.0 | Data: 10/10/2026
// v1.0 (10/10/2026): "há 2 min", "ontem", "há 3 sem" — coluna "última
//   abertura" da lista densa de Painéis. PURO (o `now` é argumento) para o
//   teste não depender do relógio. Data ausente/ inválida ⇒ "—": a lista não
//   inventa um "nunca" que a ausência de visita não prova.

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

export function relativeTimeLabel(
  iso: string | null | undefined,
  now: number = Date.now()
): string {
  if (!iso) return "—";
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return "—";
  const diff = Math.max(0, now - at);
  if (diff < MIN) return "agora";
  if (diff < HOUR) return `há ${Math.floor(diff / MIN)} min`;
  if (diff < DAY) return `há ${Math.floor(diff / HOUR)} h`;
  const days = Math.floor(diff / DAY);
  if (days === 1) return "ontem";
  if (days < 7) return `há ${days} d`;
  if (days < 30) return `há ${Math.floor(days / 7)} sem`;
  const months = Math.floor(days / 30);
  if (months < 12) return months === 1 ? "há 1 mês" : `há ${months} meses`;
  const years = Math.floor(days / 365);
  return years <= 1 ? "há 1 ano" : `há ${years} anos`;
}

/** Iniciais de um nome ("Paula Costa" ⇒ "PC"; "Júlio" ⇒ "JÚ"). */
export function nameInitials(name: string | null | undefined): string {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
