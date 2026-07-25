// Versão: 1.0 | Data: 25/07/2026
// Espaço de grid v2 ("grade fina"): a célula deixa de ser ancorada em 12
// colunas com margens de 12px e passa a BASE_COLS (120) colunas SEM margens,
// com linha default quadrada (rowHeight = largura da célula). Unidades de
// grid_position/ShapeLine ficam 10× mais finas no X e 4× no Y.
//
// Compatibilidade: dashboards/JSONs/clipboards gravados no espaço legado
// (base 12) são detectados pela AUSÊNCIA de settings.canvas.gridVersion e
// convertidos por normalizeGridSpace — runtime puro, idempotente. A conversão
// runtime é OBRIGATÓRIA (não basta backfill em `widgets`): o viewer público lê
// snapshots.config, um jsonb CONGELADO no refresh que um backfill não alcança.
// A persistência em unidades finas é garantida no write-path (ensureFineGrid
// nas actions) + runbook supabase/apply/backfill-grid-v2.sql.
//
// Matemática da conversão (pitch legado X = cellW+12px, Y = rowHeight+12px):
// - x → x·10; y → y·4; w → w·10−1; h → h·4−1 — o "−1" preserva o vão visual
//   de ~1 célula fina onde as margens de 12px davam o respiro entre cards.
// - rowHeight convertido é gravado EXPLÍCITO: (rowHeightLegado+12)/4 (default
//   30 → 10.5px). Sem isso o board migrado cairia no default quadrado
//   (responsivo) e esticaria/encolheria verticalmente conforme a viewport —
//   o legado tinha altura em px fixos. Board NOVO (sem canvas) fica no
//   quadrado. Aceita fração (10.5) — o RGL multiplica, não exige inteiro.
// - ShapeLine (fracionária) escala sem o −1; o grid_position da linha é o
//   bbox DERIVADO do traçado convertido (lineGridBBox), como no saveShapeLine.
// Puro (sem IO/DOM) — testado em grid-space.test.ts.

import type {
  DashboardSettings,
  GridPosition,
  ShapeLine,
  Widget,
  WidgetSettings,
} from "./types";
import { isLineShapeWidget, lineGridBBox } from "./lines";

export const GRID_VERSION = 2;
// Densidade default: colunas que preenchem a largura visível (10× as 12 de antes).
export const BASE_COLS = 120;
// Limites do canvas em unidades finas (antes 48/200 no espaço base-12).
export const GRID_MAX_COLS = 480;
export const GRID_MAX_ROWS = 800;
export const GRID_MIN_ROWS = 32;
// Fatores de conversão legado → fino.
export const X_SCALE = 10;
export const Y_SCALE = 4;

const LEGACY_ROW_H = 30;
const LEGACY_MARGIN = 12;

type Canvas = NonNullable<DashboardSettings["canvas"]>;

/** O espaço deste dashboard já é o fino (v2)? */
export function isFineGrid(
  settings: DashboardSettings | null | undefined
): boolean {
  return settings?.canvas?.gridVersion === GRID_VERSION;
}

/** grid_position preenchido? (o default do banco é '{}' — fallback do posOf). */
export function hasGridPos(
  p: Widget["grid_position"]
): p is GridPosition {
  return !!p && typeof (p as GridPosition).w === "number";
}

/** Converte uma posição do espaço legado (base 12) para o fino (base 120). */
export function convertLegacyPos(p: GridPosition): GridPosition {
  return {
    x: Math.max(0, Math.round(p.x * X_SCALE)),
    y: Math.max(0, Math.round(p.y * Y_SCALE)),
    w: Math.max(1, Math.round(p.w * X_SCALE) - 1),
    h: Math.max(1, Math.round(p.h * Y_SCALE) - 1),
  };
}

/** Converte um traçado de linha (coordenadas fracionárias — sem o −1). */
export function convertLegacyLine(l: ShapeLine): ShapeLine {
  return {
    x1: l.x1 * X_SCALE,
    y1: l.y1 * Y_SCALE,
    x2: l.x2 * X_SCALE,
    y2: l.y2 * Y_SCALE,
  };
}

/**
 * Converte settings.canvas legado e carimba gridVersion. rowHeight sai SEMPRE
 * explícito (fidelidade vertical do board migrado — ver cabeçalho).
 */
export function convertLegacyCanvas(c: Canvas | undefined): Canvas {
  const legacy = c ?? {};
  const legacyRowH =
    typeof legacy.rowHeight === "number" && legacy.rowHeight > 0
      ? legacy.rowHeight
      : LEGACY_ROW_H;
  const out: Canvas = {
    ...legacy,
    gridVersion: GRID_VERSION,
    rowHeight: (legacyRowH + LEGACY_MARGIN) / Y_SCALE,
  };
  if (typeof legacy.cols === "number" && legacy.cols > 0) {
    out.cols = Math.min(GRID_MAX_COLS, Math.round(legacy.cols * X_SCALE));
  }
  if (typeof legacy.rows === "number" && legacy.rows > 0) {
    out.rows = Math.min(GRID_MAX_ROWS, Math.round(legacy.rows * Y_SCALE));
  }
  return out;
}

/** Converte UM widget legado (posição + traçado de linha, se houver). */
export function convertLegacyWidget(w: Widget): Widget {
  const line = w.settings?.shape?.line;
  if (isLineShapeWidget(w) && line) {
    const fine = convertLegacyLine(line);
    return {
      ...w,
      grid_position: lineGridBBox(fine),
      settings: { ...w.settings, shape: { ...w.settings?.shape, line: fine } },
    };
  }
  if (!hasGridPos(w.grid_position)) return w; // '{}' → fallback fino do posOf
  return { ...w, grid_position: convertLegacyPos(w.grid_position) };
}

/**
 * Choke point da leitura: dashboard legado → espaço fino, em memória, sem
 * mutar as entradas. Idempotente — gridVersion 2 devolve as referências
 * originais (changed: false).
 */
export function normalizeGridSpace(
  settings: DashboardSettings,
  widgets: Widget[]
): { settings: DashboardSettings; widgets: Widget[]; changed: boolean } {
  if (isFineGrid(settings)) return { settings, widgets, changed: false };
  return {
    settings: { ...settings, canvas: convertLegacyCanvas(settings.canvas) },
    widgets: widgets.map(convertLegacyWidget),
    changed: true,
  };
}

// Forma estrutural mínima de um PresetDashboard (lib/presets/definitions) —
// redeclarada aqui para lib/ não importar de presets (direção da dependência).
type PresetLike = {
  settings?: DashboardSettings;
  widgets: Array<{
    visual_type: Widget["visual_type"];
    settings?: WidgetSettings;
    grid_position: GridPosition;
  }>;
};

/**
 * Versão do normalizador para definições de PRESET/JSON importado (widgets sem
 * id, com grid_position obrigatório). O canvas sai SEMPRE carimbado (um
 * dashboard CRIADO a partir do preset precisa nascer v2 — sem o carimbo, a
 * leitura reconverteria as posições já finas). O aplicador
 * (applyPresetDefinition) decide se o canvas gerido sobrescreve o do alvo.
 */
export function normalizePresetGridSpace<T extends PresetLike>(preset: T): T {
  if (preset.settings?.canvas?.gridVersion === GRID_VERSION) return preset;
  return {
    ...preset,
    settings: {
      ...(preset.settings ?? {}),
      canvas: convertLegacyCanvas(preset.settings?.canvas),
    },
    widgets: preset.widgets.map((w) => {
      const line = w.settings?.shape?.line;
      if (isLineShapeWidget(w) && line) {
        const fine = convertLegacyLine(line);
        return {
          ...w,
          grid_position: lineGridBBox(fine),
          settings: {
            ...w.settings,
            shape: { ...w.settings?.shape, line: fine },
          },
        };
      }
      return { ...w, grid_position: convertLegacyPos(w.grid_position) };
    }),
  };
}
