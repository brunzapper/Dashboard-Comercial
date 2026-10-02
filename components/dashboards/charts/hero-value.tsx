"use client";
// Versão: 1.0 | Data: 02/10/2026
// v1.0 (02/10/2026): NÚMERO-HERÓI dos cards. Num dashboard com estilo, o
//   valor grande sai em três partes — símbolo e unidade a ~40% do tamanho, em
//   cinza, e o número na fonte de exibição ("R$ 4,2 mi"); `compact` reescreve
//   o número em escala (appearance.kpiCompact). No Clássico (sem compact) o
//   texto sai como sempre saiu — o mesmo nó de texto, byte-idêntico.
import { compactNumber, splitValueText } from "@/lib/widgets/format";

export function HeroValue({
  text,
  value,
  styled,
  compact = false,
}: {
  /** O valor já formatado (o que o card exibiria). */
  text: string;
  /** O número cru — só usado com `compact`. */
  value?: number | null;
  styled: boolean;
  compact?: boolean;
}) {
  let parts = splitValueText(text);
  if (compact && typeof value === "number" && Number.isFinite(value)) {
    const c = compactNumber(value);
    // Percentual não ganha escala (o sufixo "%" já é a unidade).
    if (parts.suffix !== "%" && c.suffix) {
      parts = { prefix: parts.prefix, number: c.number, suffix: c.suffix };
    }
  }
  if (!styled) {
    if (!compact) return <>{text}</>;
    return (
      <>{[parts.prefix, parts.number, parts.suffix].filter(Boolean).join(" ")}</>
    );
  }
  return (
    <span className="inline-flex items-baseline gap-[0.12em]">
      {parts.prefix ? (
        <span className="text-muted-foreground text-[0.4em] font-normal">
          {parts.prefix}
        </span>
      ) : null}
      <span>{parts.number}</span>
      {parts.suffix ? (
        <span className="text-muted-foreground text-[0.4em] font-normal">
          {parts.suffix}
        </span>
      ) : null}
    </span>
  );
}
