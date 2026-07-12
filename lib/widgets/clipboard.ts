// Versão: 1.0 | Data: 12/07/2026
// "Área de transferência" de widgets (copiar/colar). Guardada em localStorage
// para funcionar entre dashboards e entre abas do navegador (mesma origem,
// leitura síncrona). Não há store global no projeto — o colar reaproveita a
// Server Action createWidget passando os campos aqui serializados.
import type { SourceKey } from "@/lib/sources";
import type {
  Dimension,
  GridPosition,
  Metric,
  Widget,
  WidgetFilter,
  WidgetSettings,
  VisualType,
} from "./types";

const WIDGET_CLIPBOARD_KEY = "dc:widget-clipboard";

// Campos copiáveis de um widget (sem id/dashboard/posição absoluta). O tamanho
// (w/h) viaja junto para preservar as dimensões no colar; a aba (settings.tab) é
// removida aqui e redefinida no destino (aba ativa).
export interface CopiedWidget {
  title: string | null;
  visual_type: VisualType;
  sources?: SourceKey[];
  splitBySource?: boolean;
  dimensions: Dimension[];
  metrics: Metric[];
  filters: WidgetFilter[];
  settings?: WidgetSettings;
  w: number;
  h: number;
}

export function copyWidget(widget: Widget): void {
  if (typeof window === "undefined") return;
  const pos = widget.grid_position as GridPosition;
  const w = typeof pos?.w === "number" ? pos.w : 6;
  const h = typeof pos?.h === "number" ? pos.h : 8;
  // Descarta a aba de origem — o colar decide a aba no destino.
  const settings: WidgetSettings = { ...(widget.settings ?? {}) };
  delete settings.tab;
  const payload: CopiedWidget = {
    title: widget.title,
    visual_type: widget.visual_type,
    sources: widget.sources,
    splitBySource: widget.split_by_source,
    dimensions: widget.dimensions,
    metrics: widget.metrics,
    filters: widget.filters,
    settings,
    w,
    h,
  };
  try {
    window.localStorage.setItem(WIDGET_CLIPBOARD_KEY, JSON.stringify(payload));
  } catch {
    // localStorage indisponível (modo privado/cheio) — copiar vira no-op.
  }
}

export function readCopiedWidget(): CopiedWidget | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(WIDGET_CLIPBOARD_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as CopiedWidget;
  } catch {
    return null;
  }
}
