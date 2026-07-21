// Versão: 1.0 | Data: 21/07/2026
// Badge "Nº dia útil": mostra qual referência de dia útil o alinhamento
// (businessDayAlign) está exibindo no momento — N único, compartilhado entre
// os meses comparados (WidgetData.businessDayRef, computado pelo engine).
// Peça reutilizável: qualquer card com o meta pode renderizá-la (dashboard
// vivo e viewer de snapshot).
import { businessDayOrdinalLabel } from "@/lib/date/business-days";
import type { WidgetData } from "@/lib/widgets/types";

export function BusinessDayBadge({
  bdRef,
}: {
  bdRef: NonNullable<WidgetData["businessDayRef"]>;
}) {
  const [y, m, d] = bdRef.date.split("-");
  const refDay = d && m ? `${d}/${m}${y ? `/${y}` : ""}` : bdRef.date;
  const refLabel =
    bdRef.reference === "period_end"
      ? `fim do período (${refDay})`
      : `hoje (${refDay})`;
  return (
    <span
      className="text-muted-foreground rounded-full border border-dashed px-2 py-0.5 text-[10px] font-semibold"
      title={`Meses comparados até o ${businessDayOrdinalLabel(bdRef.n)} — referência: ${refLabel}`}
    >
      {businessDayOrdinalLabel(bdRef.n)}
    </span>
  );
}
