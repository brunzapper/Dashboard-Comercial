// Versão: 1.1 | Data: 25/07/2026
// v1.1 (25/07/2026): espaço de grid v2 — o payload carrega `gridVersion` e um
//   payload ANTIGO (base 12, sem o campo) é convertido no readCopiedWidget
//   (w/h ×10−1/×4−1 + traçado de linha ×10/×4) — colar algo copiado antes da
//   grade fina continua com o tamanho visual original.
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
import { GRID_VERSION, X_SCALE, Y_SCALE, convertLegacyLine } from "./grid-space";

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
  // Espaço de grid do payload: 2 = unidades finas (grid-space). AUSENTE =
  // payload de antes da grade fina (base 12) — convertido na leitura.
  gridVersion?: number;
}

export function copyWidget(widget: Widget): void {
  if (typeof window === "undefined") return;
  // O widget em tela já está no espaço FINO (normalizeGridSpace na page).
  const pos = widget.grid_position as GridPosition;
  const w = typeof pos?.w === "number" ? pos.w : 59;
  const h = typeof pos?.h === "number" ? pos.h : 31;
  // Descarta a aba de origem — o colar decide a aba no destino. `pages` também
  // fica: a cópia referenciaria os MESMOS widgets-membro do original (a cópia
  // nasce sem páginas, documentado).
  const settings: WidgetSettings = { ...(widget.settings ?? {}) };
  delete settings.tab;
  delete settings.pages;
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
    gridVersion: GRID_VERSION,
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
    const parsed = JSON.parse(raw) as CopiedWidget;
    if (parsed.gridVersion === GRID_VERSION) return parsed;
    // Payload antigo (base 12): converte tamanho e, se for linha, o traçado.
    const conv: CopiedWidget = {
      ...parsed,
      gridVersion: GRID_VERSION,
      w: Math.max(1, Math.round((parsed.w || 6) * X_SCALE) - 1),
      h: Math.max(1, Math.round((parsed.h || 8) * Y_SCALE) - 1),
    };
    const line = parsed.settings?.shape?.line;
    if (line) {
      conv.settings = {
        ...parsed.settings,
        shape: { ...parsed.settings?.shape, line: convertLegacyLine(line) },
      };
    }
    return conv;
  } catch {
    return null;
  }
}
